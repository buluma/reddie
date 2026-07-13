import { describe, it, expect } from 'vitest';
import { detectTextFormat, resolveFormat } from '../text-format.js';

describe('detectTextFormat', () => {
  it('detects Textile from distinctive tokens', () => {
    expect(detectTextFormat(['h1. Title\n\nbq. a quote\n\n* item'])).toBe('textile');
    expect(detectTextFormat(['see !diagram.png! here'])).toBe('textile');
    expect(detectTextFormat(['a "link":https://example.com in text'])).toBe('textile');
  });

  it('detects Markdown from distinctive tokens', () => {
    expect(detectTextFormat(['# Title\n\n**bold** and ![a](b.png)'])).toBe('markdown');
    expect(detectTextFormat(['- one\n- two\n\n[link](https://example.com)'])).toBe('markdown');
    expect(detectTextFormat(['```\ncode\n```'])).toBe('markdown');
  });

  it('detects the real Textile body shape', () => {
    const real = "*What's wrong? (description):*\n• Currently on MC and Portal\n!clipboard-202605151559-1nixy.png!";
    expect(detectTextFormat([real])).toBe('textile');
  });

  it('aggregates across many bodies (instance-wide signal)', () => {
    const bodies = ['plain text', 'h1. Heading', 'bq. quote', 'nothing special'];
    expect(detectTextFormat(bodies)).toBe('textile');
  });

  it('falls back to markdown on no signal or a tie', () => {
    expect(detectTextFormat(['just plain prose with no markup'])).toBe('markdown');
    expect(detectTextFormat([])).toBe('markdown');
    expect(detectTextFormat(undefined)).toBe('markdown');
  });
});

describe('resolveFormat', () => {
  it('honors an explicit setting over the detected format', () => {
    expect(resolveFormat('markdown', 'textile')).toBe('markdown');
    expect(resolveFormat('textile', 'markdown')).toBe('textile');
  });

  it('defers to the detected format when set to auto', () => {
    expect(resolveFormat('auto', 'textile')).toBe('textile');
    expect(resolveFormat('auto', 'markdown')).toBe('markdown');
  });

  it('treats an unknown/empty setting as auto', () => {
    expect(resolveFormat(undefined, 'textile')).toBe('textile');
    expect(resolveFormat('', 'markdown')).toBe('markdown');
  });
});
