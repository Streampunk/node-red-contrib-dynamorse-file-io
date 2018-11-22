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

const rawInTestNode = () => ({
  type: 'raw-file-in',
  z: TestUtil.testFlowId,
  name: 'raw-file-in-test',
  grainDuration: '0/1',
  maxBuffer: 10,
  wsPort: TestUtil.properties.wsPort,
  x: 100.0,
  y: 100.0,
  wires: [[]]
});

const rawInNodeId = '24fde3d7.b7544c';
const spoutNodeId = 'f2186999.7e5f78';

const rawSpec = () => {
  TestUtil.nodeRedTest('A raw-in->spout flow is posted to Node-RED', {
    rawFilename: __dirname + '/tmp/testRaw.raw',
    sdpFilename: __dirname + '/tmp/testRaw.sdp',
    maxBuffer: 10,
    spoutTimeout: 0
  }, params => {
    var testFlow = TestUtil.testNodes.baseTestFlow();
    testFlow.nodes.push(Object.assign(rawInTestNode(), {
      id: rawInNodeId,
      file: params.rawFilename,
      sdpURL: `file:${params.sdpFilename}`,
      maxBuffer: params.maxBuffer,
      wires: [ [ spoutNodeId ] ]
    }));

    testFlow.nodes.push(Object.assign(TestUtil.testNodes.spoutTestNode(),{
      id: spoutNodeId,
      timeout: params.spoutTimeout
    }));
    return testFlow;
  }, (t, params, msgObj, onEnd) => {
    //t.comment(`Message: ${JSON.stringify(msgObj)}`);
    if (msgObj.hasOwnProperty('receive')) {
      TestUtil.checkGrain(t, msgObj.receive);
    }
    else if (msgObj.hasOwnProperty('end') && (msgObj.src === 'spout')) {
      onEnd();
    }
  });
};

module.exports = rawSpec;
