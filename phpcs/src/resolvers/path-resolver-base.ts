/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

export abstract class PhpcsPathResolverBase {
	protected phpcsExecutableFile: string;

	constructor() {
		let extension = /^win/.test(process.platform) ? ".bat" : "";
		this.phpcsExecutableFile = `phpcs${extension}`;
	}

	abstract resolve(): Promise<string>;
}
