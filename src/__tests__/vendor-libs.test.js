import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// RDD-30: the renderer used to load hand-copied builds from src/vendor/,
// which Dependabot never touches - package.json said DOMPurify 3.4.17 while
// the app actually ran 3.4.12, so sanitizer fixes silently never shipped.
// The page must load third-party libraries straight from node_modules, so
// whatever version package.json/bun.lock resolve is the version that runs.

const SRC = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);

describe('renderer third-party scripts', () => {
  it('every <script src> in index.html resolves to a real file', () => {
    expect(scriptSrcs.length).toBeGreaterThan(0);
    for (const src of scriptSrcs) {
      expect(fs.existsSync(path.join(SRC, src)), src).toBe(true);
    }
  });

  it.each(['marked', 'dompurify', 'sortablejs', 'textile-js'])('loads %s from node_modules', (pkg) => {
    expect(scriptSrcs.some((src) => src.startsWith(`../node_modules/${pkg}/`))).toBe(true);
  });

  it('has no vendored copies left to drift', () => {
    expect(fs.existsSync(path.join(SRC, 'vendor'))).toBe(false);
  });
});
