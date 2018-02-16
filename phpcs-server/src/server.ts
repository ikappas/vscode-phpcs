/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import {
	IPCMessageReader, IPCMessageWriter,
	createConnection, IConnection,
	TextDocuments, TextDocument,
	TextDocumentIdentifier, TextDocumentChangeEvent,
	InitializeParams, InitializeResult,
	DidChangeConfigurationParams, DidChangeWatchedFilesParams,
	PublishDiagnosticsParams, Files,
} from 'vscode-languageserver';

import * as path from 'path';
import * as proto from "./protocol";
import { PhpcsLinter, PhpcsPathResolver } from "./linter";
import { PhpcsSettings } from "./settings";
import { StringResources as SR } from "./helpers/strings";

class PhpcsServer {

	private connection: IConnection;
	private settings: PhpcsSettings;
	private ready: boolean = false;
	private documents: TextDocuments;
	private linter: PhpcsLinter;
	private workspaceRoot: string;
	private validating: Map<string, TextDocument>;

	/**
	 * Class constructor.
	 *
	 * @return A new instance of the server.
	 */
	constructor() {
		this.validating = new Map();
		this.connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
		this.documents = new TextDocuments();
		this.documents.listen(this.connection);
		this.connection.onInitialize(this.safeEventHandler(this.onInitialize));
		this.connection.onDidChangeConfiguration(this.safeEventHandler(this.onDidChangeConfiguration));
		this.connection.onDidChangeWatchedFiles(this.safeEventHandler(this.onDidChangeWatchedFiles));
		this.documents.onDidChangeContent(this.safeEventHandler(this.onDidChangeDocument));
		this.documents.onDidOpen(this.safeEventHandler(this.onDidOpenDocument));
		this.documents.onDidSave(this.safeEventHandler(this.onDidSaveDocument));
		this.documents.onDidClose(this.safeEventHandler(this.onDidCloseDocument));
	}

	/**
	 * Safely handle event notifications.
	 * @param callback An event handler.
	 */
	private safeEventHandler(callback: (...args: any[]) => Promise<any>): (...args: any[]) => Promise<any> {
		return (...args: any[]): Promise<any> => {
			return callback.apply(this, args).catch((error: Error) => {
				this.connection.window.showErrorMessage(`phpcs: ${error.message}`);
			});
		};
	}

	/**
	 * Handles server initialization.
	 *
	 * @param params The initialization parameters.
	 * @return A promise of initialization result or initialization error.
	 */
	private async onInitialize(params: InitializeParams): Promise<InitializeResult> {
		this.workspaceRoot = params.rootPath;
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
		this.settings = params.settings.phpcs;
		await this.initializeLinter();
	}

	/**
	 * Handles watched files changes.
	 *
	 * @param params The changed watched files parameters.
	 * @return void
	 */
	private async onDidChangeWatchedFiles(_params: DidChangeWatchedFilesParams): Promise<void> {
		await this.validateMany(this.documents.all());
	}

	/**
	 * Handles opening of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private async onDidOpenDocument(event: TextDocumentChangeEvent ): Promise<void> {
		await this.validateSingle(event.document);
	}

	/**
	 * Handles saving of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private async onDidSaveDocument(event: TextDocumentChangeEvent ): Promise<void> {
		await this.validateSingle(event.document);
	}

	/**
	 * Handles closing of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private async onDidCloseDocument(event: TextDocumentChangeEvent ): Promise<void> {
  		this.connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
	}

	/**
	 * Handles changes of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private async onDidChangeDocument(event: TextDocumentChangeEvent ): Promise<void> {
		await this.validateSingle(event.document);
	}

	/**
	 * Initialize linter instance.
	 */
	private async initializeLinter() {
		try {
			let executablePath = this.settings.executablePath;
			if (executablePath === null) {
				let executablePathResolver = new PhpcsPathResolver(this.workspaceRoot, this.settings);
				executablePath = await executablePathResolver.resolve();
			} else if (!path.isAbsolute(executablePath)) {
				executablePath = path.join(this.workspaceRoot, executablePath);
			}

			this.linter = await PhpcsLinter.create(executablePath);
			this.ready = true;
			this.validateMany(this.documents.all());
		} catch (error) {
			this.ready = false;
			throw error;
		}
	}

	/**
	 * Initialize linter unless it is ready.
	 */
	private async initializeLinterUnlessReady() {
		if (this.ready === false) {
			await this.initializeLinter();
		}
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
		this.validating.set(document.uri, document);
		this.connection.sendNotification(
			proto.DidStartValidateTextDocumentNotification.type,
			{ textDocument: TextDocumentIdentifier.create( document.uri ) }
		);
		this.connection.tracer.log(SR.format(SR.DidStartValidateTextDocument, document.uri));
	}

	/**
	 * Sends a notification for ending validation of a document.
	 *
	 * @param document The text document on which validation ended.
	 */
	private sendEndValidationNotification(document: TextDocument): void {
		this.validating.delete(document.uri);
		this.connection.sendNotification(
			proto.DidEndValidateTextDocumentNotification.type,
			{ textDocument: TextDocumentIdentifier.create( document.uri ) }
		);
		this.connection.tracer.log(SR.format(SR.DidEndValidateTextDocument, document.uri));
	}

	/**
	 * Validate a single text document.
	 *
	 * @param document The text document to validate.
	 * @return void
	 */
	public async validateSingle(document: TextDocument): Promise<void> {
		await this.initializeLinterUnlessReady();
		if (this.ready === true && this.validating.has(document.uri) === false) {
			this.sendStartValidationNotification(document);
			let diagnostics = await this.linter.lint(document, this.settings).catch((error) => {
				this.sendEndValidationNotification(document);
				throw new Error(this.getExceptionMessage(error, document));
			});

			this.sendEndValidationNotification(document);
			this.sendDiagnostics({ uri: document.uri, diagnostics });
		}
	}

	/**
	 * Validate a list of text documents.
	 *
	 * @param documents The list of text documents to validate.
	 * @return void
	 */
	public async validateMany(documents: TextDocument[]): Promise<void> {
		for (var i = 0, len = documents.length; i < len; i++) {
			await this.validateSingle(documents[i]);
		}
	}

	/**
	 * Get the exception message from an exception object.
	 *
	 * @param exception The exception to parse.
	 * @param document The document where the exception occurred.
	 * @return string The exception message.
	 */
	private getExceptionMessage(exception: any, document: TextDocument): string {
		let message: string = null;
		if (typeof exception.message === 'string' || exception.message instanceof String) {
			message = <string>exception.message;
			message = message.replace(/\r?\n/g, ' ');
			if (/^ERROR: /.test(message)) {
				message = message.substr(5);
			}
		} else {
			message = SR.format(SR.UnknownErrorWhileValidatingTextDocument, Files.uriToFilePath(document.uri));
		}
		return message;
	}
}

let server = new PhpcsServer();
server.listen();
