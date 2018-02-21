/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as path from 'path';
import * as fs from 'fs';

import { PhpcsPathResolverBase } from './path-resolver-base';

export class GlobalPhpcsPathResolver extends PhpcsPathResolverBase {
	async resolve(): Promise<string> {
		let resolvedPath = null;
		let pathSeparator = /^win/.test(process.platform) ? ";" : ":";
		let globalPaths: string[] = process.env.PATH.split(pathSeparator);
		globalPaths.some((globalPath: string) => {
			let testPath = path.join(globalPath, this.phpcsExecutableFile);
			if (fs.existsSync(testPath)) {
				resolvedPath = testPath;
				return true;
			}
			return false;
		});
		return resolvedPath;
	}
}
