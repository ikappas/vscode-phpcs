/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import {
	createConnection,
	DidChangeConfigurationParams,
	DidChangeWatchedFilesParams,
	Files,
	IConnection,
	InitializeResult,
	IPCMessageReader,
	IPCMessageWriter,
	Proposed,
	ProposedFeatures,
	PublishDiagnosticsParams,
	TextDocument,
	TextDocumentChangeEvent,
	TextDocumentIdentifier,
	TextDocuments
} from 'vscode-languageserver';

import * as proto from "./protocol";
import { PhpcsLinter } from "./linter";
import { PhpcsSettings } from "./settings";
import { StringResources as SR } from "./helpers/strings";

class PhpcsServer {

	private connection: IConnection;
	private documents: TextDocuments;
	private validating: Map<string, TextDocument>;

	// Cache the settings of all open documents
	private hasConfigurationCapability: boolean = false;
	private hasWorkspaceFolderCapability: boolean = false;

	private globalSettings: PhpcsSettings;
	private defaultSettings: PhpcsSettings = {
		enable: true,
		workspaceRoot: null,
		executablePath: null,
		composerJsonPath: null,
		standard: null,
		showSources: false,
		showWarnings: true,
		ignorePatterns: [],
		warningSeverity: 5,
		errorSeverity: 5,
	};
	private documentSettings: Map<string, Promise<PhpcsSettings>> = new Map();

	/**
	 * Class constructor.
	 *
	 * @return A new instance of the server.
	 */
	constructor() {
		this.validating = new Map();
		this.connection = createConnection(ProposedFeatures.all, new IPCMessageReader(process), new IPCMessageWriter(process));
		this.documents = new TextDocuments();
		this.documents.listen(this.connection);
		this.connection.onInitialize(this.safeEventHandler(this.onInitialize));
		this.connection.onInitialized(this.safeEventHandler(this.onDidInitialize));
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
	private async onInitialize(params: any): Promise<InitializeResult> {
		let capabilities = params.capabilities;

		// Does the client support the `workspace/configuration` request?
		// If not, we will fall back using global settings
		this.hasWorkspaceFolderCapability = (capabilities as Proposed.WorkspaceFoldersClientCapabilities).workspace && !!(capabilities as Proposed.WorkspaceFoldersClientCapabilities).workspace.workspaceFolders;
		this.hasConfigurationCapability = (capabilities as Proposed.ConfigurationClientCapabilities).workspace && !!(capabilities as Proposed.ConfigurationClientCapabilities).workspace.configuration;

		if (this.hasWorkspaceFolderCapability) {
			let folders = (params as Proposed.WorkspaceFoldersInitializeParams).workspaceFolders;
			this.connection.tracer.log(SR.format("Initialize Folders: {0}", folders.map(f => { return f.name; }).join()));
		}

		return Promise.resolve<InitializeResult>({
			capabilities: {
				textDocumentSync: this.documents.syncKind
			}
		});
	}

	/**
	 * Handles connection initialization completion.
	 */
	private async onDidInitialize(): Promise<void> {
		if (this.hasWorkspaceFolderCapability) {
			(this.connection.workspace as any).onDidChangeWorkspaceFolders((_event: Proposed.WorkspaceFoldersChangeEvent) => {
				this.connection.tracer.log('Workspace folder change event received');
			});
		}
	}

	/**
	 * Handles configuration changes.
	 *
	 * @param params The changed configuration parameters.
	 * @return void
	 */
	private async onDidChangeConfiguration(params: DidChangeConfigurationParams): Promise<void> {
		if (this.hasConfigurationCapability) {
			// Reset all cached document settings
			this.documentSettings.clear();
		} else {
			this.globalSettings = params.settings.phpcs as PhpcsSettings || this.defaultSettings;
		}
		await this.validateMany(this.documents.all());
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
		const uri = event.document.uri;

		// Clear cached document settings.
		if (this.documentSettings.has(uri)) {
			this.documentSettings.delete(uri);
		}

		// Clear validating status.
		if (this.validating.has(uri)) {
			this.validating.delete(uri);
		}

  		this.connection.sendDiagnostics({ uri, diagnostics: [] });
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
		const { uri } = document;
		if (this.validating.has(uri) === false) {
			let settings = await this.getDocumentSettings(document);
			if (settings.enable) {
				this.sendStartValidationNotification(document);
				let phpcs = await PhpcsLinter.create(settings.executablePath);
				let diagnostics = await phpcs.lint(document, settings).catch((error) => {
					this.sendEndValidationNotification(document);
					throw new Error(this.getExceptionMessage(error, document));
				});

				this.sendEndValidationNotification(document);
				this.sendDiagnostics({ uri, diagnostics });
			}
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
	 * Get the settings for the specified document.
	 *
	 * @param document The text document for which to get the settings.
	 * @return A promise of PhpcsSettings.
	 */
	private async getDocumentSettings(document: TextDocument): Promise<PhpcsSettings> {
		const { uri } = document;
		let settings: Promise<PhpcsSettings>;
		if (this.hasConfigurationCapability) {
			if (this.documentSettings.has(uri)) {
				settings = this.documentSettings.get(uri);
			} else {
				const configurationItem: Proposed.ConfigurationItem = uri.match(/^untitled:/) ? {} : { scopeUri: uri };
				settings = (this.connection.workspace as any).getConfiguration(configurationItem);
				this.documentSettings.set(uri, settings);
			}
		} else {
			settings = Promise.resolve(this.globalSettings);
		}
		return settings;
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
