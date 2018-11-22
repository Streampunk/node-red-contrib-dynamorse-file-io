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
const swapBytes = require('../util/swapBytes.js');
const fileURIToPath = require('file-uri-to-path');
const { sep } = require('path');

const utilSpec = () => {
  test('Resolving relative URLs to file paths', t => {
    const numTests = 3;
    t.plan(numTests);
    let cwd = process.cwd();
    let resolved = resolveUri('package.json');
    t.ok(resolved.startsWith('file:'), 'creates a file protocol URL.');
    t.ok(resolved.indexOf(cwd) > 0, 'contains the CWD.');
    t.ok(resolved.endsWith('/package.json'), 'ends with separator and name.');
  });

  test('Resolving paths with drive letters', t => {
    let numTests = 6;
    if (sep === '\\')
      numTests++;
    t.plan(numTests);
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
  });

  const testURLs = [
    'http://www.bbc.co.uk/',
    'ftp://fred.com/some/resource',
    'https://www.streampunk.media/index.html',
    'file:///Users/streampunk/wibble.json'
  ];

  test('Resolving other protocols are not altered', t => {
    const numTests = testURLs.length;
    t.plan(numTests);
    for ( let u of testURLs) {
      t.equal(resolveUri(u), u, `URL ${u} is not alterred.`);
    }
  });

  test('Swapping bytes', t => {
    t.plan(11);
    t.deepEqual(swapBytes(Buffer.alloc(0), 16), Buffer.alloc(0),
      'works for empty buffers.');
    t.deepEqual(swapBytes(Buffer.from([1, 2]), 16), Buffer.from([2, 1]),
      'swaps two bytes for 16 bits per sample OK.');
    t.deepEqual(swapBytes(Buffer.from([1, 2, 3]), 24), Buffer.from([3, 2, 1]),
      'swaps three bytes for 24 bits per sample OK.');
    t.deepEqual(swapBytes(Buffer.from([1, 2, 3]), 16), Buffer.from([2, 1, 3]),
      'swaps three bytes for 16 bits per sample OK.');
    t.deepEqual(swapBytes(Buffer.from([1, 2, 3, 4]), 24), Buffer.from([3, 2, 1, 4]),
      'swaps four bytes for 24 bits per sample OK.');
    t.deepEqual(swapBytes(Buffer.from([1, 2, 3, 4, 5]), 24), Buffer.from([3, 2, 1, 4, 5]),
      'swaps five bytes for 24 bits per sample OK.');
    t.deepEqual(swapBytes(Buffer.from([1]), 16), Buffer.from([1]),
      'swaps one byte for 16 bits per sample OK.');
    t.deepEqual(swapBytes(Buffer.from([1]), 24), Buffer.from([1]),
      'swaps one byte for 24 bits per sample OK.');
    t.deepEqual(swapBytes(Buffer.from([1, 2]), 24), Buffer.from([1, 2]),
      'swaps two bytes for 24 bits per sample OK.');
    // TODO - consider whether this should throw an exception?
    t.deepEqual(swapBytes(Buffer.from([1, 2, 3, 4, 5]), 17), Buffer.from([1, 2, 3, 4, 5]),
      'does not swap bytes for an unknown bit depth.');
    let b = Buffer.from([5, 4, 3, 2, 1]);
    t.equal(swapBytes(b, 16), b, 'returns the same buffer.');
  });
};

module.exports = utilSpec;
