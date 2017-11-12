/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import {
	TextDocument, Diagnostic, DiagnosticSeverity, Files
} from "vscode-languageserver";

import cp = require("child_process");
import path = require("path");
import fs = require("fs");
import cc = require("./helpers/charcode");
import minimatch = require("minimatch");
import semver = require("semver");
import spawn = require("cross-spawn");
import os = require("os");

interface PhpcsMessage {
	message: string;
	severity: number;
	type: string;
	line: number;
	column: number;
	fixable: boolean;
	source?: string;
}

export interface PhpcsSettings {
	enable: boolean;
	executablePath: string;
	composerJsonPath: string;
	standard: string;
	showSources: boolean;
	showWarnings: boolean;
	ignorePatterns: string[];
	warningSeverity: number;
	errorSeverity: number;
}

abstract class BasePhpcsPathResolver {
	protected workspacePath: string;
	protected phpcsExecutableFile: string;

	constructor(workspacePath: string) {
		this.workspacePath = workspacePath;
		let extension = /^win/.test(process.platform) ? ".bat" : "";
		this.phpcsExecutableFile = `phpcs${extension}`;
	}

	abstract async resolve(): Promise<string>;
}

class GlobalPhpcsPathResolver extends BasePhpcsPathResolver {
	async resolve(): Promise<string> {
		let resolvedPath = null;
		let pathSeparator = /^win/.test(process.platform) ? ";" : ":";
		let globalPaths: string[] = process.env.PATH.split(pathSeparator);
		globalPaths.some((globalPath: string) => {
			let testPath = path.join( globalPath, this.phpcsExecutableFile );
			if (fs.existsSync(testPath)) {
				resolvedPath = testPath;
				return true;
			}
			return false;
		});
		return resolvedPath;
	}
}

class ComposerPhpcsPathResolver extends BasePhpcsPathResolver {

	protected readonly enabled: boolean;
	protected readonly composerJsonPath: string;
	protected readonly composerLockPath: string;

	/**
	 * Class constructor.
	 *
	 * @param workspacePath The workspace path.
	 * @param composerJsonPath The path to composer.json.
	 */
	constructor(workspacePath: string, composerJsonPath?: string) {
		super(workspacePath);

		if (!path.isAbsolute(composerJsonPath)) {
			composerJsonPath = path.join(workspacePath, composerJsonPath);
		}

		try {
			this.composerJsonPath = fs.realpathSync(composerJsonPath);
			this.composerLockPath = path.join(path.dirname(this.composerJsonPath), 'composer.lock');
			this.enabled = true;
		} catch(error) {
			this.enabled = false;
		}
	}

	/**
	 * Determine whether composer.json exists at the root path.
	 */
	hasComposerJson(): boolean {
		try {
			return fs.existsSync(this.composerJsonPath);
		} catch(error) {
			return false;
		}
	}

	/**
	 * Determine whether composer.lock exists at the root path.
	 */
	hasComposerLock(): boolean {
	   try {
			return fs.existsSync(this.composerLockPath);
		} catch(error) {
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
		} catch(error) {
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
		if (this.enabled && this.workspacePath) {
			// Determine whether composer.json and composer.lock exist and phpcs is defined as a dependency.
			if (this.hasComposerJson() && this.hasComposerLock() && this.hasComposerDependency()) {
				let vendorPath = this.getVendorPath();
				if (fs.existsSync(vendorPath)) {
					resolvedPath = vendorPath;
				} else {
					let relativeVendorPath = path.relative(this.workspacePath, vendorPath);
					throw new Error(`Composer phpcs dependency is configured but was not found under ${relativeVendorPath}. You may need to run "composer install" or set your phpcs.executablePath manually.`);
				}
			}
		}
		return resolvedPath;
	}
}

export class PhpcsPathResolver extends BasePhpcsPathResolver {

	private resolvers: Array<BasePhpcsPathResolver> = [];

