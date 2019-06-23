/* --------------------------------------------------------------------------------------------
 * Copyright (c) Ioannis Kappas. All rights reserved.
 * Licensed under the MIT License. See License.md in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
"use strict";

import * as path from "path";
import * as proto from "./protocol";

import {
	CancellationToken,
	ExtensionContext,
	workspace
} from "vscode";

import {
	LanguageClient,
	LanguageClientOptions,
	Middleware,
	Proposed,
	ProposedFeatures,
	ServerOptions,
	TransportKind
} from "vscode-languageclient";

import { PhpcsStatus } from "./status";
import { PhpcsConfiguration } from "./configuration";

export function activate(context: ExtensionContext) {

	let client: LanguageClient;
	let config: PhpcsConfiguration;

	// The server is implemented in node
	let serverModule = context.asAbsolutePath(path.join("server", "src", "server.js"));

	// The debug options for the server
	let debugOptions = { execArgv: ["--nolazy", "--inspect=6199"] };

	// If the extension is launch in debug mode the debug server options are use
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};

	let middleware: ProposedFeatures.ConfigurationMiddleware | Middleware = {
		workspace: {
			configuration: async (params: Proposed.ConfigurationParams, token: CancellationToken, next: Function) => {
				return config.compute(params, token, next);
			}
		}
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for php documents
		documentSelector: ["php"],
		synchronize: {
			// Notify the server about file changes to 'ruleset.xml' files contain in the workspace
			fileEvents: workspace.createFileSystemWatcher("**/ruleset.xml")
		},
		middleware: middleware as Middleware
	};

	// Create the language client.
	client = new LanguageClient("phpcs", "PHP Code Sniffer", serverOptions, clientOptions);

	// Register new proposed protocol if available.
	client.registerProposedFeatures();

	config = new PhpcsConfiguration(client);

	// Create the status monitor.
	let status = new PhpcsStatus();
	client.onReady().then(() => {
		config.initialize();
		client.onNotification(proto.DidStartValidateTextDocumentNotification.type, event => {
			status.startProcessing(event.textDocument.uri, event.buffered);
		});
		client.onNotification(proto.DidEndValidateTextDocumentNotification.type, event => {
			status.endProcessing(event.textDocument.uri, event.buffered);
		});
	});

	client.start();

	// Push the monitor to the context's subscriptions so that the
	// client can be deactivated on extension deactivation
	context.subscriptions.push(status);
	context.subscriptions.push(config);
}
