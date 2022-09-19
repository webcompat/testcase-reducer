/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals chrome, exportFunction, reduceNode */

const reduceRequestMap = new Map();
if (window.wrappedJSObject) {
  window.wrappedJSObject.reduceTestCase = exportFunction(function(
    element,
    settings
  ) {
    const reduceRequestId = `consoleReq${Date.now()}`;
    reduceRequestMap.set(reduceRequestId, element);
    chrome.runtime.sendMessage({ reduceRequestId, settings });
    return chrome.i18n.getMessage("checkDevtoolsPanel");
  },
  window);
}

chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg === "ping") {
    return false;
  }

  // Browsers supporting useContentScriptContext will have already stored the
  // inspected node on the content script for us.  Other browsers have to store
  // it on the actual page for us to read here (we should unset it now, too).
  const requestId = msg.reduceRequest.id;
  const { frameId } = msg.reduceRequest;

  let node = reduceRequestMap.get(requestId);
  if (node) {
    reduceRequestMap.delete(requestId);
  } else {
    node = document.querySelector(`[r${requestId}]`);
  }
  if (!node) {
    sendResponse({ requestId, frameId });
    return false;
  }
  reduceNode(node, msg.reduceRequest).then(
    result => {
      sendResponse({ requestId, frameId, result });
    },
    error => {
      sendResponse({ requestId, frameId, error });
    }
  );
  return true;
});
