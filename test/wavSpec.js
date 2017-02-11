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
var os = require('os');
var fs = require('fs');

var wavInTestNode = JSON.stringify({
  "type": "wav-in",
  "z": TestUtil.testFlowId,
  "name": "wav-file-in-test",
  "maxBuffer": 10,
  "wsPort": TestUtil.properties.wsPort,
  "x": 100.0,
  "y": 100.0,
  "wires": [[]]
});

var wavOutTestNode = JSON.stringify({
  "type": "wav-out",
  "z": TestUtil.testFlowId,
  "name": "wav-file-out-test",
  "x": 300.0,
  "y": 100.0,
  "wires": []
});

var wavInNodeId = "24fde3d7.b7544c";
var spoutNodeId = "f2186999.7e5f78";

TestUtil.nodeRedTest('A wav-in->spout flow is posted to Node-RED', {
  filename: __dirname + '/data/please_help_me.wav',
  grainsPerSecond: 25,
  maxBuffer: 10,
  spoutTimeout: 0
}, function getFlow(params) {
  var testFlow = JSON.parse(TestUtil.testNodes.baseTestFlow);
  testFlow.nodes[0] = JSON.parse(wavInTestNode);
  testFlow.nodes[0].id = wavInNodeId;
  testFlow.nodes[0].file = params.filename,
  testFlow.nodes[0].grps = params.grainsPerSecond,
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
    params.count++;    
  }
  else if (msgObj.hasOwnProperty('end') && (msgObj.src === 'spout')) {
    onEnd();
  }
});

TestUtil.nodeRedTest('A wav-in->wav-out flow is posted to Node-RED', {
  inFilename: __dirname + '/data/please_help_me.wav',
  outFilename: os.tmpdir() + '/testWavOut.wav',
  grainsPerSecond: 25,
  maxBuffer: 10,
  spoutTimeout: 0
}, function getFlow(params) {
  var testFlow = JSON.parse(TestUtil.testNodes.baseTestFlow);
  testFlow.nodes[0] = JSON.parse(wavInTestNode);
  testFlow.nodes[0].id = wavInNodeId;
  testFlow.nodes[0].file = params.inFilename,
  testFlow.nodes[0].grps = params.grainsPerSecond,
  testFlow.nodes[0].maxBuffer = params.maxBuffer;
  testFlow.nodes[0].wires[0][0] = spoutNodeId;

  testFlow.nodes[1] = JSON.parse(wavOutTestNode);
  testFlow.nodes[1].id = spoutNodeId;
  testFlow.nodes[1].file = params.outFilename,
  testFlow.nodes[1].timeout = params.spoutTimeout;
  return testFlow;
}, function onMsg(t, params, msgObj, onEnd) {
  //t.comment(`Message: ${JSON.stringify(msgObj)}`);
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
});
