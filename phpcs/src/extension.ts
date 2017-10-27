/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as path from "path";
import * as proto from "./protocol";
import { PhpcsStatus } from "./status";

import { workspace, ExtensionContext } from "vscode";
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind } from "vscode-languageclient";

export function activate(context: ExtensionContext) {

	// The server is implemented in node
	let serverModule = context.asAbsolutePath(path.join("server", "server.js"));

	// The debug options for the server
	let debugOptions = { execArgv: ["--nolazy", "--debug=6199"] };

	// If the extension is launch in debug mode the debug server options are use
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run : { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for php documents
		documentSelector: ["php"],
		synchronize: {
			// Synchronize the setting section "phpcs"" to the server
			configurationSection: "phpcs",
			// Notify the server about file changes to 'ruleset.xml' files contain in the workspace
			fileEvents: workspace.createFileSystemWatcher("**/ruleset.xml")
		}
	};

	// Create the language client the client.
	let client = new LanguageClient("PHP CodeSniffer Linter", serverOptions, clientOptions);

	let status = new PhpcsStatus();
	client.onReady().then(() => {
		client.onNotification( proto.DidStartValidateTextDocumentNotification.type, (event):void => {
			status.startProcessing(event.textDocument.uri);
		});
		client.onNotification( proto.DidEndValidateTextDocumentNotification.type, (event) => {
			status.endProcessing(event.textDocument.uri);
		});
	});

	// Create the settings monitor and start the monitor for the client.
	let monitor = new SettingMonitor(client, "phpcs.enable").start();

	// Push the monitor to the context's subscriptions so that the
	// client can be deactivated on extension deactivation
	context.subscriptions.push(monitor);
	context.subscriptions.push(status);
}
