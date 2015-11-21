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

import { exec, spawn } from "child_process";

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

let connection: IConnection = createConnection(process.stdin, process.stdout);
let lib: any = null;
let settings: Settings = null;
let documents: TextDocuments = new TextDocuments();
let ready = false;
let isValidating: { [index: string]: boolean } = {};
let needsValidating: { [index: string]: ITextDocument } = {};

function getDebugString(response: string): string {
	return [settings.enable, settings.standard, response].join(" | ");
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

function checkPhpcsVersion(): Thenable<InitializeResult | ResponseError<InitializeError>> {
	return new Promise<InitializeResult | ResponseError<InitializeError>>((resolve, reject) => {
		exec(`phpcs --version`, function(error, stdout, stderr) {
			if (error) {
				let errString = `Could not find phpcs: '${stderr.toString() }'`;
				reject(new ResponseError<InitializeError>(99, errString, { retry: true }));
			}
			resolve({ capabilities: { textDocumentSync: documents.syncKind } });
		});
	});
	// TODO: check whether phpcs is installed with composer.
	// let rootFolder = params.rootPath;
	// if (fs.exists(path.join(rootFolder, 'composer.json'))) {
	// 	return new Promise<server.InitializeResult | server.ResponseError<server.InitializeError>>((resolve, reject) => {
	// 		if (fs.exists(path.join(rootFolder, 'vendor', 'bin', 'phpcs.phar' ))) {
	// 			resolve({ capabilities: { textDocumentSync: documents.syncKind } });
	// 		}
	// 		let errString = `Could not find phpcs. Please add the phpcs dependensy in composer.json and run composer update.`;
	// 		reject(new server.ResponseError<server.InitializeError>(99, errString, { retry: true }));
	// 	});
	// } else {
	// 	return new Promise<server.InitializeResult | server.ResponseError<server.InitializeError>>((resolve, reject) => {
	// 		exec(`phpcs --version`, function(error, stdout, stderr) {
	// 			if (error) {
	// 				let errString = `Could not find phpcs: '${stderr.toString() }'`;
	// 				reject(new server.ResponseError<server.InitializeError>(99, errString, { retry: true }));
	// 			}
	// 			resolve({ capabilities: { textDocumentSync: documents.syncKind } });
	// 		});
	// 	});
	// }
}

documents.listen(connection);
documents.onDidChangeContent((event) => {
	validateSingle(event.document);
});

connection.onInitialize((params): Thenable<InitializeResult | ResponseError<InitializeError>> => {
	return checkPhpcsVersion();
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

	let child = spawn("phpcs", args );
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
			connection.console.log(code + " | " + getDebugString(response));
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
			connection.console.log(`Revalidating ${uri}`);
			delete needsValidating[uri];
			validate(revalidateDocument);
		} else {
			connection.console.log(`Finished validating ${uri}`);
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
		result = `An unknown error occured while validating file: ${Files.uriToFilePath(document.uri) }`;
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
