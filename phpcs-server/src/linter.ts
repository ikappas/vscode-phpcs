/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import {
	ITextDocument, Diagnostic, DiagnosticSeverity, Files
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
}

export class PhpcsPathResolver {
	rootPath: string;
	phpcsPath: string;
	constructor(rootPath: string) {
		this.rootPath = rootPath;
		this.phpcsPath = "phpcs";
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
	resolve(): string {
		if (this.rootPath) {
			// Determine whether composer.json exists in our workspace root.
			if (this.hasComposerJson()) {

				// Determine whether composer is installed.
				if (this.hasComposerLock()) {

					// Determine whether vendor/bin/phcs exists only when project depends on phpcs.
					if (this.hasComposerPhpcsDependency()) {
						let extension = (os.platform() === "win32" || os.platform() === "win64" ) ? ".bat" : "";
						let vendorPath = path.join(this.rootPath, "vendor", "bin", `phpcs${extension}` );
						if (fs.existsSync(vendorPath)) {
							this.phpcsPath = vendorPath;
						} else {
							throw `Composer phpcs dependency is configured but was not found under workspace/vendor/bin. You may need to update your dependencies using "composer update".`;
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

function makeDiagnostic(document: ITextDocument, message: PhpcsReportMessage): Diagnostic {

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

	// Process diagnostic severity.
	let severity = DiagnosticSeverity.Error;
	if (message.type === "WARNING") {
		severity = DiagnosticSeverity.Warning;
	}

	let diagnostic: Diagnostic = {
		range: {
			start: { line, character: start },
			end: { line, character: end }
		},
		severity,
		message: `${ message.message }`
	};

	return diagnostic;
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

				cp.exec(`${phpcsPath} --version`, function(error, stdout, stderr) {

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

	public lint(document: ITextDocument, settings: PhpcsSettings, rootPath?: string): Thenable<Diagnostic[]> {
		return new Promise<Diagnostic[]>((resolve, reject) => {

			let filename = Files.uriToFilePath(document.uri);
			let args = [ "--report=json", filename ];
			if (settings.standard ) {
				args.push(`--standard=${settings.standard}`);
			}
			args.push( filename );

			let options = {
				cwd: rootPath ? rootPath: path.dirname(filename),
				env: process.env
			};

			let result = "";
			let phpcs = cp.spawn( this.phpcsPath, args, options );

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
