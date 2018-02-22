/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

export class StringResources {

	static readonly DidStartValidateTextDocument: string = 'Linting started on: {0}';
	static readonly DidEndValidateTextDocument: string = 'Linting completed on: {0}';

	static readonly ComposerDependencyNotFoundError: string = 'Composer phpcs dependency is configured but was not found under {0}. You may need to run "composer install" or set your phpcs.executablePath manually.';
	static readonly UnableToLocatePhpcsError: string = 'Unable to locate phpcs. Please add phpcs to your global path or use composer dependency manager to install it in your project locally.';
	static readonly InvalidVersionStringError: string = 'Invalid version string encountered!';
	static readonly UnknownErrorWhileValidatingTextDocument: string = 'An unknown error occurred while validating: {0}';

	static readonly CreateLinterErrorDefaultMessage: string = 'Please add phpcs to your global path or use composer dependency manager to install it in your project locally.';
	static readonly CreateLinterError: string = 'Unable to locate phpcs. {0}';

	static readonly UnknownExecutionError: string = 'Unknown error ocurred. Please verify that {0} returns a valid json object.';
	static readonly CodingStandardNotInstalledError: string = 'The "{0}" coding standard is not installed. Please review your configuration an try again.';
	static readonly InvalidJsonStringError: string = 'The phpcs report contains invalid json. Please review "Diagnosing Common Errors" in the plugin README';

	static readonly Empty: string = '';
	static readonly Space: string = ' ';

}
