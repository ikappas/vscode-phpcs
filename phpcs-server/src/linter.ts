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
import os = require("os");
import cc = require("./utils/charcode");

interface PhpcsReport {
	totals: PhpcsReportTotals;
	files: Array<PhpcsReportFile>;
}

interface PhpcsReportTotals{
	errors: number;
	warnings: number;
	fixable: number;
}

interface PhpcsReportFile {
	erros: number;
	warnings: number;
	messages: Array<PhpcsReportMessage>;
}

interface PhpcsReportMessage {
	message: string;
	severity: number;
	type: string;
	line: number;
	column: number;
	fixable: boolean;
}

export interface PhpcsSettings {
	enable: boolean;
	standard: string;
	ignore: string;
}

export class PhpcsPathResolver {
	private rootPath: string;
	private phpcsPath: string;
	private phpcsExecutable : string;

	constructor(rootPath: string) {
		this.rootPath = rootPath;
		let extension = /^win/.test(process.platform) ? ".bat" : "";
		this.phpcsExecutable = `phpcs${extension}`;
	}
	/**
	 * Determine whether composer.json exists at the root path.
	 */
	hasComposerJson(): boolean {
		try {
			return fs.existsSync(path.join(this.rootPath, "composer.json"));
		} catch(exeption) {
			return false;
		}
	}
	/**
	 * Determine whether composer.lock exists at the root path.
	 */
	hasComposerLock(): boolean {
	   try {
			return fs.existsSync(path.join(this.rootPath, "composer.lock"));
		} catch(exeption) {
			return false;
		}
	}
	/**
	 * Determine whether phpcs is set as a composer dependency.
	 */
	hasComposerPhpcsDependency(): boolean {
		// Safely load composer.lock
		let dependencies = null;
		try {
			dependencies = JSON.parse(fs.readFileSync(path.join(this.rootPath, "composer.lock"), "utf8"));
		} catch(exception) {
			dependencies = {};
		}

		// Determine phpcs dependency.
		let result = false;
		let BreakException = {};
		if (dependencies["packages"] && dependencies["packages-dev"]) {
			try {
				[ dependencies["packages"], dependencies["packages-dev"]].forEach(pkgs => {
					let match = pkgs.filter(pkg => {
						return pkg.name === "squizlabs/php_codesniffer";
					});
					if (match.length !== 0) {
						throw BreakException;
					}
				});
			} catch(exception) {
				if (exception === BreakException) {
					result = true;
				} else {
					throw exception;
				}
			}
		}
		return result;
	}
	/**
	 * Get the composer vendor path.
	 */
	getVendorPath(): string {
		let vendorPath = path.join(this.rootPath, "vendor", "bin", this.phpcsExecutable);

		// Safely load composer.json
		let config = null;
		try {
			config = JSON.parse(fs.readFileSync(path.join(this.rootPath, "composer.json"), "utf8"));
		}
		catch (exception) {
			config = {};
		}

		// Check vendor-bin configuration
		if (config["config"] && config["config"]["vendor-dir"]) {
			vendorPath = path.join(this.rootPath, config["config"]["vendor-dir"], "bin", this.phpcsExecutable);
		}

		// Check bin-bin configuration
		if (config["config"] && config["config"]["bin-dir"]) {
			vendorPath = path.join(this.rootPath, config["config"]["bin-dir"], this.phpcsExecutable);
		}

		return vendorPath;
	}
	resolve(): string {
		this.phpcsPath = this.phpcsExecutable;

		let pathSeparator = /^win/.test(process.platform) ? ";" : ":";
		let globalPaths = process.env.PATH.split(pathSeparator);
		globalPaths.forEach(globalPath => {
			let testPath = path.join( globalPath, this.phpcsExecutable );
			if (fs.existsSync(testPath)) {
				this.phpcsPath = testPath;
				return false;
			}
		});

		if (this.rootPath) {
			// Determine whether composer.json exists in our workspace root.
			if (this.hasComposerJson()) {

				// Determine whether composer is installed.
				if (this.hasComposerLock()) {

					// Determine whether vendor/bin/phcs exists only when project depends on phpcs.
					if (this.hasComposerPhpcsDependency()) {
						let vendorPath = this.getVendorPath();
						if (fs.existsSync(vendorPath)) {
							this.phpcsPath = vendorPath;
						} else {
							throw `Composer phpcs dependency is configured but was not found under ${vendorPath}. You may need to update your dependencies using "composer update".`;
						}
					}

				} else {
					throw `A composer configuration file was found at the root of your project but seems uninitialized. You may need to initialize your dependencies using "composer install".`;
				}
			}
		}
		return this.phpcsPath;
	}
}

