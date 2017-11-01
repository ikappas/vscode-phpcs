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
import cc = require("./utils/charcode");
import minimatch = require("minimatch");
import semver = require("semver");
import cs = require("cross-spawn");
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
	standard: string;
	showSources: boolean;
	showWarnings: boolean;
	ignorePatterns?: string[];
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

	abstract resolve(): string;
}

class GlobalPhpcsPathResolver extends BasePhpcsPathResolver {
	resolve(): string {
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

	/**
	 * Determine whether composer.json exists at the root path.
	 */
	hasComposerJson(): boolean {
		try {
			return fs.existsSync(path.join(this.workspacePath, "composer.json"));
		} catch(exception) {
			return false;
		}
	}

	/**
	 * Determine whether composer.lock exists at the root path.
	 */
	hasComposerLock(): boolean {
	   try {
			return fs.existsSync(path.join(this.workspacePath, "composer.lock"));
		} catch(exception) {
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
			dependencies = JSON.parse(fs.readFileSync(path.join(this.workspacePath, "composer.lock"), "utf8"));
		} catch(exception) {
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
		let vendorPath = path.join(this.workspacePath, "vendor", "bin", this.phpcsExecutableFile);

		// Safely load composer.json
		let config = null;
		try {
			config = JSON.parse(fs.readFileSync(path.join(this.workspacePath, "composer.json"), "utf8"));
		}
		catch (exception) {
			config = {};
		}

		// Check vendor-bin configuration
		if (config["config"] && config["config"]["vendor-dir"]) {
			vendorPath = path.join(this.workspacePath, config["config"]["vendor-dir"], "bin", this.phpcsExecutableFile);
		}

		// Check bin-bin configuration
		if (config["config"] && config["config"]["bin-dir"]) {
			vendorPath = path.join(this.workspacePath, config["config"]["bin-dir"], this.phpcsExecutableFile);
		}

		return vendorPath;
	}

	resolve(): string {
		let resolvedPath = null;
		if (this.workspacePath) {
			// Determine whether composer.json exists in our workspace root.
			if (this.hasComposerJson()) {

				// Determine whether composer is installed.
				if (this.hasComposerLock()) {

					// Determine whether vendor/bin/phpcs exists only when project depends on phpcs.
					if (this.hasComposerDependency()) {
						let vendorPath = this.getVendorPath();
						if (fs.existsSync(vendorPath)) {
							resolvedPath = vendorPath;
						} else {
							throw `Composer phpcs dependency is configured but was not found under ${vendorPath}. You may need to update your dependencies using "composer update".`;
						}
					}

				} else {
					throw `A composer configuration file was found at the root of your project but seems uninitialized. You may need to initialize your dependencies using "composer install".`;
				}
			}
		}
		return resolvedPath;
	}
}

export class PhpcsPathResolver extends BasePhpcsPathResolver {

	private resolvers: Array<BasePhpcsPathResolver> = [];

	constructor(workspacePath: string) {
		super(workspacePath);
		this.resolvers.push( new ComposerPhpcsPathResolver( workspacePath ) );
		this.resolvers.push( new GlobalPhpcsPathResolver( workspacePath ) );
	}

	resolve(): string {
		let resolvedPath: string = null;
		this.resolvers.some((resolver) => {
			let resolverPath = resolver.resolve();
			if (resolvedPath !== resolverPath) {
				resolvedPath = resolverPath;
				return true;
			}
			return false;
		});
		return resolvedPath;
	}
}

interface DiagnosticOptions {
	showSources: boolean;
}

function makeDiagnostic(document: TextDocument, entry: PhpcsMessage, options: DiagnosticOptions ): Diagnostic {

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
	if (options.showSources) {
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
	static async create(workspacePath: string, executablePath: string): Promise<PhpcsLinter> {
		return new Promise<PhpcsLinter>((resolve, reject) => {
			try {

				if ( executablePath === null) {
					let executablePathResolver = new PhpcsPathResolver(workspacePath);
					executablePath = executablePathResolver.resolve();
				}

				let command = executablePath;

				// Make sure we escape spaces in paths on Windows.
				if ( /^win/.test(process.platform) ) {
					command = `"${command}"`;
				}

				cp.exec(`${command} --version`, function(error, stdout, _stderr) {

					if (error) {
						reject("phpcs: Unable to locate phpcs. Please add phpcs to your global path or use composer dependency manager to install it in your project locally.");
					}

					const versionPattern: RegExp = /^PHP_CodeSniffer version (\d+\.\d+\.\d+)/i;
					const versionMatches = stdout.match(versionPattern);
					const executableVersion = versionMatches[1];

					resolve(new PhpcsLinter(executablePath, executableVersion));
				});
			} catch(e) {
				reject(e);
			}
		});
	}

	public async lint(document: TextDocument, settings: PhpcsSettings, _rootPath?: string): Promise<Diagnostic[]> {
		return new Promise<Diagnostic[]>((resolve, reject) => {

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
				return resolve([]);
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
			if ( filePath !== undefined ) {
				if (settings.ignorePatterns !== null && settings.ignorePatterns.length) {
					if (semver.gte(this.executableVersion, '3.0.0')) {
						// PHPCS v3 and up support this with STDIN files
						lintArgs.push(`--ignore=${settings.ignorePatterns.join(',')}`);
					} else if (settings.ignorePatterns.some(pattern => minimatch(filePath, pattern))) {
						// We must determine this ourself for lower versions
						return resolve([]);
					}
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
			};

			let phpcs = cs.spawn(this.executablePath, lintArgs, options);

			let stdout = '';
			phpcs.stdout.on("data", (buffer: Buffer) => {
				stdout += buffer.toString();
			});

			let stderr = '';
			phpcs.stderr.on("data", (buffer: Buffer) => {
				stderr += buffer.toString();
			});

			phpcs.on("close", () => {
				try {
					let result = stdout.toString().trim();
					let match = null;

					// Determine whether we have an error and report it otherwise send back the diagnostics.
					if (match = result.match(/^ERROR:\s?(.*)/i)) {
						let error = match[1].trim();
						if (match = error.match(/^the \"(.*)\" coding standard is not installed\./)) {
							throw new Error(`The "${match[1]}" coding standard set in your configuration is not installed. Please review your configuration an try again.`);
						}
						throw new Error(error);
					} else if ( match = result.match(/^FATAL\s?ERROR:\s?(.*)/i)) {
						let error = match[1].trim();
						if (match = error.match(/^Uncaught exception '.*' with message '(.*)'/)) {
							throw new Error(match[1]);
						}
						throw new Error(error);
					}

					let diagnostics: Diagnostic[] = [];
					let data = JSON.parse(result);

					let messages : Array<PhpcsMessage>;
					if (filePath !== undefined && semver.gte(this.executableVersion, '2.0.0')) {
						const fileRealPath = fs.realpathSync(filePath);
						if (!data.files[fileRealPath]) {
							resolve([]);
						}
						({ messages } = data.files[fileRealPath]);
					} else {
						// PHPCS v1 can't associate a filename with STDIN input
						if (!data.files.STDIN) {
						resolve([]);
						}
						({ messages } = data.files.STDIN);
					}

					messages.map((message) => {
						diagnostics.push(makeDiagnostic(document, message, settings));
					});

					resolve(diagnostics);
				}
				catch (e) {
					reject(e);
				}
			});

			phpcs.stdin.setDefaultEncoding('utf8');
			phpcs.stdin.write(text);
			phpcs.stdin.end();
		});
	}
}
