/* Copyright 2018 Streampunk Media Ltd.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

const test = require('tape');
const resolveUri = require('../util/resolveURI.js');
const fileURIToPath = require('file-uri-to-path');
const { sep } = require('path');

test('Resolving relative URLs to file paths', t => {
  let cwd = process.cwd();
  let resolved = resolveUri('package.json');
  t.ok(resolved.startsWith('file:'), 'creates a file protocol URL.');
  t.ok(resolved.indexOf(cwd) > 0, 'contains the CWD.');
  t.ok(resolved.endsWith('/package.json'), 'ends with separator and name.');
  t.end();
});

test('Resolving paths with drive letters', t => {
  let resolved = resolveUri('c:\\package.json');
  t.ok(resolved.startsWith('file:'), 'windows version creates a file protocol URL.');
  t.ok(resolved.endsWith('/c:\\package.json'), 'windows version ends with separator and name.');
  t.doesNotThrow(() => fileURIToPath(resolved), TypeError, 'windows version creates a valid path.');
  resolved = resolveUri('c:/package.json');
  t.ok(resolved.startsWith('file:'), 'unix version creates a file protocol URL.');
  t.ok(resolved.endsWith('/c:/package.json'), 'unix version ends with separator and name.');
  t.doesNotThrow(() => fileURIToPath(resolved), TypeError, 'unix version creates a valid path.');
  if (sep === '\\') { // Test only works on Windows
    t.equal(fileURIToPath(resolved), 'c:\\package.json', 'windows separators sorted.');
  }
  t.end();
});

const testURLs = [
  'http://www.bbc.co.uk/',
  'ftp://fred.com/some/resource',
  'https://www.streampunk.media/index.html',
  'file:///Users/streampunk/wibble.json'
];

test('Resolving other protocols are not altered', t => {
  for ( let u of testURLs) {
    t.equal(resolveUri(u), u, `URL ${u} is not alterred.`);
  }
  t.end();
});
