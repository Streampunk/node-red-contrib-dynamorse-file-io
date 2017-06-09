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

var redioactive = require('node-red-contrib-dynamorse-core').Redioactive;
var util = require('util');
var AWS = require('aws-sdk');
var Grain = require('node-red-contrib-dynamorse-core').Grain;
var grainConcater = require('../util/grainConcater.js');
var Promise = require('promise');
var util = require('util');

module.exports = function (RED) {
  function CloudStoreIn (config) {
    RED.nodes.createNode(this,config);
    redioactive.Funnel.call(this, config);
    console.log(util.inspect(config));
    var s3 = new AWS.S3({ region : config.region });
    s3.headBucket({ Bucket : config.bucket }, e => {
      if (e) {
        return this.preFlightError(`Error accessing bucket: ${e}`);
      }
    });

  }
  util.inherits(CloudStoreIn, redioactive.Funnel);
  RED.nodes.registerType("cloud-store-in", CloudStoreIn);
}
