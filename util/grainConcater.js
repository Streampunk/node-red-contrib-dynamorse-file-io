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

var Grain = require('node-red-contrib-dynamorse-core').Grain;
var codecadon = require('codecadon');
var H = require('highland');

module.exports = function(srcTags) {
  var concater = new codecadon.Concater(() => {
    console.log('Concater exiting');
  });

  var dstSampleSize = concater.setInfo(srcTags);
  var isVideo = srcTags.format[0] === 'video';

  var grainMuncher = (err, x, push, next) => {
    if (err) {
      push(err);
      next();
    } else if (x === H.nil) {
      concater.quit(() => { push(null, H.nil); });
    } else {
      if (Grain.isGrain(x)) {
        var dstBufSize = isVideo ? dstSampleSize : x.getDuration()[0] * dstSampleSize;
        if (isNaN(dstBufSize)) {
          dstBufSize = x.buffers.reduce((x, y) => x + y.length, 0);
        }
        var dstBuf = Buffer.allocUnsafe(dstBufSize);
        concater.concat(x.buffers, dstBuf, (err, result) => {
          if (err) {
            push(err);
          } else if (result) {
            push(null, new Grain(result, x.ptpSync, x.ptpOrigin,
              x.timecode, x.flow_id, x.source_id, x.duration));
          }
          next();
        });
      } else {
        push(null, x);
        next();
      }
    }
  };

  return H.pipeline(H.consume(grainMuncher));
};
