/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import { NotificationType, TextDocumentIdentifier } from "vscode-languageserver";

/**
 * The parameters send in a did save text document notification
 */
export interface DidSaveTextDocumentNotificationParams {
	/**
	 * The document that was saved.
	 */
	textDocument: TextDocumentIdentifier;
}

/**
 * The document save notification is sent from the client to the server to signal
 * saved text documents. The document's truth is now managed by the client
 * and the server must not try to read the document's truth using the document's
 * uri.
 */
export namespace DidSaveTextDocumentNotification {
    export const type: NotificationType<DidSaveTextDocumentNotificationParams> = { get method() { return "textDocument/didSave"; } };
}

/**
 * The parameters send in a did start validate text document notification
 */
export interface DidStartValidateTextDocumentNotificationParams {
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
    export const type: NotificationType<DidStartValidateTextDocumentNotificationParams> = { get method() { return "textDocument/didStartValidate"; } };
}

/**
 * The parameters send in a did end validate text document notification
 */
export interface DidEndValidateTextDocumentNotificationParams {
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
    export const type: NotificationType<DidEndValidateTextDocumentNotificationParams> = { get method() { return "textDocument/didEndValidate"; } };
}
