import { describe, it, expect } from 'vitest';
import { expandRedmineMacros } from '../redmine-macros.js';

describe('expandRedmineMacros - collapse', () => {
  it('drops the wrapper, keeps content, and bolds the title (Textile)', () => {
    const src = '{{collapse(Result)\nthe rack is still visible\n}}';
    expect(expandRedmineMacros(src, 'textile')).toBe('*Result*\n\nthe rack is still visible');
  });

  it('bolds the title in Markdown syntax when the format is markdown', () => {
    const src = '{{collapse(Details)\nbody line\n}}';
    expect(expandRedmineMacros(src, 'markdown')).toBe('**Details**\n\nbody line');
  });

  it('handles a collapse with no title', () => {
    const src = '{{collapse\njust content\n}}';
    expect(expandRedmineMacros(src, 'textile')).toBe('just content');
  });

  it('handles multiple collapse blocks without merging them', () => {
    const src = '{{collapse(A)\naaa\n}}\nmiddle\n{{collapse(B)\nbbb\n}}';
    expect(expandRedmineMacros(src, 'markdown')).toBe('**A**\n\naaa\nmiddle\n**B**\n\nbbb');
  });

  it('leaves text without collapse macros untouched', () => {
    expect(expandRedmineMacros('plain *textile* body', 'textile')).toBe('plain *textile* body');
  });

  it('handles empty / nullish input', () => {
    expect(expandRedmineMacros('', 'textile')).toBe('');
    expect(expandRedmineMacros(null, 'markdown')).toBe('');
  });
});
