/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals reduceNode */

chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg === "ping") {
    return;
  }

  // Browsers supporting useContentScriptContext will have already stored the
  // inspected node on the content script for us.  Other browsers have to store
  // it on the actual page for us to read here (we should unset it now, too).
  const requestId = msg.reduceRequest.id;
  const node = window.inspectedNode ||
               (window.wrappedJSObject && window.wrappedJSObject[chrome.runtime.id]);
  if (!node) {
    chrome.runtime.sendMessage({requestId}, () => { chrome.runtime.lastError; });
    return;
  }
  delete window[chrome.runtime.id];
  reduceNode(node, msg.reduceRequest).then(result => {
    chrome.runtime.sendMessage({requestId, result}, () => { chrome.runtime.lastError; });
  }, error => {
    chrome.runtime.sendMessage({requestId, error}, () => { chrome.runtime.lastError; });
  });
});
