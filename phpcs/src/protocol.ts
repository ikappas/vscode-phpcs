/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { NotificationType } from 'vscode-languageclient';

/**
 * A literal to identify a text document in the client.
 */
export interface TextDocumentIdentifier {
    /**
     * The text document's uri.
     */
    uri: string;
}

/**
 * The document save notification is sent from the client to the server to signal
 * saved text documents. The document's truth is now managed by the client
 * and the server must not try to read the document's truth using the document's
 * uri.
 */
export namespace DidSaveTextDocumentNotification {
    export const type: NotificationType<TextDocumentIdentifier> = { get method() { return 'textDocument/didSave'; } };;
}
