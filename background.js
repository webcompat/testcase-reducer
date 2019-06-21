"use strict";

let currentRequest;

async function doReduction(reduceRequest, callback) {
  const {tabId} = reduceRequest;
  currentRequest = {callback, errors: []};
  const requestId = reduceRequest.id = currentRequest.id = Date.now();

  chrome.webNavigation.getAllFrames({tabId}, frames => {
    currentRequest.framesLeft = frames.length;
    for (const {frameId, errorOccurred} of frames) {
      if (errorOccurred) {
        incomingResponseFromFrame({requestId});
        continue;
      }
      chrome.tabs.sendMessage(tabId, {reduceRequest}, {frameId}, () => {
        if (chrome.runtime.lastError) {
          incomingResponseFromFrame({requestId, error: chrome.runtime.lastError.toString()});
        }
      });
    }
  });
}

function incomingResponseFromFrame(response) {
  const {requestId, result, error} = response || {};
  if (requestId !== currentRequest.id) {
    return;
  }
  if (result) {
    currentRequest.result = result;
  }
  if (error) {
    currentRequest.errors.push(error);
  }
  if (!--currentRequest.framesLeft) {
    if (currentRequest.result) {
      currentRequest.callback({result: currentRequest.result});
    } else {
      const error = currentRequest.errors.join("\n") || "No result?";
      currentRequest.callback({error});
    }
  }
}

function ensureContentScriptInTabId(tabId, callback) {
  chrome.tabs.sendMessage(tabId, "ping", {frameId: 0}, () => {
    if (!chrome.runtime.lastError) {
      callback();
      return;
    }

    chrome.tabs.executeScript(tabId, {
      allFrames: true,
      file: "css-selector-parser.js",
    }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        callback(chrome.runtime.lastError.toString());
        return;
      }
      chrome.tabs.executeScript(tabId, {
        allFrames: true,
        file: "reduceNode.js",
      }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          callback(chrome.runtime.lastError.toString());
          return;
        }
        chrome.tabs.executeScript(tabId, {
          allFrames: true,
          file: "content.js",
        }, () => {
          if (error) {
            callback(chrome.runtime.lastError.toString());
            return;
          }
          callback();
        });
      });
    });
  });
}

function CodeMirrorContentScript(getCodeMirrorFn, markup) {
  function pageScript(getCodeMirror, markup) {
    const id = setInterval(timer, 100);
    function timer() {
      const node = getCodeMirror();
      if (node) {
        node.CodeMirror.getDoc().setValue(markup);
        clearInterval(id);
      }
    }
  }
  const script = document.createElement("script");
  script.innerText = `(${pageScript})(${getCodeMirrorFn}, ${JSON.stringify(markup)})`;
  document.head.appendChild(script);
  script.remove();
}

function getCodepenCM() {
  return document.querySelector("#box-html .CodeMirror");
}

function getJSBinCM() {
  return document.querySelector(".code.html .CodeMirror");
}

function getJSFiddleCM() {
  return document.querySelector("#id_code_html").closest(".panel").
                  querySelector(".CodeMirror");
}

function openMarkupUsingSite(markup, title, site, originalURL) {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const isQuirksMode = parsed.compatMode !== "CSS1Compat";

  let url;
  let code;
  switch (site) {
    case "Codepen":
      url = "https://codepen.io/pen/?&editable=true";
      code = `
        (${CodeMirrorContentScript})(${getCodepenCM}, ${JSON.stringify(markup)});
        undefined;
      `;
      break;

    case "JSBin":
      url = "https://jsbin.com/?html,output";
      code = `
        (${CodeMirrorContentScript})(${getJSBinCM}, ${JSON.stringify(markup)});
        undefined;
      `;
      break;

    case "JSFiddle":
      url = "https://jsfiddle.net/";
      code = `
        (${CodeMirrorContentScript})(${getJSFiddleCM}, ${JSON.stringify(markup)});
        undefined;
      `;
      break;

    case "NewTab":
      if (typeof browser !== "undefined") {
        code = `
          window.stop();

          const parsed = new DOMParser().parseFromString(${JSON.stringify(markup)}, "text/html");

          // We're not allowed to replace the document entirely, so we have to
          // make do with just changing its inner HTML (without using innerHTML).
          while (document.documentElement.childNodes.length) {
            document.documentElement.childNodes[0].remove();
          }
          while (parsed.documentElement.childNodes.length) {
            document.documentElement.appendChild(parsed.documentElement.childNodes[0]);
          }

          // Then we can also copy over the attributes meant for the <html> element.
          for (const attr of [].slice.call(parsed.documentElement.attributes)) {
            try {
              document.documentElement.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
            } catch (e) {
            }
          }

          document.title = ${JSON.stringify(title)};
        `;
        chrome.tabs.create({url: originalURL}, ({id}) => {
          chrome.tabs.executeScript(id, {
            code,
            runAt: "document_start",
          });
        });
      } else {
        const doctype = isQuirksMode ? "" : "<!DOCTYPE html>";
        const encodedMarkup = btoa(unescape(encodeURIComponent(`${doctype}${markup}`)));
        const data = `data:text/html;base64,${encodedMarkup}`;
        chrome.tabs.create({url: data});
      }
      return;
  }

  chrome.tabs.create({url}, ({id}) => {
    chrome.tabs.executeScript(id, {
      code,
      runAt: "document_idle",
    });
  });
}

chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg.requestId) {
    incomingResponseFromFrame(msg);
  } else if (msg.reduceRequest) {
    doReduction(msg.reduceRequest, sendResponse);
    return true;
  } else if (msg.ensureContentScriptInTabId) {
    ensureContentScriptInTabId(msg.ensureContentScriptInTabId, sendResponse);
    return true;
  } else if (msg.markup) {
    openMarkupUsingSite(msg.markup, msg.title, msg.site, msg.url);
  }
  return false;
});
