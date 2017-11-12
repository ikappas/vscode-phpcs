/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

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