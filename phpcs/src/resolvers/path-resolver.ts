/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import { PhpcsPathResolverBase } from './path-resolver-base';
import { ComposerPhpcsPathResolver } from './composer-path-resolver';
import { GlobalPhpcsPathResolver } from './global-path-resolver';

export interface PhpcsPathResolverOptions {
	workspaceRoot: string | null;
	composerJsonPath: string;
}

export class PhpcsPathResolver extends PhpcsPathResolverBase {

	private resolvers: PhpcsPathResolverBase[] = [];

	constructor(options: PhpcsPathResolverOptions) {
		super();
		if (options.workspaceRoot !== null) {
			this.resolvers.push(new ComposerPhpcsPathResolver(options.workspaceRoot, options.composerJsonPath));
		}
		this.resolvers.push(new GlobalPhpcsPathResolver());
	}

	async resolve(): Promise<string> {
		let resolvedPath: string = null;
		for (var i = 0, len = this.resolvers.length; i < len; i++) {
			let resolverPath = await this.resolvers[i].resolve();
			if (resolvedPath !== resolverPath) {
				resolvedPath = resolverPath;
				break;
			}
		}
		if (resolvedPath === null) {
			throw new Error('Unable to locate phpcs. Please add phpcs to your global path or use composer dependency manager to install it in your project locally.');
		}
		return resolvedPath;
	}
}
