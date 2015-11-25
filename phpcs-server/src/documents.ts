/*---------------------------------------------------------
 * Copyright (C) Ioannis Kappas. All rights reserved.
 *--------------------------------------------------------*/
"use strict";

import {
	ITextDocument, IConnection, TextDocumentSyncKind, TextDocumentContentChangeEvent,
	DidOpenTextDocumentParams, DidChangeTextDocumentParams, TextDocumentIdentifier
} from "vscode-languageserver";

import { DidSaveTextDocumentNotification } from './protocol';
import { Event, Emitter } from './utils/events';

class TextDocument implements ITextDocument {

	private _uri: string;
	private _content: string;

	public constructor(uri: string, content: string) {
		this._uri = uri;
		this._content = content;
	}

	public get uri(): string {
		return this._uri;
	}

	public getText(): string {
		return this._content;
	}

	public update(event: TextDocumentContentChangeEvent): void {
		this._content = event.text;
	}
}

interface IConnectionState {
	__textDocumentSync: TextDocumentSyncKind;
}

/**
 * Event to signal opening of a simple text document.
 */
export interface TextDocumentOpenEvent {
	/**
	 * The document that has changed.
	 */
	document: ITextDocument;
}

/**
 * Event to signal chaging of a simple text document.
 */
export interface TextDocumentChangeEvent {
	/**
	 * The document that has changed.
	 */
	document: ITextDocument;
}

/**
 * Event to signal saving of a simple text document.
 */
export interface TextDocumentSaveEvent {
	/**
	 * The document that has changed.
	 */
	document: ITextDocument;
}

/**
 * Event to signal closing of a simple text document.
 */
export interface TextDocumentCloseEvent {
	/**
	 * The document that has changed.
	 */
	document: ITextDocument;
}

/**
 * A manager for simple text documents
 */
export class PhpcsDocuments {

	private _documents : { [uri: string]: TextDocument };
	private _onDidOpenDocument: Emitter<TextDocumentOpenEvent>;
	private _onDidChangeContent: Emitter<TextDocumentChangeEvent>;
	private _onDidSaveDocument: Emitter<TextDocumentSaveEvent>;
	private _onDidCloseDocument: Emitter<TextDocumentCloseEvent>;

	/**
	 * Create a new text document manager.
	 */
	public constructor() {
		this._documents = Object.create(null);
		this._onDidOpenDocument = new Emitter<TextDocumentOpenEvent>();
		this._onDidChangeContent = new Emitter<TextDocumentChangeEvent>();
		this._onDidSaveDocument = new Emitter<TextDocumentSaveEvent>();
		this._onDidCloseDocument = new Emitter<TextDocumentCloseEvent>();
	}

	/**
	 * Returns the [TextDocumentSyncKind](#TextDocumentSyncKind) used by
	 * this text document manager.
	 */
	public get syncKind(): TextDocumentSyncKind {
		return TextDocumentSyncKind.Full;
	}

	/**
	 * An event that fires when a text document managed by this manager
	 * is opened.
	 */
	public get onDidOpenDocument() : Event<TextDocumentOpenEvent> {
		return this._onDidOpenDocument.event;
	}

	/**
	 * An event that fires when a text document managed by this manager
	 * changes.
	 */
	public get onDidChangeContent(): Event<TextDocumentChangeEvent> {
		return this._onDidChangeContent.event;
	}

	/**
	 * An event that fires when a text document managed by this manager
	 * is saved.
	 */
	public get onDidSaveDocument() : Event<TextDocumentSaveEvent> {
		return this._onDidSaveDocument.event;
	}

	/**
	 * An event that fires when a text document managed by this manager
	 * is closed.
	 */
	public get onDidCloseDocument() : Event<TextDocumentCloseEvent> {
		return this._onDidCloseDocument.event;
	}

	/**
	 * Returns the document for the given URI. Returns undefined if
	 * the document is not mananged by this instance.
	 *
	 * @param uri The text document's URI to retrieve.
	 * @return the text document or `undefined`.
	 */
	public get(uri: string): ITextDocument {
		return this._documents[uri];
	}

	/**
	 * Returns all text documents managed by this instance.
	 *
	 * @return all text documents.
	 */
	public all(): ITextDocument[] {
		return Object.keys(this._documents).map(key => this._documents[key]);
	}

	/**
	 * Returns the URIs of all text documents managed by this instance.
	 *
	 * @return the URI's of all text documents.
	 */
	public keys(): string[] {
		return Object.keys(this._documents);
	}

	/**
	 * Listens for `low level` notification on the given connection to
	 * update the text documents managed by this instance.
	 *
	 * @param connection The connection to listen on.
	 */
	public listen(connection: IConnection): void {
		(<IConnectionState><any>connection).__textDocumentSync = TextDocumentSyncKind.Full;
		connection.onDidOpenTextDocument((event: DidOpenTextDocumentParams) => {
			let document = new TextDocument(event.uri, event.text);
			this._documents[event.uri] = document;
			this._onDidOpenDocument.fire({ document });
			this._onDidChangeContent.fire({ document });
		});
		connection.onDidChangeTextDocument((event: DidChangeTextDocumentParams) => {
			let changes = event.contentChanges;
			let last: TextDocumentContentChangeEvent = changes.length > 0 ? changes[changes.length - 1] : null;
			if (last) {
				let document = this._documents[event.uri];
				document.update(last);
				this._onDidChangeContent.fire({ document });
			}
		});
	 	connection.onNotification(DidSaveTextDocumentNotification.type, (event) => {
			let document = this._documents[event.uri];
			this._onDidSaveDocument.fire({ document });
		});
		connection.onDidCloseTextDocument((event: TextDocumentIdentifier) => {
			let document = this._documents[event.uri];
			delete this._documents[event.uri];
			this._onDidCloseDocument.fire({document});
		});
	}
}