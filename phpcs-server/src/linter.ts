/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as cc from "./helpers/charcode";
import * as cp from "child_process";
import * as fs from "fs";
import * as minimatch from "minimatch";
import * as os from "os";
import * as path from "path";
import * as semver from "semver";
import * as spawn from "cross-spawn";
import * as strings from "base/common/strings";

import {
	Diagnostic,
	DiagnosticSeverity,
	Files,
	Range,
	TextDocument
} from "vscode-languageserver";

import { StringResources as SR } from "./helpers/strings";
import { PhpcsSettings } from "./settings";
import { PhpcsMessage } from "./message";

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
				throw new Error(SR.InvalidVersionStringError);
			}

			const executableVersion = versionMatches[1];
			return new PhpcsLinter(executablePath, executableVersion);

		} catch (error) {
			let message = error.message ? error.message : SR.CreateLinterErrorDefaultMessage;
			throw new Error(strings.format(SR.CreateLinterError, message));
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
		let lintArgs = ['--report=json'];

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
			cwd: settings.workspaceRoot !== null ? settings.workspaceRoot : undefined,
			env: process.env,
			encoding: "utf8",
			timeout: forcedKillTime,
			tty: true,
			input: text,
		};

		const phpcs = spawn.sync(this.executablePath, lintArgs, options);
		const stdout = phpcs.stdout.toString().trim();
		const stderr = phpcs.stderr.toString().trim();
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
			throw new Error(strings.format(SR.UnknownExecutionError, `${this.executablePath} ${lintArgs.join(' ')}`));
		}

		// Determine whether we have an error in stdout.
		if (match = stdout.match(/^ERROR:\s?(.*)/i)) {
			let error = match[1].trim();
			if (match = error.match(/^the \"(.*)\" coding standard is not installed\./)) {
				throw new Error(strings.format(SR.CodingStandardNotInstalledError, match[1]));
			}
			throw new Error(error);
		}

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

		let diagnostics: Diagnostic[] = [];
		messages.map(message => diagnostics.push(
			this.createDiagnostic(document, message, settings.showSources)
		));

		return diagnostics;
	}

	private createDiagnostic(document: TextDocument, entry: PhpcsMessage, showSources: boolean): Diagnostic {

		let lines = document.getText().split("\n");
		let line = entry.line - 1;
		let lineString = lines[line];

		// Process diagnostic start and end characters.
		let startCharacter = entry.column - 1;
		let endCharacter = entry.column;
		let charCode = lineString.charCodeAt(startCharacter);
		if (cc.isWhitespace(charCode)) {
			for (let i = startCharacter + 1, len = lineString.length; i < len; i++) {
				charCode = lineString.charCodeAt(i);
				if (!cc.isWhitespace(charCode)) {
					break;
				}
				endCharacter = i;
			}
		} else if (cc.isAlphaNumeric(charCode) || cc.isSymbol(charCode)) {
			// Get the whole word
			for (let i = startCharacter + 1, len = lineString.length; i < len; i++) {
				charCode = lineString.charCodeAt(i);
				if (!cc.isAlphaNumeric(charCode) && charCode !== 95) {
					break;
				}
				endCharacter++;
			}
			// Move backwards
			for (let i = startCharacter, len = 0; i > len; i--) {
				charCode = lineString.charCodeAt(i - 1);
				if (!cc.isAlphaNumeric(charCode) && !cc.isSymbol(charCode) && charCode !== 95) {
					break;
				}
				startCharacter--;
			}
		}

		// Process diagnostic range.
		const range: Range = Range.create(line, startCharacter, line, endCharacter);

		// Process diagnostic sources.
		let message: string = entry.message;
		if (showSources) {
			message += `\n(${entry.source})`;
		}

		// Process diagnostic severity.
		let severity: DiagnosticSeverity = DiagnosticSeverity.Error;
		if (entry.type === "WARNING") {
			severity = DiagnosticSeverity.Warning;
		}

		return Diagnostic.create(range, message, severity, null, 'phpcs');
	}
}
