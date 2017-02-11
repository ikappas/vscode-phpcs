/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
	TextDocumentIdentifier, TextDocumentChangeEvent
} from 'vscode-languageserver-types';

import {
	IPCMessageReader, IPCMessageWriter,
	createConnection, IConnection, TextDocumentSyncKind,
	TextDocuments, TextDocument, Diagnostic, DiagnosticSeverity,
	InitializeParams, InitializeResult, InitializeError,
	DidChangeConfigurationParams, DidChangeWatchedFilesParams,
	ErrorMessageTracker, PublishDiagnosticsParams, Files, ResponseError
} from 'vscode-languageserver';

import * as os from "os";
import * as url from "url";
import * as proto from "./protocol";
import { PhpcsLinter, PhpcsSettings } from "./linter";

class PhpcsServer {

    private connection: IConnection;
    private settings: PhpcsSettings;
    private ready: boolean = false;
    private documents: TextDocuments;
    private linter: PhpcsLinter;
	private rootPath: string;
	private _validating: { [uri: string]: TextDocument };

	/**
	 * Class constructor.
	 *
	 * @return A new instance of the server.
	 */
    constructor() {
		this._validating = Object.create(null);
        this.connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
        this.documents = new TextDocuments();
        this.documents.listen(this.connection);
        this.connection.onInitialize((params) => {
            return this.onInitialize(params);
        });
        this.connection.onDidChangeConfiguration((params) => {
            this.onDidChangeConfiguration(params);
        });
        this.connection.onDidChangeWatchedFiles((params) => {
            this.onDidChangeWatchedFiles(params);
        });
        this.documents.onDidOpen((event) => {
            this.onDidOpenDocument(event);
        });
        this.documents.onDidSave((event) => {
            this.onDidSaveDocument(event);
        });
		this.documents.onDidClose((event) => {
            this.onDidCloseDocument(event);
        });
    }

	/**
	 * Handles server initialization.
	 *
	 * @param params The initialization parameters.
	 * @return A promise of initialization result or initialization error.
	 */
    private onInitialize(params: InitializeParams) : Thenable<InitializeResult | ResponseError<InitializeError>> {
		this.rootPath = params.rootPath;
		return PhpcsLinter.resolvePath(this.rootPath).then((linter): InitializeResult | ResponseError<InitializeError> => {
			this.linter = linter;
			let result: InitializeResult = { capabilities: { textDocumentSync: this.documents.syncKind } };
			return result;
		}, (error) => {
			return Promise.reject(
				new ResponseError<InitializeError>(99,
				error,
				{ retry: true }));
		});
    }
	/**
	 * Handles configuration changes.
	 *
	 * @param params The changed configuration parameters.
	 * @return void
	 */
    private onDidChangeConfiguration(params: DidChangeConfigurationParams): void {
        this.settings = params.settings.phpcs;
        this.ready = true;
        this.validateMany(this.documents.all());
    }

	/**
	 * Handles watched files changes.
	 *
	 * @param params The changed watched files parameters.
	 * @return void
	 */
	private onDidChangeWatchedFiles(params: DidChangeWatchedFilesParams) : void {
		this.validateMany(this.documents.all());
	}

	/**
	 * Handles opening of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private onDidOpenDocument(event: TextDocumentChangeEvent ) : void {
		this.validateSingle(event.document);
	}

	/**
	 * Handles saving of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private onDidSaveDocument(event: TextDocumentChangeEvent ) : void {
		this.validateSingle(event.document);
	}

	/**
	 * Handles closing of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private onDidCloseDocument(event: TextDocumentChangeEvent ) : void {
  		this.connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
	}

	/**
	 * Start listening to requests.
	 *
	 * @return void
	 */
    public listen(): void {
        this.connection.listen();
    }

	/**
	 * Validate a single text document.
	 *
	 * @param document The text document to validate.
	 * @return void
	 */
    public validateSingle(document: TextDocument): void {
		let docUrl = url.parse(document.uri);

		// Only process file documents.
		if (docUrl.protocol == "file:" && this._validating[document.uri] === undefined ) {
			this._validating[ document.uri ] = document;
			this.sendStartValidationNotification(document);
			this.linter.lint(document, this.settings, this.rootPath).then(diagnostics => {
				delete this._validating[document.uri];
				this.sendEndValidationNotification(document);
				this.connection.sendDiagnostics({ uri: document.uri, diagnostics });
			}, (error) => {
				delete this._validating[document.uri];
				this.sendEndValidationNotification(document);
				this.connection.window.showErrorMessage(this.getExceptionMessage(error, document));
			});
		}
    }

	private sendStartValidationNotification(document:TextDocument): void {
		this.connection.sendNotification(
			proto.DidStartValidateTextDocumentNotification.type,
			{ textDocument: TextDocumentIdentifier.create( document.uri ) }
		);
	}
	private sendEndValidationNotification(document:TextDocument): void {
		this.connection.sendNotification(
			proto.DidEndValidateTextDocumentNotification.type,
			{ textDocument: TextDocumentIdentifier.create( document.uri ) }
		);
	}
	/**
	 * Validate a list of text documents.
	 *
	 * @param documents The list of textdocuments to validate.
	 * @return void
	 */
    public validateMany(documents: TextDocument[]): void {
		let tracker = new ErrorMessageTracker();
		let promises: Thenable<PublishDiagnosticsParams>[] = [];

		documents.forEach(document => {
			this.sendStartValidationNotification(document);
			promises.push( this.linter.lint(document, this.settings, this.rootPath).then<PublishDiagnosticsParams>((diagnostics: Diagnostic[]): PublishDiagnosticsParams => {
				this.connection.console.log(`processing: ${document.uri}`);
				this.sendEndValidationNotification(document);
				let diagnostic = { uri: document.uri, diagnostics };
				this.connection.sendDiagnostics(diagnostic);
				return diagnostic;
			}, (error: any): PublishDiagnosticsParams => {
				this.sendEndValidationNotification(document);
				tracker.add(this.getExceptionMessage(error, document));
				return { uri: document.uri, diagnostics: [] };
			}));
		});

		Promise.all( promises ).then( results => {
			tracker.sendErrors(this.connection);
		});
    }

	/**
	 * Get the exception message from an exception object.
	 *
	 * @param exeption The exception to parse.
	 * @param document The document where the exception occured.
	 * @return string The exception message.
	 */
    private getExceptionMessage(exception: any, document: TextDocument): string {
        let msg: string = null;
        if (typeof exception.message === "string" || exception.message instanceof String) {
            msg = <string>exception.message;
            msg = msg.replace(/\r?\n/g, " ");
            if (/^ERROR: /.test(msg)) {
                msg = msg.substr(5);
            }
        } else {
            msg = `An unknown error occured while validating file: ${Files.uriToFilePath(document.uri) }`;
        }
        return `phpcs: ${msg}`;
    }
}

let server = new PhpcsServer();
server.listen();
