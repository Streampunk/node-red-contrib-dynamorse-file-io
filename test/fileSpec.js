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

const fs = require('fs');
const util = require('util');
const getUri = util.promisify(require('get-uri'));
const mkdir = util.promisify(fs.mkdir);
const path = require('path');
const rawSpec = require('./rawSpec.js');
const utilSpec = require('./utilSpec.js');
const wavSpec = require('./wavSpec.js');

let download = async (uri, file) => {
  try {
    await mkdir(path.join(__dirname, 'tmp'));
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  let srcStream = await getUri(uri);
  await new Promise((resolve, reject) => {
    srcStream.pipe(fs.createWriteStream(path.join(__dirname, 'tmp', file))
      .on('finish', resolve)
      .on('error', reject));
  });
};

const downloads = async () => {
  console.log('Downloading https://s3-eu-west-1.amazonaws.com/dynamorse-test/testRaw.raw');
  await download('https://s3-eu-west-1.amazonaws.com/dynamorse-test/testRaw.raw', 'testRaw.raw');
  console.log('Downloading https://s3-eu-west-1.amazonaws.com/dynamorse-test/sdp_rfc4175_10bit_1080i50.sdp');
  await download('https://s3-eu-west-1.amazonaws.com/dynamorse-test/sdp_rfc4175_10bit_1080i50.sdp', 'testRaw.sdp');
  console.log('Downloading https://s3-eu-west-1.amazonaws.com/dynamorse-test/audiosweep.wav');
  await download('https://s3-eu-west-1.amazonaws.com/dynamorse-test/audiosweep.wav', 'test.wav');
};

downloads()
  .then(() => {
    utilSpec();
    wavSpec();
    rawSpec();
  }).catch(console.error);
