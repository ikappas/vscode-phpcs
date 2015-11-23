/*---------------------------------------------------------
 * Copyright (C) Ioannis Kappas. All rights reserved.
 *--------------------------------------------------------*/
"use strict";

import {
	createConnection, IConnection,
	ResponseError, RequestType, IRequestHandler, NotificationType, INotificationHandler,
	InitializeResult, InitializeError,
	Diagnostic, DiagnosticSeverity, Position, Files,
	TextDocuments, ITextDocument, TextDocumentSyncKind,
	ErrorMessageTracker
} from "vscode-languageserver";

import {
    exec, spawn, ChildProcess
} from "child_process";

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface Settings {
	enable: boolean;
	standard: string;
}

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

class PhpcsPathResolver {
	rootPath: string;
	phpcsPath: string;
	constructor(rootPath: string) {
		this.rootPath = rootPath;
		this.phpcsPath = 'phpcs';
	}
	/**
	 * Determine whether composer.json exists at the root path.
	 */
	hasComposerJson(): boolean {
		try {
			return fs.existsSync(path.join(this.rootPath, 'composer.json'));
		} catch(exeption) {
			return false;
		}
	}
	/**
	 * Determine whether composer.lock exists at the root path.
	 */
	hasComposerLock(): boolean {
	   try {
			return fs.existsSync(path.join(this.rootPath, 'composer.lock'));
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
			dependencies = JSON.parse(fs.readFileSync(path.join(this.rootPath, 'composer.lock'), 'utf8'));
		} catch(exception) {
			dependencies = {};
		}

		// Determine phpcs dependency.
		let result = false;
		let BreakException = {};
		if (dependencies['packages'] && dependencies['packages-dev']) {
			try {
				[ dependencies['packages'], dependencies['packages-dev']].forEach(pkgs => {
					let match = pkgs.filter(pkg => {
						return pkg.name === 'squizlabs/php_codesniffer';
					});
					if (match.length !== 0) throw BreakException;
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
			let composerJson = path.join(this.rootPath, 'composer.json');
			if (this.hasComposerJson()) {

				// Determine whether composer is installed.
				if (this.hasComposerLock()) {

					// Determine whether vendor/bin/phcs exists only when project depends on phpcs.
					if (this.hasComposerPhpcsDependency()) {
						let extension = (os.platform() === "win32" || os.platform() === "win64" ) ? '.bat' : '';
						let vendorPath = path.join(this.rootPath, 'vendor', 'bin', `phpcs${extension}` );
						if (fs.existsSync(vendorPath)) {
							this.phpcsPath = vendorPath;
						} else {
							throw {
								name: 'phpcs',
								message: `Composer phpcs dependency is configured but was not found under workspace/vendor/bin. You may need to update your dependencies using "composer update".`
							};
						}
					}

				} else {
					throw {
						name: 'phpcs',
						message: `A composer configuration file was found at the root of your project but seems uninitialized. You may need to initialize your dependencies using "composer install".`
					};
				}
			}
		}

		return this.phpcsPath;
	}
}

let connection: IConnection = createConnection(process.stdin, process.stdout);
let lib: any = null;
let settings: Settings = null;
let documents: TextDocuments = new TextDocuments();
let ready = false;
let isValidating: { [index: string]: boolean } = {};
let needsValidating: { [index: string]: ITextDocument } = {};
let phpcsPath: string = null;

function getDebugMessage(response: string): string {
	return [settings.enable, settings.standard].join(" | ");
}

function isWhitespace(charCode: number) : boolean {
	return charCode === 34 || charCode === 9 || charCode === 10 || charCode === 11 || charCode === 13;
}

function isAlphaNumeric(charCode: number) : boolean {
	if (!(charCode > 47 && charCode < 58) && // numeric (0-9)
		!(charCode > 64 && charCode < 91) && // upper alpha (A-Z)
		!(charCode > 96 && charCode < 123)) { // lower alpha (a-z)
		return false;
	}
	return true;
}

function getDiagnostic(document: ITextDocument, message: PhpcsReportMessage): Diagnostic {

	let lines = document.getText().split("\n");
	let line = message.line - 1;
	let lineString = lines[line];

	// Process diagnostic start and end columns.
	let start = message.column - 1;
	let end = message.column;
	let code = lineString.charCodeAt(start);
	if (isWhitespace(code)) {
		for (var i = start + 1, len = lineString.length; i < len; i++) {
			code = lineString.charCodeAt(i);
			if (!isWhitespace(code)) {
				break;
			}
			end = i;
		}
	} else if (isAlphaNumeric(code)) {
		for (var i = start + 1, len = lineString.length; i < len; i++) {
			let code = lineString.charCodeAt(i);
			if (!isAlphaNumeric(code)) {
				break;
			}
			end += 1;
		}
	}

	// Process diagnostic severity.
	let severity = DiagnosticSeverity.Error;
	if (message.type === 'WARNING') {
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

documents.listen(connection);
documents.onDidChangeContent((event) => {
	validateSingle(event.document);
});

connection.onInitialize((params): Thenable<InitializeResult | ResponseError<InitializeError>> => {
	let rootPath = params.rootPath;
	return new Promise<InitializeResult | ResponseError<InitializeError>>((resolve, reject) => {
		try {
			// Resolve the phpcs path.
			let pathResolver = new PhpcsPathResolver(rootPath);
			phpcsPath = pathResolver.resolve();

			//reject(new ResponseError<InitializeError>(99, `PHPCS DEBUG: ${phpcsPath}`, { retry: true }));

			// Determine whether we can execute phpcs.
			connection.console.log(`phpcs: The path for phpcs resolved to "${phpcsPath}"`);
			exec(`${phpcsPath} --version`, function(error, stdout, stderr) {
				if (error) {
					let message = 'phpcs: Unable to locate phpcs. Please add phpcs to your global path or use composer depency manager to install it in your project locally.';
					reject(new ResponseError<InitializeError>(99, message, { retry: true }));
				}
				resolve({ capabilities: { textDocumentSync: documents.syncKind } });
			});

		} catch(exception) {
			reject(new ResponseError<InitializeError>(99, exception.message, { retry: true }));
		}
	});
});

function validate(document: ITextDocument): void {
	let uri = document.uri;
	connection.console.log(`Wants to validate ${uri}`);

	if (!ready || isValidating[uri]) {
		needsValidating[uri] = document;
		return;
	};

	isValidating[uri] = true;

	let args = [ '--report=json', Files.uriToFilePath(document.uri) ];
	if (settings.standard ) {
		args.push( `--standard=${settings.standard}`)
	}

	let child = spawn(phpcsPath, args );
	let diagnostics: Diagnostic[] = [];
	let response = "";

	child.stderr.on("data", (buffer: Buffer) => {
		response += buffer.toString();
	});

	child.stdout.on("data", (buffer: Buffer) => {
		response += buffer.toString();
	});

	child.on("close", (code: string) => {
		let match = null;
		if (match = response.match(/^ERROR: the \"([a-zA-Z0-9'_-]+\s?)\" coding standard is not installed\./)) {
			connection.window.showErrorMessage(`phpcs: The "${match[1]}" coding standard set in your configuration is not installed. Please review your configuration an try again.`);
		} else {
			connection.console.log(`phpcs: ${code} | ${getDebugMessage(response)}`);
			let report = JSON.parse(response);
			for (var filename in report.files) {
				let file: PhpcsReportFile = report.files[filename];
				file.messages.forEach(message => {
					diagnostics.push(getDiagnostic(documents.get(uri), message));
				});
			}
			connection.sendDiagnostics({ uri, diagnostics });
		}

		isValidating[uri] = false;
		let revalidateDocument = needsValidating[uri];

		if (revalidateDocument) {
			connection.console.log(`phpcs: Revalidating ${uri}`);
			delete needsValidating[uri];
			validate(revalidateDocument);
		} else {
			connection.console.log(`phpcs: Finished validating ${uri}`);
		}
	});
}

function getMessage(err: any, document: ITextDocument): string {
	let result: string = null;
	if (typeof err.message === "string" || err.message instanceof String) {
		result = <string>err.message;
		result = result.replace(/\r?\n/g, " ");
		if (/^CLI: /.test(result)) {
			result = result.substr(5);
		}
	} else {
		result = `phpcs: An unknown error occured while validating file: ${Files.uriToFilePath(document.uri) }`;
	}
	return result;
}

function validateSingle(document: ITextDocument): void {
	try {
		validate(document);
	} catch (err) {
		connection.window.showErrorMessage(getMessage(err, document));
	}
}

function validateMany(documents: ITextDocument[]): void {
	let tracker = new ErrorMessageTracker();
	documents.forEach(document => {
		try {
			validate(document);
		} catch (err) {
			tracker.add(getMessage(err, document));
		}
	});
	tracker.sendErrors(connection);
}

connection.onDidChangeConfiguration((params) => {
	settings = params.settings["phpcs"];
	ready = true;
	validateMany(documents.all());
});

connection.onDidChangeWatchedFiles((params) => {
	validateMany(documents.all());
});

connection.listen();
