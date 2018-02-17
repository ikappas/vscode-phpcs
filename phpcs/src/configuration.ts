/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as path from "path";

import {
	CancellationToken,
	Disposable,
	Uri,
	workspace,
	WorkspaceConfiguration,
	WorkspaceFolder
} from "vscode";

import {
	DidChangeConfigurationNotification,
	LanguageClient,
	Proposed,
} from "vscode-languageclient";

import { PhpcsSettings } from "./settings";
import { PhpcsPathResolver } from "./resolvers/path-resolver";

export class PhpcsConfiguration extends Disposable {

	private client: LanguageClient;
	private disposables: Array<Disposable> = [];
	private globalSettings: PhpcsSettings;
	private folderSettings: Map<Uri, PhpcsSettings> = new Map();

	/**
	 * Class constructor
	 * @param client The client to use.
	 */
	public constructor(client: LanguageClient) {
		super(() => {
			this.disposables.map(o => { o.dispose(); });
			this.client = null;
		});

		this.client = client;
	}

	// Convert VS Code specific settings to a format acceptable by the server. Since
	// both client and server do use JSON the conversion is trivial.
	public async compute(params: Proposed.ConfigurationParams, _token: CancellationToken, _next: Function): Promise<any[]> {
		if (!params.items) {
			return null;
		}
		let result: (PhpcsSettings | null)[] = [];
		for (let item of params.items) {
			// The server asks the client for configuration settings without a section
			// If a section is present we return null to indicate that the configuration
			// is not supported.
			if (item.section) {
				result.push(null);
				continue;
			}

			let config: WorkspaceConfiguration;
			let folder: WorkspaceFolder;
			if (item.scopeUri) {
				let resource = this.client.protocol2CodeConverter.asUri(item.scopeUri);
				folder = workspace.getWorkspaceFolder(resource);
				if (this.folderSettings.has(folder.uri)) {
					result.push(this.folderSettings.get(folder.uri));
					continue;
				}
				config = workspace.getConfiguration('phpcs', resource);
			} else {
				if (this.globalSettings) {
					result.push(this.globalSettings);
					continue;
				}
				config = workspace.getConfiguration('phpcs');
			}

			let settings: PhpcsSettings = {
				enable: config.get('enable'),
				workspaceRoot: folder ? folder.uri.fsPath : null,
				executablePath: config.get('executablePath'),
				composerJsonPath: config.get('composerJsonPath'),
				standard: config.get('standard'),
				showSources: config.get('showSources'),
				showWarnings: config.get('showWarnings'),
				ignorePatterns: config.get('ignorePatterns'),
				warningSeverity: config.get('warningSeverity'),
				errorSeverity: config.get('errorSeverity'),
			};

			settings = await this.resolveExecutablePath(settings);

			if (item.scopeUri) {
				this.folderSettings.set(folder.uri, settings);
			} else {
				this.globalSettings = settings;
			}
			result.push(settings);
		}
		return result;
	}

	protected async resolveExecutablePath(settings: PhpcsSettings): Promise<PhpcsSettings> {
		if (settings.executablePath === null) {
			let executablePathResolver = new PhpcsPathResolver(settings);
			settings.executablePath = await executablePathResolver.resolve();
		} else if (!path.isAbsolute(settings.executablePath) && settings.workspaceRoot !== null) {
			settings.executablePath = path.join(settings.workspaceRoot, settings.executablePath);
		}
		return settings;
	}

	public initialize(): void {
		// VS Code currently doesn't sent fine grained configuration changes. So we
		// listen to any change. However this will change in the near future.
		this.disposables.push(workspace.onDidChangeConfiguration(() => {
			this.folderSettings.clear();
			this.globalSettings = null;
			this.client.sendNotification(DidChangeConfigurationNotification.type, { settings: null });
		}));
	}
}
