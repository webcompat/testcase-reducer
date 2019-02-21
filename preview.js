/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

window.addEventListener("message", ({data}) => {
  const {markup, title} = data;

  const parsed = new DOMParser().parseFromString(markup, "text/html");

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

  document.title = title;
}, {once: true});
