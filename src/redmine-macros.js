// Expands the Redmine text macros we care about into plain format-native
// markup, so they don't render as literal `{{...}}` noise. Pure and shared:
// loaded as a <script> exposing `window.reddieMacros`, required as CommonJS by
// the test suite.
//
// Only `collapse` is handled for now (the one that actually shows up in real
// bodies): Redmine wraps a foldable section as
//   {{collapse(Optional title)
//   ...content...
//   }}
// Neither marked nor textile-js knows the macro, and injecting a <details>
// element doesn't survive textile-js (it escapes unknown block HTML). So we
// drop the wrapper, keep the content, and turn the title into a bold line in
// whichever format the body uses. Not truly collapsible, but faithful and
// noise-free instead of raw macro text.
(function (global) {
  'use strict';

  function expandRedmineMacros(text, format) {
    if (!text) return text || '';
    const bold = (s) => (format === 'textile' ? `*${s}*` : `**${s}**`);
    // {{collapse(Title)  ...  }}  - title optional; content is everything up
    // to the first closing }}. Non-greedy so multiple macros don't merge.
    return text.replace(
      /\{\{collapse(?:\(([^)\n]*)\))?[ \t]*\r?\n?([\s\S]*?)\r?\n?\}\}/g,
      (match, title, content) => {
        const heading = title && title.trim() ? `${bold(title.trim())}\n\n` : '';
        return `${heading}${content}`;
      },
    );
  }

  const api = { expandRedmineMacros };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.reddieMacros = api;
  }
})(typeof self !== 'undefined' ? self : this);