function makeDiagnostic(document: TextDocument, message: PhpcsReportMessage): Diagnostic {

	let lines = document.getText().split("\n");
	let line = message.line - 1;
	let lineString = lines[line];

	// Process diagnostic start and end columns.
	let start = message.column - 1;
	let end = message.column;
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
	let severity = DiagnosticSeverity.Error;
	if (message.type === "WARNING") {
		severity = DiagnosticSeverity.Warning;
	}

	return Diagnostic.create( range, `${ message.message }`, severity, null, 'phpcs' );
};

export class PhpcsLinter {

	private phpcsPath: string;

	constructor(phpcsPath: string) {
		this.phpcsPath = phpcsPath;
	}

	/**
	* Resolve the phpcs path.
	*/
	static resolvePath(rootPath: string): Thenable<any> {
		return new Promise<any>((resolve, reject) => {
			try {
				let phpcsPathResolver = new PhpcsPathResolver(rootPath);
				let phpcsPath = phpcsPathResolver.resolve();
				let command = phpcsPath;

				// Make sure we escape spaces in paths on Windows.
				if ( /^win/.test(process.platform) ) {
					command = `"${command}"`;
				}

				cp.exec(`${command} --version`, function(error, stdout, stderr) {

					if (error) {
						reject("phpcs: Unable to locate phpcs. Please add phpcs to your global path or use composer depency manager to install it in your project locally.");
					}

					resolve(new PhpcsLinter(phpcsPath));
				});
			} catch(e) {
				reject(e);
			}
		});
	}

	public lint(document: TextDocument, settings: PhpcsSettings, rootPath?: string): Thenable<Diagnostic[]> {

		// Process linting paths.
		let filePath = Files.uriToFilePath(document.uri);
		let lintPath = this.phpcsPath;

		// Make sure we escape spaces in paths on Windows.
		if ( /^win/.test(process.platform) ) {
			filePath = `"${filePath}"`;
		 	lintPath = `"${lintPath}"`;
		}

		// Process linting arguments.
		let lintArgs = [ "--report=json", "-q" ];
		if (settings.standard) {
			lintArgs.push(`--standard=${settings.standard}`);
		}
		if (settings.ignore) {
			lintArgs.push(`--ignore=${settings.ignore}`);
		}
		lintArgs.push( filePath );

		return new Promise<Diagnostic[]>((resolve, reject) => {
			let command = null;
			let args = null;
			let phpcs = null;

			let options = {
				cwd: rootPath ? rootPath: path.dirname(filePath),
				stdio: [ "ignore", "pipe", "pipe" ],
				env: process.env,
				encoding: "utf8",
				timeout: 0,
				maxBuffer: 1024 * 1024,
				detached: true,
				windowsVerbatimArguments: true,
			};

			if ( /^win/.test(process.platform) ) {
				command = process.env.comspec || "cmd.exe";
				args = ['/s', '/c', '"', lintPath].concat(lintArgs).concat('"');
				phpcs = cp.execFile( command, args, options );
			} else {
				command = lintPath;
				args = lintArgs;
				phpcs = cp.spawn( command, args, options );
			}

			let result = "";

			phpcs.stderr.on("data", (buffer: Buffer) => {
				result += buffer.toString();
			});

			phpcs.stdout.on("data", (buffer: Buffer) => {
				result += buffer.toString();
			});

			phpcs.on("close", (code: string) => {
				try {
					result = result.trim();
					let match = null;

					// Determine whether we have an error and report it otherwise send back the diagnostics.
					if (match = result.match(/^ERROR:\s?(.*)/i)) {
						let error = match[1].trim();
						if (match = error.match(/^the \"(.*)\" coding standard is not installed\./)) {
							throw { message: `The "${match[1]}" coding standard set in your configuration is not installed. Please review your configuration an try again.` };
						}
						throw { message: error };
					} else if ( match = result.match(/^FATAL\s?ERROR:\s?(.*)/i)) {
						let error = match[1].trim();
						if (match = error.match(/^Uncaught exception '.*' with message '(.*)'/)) {
							throw { message: match[1] };
						}
						throw { message: error };
					}

					let diagnostics: Diagnostic[] = [];
					let report = JSON.parse(result);
					for (var filename in report.files) {
						let file: PhpcsReportFile = report.files[filename];
						file.messages.forEach(message => {
							diagnostics.push(makeDiagnostic(document, message));
						});
					}
					resolve(diagnostics);
				}
				catch (e) {
					reject(e);
				}
			});
		});
	}
}
