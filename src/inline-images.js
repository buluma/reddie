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
//   - Textile:  !filename.png!, optionally with Textile's image modifiers
//     before the target and a title after it - the real instance's editor
//     writes !{height: 639px; width: 1201px;}filename.png! for pasted
//     screenshots. Modifiers/title are kept; only the target is rewritten.
// A target may also be URL-encoded (Screenshot%202026-...png for an
// attachment named "Screenshot 2026-...png"), so a miss on the raw target
// retries with it decoded.
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

    const lookup = (target) => {
      if (byName.has(target)) return byName.get(target);
      try {
        return byName.get(decodeURIComponent(target));
      } catch {
        return undefined; // not valid %-encoding - just not a match
      }
    };

    // Markdown ![alt](target) first, so its inner text can't be mistaken for a
    // Textile !...! pair below. Preserve the alt text.
    let out = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, target) => {
      const url = lookup(target);
      return url ? `![${alt}](${url})` : match;
    });

    // Textile !mods target(title)! - mods are any run of {style}, (class),
    // [lang] and the <, >, = alignment marks; target can't contain whitespace,
    // `!`, `|` or `(`. Only rewritten when the target names a real image
    // attachment, so ordinary `!word!` / `!{color: red}word!` text is
    // untouched. Everything but the target is preserved so the Textile
    // renderer still sees the same image (style, alignment, title).
    out = out.replace(
      /!((?:\{[^}!]*\}|\([^)!]*\)|\[[^\]!]*\]|[<>=])*)([^!\s|(]+)(\([^)!]*\))?!/g,
      (match, mods, target, title) => {
        const url = lookup(target);
        return url ? `!${mods}${url}${title || ''}!` : match;
      },
    );

    return out;
  }

  const api = { resolveInlineAttachmentImages };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.reddieInlineImages = api;
  }
})(typeof self !== 'undefined' ? self : this);
