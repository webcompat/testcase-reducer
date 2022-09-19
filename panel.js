/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// TODO: a way to reduce test-cases on Android.

/* global $0, chrome, html_beautify, reduceNode */

document.addEventListener("DOMContentLoaded", startup);

const BEAUTIFY_CONFIG = {
  indent_size: 2,
  space_in_empty_paren: true,
};

let textAreaModified = false;

function startup() {
  // Reload the previous state of the UI
  document
    .querySelectorAll("label[id] > input[type=checkbox]")
    .forEach(input => {
      input.checked = localStorage[input.parentNode.id] === "true";
    });

  document.body.addEventListener("click", ({ target }) => {
    const { id } = target;
    if (id === "reduce") {
      reduceInspectorSelection();
    } else if (id === "refine") {
      refine();
    } else if (id === "beautify") {
      beautify();
    } else if (id.startsWith("openIn")) {
      openInNewTab(id.substr(6));
    }
  });

  document.body.addEventListener("change", ({ target }) => {
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
    "beautify",
    "reduce",
    "refine",
    "showSameViewportSize",
  ]) {
    document
      .querySelector(`#${label}`)
      .appendChild(document.createTextNode(chrome.i18n.getMessage(label)));
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

function markInspectedNode(requestId) {
  $0.setAttribute(`r${requestId}`, "");
}

function unmarkInspectedNode(requestId) {
  $0.removeAttribute(`r${requestId}`);
}

function runReductionInContentScript(reduceRequest) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ reduceRequest }, result => {
      handleReductionResult(result);
      resolve();
    });
  });
}

function handleReductionResult({ result, error }) {
  textAreaModified = false;
  if (error || result.error) {
    updateUI(error || result.error);
  } else {
    const { html, url, viewport } = result;
    document.querySelector("textarea").value = html;
    const { host } = new URL(url);
    const title = chrome.i18n.getMessage("reducedTestCase", host);
    updateUI(html, viewport, title, url);
    for (const button of document.querySelectorAll("#beautify, #refine")) {
      button.removeAttribute("disabled");
    }
  }
}

function refine() {
  const ta = document.querySelector("textarea");
  const iframe = document.createElement("iframe");
  iframe.style.width = `${currentIFrameViewportSize.width}px`;
  iframe.style.height = `${currentIFrameViewportSize.height}px`;
  iframe.style.position = "absolute";
  iframe.style.overflow = "auto";
  iframe.srcdoc = ta.value;
  const cleanup = () => {
    iframe.remove();
  };
  iframe.onload = () => {
    if (!iframe.contentDocument) {
      updateUI(chrome.i18n.getMessage("couldNotRefine"));
      cleanup();
      return;
    }
    ta.value = reduceNode(
      iframe.contentDocument.documentElement,
      getCurrentlySelectedOptions()
    )
      .then(
        result => handleReductionResult({ result }),
        error => handleReductionResult({ error })
      )
      .then(cleanup);
  };
  document.body.appendChild(iframe);
}

function beautify() {
  const ta = document.querySelector("textarea");
  ta.value = html_beautify(ta.value, BEAUTIFY_CONFIG);
}

function getCurrentlySelectedOptions() {
  return {
    alsoIncludeAllMedias: document.querySelector(
      "#alsoIncludeAllMedias > input"
    ).checked,
    alsoIncludeAncestors: document.querySelector(
      "#alsoIncludeAncestors > input"
    ).checked,
    alsoIncludeCSSFonts: document.querySelector("#alsoIncludeCSSFonts > input")
      .checked,
    alsoIncludeMetas: document.querySelector("#alsoIncludeMetas > input")
      .checked,
    alsoIncludePageRules: document.querySelector(
      "#alsoIncludePageRules > input"
    ).checked,
    alsoIncludeScripts: document.querySelector("#alsoIncludeScripts > input")
      .checked,
  };
}

async function reduceInspectorSelection() {
  if (textAreaModified && !(await confirmLoseEdits())) {
    return;
  }

  const tabId = chrome.devtools.inspectedWindow.tabId;
  const reduceRequest = Object.assign(getCurrentlySelectedOptions(), {
    id: Date.now(),
    tabId,
  });

  // First we ensure our content scripts are started with our reducing code.
  chrome.runtime.sendMessage({ ensureContentScriptInTabId: tabId }, error => {
    if (error) {
      console.error(error);
      return;
    }

    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError.toString());
      return;
    }

    chrome.devtools.inspectedWindow.eval(
      `(${markInspectedNode})(${reduceRequest.id})`,
      async error => {
        if (error) {
          updateUI(chrome.i18n.getMessage("couldNotAccessInspectedNode"));
        } else {
          await runReductionInContentScript(reduceRequest);
        }
        chrome.devtools.inspectedWindow.eval(
          `(${unmarkInspectedNode})(${reduceRequest.id})`
        );
      }
    );
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
let currentReducedDocumentOriginalURL;
let currentReducedDocumentTitle;

function updateUI(_markup, viewport, title, url) {
  const markup =
    typeof _markup === "string"
      ? _markup
      : document.querySelector("textarea").value;

  const iframe = document.querySelector("iframe");
  iframe.srcdoc = markup;
  updateIFrameViewportSize(viewport);

  currentReducedDocument = markup;
  currentReducedDocumentOriginalURL = url;
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
    url: currentReducedDocumentOriginalURL,
  });
}

let port = chrome.runtime.connect();
port.onMessage.addListener(result => {
  handleReductionResult(result);
});
