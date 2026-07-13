// Pure rewrite of Redmine inline-image references into resolvable Markdown
// images, shared by the renderer (loaded as a plain <script> exposing
// `window.reddieInlineImages`) and the test suite (required as CommonJS).
//
// Redmine embeds an inline image as an attachment reference in the body and
// rewrites it to the real attachment URL server-side at display time. Reddie
// renders the raw body client-side with `marked`, so those references have to
// be resolved first or the image is simply missing. Two syntaxes exist and
// both must be handled - a real instance (redmine.nasctech.com) uses the
// Textile form, which `marked` otherwise leaves as literal text:
//   - Markdown: ![alt](filename.png)
//   - Textile:  !filename.png!
// Each has only its *target* rewritten to the attachment's absolute
// content_url, keeping its original delimiter - Markdown stays Markdown,
// Textile stays Textile - so whichever renderer (marked / textile-js) parses
// the body handles its own native image syntax. The existing
// hydrateAuthenticatedImages/fetch-image same-origin auth path then loads the
// content_url with the API key.
//
// Only references whose target matches a real IMAGE attachment are touched,
// so unrelated text like `!important!` (or a `![x](y)` pointing elsewhere) is
// left exactly as-is.
(function (global) {
  'use strict';

  function resolveInlineAttachmentImages(text, attachments) {
    if (!text) return '';
    if (!attachments || !attachments.length) return text;

    // filename -> content_url, image attachments only.
    const byName = new Map();
    attachments.forEach((a) => {
      if (a && a.filename && a.content_url && a.content_type && a.content_type.indexOf('image/') === 0) {
        byName.set(a.filename, a.content_url);
      }
    });
    if (!byName.size) return text;

    // Markdown ![alt](target) first, so its inner text can't be mistaken for a
    // Textile !...! pair below. Preserve the alt text.
    let out = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, target) => {
      const url = byName.get(target);
      return url ? `![${alt}](${url})` : match;
    });

    // Textile !target! - target can't contain whitespace, `!`, or `|`. Only
    // rewritten when it names a real image attachment, so ordinary `!word!`
    // emphasis-style text is untouched. The `!...!` delimiter is preserved so
    // the Textile renderer still sees an image.
    out = out.replace(/!([^!\s|]+)!/g, (match, target) => {
      const url = byName.get(target);
      return url ? `!${url}!` : match;
    });

    return out;
  }

  const api = { resolveInlineAttachmentImages };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.reddieInlineImages = api;
  }
})(typeof self !== 'undefined' ? self : this);
