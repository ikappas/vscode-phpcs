/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
const strings = require('../../../src/base/common/strings');

suite('Strings', () => {

	test('format', function () {
		assert.strictEqual(strings.format('Foo Bar'), 'Foo Bar');
		assert.strictEqual(strings.format('Foo {0} Bar'), 'Foo {0} Bar');
		assert.strictEqual(strings.format('Foo {0} Bar', 'yes'), 'Foo yes Bar');
		assert.strictEqual(strings.format('Foo {0} Bar {0}', 'yes'), 'Foo yes Bar yes');
		assert.strictEqual(strings.format('Foo {0} Bar {1}{2}', 'yes'), 'Foo yes Bar {1}{2}');
		assert.strictEqual(strings.format('Foo {0} Bar {1}{2}', 'yes', undefined), 'Foo yes Bar undefined{2}');
		assert.strictEqual(strings.format('Foo {0} Bar {1}{2}', 'yes', 5, false), 'Foo yes Bar 5false');
		assert.strictEqual(strings.format('Foo {0} Bar. {1}', '(foo)', '.test'), 'Foo (foo) Bar. .test');
	});

	test('rtrim', function () {
		assert.strictEqual(strings.rtrim('foo', 'o'), 'f');
		assert.strictEqual(strings.rtrim('foo', 'f'), 'foo');
		assert.strictEqual(strings.rtrim('http://www.test.de', '.de'), 'http://www.test');
		assert.strictEqual(strings.rtrim('/foo/', '/'), '/foo');
		assert.strictEqual(strings.rtrim('/foo//', '/'), '/foo');
		assert.strictEqual(strings.rtrim('/', ''), '/');
		assert.strictEqual(strings.rtrim('/', '/'), '');
		assert.strictEqual(strings.rtrim('///', '/'), '');
		assert.strictEqual(strings.rtrim('', ''), '');
		assert.strictEqual(strings.rtrim('', '/'), '');
	});

});