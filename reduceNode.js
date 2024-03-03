/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals chrome */

/* eslint-disable no-labels */

class Block {
  rules = [];
  hasSubBlocks = false;
  hasDeclarations = false;
  internalURLs = new Set();
  toString() {
    if (!this.prelude) {
      return this.rules.map(r => r.toString()).join("\n");
    }

    if (!this.hasSubBlocks && !this.hasDeclarations) {
      return `${this.prelude.full};`;
    }

    return [
      `${this.prelude.full} {`,
      ...this.rules.map(r => r.toString()),
      "}",
    ].join("\n");
  }
  get blocks() {
    return this.rules.filter(r => r instanceof Block);
  }
  getDeclarations(regex) {
    const decls = [];
    if (this.hasDeclarations) {
      for (const decl of this.rules.filter(r => r instanceof Declaration)) {
        if (decl.key.match(regex)) {
          decls.push(decl);
        }
      }
    }
    return decls;
  }
}

class Declaration {
  #str = "";
  constructor(str) {
    this.#str = str;
  }
  toString() {
    return `${this.#str};`;
  }
  #key;
  #value;
  #ensureSplit() {
    if (!this.#key) {
      const s = this.#str.split(":");
      this.#key = s.shift();
      this.#value = s.join(":");
    }
  }
  get key() {
    this.#ensureSplit();
    return this.#key;
  }
  get value() {
    this.#ensureSplit();
    return this.#value;
  }
}

class Comment {
  #str = "";
  constructor(str) {
    this.#str = str;
  }
  toString() {
    return `/*${this.#str}`;
  }
}

class StylesheetParser {
  #str = "";
  #pos = 0;
  #parsed;
  #baseUrl;

  constructor(baseUrl) {
    this.#baseUrl = baseUrl;
  }

  fullyQualifyUrl(_ptail, block) {
    let ptail = _ptail;
    const parens = ptail[0] == "(";
    if (parens) {
      ptail = ptail.slice(1, -1);
    }
    let quote = '"';
    if (ptail[0] == "'" || ptail[0] == '"') {
      quote = ptail[0];
      ptail = ptail.slice(1, -1);
    }
    try {
      let url = ptail;
      if (ptail.startsWith("#")) {
        block?.internalURLs?.add(url);
      } else {
        url = `${quote}${new URL(ptail, this.#baseUrl).href}${quote}`;
      }
      return parens ? `(${url})` : url;
    } catch (_) {}
    return _ptail;
  }

  #parseCommentTail = /.*?\*\//msy;
  parseCommentTail(block) {
    this.#parseCommentTail.lastIndex = this.#pos;
    let match = this.#str.match(this.#parseCommentTail);
    if (!match) {
      // unclosed comment going to the end of the stylesheet
      console.warn(
        chrome.i18n.getMessage("unclosedComment"),
        this.#str.substr(this.#pos)
      );
      const pos = this.#pos;
      this.#pos = this.#str.length;
      return this.#str.substr(pos);
    }
    this.#pos += match[0].length;
    return match[0];
  }

  #parseStringTail = /([^'"\\]*)(['"\\])/msy;
  parseStringTail(block, endChar) {
    if (endChar != '"' && endChar != "'") {
      throw new Error("Need an end char single or double quote");
    }
    let tail = "";
    while (1) {
      this.#parseStringTail.lastIndex = this.#pos;
      const match = this.#str.match(this.#parseStringTail);
      if (!match) {
        console.warn(
          chrome.i18n.getMessage("unclosedString"),
          this.#str.substr(this.#pos)
        );
        const pos = this.#pos;
        this.#pos = this.#str.length;
        return this.#str.substr(pos);
      }
      this.#pos += match[0].length;
      tail += match[0];
      if (match[2] == endChar) {
        break;
      }
    }
    return `${endChar}${tail}`;
  }

