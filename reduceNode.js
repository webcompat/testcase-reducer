/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals CSSMozDocumentRule, CssSelectorParser */

const SelectorParser = new CssSelectorParser();
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
  function fullyQualifyURL(url, baseUrl = docHref) {
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
    constructor(text, keyframeName, fontfaceName) {
      this.text = text;
      this.unused = false;
      this.keyframeName = keyframeName;
      this.fontfaceName = fontfaceName;
    }
  }

  function getSubruleMatches(rule, finalDocument) {
    const matches = [];
    for (const subrule of rule.cssRules) {
      const selectorText = filterCSSPseudos(subrule.selectorText);
      if (finalDocument.querySelector(selectorText)) {
        matches.push(fullyQualifyCSSUrls(subrule.cssText));
      }
    }
    return matches;
  }

  const haveMozDocumentRule = !!window.CSSMozDocumentRule;

  async function getCSSTextApplyingTo(finalDocument, alsoIncludeAllMedias,
                                      alsoIncludeCSSFonts, alsoIncludePageRules) {
    const candidateRules = [];
    async function processRule(rule) {
      if (rule instanceof CSSFontFaceRule) {
        if (alsoIncludeCSSFonts) {
          const family = rule.style.getPropertyValue("font-family");
          candidateRules.push(new Rule(fullyQualifyCSSUrls(rule.cssText),
                                       undefined, family));
        }
      } else if (rule instanceof CSSImportRule) {
        const sheet = await getUsableStylesheet(rule.styleSheet);
        if (sheet) {
          replaceCSSUrl.baseUrl = sheet.baseUrl;
          for (const rule of sheet.cssRules) {
            await processRule(rule);
          }
        }
      } else if (rule instanceof CSSKeyframesRule) {
        // We filter out the unused keyframes later, from the reduced rule set.
        candidateRules.push(new Rule(fullyQualifyCSSUrls(rule.cssText),
                                     rule.name));
      } else if (rule instanceof CSSMediaRule) {
        if (alsoIncludeAllMedias ||
            window.matchMedia(rule.conditionText).matches) {
          const matches = getSubruleMatches(rule, finalDocument);
          if (matches.length) {
            const finalRuleText = `@media ${rule.conditionText} {
              ${matches.join("\n")}
            }`;
            candidateRules.push(new Rule(fullyQualifyCSSUrls(finalRuleText)));
          }
        }
      } else if (haveMozDocumentRule && rule instanceof CSSMozDocumentRule) {
        const matches = getSubruleMatches(rule, finalDocument);
        if (matches.length) {
          const finalRuleText = `@-moz-document ${rule.conditionText} {
            ${matches.join("\n")}
          }`;
          candidateRules.push(new Rule(fullyQualifyCSSUrls(finalRuleText)));
        }
      } else if (rule instanceof CSSNamespaceRule) {
        candidateRules.push(new Rule(fullyQualifyCSSUrls(rule.cssText)));
      } else if (rule instanceof CSSPageRule) {
        if (alsoIncludePageRules) {
          candidateRules.push(new Rule(rule.cssText));
        }
      } else if (rule instanceof CSSSupportsRule) {
        const matches = getSubruleMatches(rule, finalDocument);
        if (matches.length) {
          const finalRuleText = `@supports ${rule.conditionText} {
            ${matches.join("\n")}
          }`;
          candidateRules.push(new Rule(fullyQualifyCSSUrls(finalRuleText)));
        }
      } else if (rule instanceof CSSStyleRule) {
        const selectorText = filterCSSPseudos(rule.selectorText);
        if (finalDocument.matches(selectorText) ||
            finalDocument.querySelector(selectorText)) {
          candidateRules.push(new Rule(fullyQualifyCSSUrls(rule.cssText)));
        }
      } else {
        console.error(chrome.i18n.getMessage("errorUnexpectedCSSRule"), rule);
      }
    }
    const sheets = [].slice.call(document.styleSheets || []);
    for (const srcSheet of sheets) {
      const sheet = await getUsableStylesheet(srcSheet);
      if (sheet) {
        replaceCSSUrl.baseUrl = sheet.baseUrl;
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
      if (keyframe !== undefined) {
        const frameNameRE = new RegExp(
          `(\\s|^|;|{)animation(-name)?\\s*?:[,\\s]*?${keyframe}\\s*?(,|;|$)`);
        for (const candidate of candidateRules) {
          if (candidate.keyframeName === undefined &&
              candidate.fontfaceName === undefined &&
              candidate.text.match(frameNameRE)) {
            rule.unused = false;
            break;
          }
        }
      } else if (fontface !== undefined) {
        const fontfaceRE = new RegExp(
          `(\\s|^|;|{)font(-family?)\\s*:[^};]*${fontface}[\\s,;}"']`);
        for (const candidate of candidateRules) {
          if (candidate.keyframeName === undefined &&
              candidate.fontfaceName === undefined &&
              candidate.text.match(fontfaceRE)) {
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

  async function reduce(node, settings = {}) {
    const {alsoIncludeAllMedias, alsoIncludeAncestors, alsoIncludeCSSFonts,
           alsoIncludeMetas, alsoIncludePageRules, alsoIncludeScripts} = settings;

    function alsoConsider(node) {
      const newFinalDocument = node.cloneNode(false);
      newFinalDocument.appendChild(finalDocument);
      finalDocument = newFinalDocument;
      finalDocument.prepend(document.createTextNode("\n"));
      finalDocument.appendChild(document.createTextNode("\n"));
    }

    // If desired, we also consider the focused node's ancestors.
    let finalDocument = node.cloneNode(true);
    while (node.parentElement) {
      node = node.parentElement;
      if ((!alsoIncludeAncestors && node.nodeName === "BODY") ||
           (alsoIncludeAncestors && node.nodeName !== "HTML")) {
        alsoConsider(node);
      }
    }

    // node is now the <html> element, which we always need to consider and add.
    alsoConsider(node);
    const doctypeNode = node.parentNode.doctype;
    const doctype = doctypeNode ? `${doctypeToString(doctypeNode)}\n` : "";
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    // Put all CSS text matching the desired nodes into a <style> tag.
    const css = `\n${await getCSSTextApplyingTo(finalDocument,
                                                alsoIncludeAllMedias,
                                                alsoIncludeCSSFonts,
                                                alsoIncludePageRules)}\n`;

    // Filter out any <style> (and maybe <script>) tags we've dragged along.
    const toFilter = alsoIncludeScripts ? "style" : "script, style";
    finalDocument.querySelectorAll(toFilter).forEach(node => node.remove());

    const head = document.createElement("head");
    finalDocument.prepend(head);
    finalDocument.prepend(document.createTextNode("\n"));

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
    finalDocument.querySelectorAll("[srcset]").forEach(node => {
      node.setAttribute("srcset", fullyQualifySrcSetURLs(node.getAttribute("srcset")));
    });

    for (const attr of ["action", "src", "href"]) {
      finalDocument.querySelectorAll(`[${attr}]`).forEach(node => {
        node.setAttribute(attr, fullyQualifyURL(node.getAttribute(attr)));
      });
    }

    return {
      html: `${doctype}${finalDocument.outerHTML}`,
      url: location.host,
      viewport,
    };
  }

  return reduce(node, settings);
}
