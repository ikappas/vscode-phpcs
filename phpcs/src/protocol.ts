/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import { NotificationType, TextDocumentIdentifier } from "vscode-languageclient";

/**
 * The parameters send in a did start validate text document notification
 */
export interface DidStartValidateTextDocumentParams {
	/**
	 * The document on which validation started.
	 */
	textDocument: TextDocumentIdentifier;
}

/**
 * The document start validation notification is sent from the server to the client to signal
 * the start of the validation on text documents.
 */
export namespace DidStartValidateTextDocumentNotification {
	export const type = new NotificationType<DidStartValidateTextDocumentParams, void>( "textDocument/didStartValidate" );
}

/**
 * The parameters send in a did end validate text document notification
 */
export interface DidEndValidateTextDocumentParams {
	/**
	 * The document on which validation ended.
	 */
	textDocument: TextDocumentIdentifier;
}

/**
 * The document end validation notification is sent from the server to the client to signal
 * the end of the validation on text documents.
 */
export namespace DidEndValidateTextDocumentNotification {
	export const type = new NotificationType<DidEndValidateTextDocumentParams, void>( "textDocument/didEndValidate" );
}
