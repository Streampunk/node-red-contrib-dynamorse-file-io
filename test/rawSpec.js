/* Copyright 2017 Streampunk Media Ltd.

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

var TestUtil = require('dynamorse-test').TestUtil;
var util = require('util');

var rawInTestNode = JSON.stringify({
  "type": "raw-file-in",
  "z": TestUtil.testFlowId,
  "name": "raw-file-in-test",
  "grainDuration" : "0/1",
  "maxBuffer": 10,
  "wsPort": TestUtil.properties.wsPort,
  "x": 100.0,
  "y": 100.0,
  "wires": [[]]
});
var rawInNodeId = "24fde3d7.b7544c";
var spoutNodeId = "f2186999.7e5f78";

TestUtil.nodeRedTest('A raw-in->spout flow is posted to Node-RED', {
  rawFilename: __dirname + '/data/testRaw.raw',
  sdpFilename: __dirname + '/data/sdp_rfc4175_10bit_1080i50.sdp',
  maxBuffer: 10,
  spoutTimeout: 0
}, function getFlow(params) {
  var testFlow = JSON.parse(TestUtil.testNodes.baseTestFlow);
  testFlow.nodes[0] = JSON.parse(rawInTestNode);
  testFlow.nodes[0].id = rawInNodeId;
  testFlow.nodes[0].file = params.rawFilename,
  testFlow.nodes[0].sdpURL = `file:${params.sdpFilename}`,
  testFlow.nodes[0].maxBuffer = params.maxBuffer;
  testFlow.nodes[0].wires[0][0] = spoutNodeId;

  testFlow.nodes[1] = JSON.parse(TestUtil.testNodes.spoutTestNode);
  testFlow.nodes[1].id = spoutNodeId;
  testFlow.nodes[1].timeout = params.spoutTimeout;
  return testFlow;
}, function onMsg(t, params, msgObj, onEnd) {
  //t.comment(`Message: ${JSON.stringify(msgObj)}`);
  if (msgObj.hasOwnProperty('receive')) {
    TestUtil.checkGrain(t, msgObj.receive);
  }
  else if (msgObj.hasOwnProperty('end') && (msgObj.src === 'spout')) {
    onEnd();
  }
});

