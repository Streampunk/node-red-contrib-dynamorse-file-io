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

const TestUtil = require('dynamorse-test');
// const os = require('os');
const fs = require('fs');
const util = require('util');
const getUri = util.promisify(require('get-uri'));
const mkdir = util.promisify(fs.mkdir);
const path = require('path');

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

const wavInTestNode = () => ({
  type: 'wav-in',
  z: TestUtil.testFlowId,
  name: 'wav-file-in-test',
  maxBuffer: 10,
  wsPort: TestUtil.properties.wsPort,
  x: 100.0,
  y: 100.0,
  wires: [[]]
});

// const wavOutTestNode = () => ({
//   type: 'wav-out',
//   z: TestUtil.testFlowId,
//   name: 'wav-file-out-test',
//   x: 300.0,
//   y: 100.0,
//   wires: []
// });

const wavInNodeId = '24fde3d7.b7544c';
const spoutNodeId = 'f2186999.7e5f78';

(async () => {
  await download('https://s3-eu-west-1.amazonaws.com/dynamorse-test/audiosweep.wav', 'test.wav');
  TestUtil.nodeRedTest('A wav-in->spout flow is posted to Node-RED', {
    filename: path.join(__dirname, 'tmp', 'test.wav'),
    grainsPerSecond: 25,
    maxBuffer: 10,
    spoutTimeout: 0
  }, params => {
    let testFlow = TestUtil.testNodes.baseTestFlow();
    testFlow.nodes.push(Object.assign(wavInTestNode(), {
      id: wavInNodeId,
      file: params.filename,
      grps: params.grainsPerSecond,
      maxBuffer: params.maxBuffer,
      wires: [ [ spoutNodeId ] ]
    }));

    testFlow.nodes.push(Object.assign(TestUtil.testNodes.spoutTestNode(), {
      id: spoutNodeId,
      timeout: params.spoutTimeout
    }));
    return testFlow;
  }, (t, params, msgObj, onEnd) => {
    let msgType = Object.keys(msgObj)
      .reduce((x, y) => x + y + ' ', '')
      .replace(/src /, msgObj.src);
    // t.comment(`Message: '${msgType}'`);
    switch (msgType) {
    case 'found srcID srcType spout':
      break;
    case 'push wav-file-in-test':
      TestUtil.checkGrain(t, msgObj.push);
      params.count++;
      break;
    case 'receive spout':
      TestUtil.checkGrain(t, msgObj.receive);
      break;
    case 'end spout':
      onEnd();
      break;
    case 'pull spout':
    case 'pull wav-file-in-test':
    case 'send wav-file-in-test':
    case 'close spout':
      break;
    default:
      t.comment(`Not handling ${msgType}: ${JSON.stringify(msgObj)}`);
      break;
    }
  }); })();

/* TestUtil.nodeRedTest('A wav-in->wav-out flow is posted to Node-RED', {
  inFilename: __dirname + '/data/please_help_me.wav',
  outFilename: os.tmpdir() + '/testWavOut.wav',
  grainsPerSecond: 25,
  maxBuffer: 10,
  spoutTimeout: 0
}, params => {
  var testFlow = TestUtil.testNodes.baseTestFlow();
  testFlow.nodes.push(Object.assign(wavInTestNode(), {
    id: wavInNodeId,
    file: params.inFilename,
    grps: params.grainsPerSecond,
    maxBuffer: params.maxBuffer,
    wires: [ [ spoutNodeId ] ]
  }));

  testFlow.nodes.push(Object.assign(wavOutTestNode(), {
    id: spoutNodeId,
    file: params.outFilename,
    timeout: params.spoutTimeout
  }));
  return testFlow;
}, (t, params, msgObj, onEnd) => {
  t.comment(`Message: ${JSON.stringify(msgObj)}`);
  if (msgObj.hasOwnProperty('receive')) {
    TestUtil.checkGrain(t, msgObj.receive);
    params.count++;
  }
  else if (msgObj.hasOwnProperty('wavDone')) {
    var srcStats = fs.statSync(params.inFilename);
    var dstStats = fs.statSync(params.outFilename);
    t.equal(srcStats.size, dstStats.size, 'output file is same size as source file');
    onEnd();
  }
}); */