	constructor(workspacePath: string, settings: PhpcsSettings) {
		super(workspacePath);
		if (this.workspacePath !== null) {
			this.resolvers.push(new ComposerPhpcsPathResolver(workspacePath, settings.composerJsonPath) );
		}
		this.resolvers.push( new GlobalPhpcsPathResolver( workspacePath ) );
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

function makeDiagnostic(document: TextDocument, entry: PhpcsMessage, showSources: boolean): Diagnostic {

	let lines = document.getText().split("\n");
	let line = entry.line - 1;
	let lineString = lines[line];

	// Process diagnostic start and end columns.
	let start = entry.column - 1;
	let end = entry.column;
	let charCode = lineString.charCodeAt(start);
	if (cc.isWhitespace(charCode)) {
		for (var i = start + 1, len = lineString.length; i < len; i++) {
			charCode = lineString.charCodeAt(i);
			if (!cc.isWhitespace(charCode)) {
				break;
			}
			end = i;
		}
	} else if (cc.isAlphaNumeric(charCode) || cc.isSymbol(charCode)) {
		// Get the whole word
		for (var i = start + 1, len = lineString.length; i < len; i++) {
			charCode = lineString.charCodeAt(i);
			if (!cc.isAlphaNumeric(charCode) && charCode !== 95) {
				break;
			}
			end += 1;
		}
		// Move backwards
		for (var i = start, len = 0; i >  len; i--) {
			charCode = lineString.charCodeAt(i - 1);
			if (!cc.isAlphaNumeric(charCode) && !cc.isSymbol(charCode) && charCode !== 95) {
				break;
			}
			start -= 1;
		}
	}

	let range = {
		start: { line, character: start },
		end: { line, character: end }
	};

	// Process diagnostic severity.
	let severity: DiagnosticSeverity = DiagnosticSeverity.Error;
	if (entry.type === "WARNING") {
		severity = DiagnosticSeverity.Warning;
	}

	// Process diagnostic sources.
	let message: string = entry.message;
	if (showSources) {
		message += `\n(${ entry.source })`;
	}

	return Diagnostic.create( range, message, severity, null, 'phpcs' );
};

export class PhpcsLinter {

	private executablePath: string;
	private executableVersion: string;

	private constructor(executablePath: string, executableVersion: string) {
		this.executablePath = executablePath;
		this.executableVersion = executableVersion;
	}

	/**
	 * Create an instance of the PhpcsLinter.
	 */
	static async create(executablePath: string): Promise<PhpcsLinter> {
		try {

			let result: Buffer = cp.execSync(`"${executablePath}" --version`);

			const versionPattern: RegExp = /^PHP_CodeSniffer version (\d+\.\d+\.\d+)/i;
			const versionMatches = result.toString().match(versionPattern);

			if (versionMatches === null) {
				throw new Error('Invalid version string encountered!');
			}

			const executableVersion = versionMatches[1];
			return new PhpcsLinter(executablePath, executableVersion);

		} catch(error) {
			let message = error.message ? error.message : 'Please add phpcs to your global path or use composer dependency manager to install it in your project locally.';
			throw new Error(`Unable to locate phpcs. ${message}`);
		}
	}

	public async lint(document: TextDocument, settings: PhpcsSettings): Promise<Diagnostic[]> {

		// Process linting paths.
		let filePath = Files.uriToFilePath(document.uri);

		// Make sure we capitalize the drive letter in paths on Windows.
		if (filePath !== undefined && /^win/.test(process.platform)) {
			let pathRoot: string = path.parse(filePath).root;
			let noDrivePath = filePath.slice(Math.max(pathRoot.length - 1, 0));
			filePath = path.join(pathRoot.toUpperCase(), noDrivePath);
		}

		let fileText = document.getText();

		// Return empty on empty text.
		if (fileText === '') {
			return [];
		}

		// Process linting arguments.
		let lintArgs = [ '--report=json' ];

		// -q (quiet) option is available since phpcs 2.6.2
		if (semver.gte(this.executableVersion, '2.6.2')) {
			lintArgs.push('-q');
		}

		// Show sniff source codes in report output.
		if (settings.showSources === true) {
			lintArgs.push('-s');
		}

		// --encoding option is available since 1.3.0
		if (semver.gte(this.executableVersion, '1.3.0')) {
			lintArgs.push('--encoding=UTF-8');
		}

		if (settings.standard !== null) {
			lintArgs.push(`--standard=${settings.standard}`);
		}

		// Check if file should be ignored (Skip for in-memory documents)
		if (filePath !== undefined && settings.ignorePatterns.length) {
			if (semver.gte(this.executableVersion, '3.0.0')) {
				// PHPCS v3 and up support this with STDIN files
				lintArgs.push(`--ignore=${settings.ignorePatterns.join()}`);
			} else if (settings.ignorePatterns.some(pattern => minimatch(filePath, pattern))) {
				// We must determine this ourself for lower versions
				return [];
			}
		}

		lintArgs.push(`--error-severity=${settings.errorSeverity}`);

		let warningSeverity = settings.warningSeverity;
		if (settings.showWarnings === false) {
			warningSeverity = 0;
		}
		lintArgs.push(`--warning-severity=${warningSeverity}`);

		let text = fileText;

		// Determine the method of setting the file name
		if (filePath !== undefined) {
			switch (true) {

				// PHPCS 2.6 and above support sending the filename in a flag
				case semver.gte(this.executableVersion, '2.6.0'):
					lintArgs.push(`--stdin-path=${filePath}`);
					break;

				// PHPCS 2.x.x before 2.6.0 supports putting the name in the start of the stream
				case semver.satisfies(this.executableVersion, '>=2.0.0 <2.6.0'):
					// TODO: This needs to be document specific.
					const eolChar = os.EOL;
					text = `phpcs_input_file: ${filePath}${eolChar}${fileText}`;
					break;

				// PHPCS v1 supports stdin, but ignores all filenames.
				default:
					// Nothing to do
					break;
			}
		}

		// Finish off the parameter list
		lintArgs.push('-');

		const forcedKillTime = 1000 * 60 * 5; // ms * s * m: 5 minutes
		const options = {
			env: process.env,
			encoding: "utf8",
			timeout: forcedKillTime,
			tty: true,
			input: text,
		};

		let phpcs = spawn.sync(this.executablePath, lintArgs, options);
		let stdout = phpcs.stdout.toString().trim();
		let stderr = phpcs.stderr.toString().trim();
		let match = null;

		// Determine whether we have an error in stderr.
		if (stderr !== '') {
			if (match = stderr.match(/^(?:PHP\s?)FATAL\s?ERROR:\s?(.*)/i)) {
				let error = match[1].trim();
				if (match = error.match(/^Uncaught exception '.*' with message '(.*)'/)) {
					throw new Error(match[1]);
				}
				throw new Error(error);
			}
			throw new Error(`Unknown error ocurred. Please verify that ${this.executablePath} ${lintArgs.join(' ')} returns a valid json object.`);
		}

		// Determine whether we have an error in stdout.
		if (match = stdout.match(/^ERROR:\s?(.*)/i)) {
			let error = match[1].trim();
			if (match = error.match(/^the \"(.*)\" coding standard is not installed\./)) {
				throw new Error(`The "${match[1]}" coding standard set in your configuration is not installed. Please review your configuration an try again.`);
			}
			throw new Error(error);
		}

		let diagnostics: Diagnostic[] = [];
		let data = JSON.parse(stdout);

		let messages: Array<PhpcsMessage>;
		if (filePath !== undefined && semver.gte(this.executableVersion, '2.0.0')) {
			const fileRealPath = fs.realpathSync(filePath);
			if (!data.files[fileRealPath]) {
				return [];
			}
			({ messages } = data.files[fileRealPath]);
		} else {
			// PHPCS v1 can't associate a filename with STDIN input
			if (!data.files.STDIN) {
				return [];
			}
			({ messages } = data.files.STDIN);
		}

		messages.map((message) => {
			diagnostics.push(makeDiagnostic(document, message, settings.showSources));
		});

		return diagnostics;
	}
}
