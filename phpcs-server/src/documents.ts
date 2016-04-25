/*---------------------------------------------------------
 * Copyright (C) Ioannis Kappas. All rights reserved.
 *--------------------------------------------------------*/
"use strict";

import {
	ITextDocument, IConnection, TextDocumentSyncKind, TextDocumentContentChangeEvent,
	DidOpenTextDocumentParams, DidChangeTextDocumentParams, TextDocumentIdentifier,
	Position
} from "vscode-languageserver";

import { DidSaveTextDocumentNotification } from "./protocol";
import { Event, Emitter } from "./utils/events";

class FullTextDocument implements ITextDocument {

	private _uri: string;
	private _languageId: string;
	private _version: number;
	private _content: string;
	private _lineOffsets: number[];

	public constructor(uri: string, languageId: string, version: number, content: string) {
		this._uri = uri;
		this._languageId = languageId;
		this._version = version;
		this._content = content;
		this._lineOffsets = null;
	}

	public get uri(): string {
		return this._uri;
	}

	public get languageId(): string {
		return this._languageId;
	}

	public get version(): number {
		return this._version;
	}

	public getText(): string {
		return this._content;
	}

	public update(event: TextDocumentContentChangeEvent, version: number): void {
		this._content = event.text;
		this._version = version;
		this._lineOffsets = null;
	}

	private getLineOffsets() : number[] {
		if (this._lineOffsets === null) {
			let lineOffsets: number[] = [];
			let text = this._content;
			let isLineStart = true;
			for (let i = 0; i < text.length; i++) {
				if (isLineStart) {
					lineOffsets.push(i);
					isLineStart = false;
				}
				let ch = text.charAt(i);
				isLineStart = (ch === "\r" || ch === "\n");
				if (ch === "\r" && i + 1 < text.length && text.charAt(i+1) === "\n") {
					i++;
				}
			}
			if (isLineStart && text.length > 0) {
				lineOffsets.push(text.length);
			}
			this._lineOffsets = lineOffsets;
		}
		return this._lineOffsets;
	}

	public positionAt(offset:number) {
		offset = Math.max(Math.min(offset, this._content.length), 0);

		let lineOffsets = this.getLineOffsets();
		let low = 0, high = lineOffsets.length;
		if (high === 0) {
			return Position.create(0, offset);
		}
		while (low < high) {
			let mid = Math.floor((low + high) / 2);
			if (lineOffsets[mid] > offset) {
				high = mid;
			} else {
				low = mid + 1;
			}
		}
		// low is the least x for which the line offset is larger than the current offset
		// or array.length if no line offset is larger than the current offset
		let line = low - 1;
		return Position.create(line, offset - lineOffsets[line]);
	}

	public offsetAt(position: Position) {
		let lineOffsets = this.getLineOffsets();
		if (position.line >= lineOffsets.length) {
			return this._content.length;
		} else if (position.line < 0) {
			return 0;
		}
		let lineOffset = lineOffsets[position.line];
		let nextLineOffset = (position.line + 1 < lineOffsets.length) ? lineOffsets[position.line + 1] : this._content.length;
		return Math.max(Math.min(lineOffset + position.character, nextLineOffset), lineOffset);
	}

	public get lineCount() {
		return this.getLineOffsets().length;
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

	private _documents : { [uri: string]: FullTextDocument };
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
			let document = new FullTextDocument(event.uri, event.languageId, -1, event.text);
			this._documents[event.uri] = document;
			this._onDidOpenDocument.fire({ document });
			this._onDidChangeContent.fire({ document });
		});
		connection.onDidChangeTextDocument((event: DidChangeTextDocumentParams) => {
			let changes = event.contentChanges;
			let last: TextDocumentContentChangeEvent = changes.length > 0 ? changes[changes.length - 1] : null;
			if (last) {
				let document = this._documents[event.uri];
				document.update(last, -1);
				this._onDidChangeContent.fire({ document });
			}
		});
	 	connection.onNotification(DidSaveTextDocumentNotification.type, (event) => {
			let document = this._documents[event.textDocument.uri];
			this._onDidSaveDocument.fire({ document });
		});
		connection.onDidCloseTextDocument((event: TextDocumentIdentifier) => {
			let document = this._documents[event.uri];
			delete this._documents[event.uri];
			this._onDidCloseDocument.fire({document});
		});
	}
}