  #parseParensTail = /(.*?)(\)|\/\*|\[|\(\|'|")/msy;
  parseParensTail(block) {
    let tail = "";
    looping: while (1) {
      this.#parseParensTail.lastIndex = this.#pos;
      const match = this.#str.match(this.#parseParensTail);
      if (!match) {
        console.warn(
          chrome.i18n.getMessage("unclosedParentheses"),
          this.#str.substr(this.#pos)
        );
        const pos = this.#pos;
        this.#pos = this.#str.length;
        return this.#str.substr(pos);
      }
      tail += match[1];
      this.#pos += match[0].length;
      switch (match[2]) {
        case ")":
          break looping;
        case "(":
          let ptail = this.parseParensTail(block);
          if (tail.endsWith("url")) {
            ptail = this.fullyQualifyUrl(ptail, block);
          }
          tail += ptail;
          break;
        case "[":
          tail += this.parseBracketTail(block);
          break;
        case "/*":
          const comment = this.parseCommentTail(block);
          if (undefined === comment) {
            return "";
          }
          if (comment.trim()) {
            // don't bother with empty comments
            tail += `/*${comment}`;
          }
          break;
        case "'":
        case '"':
          const str = this.parseStringTail(block, match[2]);
          if (str === undefined) {
            return "";
          }
          tail += str;
      }
    }
    return `(${tail})`;
  }

  #parseBracketTail = /(.*?)(\]|\/\*|\[|\(\|'|")/msy;
  parseBracketTail(block) {
    let tail = "";
    looping: while (1) {
      this.#parseBracketTail.lastIndex = this.#pos;
      const match = this.#str.match(this.#parseBracketTail);
      if (!match) {
        console.warn(
          chrome.i18n.getMessage("unclosedBrackets"),
          this.#str.substr(this.#pos)
        );
        const pos = this.#pos;
        this.#pos = this.#str.length;
        return this.#str.substr(pos);
      }
      tail += match[1];
      this.#pos += match[0].length;
      switch (match[2]) {
        case "]":
          break looping;
        case "(":
          let ptail = this.parseParensTail(block);
          if (tail.endsWith("url")) {
            ptail = this.fullyQualifyUrl(ptail, block);
          }
          tail += ptail;
          break;
        case "[":
          tail += this.parseBracketTail(block);
          break;
        case "/*":
          const comment = this.parseCommentTail(block);
          if (undefined === comment) {
            return "";
          }
          if (comment.trim()) {
            // don't bother with empty comments
            tail += `/*${comment}`;
          }
          break;
        case "'":
        case '"':
          const str = this.parseStringTail(block, match[2]);
          if (str === undefined) {
            return "";
          }
          tail += str;
      }
    }
    return `[${tail}]`;
  }

  #parseWS = /\s*$/msy;
  #parsePseudoTail = /(.*?)(\s+|,|\/\*|\(|\[|{|}|;|"|')/msy;
  parsePseudoTail(block) {
    let tail = "";
    let spaceCnt = 0;
    looping: while (this.#pos < this.#str.length) {
      this.#parseWS.lastIndex = this.#pos;
      let match = this.#str.match(this.#parseWS);
      if (match) {
        this.#pos += match[0];
        if (++spaceCnt > 1) {
          // pseudo is over if we hit spaces after it
          break looping;
        }
        tail += match[1];
      }
      this.#parsePseudoTail.lastIndex = this.#pos;
      match = this.#str.match(this.#parsePseudoTail);
      if (!match) {
        console.warn(
          chrome.i18n.getMessage("unclosedPseudo"),
          this.#str.substr(this.#pos)
        );
        const pos = this.#pos;
        this.#pos = this.#str.length;
        return this.#str.substr(pos);
      }
      this.#pos += match[0].length;
      tail += match[1];
      switch (match[2]) {
        case ":":
          ptail += this.parsePseudo(block);
          break;
        case "(":
          let ptail = this.parseParensTail(block);
          if (tail.endsWith("url")) {
            ptail = this.fullyQualifyUrl(ptail, block);
          }
          tail += ptail;
          break;
        case "[":
          tail += this.parseBracketTail(block);
          break;
        case "{":
        case "}":
        case ";":
          // back up so the block parser sees this
          this.#pos--;
          break looping;
        case "/*":
          const comment = this.parseCommentTail(block);
          if (undefined === comment) {
            break looping;
          }
          if (comment.trim()) {
            // don't bother with empty comments
            tail += `/*${comment}`;
          }
          break;
        case "'":
        case '"':
          const str = this.parseStringTail(block, match[2]);
          if (str === undefined) {
            break looping;
          }
          tail += str;
          break;
        case ",": // comma == done, but back up to let the block parser see it too
          this.#pos--;
          break looping;
        default:
          // spaces == done
          tail += " ";
          break looping;
      }
    }
    return tail;
  }

