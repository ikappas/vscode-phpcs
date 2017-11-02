/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/// <reference path="typings/thenable.d.ts" />
'use strict';

import {
	TextDocumentIdentifier, TextDocumentChangeEvent
} from 'vscode-languageserver-types';

import {
	IPCMessageReader, IPCMessageWriter,
	createConnection, IConnection,
	TextDocuments, TextDocument,
	InitializeParams, InitializeResult,
	DidChangeConfigurationParams, DidChangeWatchedFilesParams,
	PublishDiagnosticsParams, Files,
} from 'vscode-languageserver';

import * as proto from "./protocol";
import { PhpcsLinter, PhpcsSettings, PhpcsPathResolver } from "./linter";

class PhpcsServer {

	private connection: IConnection;
	private settings: PhpcsSettings;
	private ready: boolean = false;
	private documents: TextDocuments;
	private linter: PhpcsLinter;
	private workspacePath: string;
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
		this.connection.onInitialize((params): any => {
			return this.onInitialize(params);
		});
		this.connection.onDidChangeConfiguration((params) => {
			this.onDidChangeConfiguration(params).catch((error: Error) => {
				this.showErrorMessage(error.message);
			});
		});
		this.connection.onDidChangeWatchedFiles((params) => {
			this.onDidChangeWatchedFiles(params);
		});
		this.documents.onDidChangeContent((event) =>{
			this.onDidChangeDocument(event);
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
	 * Show an error message.
	 *
	 * @param message The message to show.
	 */
	private showErrorMessage(message: string): void {
		this.connection.window.showErrorMessage(`phpcs: ${message}`);
	}

	/**
	 * Handles server initialization.
	 *
	 * @param params The initialization parameters.
	 * @return A promise of initialization result or initialization error.
	 */
	private onInitialize(params: InitializeParams): InitializeResult {
		this.workspacePath = params.rootPath;
		let result: InitializeResult = { capabilities: { textDocumentSync: this.documents.syncKind } };
		return result;
	}

	/**
	 * Handles configuration changes.
	 *
	 * @param params The changed configuration parameters.
	 * @return void
	 */
	private async onDidChangeConfiguration(params: DidChangeConfigurationParams): Promise<void> {
		try {
			this.settings = params.settings.phpcs;

			let executablePath = this.settings.executablePath;
			if (executablePath === null) {
				let executablePathResolver = new PhpcsPathResolver(this.workspacePath, this.settings);
				executablePath = await executablePathResolver.resolve();
			}

			this.linter = await PhpcsLinter.create(executablePath);
			this.ready = true;
			this.validateMany(this.documents.all());
		} catch(error) {
			this.ready = false;
			throw error;
		}
	}

	/**
	 * Handles watched files changes.
	 *
	 * @param params The changed watched files parameters.
	 * @return void
	 */
	private onDidChangeWatchedFiles(_params: DidChangeWatchedFilesParams): void {
		this.validateMany(this.documents.all());
	}

	/**
	 * Handles opening of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private onDidOpenDocument(event: TextDocumentChangeEvent ): void {
		this.validateSingle(event.document);
	}

	/**
	 * Handles saving of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private onDidSaveDocument(event: TextDocumentChangeEvent ): void {
		this.validateSingle(event.document);
	}

	/**
	 * Handles closing of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private onDidCloseDocument(event: TextDocumentChangeEvent ): void {
  		this.connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
	}

	/**
	 * Handles changes of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private onDidChangeDocument(event: TextDocumentChangeEvent ): void {
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
	 * Sends diagnostics computed for a given document to VSCode to render them in the
	 * user interface.
	 *
	 * @param params The diagnostic parameters.
	 */
	private sendDiagnostics(params: PublishDiagnosticsParams): void {
		this.connection.sendDiagnostics(params);
	}

	/**
	 * Sends a notification for starting validation of a document.
	 *
	 * @param document The text document on which validation started.
	 */
	private sendStartValidationNotification(document: TextDocument): void {
		this._validating[ document.uri ] = document;
		this.connection.sendNotification(
			proto.DidStartValidateTextDocumentNotification.type,
			{ textDocument: TextDocumentIdentifier.create( document.uri ) }
		);
		this.connection.tracer.log(`Linting started on: ${document.uri}`);
	}

	/**
	 * Sends a notification for ending validation of a document.
	 *
	 * @param document The text document on which validation ended.
	 */
	private sendEndValidationNotification(document: TextDocument): void {
		delete this._validating[ document.uri ];
		this.connection.sendNotification(
			proto.DidEndValidateTextDocumentNotification.type,
			{ textDocument: TextDocumentIdentifier.create( document.uri ) }
		);
		this.connection.tracer.log(`Linting completed on: ${document.uri}`);
	}

	/**
	 * Validate a single text document.
	 *
	 * @param document The text document to validate.
	 * @return void
	 */
	public validateSingle(document: TextDocument): void {
		if (this.ready && this._validating[ document.uri ] === undefined ) {
			this.sendStartValidationNotification(document);
			this.linter.lint(document, this.settings).then(diagnostics => {
				this.sendEndValidationNotification(document);
				this.sendDiagnostics({ uri: document.uri, diagnostics });
			}, (error) => {
				this.sendEndValidationNotification(document);
				this.connection.window.showErrorMessage(this.getExceptionMessage(error, document));
			});
		}
	}

	/**
	 * Validate a list of text documents.
	 *
	 * @param documents The list of text documents to validate.
	 * @return void
	 */
	public validateMany(documents: TextDocument[]): void {
		documents.forEach((document: TextDocument) =>{
			this.validateSingle(document);
		});
	}

	/**
	 * Get the exception message from an exception object.
	 *
	 * @param exception The exception to parse.
	 * @param document The document where the exception occurred.
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
			msg = `An unknown error occurred while validating file: ${Files.uriToFilePath(document.uri) }`;
		}
		return `phpcs: ${msg}`;
	}
}

let server = new PhpcsServer();
server.listen();
