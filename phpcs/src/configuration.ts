/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import { workspace, Disposable, CancellationToken, WorkspaceConfiguration, WorkspaceFolder, Uri } from "vscode";
import { LanguageClient, Proposed, DidChangeConfigurationNotification } from "vscode-languageclient";
import path = require("path");
import fs = require("fs");
import { PhpcsSettings } from "./settings";

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
			this.disposables.map(o =>{ o.dispose(); });
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

abstract class BasePathResolver {
	protected phpcsExecutableFile: string;

	constructor() {
		let extension = /^win/.test(process.platform) ? ".bat" : "";
		this.phpcsExecutableFile = `phpcs${extension}`;
	}

	abstract async resolve(): Promise<string>;
}

class GlobalPathResolver extends BasePathResolver {
	async resolve(): Promise<string> {
		let resolvedPath = null;
		let pathSeparator = /^win/.test(process.platform) ? ";" : ":";
		let globalPaths: string[] = process.env.PATH.split(pathSeparator);
		globalPaths.some((globalPath: string) => {
			let testPath = path.join(globalPath, this.phpcsExecutableFile);
			if (fs.existsSync(testPath)) {
				resolvedPath = testPath;
				return true;
			}
			return false;
		});
		return resolvedPath;
	}
}

class ComposerPathResolver extends BasePathResolver {

	protected readonly _workspaceRoot: string;
	protected readonly _workingPath: string;

	protected _composerJsonPath: string;
	protected _composerLockPath: string;

	/**
	 * Class constructor.
	 *
	 * @param workspaceRoot The workspace path.
	 * @param composerJsonPath The path to composer.json.
	 */
	constructor(workspaceRoot: string, workingPath?: string) {
		super();

		this._workspaceRoot = workspaceRoot;

		if (!path.isAbsolute(workingPath)) {
			workingPath = path.join(workspaceRoot, workingPath);
		}
		this._workingPath = workingPath;
	}

	public get workspaceRoot(): string {
		return this._workspaceRoot;
	}

	public get workingPath(): string {
		return  this._workingPath;
	}

	public get composerJsonPath(): string {
		if (!this._composerJsonPath) {
			this._composerJsonPath = fs.realpathSync(path.join(this.workingPath, 'composer.json'));
		}
		return this._composerJsonPath
	}

	public get composerLockPath(): string {
		if (!this._composerLockPath) {
			this._composerLockPath = fs.realpathSync(path.join(this.workingPath, 'composer.lock'));
		}
		return this._composerLockPath;
	}
	/**
	 * Determine whether composer.json exists at the root path.
	 */
	hasComposerJson(): boolean {
		try {
			return fs.existsSync(this.composerJsonPath);
		} catch (error) {
			return false;
		}
	}

	/**
	 * Determine whether composer.lock exists at the root path.
	 */
	hasComposerLock(): boolean {
		try {
			return fs.existsSync(this.composerLockPath);
		} catch (error) {
			return false;
		}
	}

	/**
	 * Determine whether phpcs is set as a composer dependency.
	 */
	hasComposerDependency(): boolean {
		// Safely load composer.lock
		let dependencies = null;
		try {
			dependencies = JSON.parse(fs.readFileSync(this.composerLockPath, "utf8"));
		} catch (error) {
			dependencies = {};
		}

		// Determine phpcs dependency.
		let search = [];
		if (dependencies["packages-dev"]) {
			search.push(dependencies["packages-dev"]);
		}
		if (dependencies["packages"]) {
			search.push(dependencies["packages"]);
		}

		return search.some(pkgs => {
			let match = pkgs.filter((pkg: any) => {
				return pkg.name === "squizlabs/php_codesniffer";
			});
			return match.length !== 0
		});
	}

	/**
	 * Get the composer vendor path.
	 */
	getVendorPath(): string {
		let basePath = path.dirname(this.composerJsonPath);
		let vendorPath = path.join(basePath, "vendor", "bin", this.phpcsExecutableFile);

		// Safely load composer.json
		let config = null;
		try {
			config = JSON.parse(fs.readFileSync(this.composerJsonPath, "utf8"));
		}
		catch (error) {
			config = {};
		}

		// Check vendor-bin configuration
		if (config["config"] && config["config"]["vendor-dir"]) {
			vendorPath = path.join(basePath, config["config"]["vendor-dir"], "bin", this.phpcsExecutableFile);
		}

		// Check bin-bin configuration
		if (config["config"] && config["config"]["bin-dir"]) {
			vendorPath = path.join(basePath, config["config"]["bin-dir"], this.phpcsExecutableFile);
		}

		return vendorPath;
	}

	async resolve(): Promise<string> {
		let resolvedPath = null;
		if (this.workspaceRoot) {
			// Determine whether composer.json and composer.lock exist and phpcs is defined as a dependency.
			if (this.hasComposerJson() && this.hasComposerLock() && this.hasComposerDependency()) {
				let vendorPath = this.getVendorPath();
				if (fs.existsSync(vendorPath)) {
					resolvedPath = vendorPath;
				} else {
					let relativeVendorPath = path.relative(this.workspaceRoot, vendorPath);
					throw new Error(`Composer phpcs dependency is configured but was not found under ${relativeVendorPath}. You may need to run "composer install" or set your phpcs.executablePath manually.`);
				}
			}
		}
		return resolvedPath;
	}
}

interface PhpcsPathResolverOptions {
	workspaceRoot: string | null;
	composerJsonPath: string;
}
class PhpcsPathResolver extends BasePathResolver {

	private resolvers: Array<BasePathResolver> = [];

	constructor(options: PhpcsPathResolverOptions) {
		super();
		if (options.workspaceRoot !== null) {
			this.resolvers.push(new ComposerPathResolver(options.workspaceRoot, options.composerJsonPath));
		}
		this.resolvers.push(new GlobalPathResolver());
	}

	async resolve(): Promise<string> {
		let resolvedPath: string = null;
		for (var i = 0, len = this.resolvers.length; i < len; i++) {
			let resolverPath = await this.resolvers[i].resolve();
			if (resolvedPath !== resolverPath) {
				resolvedPath = resolverPath;
				break;
			}
		}
		if (resolvedPath === null) {
			throw new Error('Unable to locate phpcs. Please add phpcs to your global path or use composer dependency manager to install it in your project locally.');
		}
		return resolvedPath;
	}
}
