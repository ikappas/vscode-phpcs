
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as fs from "fs";
import * as paths from "path";
import * as strings from "../common/strings";

export function realpathSync(path: string): string {
	try {
		return fs.realpathSync(path);
	} catch (error) {

		// We hit an error calling fs.realpathSync(). Since fs.realpathSync() is doing some path normalization
		// we now do a similar normalization and then try again if we can access the path with read
		// permissions at least. If that succeeds, we return that path.
		// fs.realpath() is resolving symlinks and that can fail in certain cases. The workaround is
		// to not resolve links but to simply see if the path is read accessible or not.
		const normalizedPath = normalizePath(path);
		fs.accessSync(normalizedPath, fs.constants.R_OK); // throws in case of an error

		return normalizedPath;
	}
}

function normalizePath(path: string): string {
	return strings.rtrim(paths.normalize(path), paths.sep);
}

export async function findAsync(parent: string, directory: string, name: string | Array<string>): Promise<string | null> {

	if (typeof parent !== 'string') {
		throw new Error('Invalid or no `parent` provided');
	} else if (typeof directory !== 'string') {
		throw new Error('Invalid or no `directory` provided');
	} else if (typeof name !== 'string' && !(name instanceof Array)) {
		throw new Error('Invalid or no `name` provided');
	}

	const names = [].concat(name);
	const chunks = paths.resolve(parent, directory).split(paths.sep);

	while (chunks.length) {
		let currentDir = chunks.join(paths.sep);
		for (const fileName of names) {
			const filePath = paths.join(currentDir, fileName);
			if (fs.existsSync(filePath)) {
				return filePath;
			}
		}
		if (parent === currentDir) {
			break;
		}
		chunks.pop();
	}

	return null;
}
