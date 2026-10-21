import { describe, it, expect } from 'vitest';
import { resolveInlineAttachmentImages } from '../inline-images.js';

// Redmine embeds inline images as an attachment reference in the body and
// rewrites them server-side. Reddie renders the raw body with `marked`, so
// these must be rewritten to the attachment's absolute content_url first -
// for BOTH the Markdown `![](name)` form and the Textile `!name!` form the
// real instance actually uses. Only references matching a real image
// attachment are touched; everything else is left exactly as-is.

const img = (filename, content_url, content_type = 'image/png') => ({ filename, content_url, content_type });
const URL1 = 'http://redmine.example.com/attachments/download/295177/clipboard.png';

describe('resolveInlineAttachmentImages', () => {
  it('rewrites a Textile !name! reference in place, keeping the Textile delimiter', () => {
    const atts = [img('clipboard.png', URL1)];
    expect(resolveInlineAttachmentImages('before !clipboard.png! after', atts)).toBe(
      `before !${URL1}! after`,
    );
  });

  it('rewrites the real captured reference (Textile, delimiter preserved)', () => {
    const url = 'http://redmine.nasctech.com/attachments/download/295177/clipboard-202605151559-1nixy.png';
    const atts = [img('clipboard-202605151559-1nixy.png', url)];
    expect(resolveInlineAttachmentImages('!clipboard-202605151559-1nixy.png!', atts)).toBe(`!${url}!`);
  });

  it('rewrites a Markdown ![alt](name) reference, preserving the alt text', () => {
    const atts = [img('diagram.png', URL1)];
    expect(resolveInlineAttachmentImages('![a diagram](diagram.png)', atts)).toBe(`![a diagram](${URL1})`);
  });

  it('leaves a !word! that is not an attachment filename untouched', () => {
    const atts = [img('clipboard.png', URL1)];
    expect(resolveInlineAttachmentImages('this is !important! text', atts)).toBe('this is !important! text');
  });

  it('ignores a non-image attachment with a matching name', () => {
    const atts = [img('report.pdf', URL1, 'application/pdf')];
    expect(resolveInlineAttachmentImages('!report.pdf!', atts)).toBe('!report.pdf!');
  });

  it('returns the text unchanged when there are no attachments', () => {
    expect(resolveInlineAttachmentImages('!clipboard.png!', [])).toBe('!clipboard.png!');
    expect(resolveInlineAttachmentImages('!clipboard.png!', undefined)).toBe('!clipboard.png!');
  });

  it('handles empty/nullish text', () => {
    expect(resolveInlineAttachmentImages('', [img('x.png', URL1)])).toBe('');
    expect(resolveInlineAttachmentImages(null, [img('x.png', URL1)])).toBe('');
  });

  // RDD-28: the real instance's editor emits Textile images with a style
  // modifier - captured verbatim from #116222 / #109211 journals. The
  // modifier must be kept (it's Textile's own image syntax) while the target
  // after it is resolved.
  it('rewrites a Textile image with a {style} modifier, keeping the modifier', () => {
    const atts = [img('20260901-093830-351.png', URL1)];
    expect(resolveInlineAttachmentImages('!{height: 639px; width: 1201px;}20260901-093830-351.png!', atts)).toBe(
      `!{height: 639px; width: 1201px;}${URL1}!`,
    );
  });

  it('rewrites Textile images with class/lang/alignment modifiers and a title', () => {
    const atts = [img('a.png', URL1)];
    expect(resolveInlineAttachmentImages('!(shot)[en]>a.png(the alt)!', atts)).toBe(`!(shot)[en]>${URL1}(the alt)!`);
    expect(resolveInlineAttachmentImages('!<a.png!', atts)).toBe(`!<${URL1}!`);
  });

  it('matches a URL-encoded Textile target to the attachment filename (real #116222 reference)', () => {
    const atts = [img('Screenshot 2026-08-11 at 09.48.46.png', URL1)];
    expect(
      resolveInlineAttachmentImages('!{height: 761px; width: 1301px;}Screenshot%202026-08-11%20at%2009.48.46.png!', atts),
    ).toBe(`!{height: 761px; width: 1301px;}${URL1}!`);
  });

  it('matches a URL-encoded Markdown target to the attachment filename', () => {
    const atts = [img('my shot.png', URL1)];
    expect(resolveInlineAttachmentImages('![x](my%20shot.png)', atts)).toBe(`![x](${URL1})`);
  });

  it('leaves a malformed %-sequence that is not an attachment untouched', () => {
    const atts = [img('a.png', URL1)];
    expect(resolveInlineAttachmentImages('!50%off!', atts)).toBe('!50%off!');
  });

  it('still ignores a styled !{...}word! that is not an attachment', () => {
    const atts = [img('a.png', URL1)];
    expect(resolveInlineAttachmentImages('!{color: red}warning!', atts)).toBe('!{color: red}warning!');
  });

  it('rewrites multiple Textile references in one body', () => {
    const url2 = 'http://redmine.example.com/attachments/download/2/b.png';
    const atts = [img('a.png', URL1), img('b.png', url2)];
    expect(resolveInlineAttachmentImages('!a.png! and !b.png!', atts)).toBe(`!${URL1}! and !${url2}!`);
  });
});
