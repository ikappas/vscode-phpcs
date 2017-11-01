/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

export function isWhitespace(charCode: number) : boolean {
	return (charCode >= 9 && charCode <= 13) || // HT, LF, VT, CR
			charCode === 32; // space
}

export function isAlphaNumeric(charCode: number) : boolean {
	if (!(charCode > 47 && charCode < 58) && // numeric (0-9)
		!(charCode > 64 && charCode < 91) && // upper alpha (A-Z)
		!(charCode > 96 && charCode < 123)) { // lower alpha (a-z)
		return false;
	}
	return true;
}

export function isSymbol(charCode: number) : boolean {
	return charCode === 36 || // $
		   charCode === 64;   // @
}
