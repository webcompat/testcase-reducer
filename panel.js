/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// TODO: a way to reduce test-cases on Android.

/* global $0 */

document.addEventListener("DOMContentLoaded", startup);

let textAreaModified = false;

function startup() {
  // Reload the previous state of the UI
  document.querySelectorAll("label[id] > input[type=checkbox]").forEach(input => {
    input.checked = localStorage[input.parentNode.id] === "true";
  });

  document.body.addEventListener("click", ({target}) => {
    const {id} = target;
    if (id === "reduce") {
      reduceInspectorSelection();
    } else if (id.startsWith("openIn")) {
      openInNewTab(id.substr(6));
    }
  });

  document.body.addEventListener("change", ({target}) => {
    if (target.nodeName === "TEXTAREA") {
      textAreaModified = true;
      updateUI();
      return;
    }

    // Save any change in UI state in case the user reloads the addon
    const label = target.closest("label");
    if (label && label.id) {
      localStorage[label.id] = target.checked;
    }

    if (label && label.id === "showSameViewportSize") {
      updateIFrameViewportSize();
    }
  });

  for (const label of [
    "alsoIncludeAllMedias",
    "alsoIncludeAncestors",
    "alsoIncludeCSSFonts",
    "alsoIncludeMetas",
    "alsoIncludePageRules",
    "alsoIncludeScripts",
    "openInCodepen",
    "openInJSBin",
    "openInJSFiddle",
    "openInNewTab",
    "reduce",
    "showSameViewportSize",
  ]) {
    document.querySelector(`#${label}`).
      appendChild(document.createTextNode(chrome.i18n.getMessage(label)));
  }

  updateIFrameViewportSize();
}

function confirmScript(text) {
  return confirm(text);
}

function confirmLoseEdits() {
  // Confirm dialogs look weird when issued by the devtools panel, so we
  // issue them from the underlying page for now.
  return new Promise(resolve => {
    const msg = JSON.stringify(chrome.i18n.getMessage("confirmLoseEdits"));
    chrome.devtools.inspectedWindow.eval(`confirm(${msg})`, resolve);
  });
}

const useCS = {
  useContentScriptContext: true,
};

function storeInspectedNodeOnContentScript() {
  window.inspectedNode = $0;
}

function storeInspectedNodeOnPageScript() {
  try {
    $0.setAttribute("__inspectedNode__", "");
  } catch (_) {
    console.error(_);
    return true;
  }
  return false;
}

function runReductionInContentScript(reduceRequest) {
  chrome.runtime.sendMessage({reduceRequest}, ({result, error}) => {
    textAreaModified = false;
    if (error || result.error) {
      updateUI(error || result.error);
    } else {
      const {html, url, viewport} = result;
      document.querySelector("textarea").value = html;
      const title = chrome.i18n.getMessage("reducedTestCase", url);
      updateUI(html, viewport, title);
    }
  });
}

async function reduceInspectorSelection() {
  if (textAreaModified && !await confirmLoseEdits()) {
    return;
  }

  const tabId = chrome.devtools.inspectedWindow.tabId;
  const reduceRequest = {
    tabId,
    alsoIncludeAllMedias: document.querySelector("#alsoIncludeAllMedias > input").checked,
    alsoIncludeAncestors: document.querySelector("#alsoIncludeAncestors > input").checked,
    alsoIncludeCSSFonts: document.querySelector("#alsoIncludeCSSFonts > input").checked,
    alsoIncludeMetas: document.querySelector("#alsoIncludeMetas > input").checked,
    alsoIncludePageRules: document.querySelector("#alsoIncludePageRules > input").checked,
    alsoIncludeScripts: document.querySelector("#alsoIncludeScripts > input").checked,
  };

  // First we ensure our content scripts are started with our reducing code.
  chrome.runtime.sendMessage({ensureContentScriptInTabId: tabId}, error => {
    if (error) {
      console.error(error);
      return;
    }

    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError.toString());
      return;
    }

    // Now we have to pass in the currently-selected node. In Chrome, we have to tell
    // it to run evals in the content script.
    try {
      chrome.devtools.inspectedWindow.eval(
        `(${storeInspectedNodeOnContentScript})()`,
        useCS,
        () => {
          runReductionInContentScript(reduceRequest);
        }
      );
    } catch (error) {
      if (error.message.includes("useContentScriptContext")) {
        // Firefox just uses the content script by default, so no issue there.
        chrome.devtools.inspectedWindow.eval(
          `(${storeInspectedNodeOnPageScript})()`,
          error => {
            if (error) {
              updateUI(chrome.i18n.getMessage("couldNotAccessInspectedNode"));
            } else {
              runReductionInContentScript(reduceRequest);
            }
          }
        );
      } else {
        console.error(error);
      }
    }
  });
}

function showSameViewportSize() {
  return document.querySelector("#showSameViewportSize > input").checked;
}

let currentIFrameViewportSize;

function updateIFrameViewportSize(viewport) {
  if (viewport && "width" in viewport && "height" in viewport) {
    currentIFrameViewportSize = viewport;
  }
  const iframe = document.querySelector("iframe");
  if (currentIFrameViewportSize && showSameViewportSize()) {
    iframe.style.width = `${currentIFrameViewportSize.width}px`;
    iframe.style.height = `${currentIFrameViewportSize.height}px`;
  } else {
    iframe.style.width = "100%";
    iframe.style.height = "100%";
  }
}

let currentReducedDocument;
let currentReducedDocumentTitle;

function updateUI(_markup, viewport, title) {
  const markup = typeof _markup === "string" ? _markup : document.querySelector("textarea").value;

  const iframe = document.querySelector("iframe");
  iframe.srcdoc = markup;
  updateIFrameViewportSize(viewport);

  currentReducedDocument = markup;
  currentReducedDocumentTitle = title;
  document.querySelectorAll("#exports button").forEach(button => {
    button.disabled = false;
  });
}

function openInNewTab(site) {
  if (!currentReducedDocument) {
    return;
  }
  chrome.runtime.sendMessage({
    site,
    markup: currentReducedDocument,
    title: currentReducedDocumentTitle,
  });
}
