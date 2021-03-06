/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals CSSMozDocumentRule, CssSelectorParser */

var SelectorParser = new CssSelectorParser(); // eslint-disable-line no-var
SelectorParser.registerSelectorPseudos("lang", "dir", "host", "host-context", "is", "where", "has", "contains", "not");
SelectorParser.registerNumericPseudos("nth-child", "nth-last-child", "nth-col", "nth-last-col", "nth-of-type", "nth-last-of-type");
SelectorParser.registerNestingOperators(">", "+", "~");
SelectorParser.registerAttrEqualityMods("^", "$", "*", "~", "|");
SelectorParser.enableSubstitutes();

function reduceNode(node, settings) {
  let parsingDocument;
  async function getUsableStylesheet(srcSheet) {
    if (!srcSheet || srcSheet.disabled) {
      return undefined;
    }
    try {
      srcSheet.cssRules; // can throw SecurityError
      return srcSheet;
    } catch (e) {
      parsingDocument = parsingDocument ||
                        document.implementation.createHTMLDocument("");
      const href = srcSheet.href;
      const css = href ? (await (await fetch(href)).text())
                       : srcSheet.ownerNode.textContent;
      const style = parsingDocument.createElement("style");
      style.textContent = css;
      parsingDocument.head.appendChild(style);
      const sheet = style.sheet;
      sheet.baseUrl = href;
      style.remove();
      return sheet;
    }
  }

  const docHref = location.href;

  const referencedInternalLinks = new Set();

  function fullyQualifyURL(url, baseUrl) {
    baseUrl = baseUrl || docHref;
    if (url.startsWith("#")) {
      referencedInternalLinks.add(url);
      return url;
    }
    try {
      return new URL(url, baseUrl).href;
    } catch (e) {
    }
    return url;
  }

  function replaceSrcSetURL($0, ws, url, size) {
    return `${ws}${fullyQualifyURL(url) || url}${size}`;
  }

  const regexSrcSet = /(\s*)(\S*?)( .*?,?)/g;
  function fullyQualifySrcSetURLs(srcset) {
    return srcset.replace(regexSrcSet, replaceSrcSetURL);
  }

  function replaceCSSUrl($0, pre, url, post) {
    return `${pre}${fullyQualifyURL(url, replaceCSSUrl.baseUrl) || url}${post}`;
  }

  const regexCSSURLNoQuotes = /(url\(^["'](.*?)\))/ig;
  const regexCSSURLSingleQuotes = /(url\(')(.*?)('\))/ig;
  const regexCSSURLDoubleQuotes = /(url\(")(.*?)("\))/ig;
  function fullyQualifyCSSUrls(cssText) {
    return cssText.replace(regexCSSURLSingleQuotes, replaceCSSUrl).
                   replace(regexCSSURLDoubleQuotes, replaceCSSUrl).
                   replace(regexCSSURLNoQuotes, replaceCSSUrl);
  }

  function stripPseudos(entity) {
    if (entity.pseudos) {
      delete entity.pseudos;
      if (!entity.classNames && !entity.tagName) {
        entity.tagName = "*";
      }
    }
    if (entity.selectors) {
      for (const subEntity of entity.selectors) {
        stripPseudos(subEntity);
      }
    }
    if (entity.rule) {
      stripPseudos(entity.rule);
    }
  }

  function filterCSSPseudos(cssSelector) {
    if (!cssSelector) {
      return undefined;
    }
    const parsed = SelectorParser.parse(cssSelector);
    stripPseudos(parsed);
    return SelectorParser.render(parsed);
  }

  class Rule {
    constructor(rule, text, keyframeName, fontfaceName) {
      const style = rule && rule.style || {};
      this.style = new Proxy({}, {
        get: (_, prop) => style[prop] || "",
      });
      this.text = text;
      this.unused = false;
      this.keyframeName = keyframeName;
      this.fontfaceName = fontfaceName;
    }
  }

  function getPotentiallyUsedRuleParts(rule, finalDocument) {
    const filteredSelectorText = filterCSSPseudos(rule.selectorText);
    if (!finalDocument.matches(filteredSelectorText) &&
        !finalDocument.querySelector(filteredSelectorText)) {
      return undefined;
    }

    const originalSelectors = rule.selectorText;
    const restOfRule = rule.cssText.replace(originalSelectors, "");
    const parsed = SelectorParser.parse(originalSelectors);
    const matchingSelectors = [];
    const candidateSelectors = parsed.selectors || [parsed];
    for (const parsedSelector of candidateSelectors) {
      const selector = SelectorParser.render(parsedSelector);
      const filteredSelector = filterCSSPseudos(selector);
      if (finalDocument.matches(filteredSelector) ||
          finalDocument.querySelector(filteredSelector)) {
        matchingSelectors.push(selector);
      }
    }
    if (matchingSelectors.length) {
      return `${matchingSelectors.join(", ")}${restOfRule}`;
    }
    return undefined;
  }

  function getSubruleMatches(rule, finalDocument) {
    const matches = [];
    for (const subrule of rule.cssRules) {
      const finalCSSText = getPotentiallyUsedRuleParts(subrule, finalDocument);
      if (finalCSSText) {
        matches.push(fullyQualifyCSSUrls(finalCSSText));
      }
    }
    return matches;
  }

  const haveMozDocumentRule = !!window.CSSMozDocumentRule;

  async function getCSSTextApplyingTo(wndw, sheets, finalDocument, alsoIncludeAllMedias,
                                      alsoIncludeCSSFonts, alsoIncludePageRules) {
    const candidateRules = [];
    async function processRule(rule) {
      if (rule instanceof CSSFontFaceRule) {
        if (alsoIncludeCSSFonts) {
          const family = rule.style.getPropertyValue("font-family");
          candidateRules.push(new Rule(rule, fullyQualifyCSSUrls(rule.cssText),
                                       undefined, family));
        }
      } else if (rule instanceof CSSImportRule) {
        const sheet = await getUsableStylesheet(rule.styleSheet);
        if (sheet) {
          replaceCSSUrl.baseUrl = sheet.href;
          for (const rule of sheet.cssRules) {
            await processRule(rule);
          }
        }
      } else if (rule instanceof CSSKeyframesRule) {
        // We filter out the unused keyframes later, from the reduced rule set.
        candidateRules.push(new Rule(rule, fullyQualifyCSSUrls(rule.cssText),
                                     rule.name));
      } else if (rule instanceof CSSMediaRule) {
        if (alsoIncludeAllMedias ||
            wndw.matchMedia(rule.conditionText).matches) {
          const matches = getSubruleMatches(rule, finalDocument);
          if (matches.length) {
            const finalRuleText = `@media ${rule.conditionText} {
              ${matches.join("\n")}
            }`;
            candidateRules.push(new Rule(rule, fullyQualifyCSSUrls(finalRuleText)));
          }
        }
      } else if (haveMozDocumentRule && rule instanceof CSSMozDocumentRule) {
        const matches = getSubruleMatches(rule, finalDocument);
        if (matches.length) {
          const finalRuleText = `@-moz-document ${rule.conditionText} {
            ${matches.join("\n")}
          }`;
          candidateRules.push(new Rule(rule, fullyQualifyCSSUrls(finalRuleText)));
        }
      } else if (rule instanceof CSSNamespaceRule) {
        candidateRules.push(new Rule(rule, fullyQualifyCSSUrls(rule.cssText)));
      } else if (rule instanceof CSSPageRule) {
        if (alsoIncludePageRules) {
          candidateRules.push(new Rule(rule, rule.cssText));
        }
      } else if (rule instanceof CSSSupportsRule) {
        const matches = getSubruleMatches(rule, finalDocument);
        if (matches.length) {
          const finalRuleText = `@supports ${rule.conditionText} {
            ${matches.join("\n")}
          }`;
          candidateRules.push(new Rule(rule, fullyQualifyCSSUrls(finalRuleText)));
        }
      } else if (rule instanceof CSSStyleRule) {
        const finalCSSText = getPotentiallyUsedRuleParts(rule, finalDocument);
        if (finalCSSText) {
          candidateRules.push(new Rule(rule, fullyQualifyCSSUrls(finalCSSText)));
        }
      } else {
        console.error(chrome.i18n.getMessage("errorUnexpectedCSSRule"), rule);
      }
    }
    for (const srcSheet of sheets) {
      const sheet = await getUsableStylesheet(srcSheet);
      if (sheet) {
        replaceCSSUrl.baseUrl = sheet.baseUrl || sheet.href;
        for (const rule of sheet.cssRules) {
          await processRule(rule);
        }
      }
    }
    // Filter out any keyframes/fontfaces that aren't actually used by our matches.
    for (const rule of candidateRules) {
      const keyframe = rule.keyframeName;
      const fontface = rule.fontfaceName;
      if (keyframe === undefined && fontface === undefined) {
        continue;
      }
      rule.unused = true;
      if (keyframe) {
        const keyframeRE = new RegExp(
          `(^|,)\\s*${keyframe}\\s*(,|$)`, "i");
        for (const candidate of candidateRules) {
          if (candidate.style.animationName.match(keyframeRE)) {
            rule.unused = false;
            break;
          }
        }
      } else if (fontface) {
        const fontfaceRE = new RegExp(
          `("${fontface}"|'${fontface}'|(^|,)\\s*${fontface}\\s*(,|$))`, "i");
        for (const candidate of candidateRules) {
          if (candidate.style.fontFamily.match(fontfaceRE)) {
            rule.unused = false;
            break;
          }
        }
      }
    }

    return candidateRules.filter(r => !r.unused).map(r => r.text).join("\n");
  }

  function doctypeToString(node) {
    const {name, publicId, systemId} = node;
    return "<!DOCTYPE " + name +
             (publicId ? " PUBLIC \"" + publicId + "\"" : "") +
             (!publicId && systemId ? " SYSTEM" : "") +
             (systemId ? " \"" + systemId + '"' : "") + ">";
  }

  async function reduce(node, settings = {}) { // eslint-disable-line complexity
    const {alsoIncludeAllMedias, alsoIncludeAncestors, alsoIncludeCSSFonts,
           alsoIncludeMetas, alsoIncludePageRules, alsoIncludeScripts} = settings;

    function alsoConsider(node) {
      const newFinalDocument = node.cloneNode(false);
      newFinalDocument.appendChild(finalDocument);
      finalDocument = newFinalDocument;
      try {
        finalDocument.prepend(document.createTextNode("\n"));
        finalDocument.appendChild(document.createTextNode("\n"));
      } catch (_) {
      }
    }

    function findOutermostUseElement(node) {
      let outermost;
      while (node) {
        if (node instanceof SVGUseElement) {
          outermost = node;
        }
        node = node.parentNode;
        if (node instanceof ShadowRoot) {
          node = node.host;
        }
      }
      return outermost;
    }

    node = findOutermostUseElement(node) || node;

    // If desired, we also consider the focused node's ancestors.
    const topLevelHTMLWasSelected = node.parentNode instanceof Document;
    let finalDocument = node.cloneNode(true);
    while (!(node.parentNode instanceof Document)) {
      node = node.parentNode;
      if (node && node instanceof ShadowRoot) {
        node = node.host;
      }
      if (alsoIncludeAncestors || (node instanceof HTMLBodyElement ||
                                   node instanceof SVGSVGElement)) {
        alsoConsider(node);
      }
    }

    // node is now the <html> element, which we always need to consider and add.
    const wndw = node.parentNode.defaultView;
    const sheets = [].slice.call(node.parentNode.styleSheets || []);
    if (!topLevelHTMLWasSelected) {
      alsoConsider(node);
    }
    const doctypeNode = document.doctype;
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
      if (!(elem instanceof SVGElement ||
            elem instanceof HTMLVideoElement ||
            elem instanceof HTMLAudioElement ||
            elem instanceof HTMLIFrameElement ||
            elem instanceof HTMLCanvasElement)) {
        memoizedUseReferences.set(elem, false);
        return false;
      }

      // "If the referenced element is a (shadow-including) ancestor of the ‘use’
      // element, then this is an invalid circular reference"
      while (elem) {
        if (elem instanceof ShadowRoot) {
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
      const base = document.querySelector(use.href.baseVal);
      const anim = document.querySelector(use.href.animVal);
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
    const css = `\n${await getCSSTextApplyingTo(wndw, sheets, finalDocument,
                                                alsoIncludeAllMedias,
                                                alsoIncludeCSSFonts,
                                                alsoIncludePageRules)}\n`;

    // We no longer need the fake use instances, so remove them so they
    // do not end up in our final "reduced" markup
    for (const inst of mockUseInstances) {
      inst.remove();
    }

    // Filter out any <head>, <style> (and maybe <script>) tags we've dragged along.
    const toFilter = alsoIncludeScripts ? "head, style, link[rel=stylesheet]" :
                                          "head, script, style, link[rel=stylesheet]";
    for (const elem of finalDocument.querySelectorAll(toFilter)) {
      elem.remove();
    }

    const head = document.createElement("head");
    finalDocument.prepend(head);
    finalDocument.prepend(document.createTextNode("\n"));

    // Note any <defs> being used via SVG url() properties.
    for (const attr of ["fill", "clip-path", "cursor", "filter", "marker-end",
                        "marker-mid", "marker-start"]) {
      for (const elem of document.querySelectorAll(`[${attr}]`)) {
        const url = (elem.getAttribute(attr).match(/url\((.*)\)/) || [])[1];
        if (url && url.startsWith("#") && elem instanceof SVGElement) {
          const ref = document.querySelector(url);
          if (ref) {
            usedDefs.push(ref);
          }
        }
      }
    }
    // Note any <defs> being used via CSS clip-path URLs and the like.
    for (const href of referencedInternalLinks) {
      if (finalDocument.querySelector(href)) {
        continue;
      }
      const src = document.querySelector(href);
      if (src && src instanceof SVGElement) {
        usedDefs.push(src);
      }
    }

    // Copy over any <defs> that we need
    if (usedDefs.length) {
      const s = document.createElement("svg");
      s.width = "0";
      s.height = "0";
      head.appendChild(s);
      const d = document.createElement("defs");
      s.appendChild(d);
      for (const def of usedDefs) {
        d.appendChild(def.cloneNode(true));
      }
    }

    // Copy over any <meta> viewport, charset, or encoding directives.
    if (alsoIncludeMetas) {
      const metas = [].slice.call(document.querySelectorAll("head > meta"));
      for (const meta of metas) {
        if (meta.getAttribute("charset") ||
            meta.getAttribute("http-equiv") === "Content-Type" ||
            meta.getAttribute("name") === "viewport") {
          head.appendChild(meta.cloneNode(false));
          head.appendChild(document.createTextNode("\n"));
        }
      }
    }

    // Add a UTF-8 charset if no encoding was specified.
    if (!head.querySelector("meta[charset], meta[http-equiv=Content-Type")) {
      const meta = document.createElement("meta");
      meta.setAttribute("charset", "UTF-8");
      head.appendChild(meta);
      head.appendChild(document.createTextNode("\n"));
    }

    // Copy over any <script> tags, if desired.
    if (alsoIncludeScripts) {
      const scripts = [].slice.call(document.querySelectorAll("script"));
      for (const script of scripts) {
        head.appendChild(script.cloneNode(true));
        head.appendChild(document.createTextNode("\n"));
      }
    }

    // Add a <style> with the CSS text.
    const style = document.createElement("style");
    style.appendChild(document.createTextNode(css));
    head.appendChild(style);
    head.prepend(document.createTextNode("\n"));
    head.appendChild(document.createTextNode("\n"));

    // Fully-qualify all the URLs that we can.
    for (const node of finalDocument.querySelectorAll("[srcset]")) {
      node.setAttribute("srcset", fullyQualifySrcSetURLs(node.getAttribute("srcset")));
    }

    for (const attr of ["action", "src", "href"]) {
      for (const node of finalDocument.querySelectorAll(`:not(use)[${attr}]`)) {
        node.setAttribute(attr, fullyQualifyURL(node.getAttribute(attr)));
      }
    }

    return {
      html: `${doctype}${finalDocument.outerHTML}`,
      url: location.href,
      viewport,
    };
  }

  try {
    return reduce(node, settings);
  } catch (error) {
    console.error(error);
    return {error};
  }
}
