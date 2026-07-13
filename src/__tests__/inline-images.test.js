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

  it('rewrites multiple Textile references in one body', () => {
    const url2 = 'http://redmine.example.com/attachments/download/2/b.png';
    const atts = [img('a.png', URL1), img('b.png', url2)];
    expect(resolveInlineAttachmentImages('!a.png! and !b.png!', atts)).toBe(`!${URL1}! and !${url2}!`);
  });
});