  #pseudolessCheck = /[>~+|]$/;
  cleanSelector(full, withoutPseudos) {
    full = full.trim();
    // The pseudo-removing code does not ensure that the result is valid. So if the
    // result ends with a combinator, we add * (ie, `td>:last-child` -> `td>` -> `td>*`)
    withoutPseudos = withoutPseudos
      .trim()
      .replace(this.#pseudolessCheck, "$&*");
    if (!withoutPseudos && full) {
      withoutPseudos = "*";
    }
    return { full, withoutPseudos };
  }

  // blocks have the recursive form [@]prelude { list of (block | declaration | comment) }
  // where declaration are simply key:value[;]
  // comments are treated as rules in case we want to keep them.
  // loop:
  // - build a token up to the next ; or { or }, taking care to avoid
  //     escaping in strings and the contents of [] and ().
  //   - also store the prelude, both with and without pseudoselectors
  //   - if we find a ; or } first, we just have a key:value pair.
  //   - if we find a { first, we have a full block (at-rule, declaration list etc)
  #parseBlock = /(\s*.*?)(\<\!--|--\>|,|\/\*|\(|\[|{|}|:|;|"|')/msy;
  #endsWithSpace = /\s+$/;
  #preludeParts = /^(\S*?)(\s+((.*)))?$/ms;
  parseBlock(toplevel = false) {
    const block = new Block();
    let token = "";
    let potentialSelector = "";
    let potentialSelectorNoPseudos = "";
    let prelude = ""; // the full prelude
    let selectors = []; // individual selectors in the prelude
    looping: while (this.#pos < this.#str.length) {
      this.#parseBlock.lastIndex = this.#pos;
      const match = this.#str.match(this.#parseBlock);
      if (!match) {
        this.#parseWS.lastIndex = this.#pos;
        if (this.#str.match(this.#parseWS)) {
          break;
        }
        console.warn(
          chrome.i18n.getMessage("unclosedBlock"),
          this.#str.substr(this.#pos)
        );
        break looping;
      }
      this.#pos += match[0].length;
      token += match[1];
      potentialSelector += match[1];
      potentialSelectorNoPseudos += match[1];
      switch (match[2]) {
        case "<!--":
        case "-->":
          if (!toplevel) {
            token += match[2];
            potentialSelector += match[2];
            potentialSelectorNoPseudos += match[2];
          }
          break;
        case ",":
          token += ",";
          selectors.push(
            this.cleanSelector(potentialSelector, potentialSelectorNoPseudos)
          );
          potentialSelector = "";
          potentialSelectorNoPseudos = "";
          break;
        case ":":
          const ctail = `:${this.parsePseudoTail(block)}`;
          token += ctail;
          potentialSelector += ctail;
          if (potentialSelector.match(this.#endsWithSpace)) {
            potentialSelectorNoPseudos += " ";
          }
          break;
        case "(":
          let ptail = this.parseParensTail(block);
          if (token.endsWith("url")) {
            ptail = this.fullyQualifyUrl(ptail, block);
          }
          token += ptail;
          potentialSelector += ptail;
          potentialSelectorNoPseudos += ptail;
          break;
        case "[":
          let btail = this.parseBracketTail(block);
          token += btail;
          potentialSelector += btail;
          potentialSelectorNoPseudos += btail;
          break;
        case "{": // must be a rule set
          const subblock = this.parseBlock();
          if (!subblock) {
            break looping;
          }
          potentialSelector = potentialSelector.trim();
          if (potentialSelector) {
            selectors.push(
              this.cleanSelector(potentialSelector, potentialSelectorNoPseudos)
            );
          }
          prelude += token;
          prelude = prelude.trim();
          const preludeMatch = prelude.match(this.#preludeParts);
          subblock.prelude = {
            full: prelude,
            type: preludeMatch[1],
            condition: preludeMatch[3],
          };
          subblock.selectors = selectors;
          block.rules.push(subblock);
          block.hasSubBlocks = true;
          token = "";
          potentialSelector = "";
          potentialSelectorNoPseudos = "";
          prelude = "";
          selectors = [];
          break;
        case "}":
        case ";": // must have found just a rule, not a block
          token = token.trim();
          if (token) {
            block.rules.push(new Declaration(token));
            block.hasDeclarations = true;
            token = "";
            potentialSelector = "";
            potentialSelectorNoPseudos = "";
          }
          if (match[2] == "}") {
            break looping;
          } else {
            break;
          }
        case "/*":
          const comment = this.parseCommentTail(block);
          if (undefined === comment) {
            return block;
          }
          if (comment.trim()) {
            // don't bother with empty comments
            block.rules.push(new Comment(comment));
          }
          break;
        case "'":
        case '"':
          const str = this.parseStringTail(block, match[2]);
          if (str === undefined) {
            return block;
          }
          token += str;
          potentialSelector += str;
          potentialSelectorNoPseudos += str;
      }
    }
    return block;
  }

  parse(str, pos = 0, toplevel = true) {
    this.#str = str;
    this.#pos = pos;
    this.#parsed = this.parseBlock(toplevel);
  }

  toString() {
    return `${this.#parsed?.toString()}`;
  }

  get blocks() {
    return this.#parsed?.blocks;
  }
}

function reduceNode(node, settings) {
  async function getUsableStylesheet(srcSheet) {
    if (!srcSheet || srcSheet.disabled) {
      return undefined;
    }
    if (srcSheet._cachedParse) {
      return srcSheet._cachedParse;
    }
    const href = srcSheet.href;
    const css = href
      ? await (await fetch(href)).text()
      : srcSheet.ownerNode.textContent;
    const p = new StylesheetParser(
      srcSheet.baseUrl || srcSheet.href || location.href
    );
    p.parse(css);
    srcSheet._cachedParse = p;
    return p;
  }

  const docHref = location.href;

  const referencedInternalLinks = new Set();

  function fullyQualifyURL(url, baseUrl) {
    baseUrl = baseUrl || docHref;
    if (url.startsWith("#")) {
      referencedInternalLinks.add(url.substr(1));
      return url;
    }
    try {
      return new URL(url, baseUrl).href;
    } catch (e) {}
    return url;
  }

  function replaceSrcSetURL($0, ws, url, size) {
    return `${ws}${fullyQualifyURL(url) || url}${size}`;
  }

  const regexSrcSet = /(\s*)(\S*?)( .*?,?)/g;
  function fullyQualifySrcSetURLs(srcset) {
    return srcset.replace(regexSrcSet, replaceSrcSetURL);
  }

  function isSelectorUsedByDocument(sel, doc, rule) {
    try {
      return doc.matches(sel) || doc.querySelector(sel);
    } catch (e) {
      console.error(chrome.i18n.getMessage("invalidSelector"), sel, rule);
      return true;
    }
  }

  const parseDoc = document.implementation.createHTMLDocument("");
  const parseDocStyle = parseDoc.createElement("style");
  parseDoc.head.appendChild(parseDocStyle);

  function getCSSRule(text) {
    try {
      parseDocStyle.textContent = text;
      return parseDoc.styleSheets[0].cssRules[0];
    } catch (_) {
      console.warn(chrome.i18n.getMessage("unparseableRule"), text);
    }
    return {};
  }

  const keyframesRE = /^@[\w-]*keyframes/i;
  const fontFamilyRE = /^font(-family)?$/i;
  const animationNameRE = /^(-(?!-).*)?animation(-name)?$/i;
  async function getCSSTextApplyingTo(
    wndw,
    sheets,
    finalDocument,
    alsoIncludeAllMedias,
    alsoIncludeCSSFonts,
    alsoIncludePageRules
  ) {
    const keyframeRules = new Set();
    const fontfaceRules = new Set();
    async function processRulePhase1(rule) {
      switch (rule.prelude.type) {
        case "@font-face":
          if (!alsoIncludeCSSFonts) {
            rule.skip = true;
          }
          const fam = rule
            .getDeclarations(fontFamilyRE)
            .pop()
            ?.value.trim();
          if (!fam) {
            rule.skip = true;
            return;
          }
          rule.fontName = (fam[0] == "'" || fam[1] == '"'
            ? fam.slice(1, -1).trim()
            : fam
          ).toLowerCase();
          fontfaceRules.add(rule);
          return;

        case "@page":
          if (!alsoIncludePageRules) {
            rule.skip = true;
            return;
          }
          break;

        case "@media":
          if (
            !alsoIncludeAllMedias ||
            !wndw.matchMedia(rule.prelude.condition).matches
          ) {
            rule.skip = true;
            return;
          }
          break;

        case "@import":
          // TODO: consider media/layer/supports (rewrite the at-rule, basically)
          rule.cssRule = getCSSRule(rule.toString());
          rule.sheet = getUsableStylesheet(rule.cssRule.styleSheet);
          rule.hasSubBlocks = true;
          rule.rules = rule.sheet.blocks;
          break;

        default:
          // TODO: alsoSkipAnimations
          if (rule.prelude.type.match(keyframesRE)) {
            rule.animationName = rule.prelude.condition;
            keyframeRules.add(rule);
            return;
          }
      }

      if (rule.hasDeclarations && rule.selectors.length) {
        rule.usedSelectors = rule.selectors.filter(sel =>
          isSelectorUsedByDocument(sel.withoutPseudos, finalDocument, rule)
        );
      }

      if (rule.hasSubBlocks) {
        for (const subrule of rule.rules.filter(r => r instanceof Block)) {
          processRulePhase1(subrule);
        }
      }
    }

    function processRulePhase2(rule) {
      if (rule.skip) {
        return;
      }

      if ("fontName" in rule || "animationName" in rule) {
        return;
      }

      if (rule.hasDeclarations && rule.selectors.length) {
        if (rule.usedSelectors.length) {
          if (fontfaceRules.size) {
            const fdecl = rule
              .getDeclarations(fontFamilyRE)
              .pop()
              ?.value.toLowerCase();
            if (fdecl) {
              for (const rule of fontfaceRules) {
                if (fdecl.includes(rule.fontName)) {
                  // TODO: using includes is bad
                  rule.used = true;
                  fontfaceRules.delete(rule); // perf optimization
                }
              }
            }
          }

          if (keyframeRules.size) {
            const adecl = rule
              .getDeclarations(animationNameRE)
              .pop()
              ?.value.toLowerCase();
            if (adecl) {
              for (const rule of keyframeRules) {
                if (adecl.includes(rule.animationName)) {
                  // TODO: using includes is bad
                  rule.used = true;
                  keyframeRules.delete(rule); // perf optimization
                }
              }
            }
          }
        }
        return;
      }

      if (rule.hasSubBlocks) {
        for (const subrule of rule.rules.filter(r => r instanceof Block)) {
          processRulePhase2(subrule);
        }
      }
    }

    function processRulePhase3(rule, finalRules) {
      if (rule.skip) {
        return;
      }

      rule.internalURLs?.forEach(url => {
        referencedInternalLinks.add(url);
      });

      if ("fontName" in rule || "animationName" in rule) {
        if (rule.used) {
          finalRules.push(rule.toString());
        }
        return;
      }

      if (rule.hasDeclarations && rule.selectors.length) {
        if (rule.usedSelectors.length) {
          const finalSelectors = rule.usedSelectors.map(s => s.full).join(",");
          const decls = rule.rules
            .filter(r => r instanceof Declaration)
            .join("\n");
          finalRules.push(`${finalSelectors}{\n${decls}\n}`);
        }
      }

      if (rule.hasSubBlocks) {
        const finalSubRules = [];
        for (const subrule of rule.rules.filter(r => r instanceof Block)) {
          processRulePhase3(subrule, finalSubRules);
        }
        if (finalSubRules.length) {
          finalRules.push(
            `${rule.prelude.full}{\n${finalSubRules.join("\n")}\n}`
          );
        }
      }
    }

    // first process the rules to figure out the font-faces and keyframes,
    // and which rules are actually in-use in the final document.

    for (const srcSheet of sheets) {
      const sheet = await getUsableStylesheet(srcSheet);
      if (sheet) {
        for (const rule of sheet.blocks) {
          await processRulePhase1(rule);
        }
      }
    }

    // now go through the rules again, and find which font-names and keyframes
    // are actually in-use.
    if (fontfaceRules.size || keyframeRules.size) {
      for (const srcSheet of sheets) {
        const sheet = await getUsableStylesheet(srcSheet);
        if (sheet) {
          for (const rule of sheet.blocks) {
            await processRulePhase2(rule);
          }
        }
      }
    }

    // finally, gather up all of the in-use rules, including the fontfaces/keyframes.
    const finalRules = [];
    for (const srcSheet of sheets) {
      const sheet = await getUsableStylesheet(srcSheet);
      if (sheet) {
        for (const rule of sheet.blocks) {
          await processRulePhase3(rule, finalRules);
        }
      }
    }

    return finalRules.join("\n");
  }

  function doctypeToString(node) {
    const { name, publicId, systemId } = node;
    return (
      "<!DOCTYPE " +
      name +
      (publicId ? ' PUBLIC "' + publicId + '"' : "") +
      (!publicId && systemId ? " SYSTEM" : "") +
      (systemId ? ' "' + systemId + '"' : "") +
      ">"
    );
  }

  // eslint-disable-next-line complexity
  async function reduce(node, settings = {}) {
    try {
      const doc = node.ownerDocument;
      const wndw = doc.defaultView;

      const {
        alsoIncludeAllMedias,
        alsoIncludeAncestors,
        alsoIncludeCSSFonts,
        alsoIncludeMetas,
        alsoIncludePageRules,
        alsoIncludeScripts,
      } = settings;

      function alsoConsider(node) {
        const newFinalDocument = node.cloneNode(false);
        newFinalDocument.appendChild(finalDocument);
        finalDocument = newFinalDocument;
        try {
          finalDocument.prepend(doc.createTextNode("\n"));
          finalDocument.appendChild(doc.createTextNode("\n"));
        } catch (_) {}
      }

      function findOutermostUseElement(node) {
        let outermost;
        while (node) {
          if (node instanceof wndw.SVGUseElement) {
            outermost = node;
          }
          node = node.parentNode;
          if (node instanceof wndw.ShadowRoot) {
            node = node.host;
          }
        }
        return outermost;
      }

      node = findOutermostUseElement(node) || node;

      // If desired, we also consider the focused node's ancestors.
      let finalDocument = node.cloneNode(true);
      while (!(node.parentNode instanceof wndw.Document)) {
        node = node.parentNode;
        if (node && node instanceof wndw.ShadowRoot) {
          node = node.host;
        }
        if (
          alsoIncludeAncestors ||
          node instanceof wndw.HTMLBodyElement ||
          node instanceof wndw.SVGSVGElement
        ) {
          alsoConsider(node);
        }
      }

      // node is now the <html> or equivalent element, which should always be considered.
      if (finalDocument.nodeName !== node.nodeName) {
        alsoConsider(node);
      }

      const sheets = [].slice.call(doc.styleSheets);
      const doctypeNode = doc.doctype;
      const doctype = doctypeNode ? `${doctypeToString(doctypeNode)}\n` : "";
      const viewport = {
        width: wndw.innerWidth,
        height: wndw.innerHeight,
      };

      const mockUseInstances = [];
      const usedDefs = [];
      const memoizedUseReferences = new Map();

      function isValidSVGUseReference(elem) {
        if (memoizedUseReferences.has(elem)) {
          return memoizedUseReferences.get(elem);
        }

        // As per https://www.w3.org/TR/SVG2/struct.html#UseElement,
        // "If the referenced element that results from resolving the URL is neither
        // an SVG element nor an HTML-namespaced element that may be included as a
        // child of an SVG container element, then the reference is invalid"
        if (
          !(
            elem instanceof wndw.SVGElement ||
            elem instanceof wndw.HTMLVideoElement ||
            elem instanceof wndw.HTMLAudioElement ||
            elem instanceof wndw.HTMLIFrameElement ||
            elem instanceof wndw.HTMLCanvasElement
          )
        ) {
          memoizedUseReferences.set(elem, false);
          return false;
        }

        // "If the referenced element is a (shadow-including) ancestor of the ‘use’
        // element, then this is an invalid circular reference"
        while (elem) {
          if (elem instanceof wndw.ShadowRoot) {
            memoizedUseReferences.set(elem, false);
            return false;
          }
          elem = elem.parentNode;
        }
        memoizedUseReferences.set(elem, true);
        return true;
      }

      function mockInstantiateUseElement(use, addToList = true) {
        if (!use.href) {
          return;
        }
        const base = doc.getElementById(use.href.baseVal.substr(1));
        const anim = doc.getElementById(use.href.animVal.substr(1));
        if (base && isValidSVGUseReference(base)) {
          usedDefs.push(base);
          const inst = base.cloneNode(true);
          if (addToList) {
            mockUseInstances.push(inst);
          }
          use.appendChild(inst);
        }
        if (anim && anim !== base && isValidSVGUseReference(anim)) {
          usedDefs.push(anim);
          const inst = anim.cloneNode(true);
          if (addToList) {
            mockUseInstances.push(inst);
          }
          use.appendChild(inst);
        }
        for (const subuse of use.querySelectorAll("use")) {
          mockInstantiateUseElement(subuse, false);
        }
      }

      // Mock-instantiate use elements, so our CSS matcher can match them.
      // Also note which <defs> they use.
      for (const use of finalDocument.querySelectorAll("use")) {
        mockInstantiateUseElement(use);
      }

      // Put all CSS text matching the desired nodes into a <style> tag.
      const css = `\n${await getCSSTextApplyingTo(
        wndw,
        sheets,
        finalDocument,
        alsoIncludeAllMedias,
        alsoIncludeCSSFonts,
        alsoIncludePageRules
      )}\n`;

      // We no longer need the fake use instances, so remove them so they
      // do not end up in our final "reduced" markup
      for (const inst of mockUseInstances) {
        inst.remove();
      }

      // Filter out any <head>, <style> (and maybe <script>) tags we've dragged along.
      const toFilter = alsoIncludeScripts
        ? "head, style, link[rel=stylesheet]"
        : "head, script, style, link[rel=stylesheet]";
      for (const elem of finalDocument.querySelectorAll(toFilter)) {
        elem.remove();
      }

      const head = doc.createElement("head");
      finalDocument.prepend(head);
      finalDocument.prepend(doc.createTextNode("\n"));

      // Note any <defs> being used via SVG url() properties.
      for (const attr of [
        "fill",
        "clip-path",
        "cursor",
        "filter",
        "marker-end",
        "marker-mid",
        "marker-start",
      ]) {
        for (const elem of doc.querySelectorAll(`[${attr}]`)) {
          const url = (elem.getAttribute(attr).match(/url\((.*)\)/) || [])[1];
          if (url && url.startsWith("#") && elem instanceof wndw.SVGElement) {
            const ref = doc.getElementById(url.substr(1));
            if (ref) {
              usedDefs.push(ref);
            }
          }
        }
      }
      // Note any <defs> being used via CSS clip-path URLs and the like.
      for (const href of referencedInternalLinks) {
        if (finalDocument.querySelector(`[id="${href.substr(1)}"]`)) {
          continue;
        }
        const src = doc.getElementById(href);
        if (src && src instanceof wndw.SVGElement) {
          usedDefs.push(src);
        }
      }

      // Copy over any <defs> that we need
      if (usedDefs.length) {
        const s = doc.createElement("svg");
        s.width = "0";
        s.height = "0";
        head.appendChild(s);
        const d = doc.createElement("defs");
        s.appendChild(d);
        for (const def of usedDefs) {
          d.appendChild(def.cloneNode(true));
        }
      }

      // Copy over any <meta> viewport, charset, or encoding directives.
      if (alsoIncludeMetas) {
        const metas = [].slice.call(doc.querySelectorAll("head > meta"));
        for (const meta of metas) {
          if (
            meta.getAttribute("charset") ||
            meta.getAttribute("http-equiv") === "Content-Type" ||
            meta.getAttribute("name") === "viewport"
          ) {
            head.appendChild(meta.cloneNode(false));
            head.appendChild(doc.createTextNode("\n"));
          }
        }
      }

      // Add a UTF-8 charset if no encoding was specified.
      if (!head.querySelector("meta[charset], meta[http-equiv=Content-Type")) {
        const meta = doc.createElement("meta");
        meta.setAttribute("charset", "UTF-8");
        head.appendChild(meta);
        head.appendChild(doc.createTextNode("\n"));
      }

      // Copy over any <script> tags, if desired.
      if (alsoIncludeScripts) {
        const scripts = [].slice.call(doc.querySelectorAll("script"));
        for (const script of scripts) {
          head.appendChild(script.cloneNode(true));
          head.appendChild(doc.createTextNode("\n"));
        }
      }

      // Add a <style> with the CSS text.
      const style = doc.createElement("style");
      style.appendChild(doc.createTextNode(css));
      head.appendChild(style);
      head.prepend(doc.createTextNode("\n"));
      head.appendChild(doc.createTextNode("\n"));

      // Fully-qualify all the URLs that we can.
      for (const node of finalDocument.querySelectorAll("[srcset]")) {
        node.setAttribute(
          "srcset",
          fullyQualifySrcSetURLs(node.getAttribute("srcset"))
        );
      }

      for (const attr of ["action", "src", "href"]) {
        for (const node of finalDocument.querySelectorAll(
          `:not(use)[${attr}]`
        )) {
          node.setAttribute(attr, fullyQualifyURL(node.getAttribute(attr)));
        }
      }

      return {
        html: `${doctype}${finalDocument.outerHTML}`,
        url: location.href,
        viewport,
      };
    } catch (error) {
      console.trace(error);
      return { error };
    }
  }

  return reduce(node, settings);
}
