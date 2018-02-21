/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

export interface PhpcsMessage {
	message: string;
	severity: number;
	type: string;
	line: number;
	column: number;
	fixable: boolean;
	source?: string;
}
