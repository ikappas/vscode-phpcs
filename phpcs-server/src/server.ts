/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as proto from "./protocol";
import * as strings from "./base/common/strings";

import {
	ClientCapabilities,
	createConnection,
	Diagnostic,
	DidChangeConfigurationParams,
	DidChangeWatchedFilesParams,
	Files,
	IConnection,
	InitializeParams,
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

import { PhpcsLinter } from "./linter";
import { PhpcsSettings } from "./settings";
import { StringResources as SR } from "./strings";

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
		autoConfigSearch: true,
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
	private async onInitialize(params: InitializeParams & Proposed.WorkspaceFoldersInitializeParams): Promise<InitializeResult> {
		let capabilities = params.capabilities as ClientCapabilities & Proposed.WorkspaceFoldersClientCapabilities & Proposed.ConfigurationClientCapabilities;
		this.hasWorkspaceFolderCapability = capabilities.workspace && !!capabilities.workspace.workspaceFolders;
		this.hasConfigurationCapability = capabilities.workspace && !!capabilities.workspace.configuration;
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
			this.documentSettings.clear();
		} else {
			this.globalSettings = {
				...this.defaultSettings,
				...params.settings.phpcs
			};
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
	private async onDidOpenDocument({ document }: TextDocumentChangeEvent): Promise<void> {
		await this.validateSingle(document);
	}

	/**
	 * Handles saving of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private async onDidSaveDocument({ document }: TextDocumentChangeEvent): Promise<void> {
		await this.validateSingle(document);
	}

	/**
	 * Handles closing of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private async onDidCloseDocument({ document }: TextDocumentChangeEvent): Promise<void> {
		const uri = document.uri;

		// Clear cached document settings.
		if (this.documentSettings.has(uri)) {
			this.documentSettings.delete(uri);
		}

		// Clear validating status.
		if (this.validating.has(uri)) {
			this.validating.delete(uri);
		}

		this.clearDiagnostics(uri);
	}

	/**
	 * Handles changes of text documents.
	 *
	 * @param event The text document change event.
	 * @return void
	 */
	private async onDidChangeDocument({ document }: TextDocumentChangeEvent): Promise<void> {
		await this.validateSingle(document);
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
	 * Clears the diagnostics computed for a given document.
	 *
	 * @param uri The document uri for which to clear the diagnostics.
	 */
	private clearDiagnostics(uri: string): void {
		this.connection.sendDiagnostics({ uri, diagnostics: [] });
	}

	/**
	 * Sends a notification for starting validation of a document.
	 *
	 * @param document The text document on which validation started.
	 */
	private sendStartValidationNotification(document: TextDocument): void {
		this.connection.sendNotification(
			proto.DidStartValidateTextDocumentNotification.type,
			{ textDocument: TextDocumentIdentifier.create(document.uri) }
		);
		this.connection.tracer.log(strings.format(SR.DidStartValidateTextDocument, document.uri));
	}

	/**
	 * Sends a notification for ending validation of a document.
	 *
	 * @param document The text document on which validation ended.
	 */
	private sendEndValidationNotification(document: TextDocument): void {
		this.connection.sendNotification(
			proto.DidEndValidateTextDocumentNotification.type,
			{ textDocument: TextDocumentIdentifier.create(document.uri) }
		);
		this.connection.tracer.log(strings.format(SR.DidEndValidateTextDocument, document.uri));
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
			this.validating.set(uri, document);
			let settings = await this.getDocumentSettings(document);
			if (settings.enable) {
				let diagnostics: Diagnostic[] = [];
				this.sendStartValidationNotification(document);
				try {
					const phpcs = await PhpcsLinter.create(settings.executablePath);
					diagnostics = await phpcs.lint(document, settings);
				} catch(error) {
					throw new Error(this.getExceptionMessage(error, document));
				} finally {
					this.validating.delete(uri);
					this.sendEndValidationNotification(document);
					this.sendDiagnostics({ uri, diagnostics });
				}
			} else {
				this.validating.delete(uri);
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
			message = strings.format(SR.UnknownErrorWhileValidatingTextDocument, Files.uriToFilePath(document.uri));
		}
		return message;
	}
}

let server = new PhpcsServer();
server.listen();
