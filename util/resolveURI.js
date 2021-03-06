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

const { parse } = require('url');
const relativeOrDrive = /^.+:|^\/|^\\/;

module.exports = uri => {
  let parsed = parse(uri);
  if (parsed.protocol && parsed.protocol.length === 2) {
    parsed.pathname = uri;
    parsed.protocol = null;
  }
  if (!parsed.protocol) {
    return relativeOrDrive.test(parsed.pathname) ?
      'file:///' + parsed.pathname : 'file:///' + process.cwd() + '/' + parsed.pathname;
  }
  return uri;
};
