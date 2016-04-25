/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import { NotificationType, TextDocumentIdentifier } from "vscode-languageserver";

/**
 * The document save notification is sent from the client to the server to signal
 * saving of text documents. The document's truth is now managed by the client
 * and the server must not try to read the document's truth using the document's
 * uri.
 */
export namespace DidSaveTextDocumentNotification {
    export const type: NotificationType<TextDocumentIdentifier> = { get method() { return "textDocument/didSave"; } };
}

export namespace DidStartValidateTextDocumentNotification {
    export const type: NotificationType<TextDocumentIdentifier> = { get method() { return "textDocument/didStartValidate"; } };
}

export namespace DidEndValidateTextDocumentNotification {
    export const type: NotificationType<TextDocumentIdentifier> = { get method() { return "textDocument/didEndValidate"; } };
}
