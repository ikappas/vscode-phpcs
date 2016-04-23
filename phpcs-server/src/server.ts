/*---------------------------------------------------------
 * Copyright (C) Ioannis Kappas. All rights reserved.
 *--------------------------------------------------------*/
"use strict";

import {
	createConnection, IConnection,
	ResponseError, RequestType, IRequestHandler, NotificationType, INotificationHandler,
	InitializeParams, InitializeResult, InitializeError,
	Diagnostic, DiagnosticSeverity, Position, Files,
	TextDocuments, ITextDocument, TextDocumentSyncKind, PublishDiagnosticsParams,
	ErrorMessageTracker, DidChangeConfigurationParams, DidChangeWatchedFilesParams

} from "vscode-languageserver";

import {
    exec, spawn, ChildProcess
} from "child_process";

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as url from "url";
import * as proto from './protocol';
import { PhpcsDocuments, TextDocumentOpenEvent, TextDocumentSaveEvent  } from "./documents";
import { PhpcsLinter, PhpcsSettings } from './linter';

class PhpcsServer {

    private connection: IConnection;
    private settings: PhpcsSettings;
    private ready: boolean = false;
    private documents: PhpcsDocuments;
    private linter: PhpcsLinter;
	private rootPath: string;

	/**
	 * Class constructor.
	 *
	 * @return A new instance of the server.
	 */
    constructor() {
        this.connection = createConnection(process.stdin, process.stdout);
        this.documents = new PhpcsDocuments();
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
        this.documents.onDidOpenDocument((event) => {
            this.onDidOpenDocument(event);
        });
        this.documents.onDidSaveDocument((event) => {
            this.onDidSaveDocument(event);
        })
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
			return result
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
        this.settings = params.settings["phpcs"];
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
	 * @param event The text document open event.
	 * @return void
	 */
	private onDidOpenDocument(event: TextDocumentOpenEvent ) : void {
		this.validateSingle(event.document);
	}

	/**
	 * Handles saving of text documents.
	 *
	 * @param event The text document save event.
	 * @return void
	 */
	private onDidSaveDocument(event: TextDocumentSaveEvent ) : void {
		this.validateSingle(event.document);
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
    public validateSingle(document: ITextDocument): void {
		let docUrl = url.parse(document.uri);

		// Only process file documents.
		if (docUrl.protocol == "file:") {
			this.sendStartValidationNotification(document);
			this.linter.lint(document, this.settings, this.rootPath).then(diagnostics => {
				this.sendEndValidationNotification(document);
				this.connection.sendDiagnostics({ uri: document.uri, diagnostics });
			}, (error) => {
				this.sendEndValidationNotification(document);
				this.connection.window.showErrorMessage(this.getExceptionMessage(error, document));
			});
		}
    }

	private sendStartValidationNotification(document:ITextDocument): void {
		this.connection.sendNotification(
			proto.DidStartValidateTextDocumentNotification.type,
			{ uri: document.uri }
		);
	}
	private sendEndValidationNotification(document:ITextDocument): void {
		this.connection.sendNotification(
			proto.DidEndValidateTextDocumentNotification.type,
			{ uri: document.uri }
		);
	}
	/**
	 * Validate a list of text documents.
	 *
	 * @param documents The list of textdocuments to validate.
	 * @return void
	 */
    public validateMany(documents: ITextDocument[]): void {
		let tracker = new ErrorMessageTracker();
		let promises: Thenable<PublishDiagnosticsParams>[] = [];

		documents.forEach(document => {
			this.sendStartValidationNotification(document);
			promises.push( this.linter.lint(document, this.settings, this.rootPath).then<PublishDiagnosticsParams>((diagnostics: Diagnostic[]) => {
				this.connection.console.log(`processing: ${document.uri}`);
				this.sendEndValidationNotification(document);
				let diagnostic = { uri: document.uri, diagnostics };
				this.connection.sendDiagnostics(diagnostic);
				return diagnostic;
			}, (error) => {
				this.sendEndValidationNotification(document);
				tracker.add(this.getExceptionMessage(error, document));
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
    private getExceptionMessage(exception: any, document: ITextDocument): string {
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
