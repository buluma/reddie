// Redmine's body text_formatting (textile vs common_mark/Markdown) is an
// instance-wide setting that the REST API does not expose to a normal API key
// (/settings.json 401s), and the API only ever returns raw source - never
// rendered HTML. So when the user leaves the format on "Auto", we guess it
// from the bodies themselves by counting format-distinctive tokens.
//
// Pure and shared: loaded as a <script> exposing `window.reddieTextFormat`,
// and required as CommonJS by the test suite.
(function (global) {
  'use strict';

  // Tokens that are strong signals of one format and rare/invalid in the other.
  const TEXTILE = [
    /^h[1-6]\.\s/m, // h1. Heading
    /^bq\.\s/m, // bq. blockquote
    /^p(?:\([^)]*\))?\.\s/m, // p. paragraph (optionally p(class).)
    /^\*\s+\S/m, // * bullet (textile uses single *)
    /"[^"\n]+":https?:\/\//, // "text":http... link
    /(?:^|\s)!\S+\.(?:png|jpe?g|gif|bmp|svg)!/i, // !image.png! inline image
  ];
  const MARKDOWN = [
    /^#{1,6}\s+\S/m, // # ATX heading
    /\*\*[^*\n]+\*\*/, // **bold**
    /!\[[^\]]*\]\([^)\s]+\)/, // ![alt](url) image
    /(?<!!)\[[^\]]+\]\([^)\s]+\)/, // [text](url) link
    /^```/m, // fenced code block
    /^[-+]\s+\S/m, // - / + bullet (markdown; textile doesn't use these)
  ];

  function score(text, patterns) {
    return patterns.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  }

  // Classify a set of body strings as 'textile' or 'markdown'. Ties and
  // no-signal input fall back to 'markdown' (Redmine's modern default).
  function detectTextFormat(texts) {
    let textile = 0;
    let markdown = 0;
    (texts || []).forEach((t) => {
      if (!t) return;
      textile += score(t, TEXTILE);
      markdown += score(t, MARKDOWN);
    });
    return textile > markdown ? 'textile' : 'markdown';
  }

  // The effective format: an explicit 'textile'/'markdown' setting wins;
  // 'auto' (or anything unrecognized) defers to the detected format.
  function resolveFormat(setting, detected) {
    if (setting === 'textile' || setting === 'markdown') return setting;
    return detected === 'textile' ? 'textile' : 'markdown';
  }

  const api = { detectTextFormat, resolveFormat };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.reddieTextFormat = api;
  }
})(typeof self !== 'undefined' ? self : this);
