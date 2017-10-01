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

var util = require('util');
var redioactive = require('node-red-contrib-dynamorse-core').Redioactive
var Grain = require('node-red-contrib-dynamorse-core').Grain;

module.exports = function (RED) {
  function GlobOut (config) {
    RED.nodes.createNode(this, config);
    redioactive.Spout.call(this, config);

    this.srcTags = null;
    var begin = null;
    var sentCount = 0;

    var lastSlash = config.glob.lastIndexOf(path.sep);
    var pathParts = (lastSlash >= 0) ?
      [ config.glob.slice(0, lastSlash), config.glob.slice(lastSlash + 1)] :
      [ '.', config.glob];
    pathParts[1] = (pathParts[1].length === 0) ? '*' : pathParts[1];

    this.each((x, next) => {
      if (!Grain.isGrain(x)) {
        this.warn('Received non-Grain payload.');
        return next();
      }
      var nextJob = (this.srcTags) ? // TODO improve cable filtering
        Promise.resolve(x) :
        this.findCable(x).then(f => {
          if (Array.isArray(f[0].video) && f[0].video.length > 0) {
            this.srcTags = f[0].video[0].tags;
          } else if (Array.isArray(f[0].audio) && f[0].audio.length > 0) {
            this.srcTags = f[0].audio[0].tags;
          } else {
            return Promise.reject(`Logical cable does not contain video or audio.`);
          }
          return x;
        });
      nextJob.then(g => {

      }).catch(e => {
        this.preFlightError(`Could not read tags: ${e}`);
      });
      next();
    });
    this.done(() => {
      this.log('Thank goodness that is over!');
    });
    this.errors((err, next) => {
      this.log(`Received error ${err.toString()}.`);
      next();
    });
  }
  util.inherits(GlobOut, redioactive.Spout);
  RED.nodes.registerType("glob-out", GlobOut);
}
