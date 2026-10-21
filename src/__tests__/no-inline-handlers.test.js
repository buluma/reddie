import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// RDD-29: both renderer pages run under a CSP whose script-src has no
// 'unsafe-inline', so an inline on*="..." attribute is silently dead - the
// button renders but does nothing. UI wiring goes through data-click /
// data-change / data-input / data-blur attributes that renderer.js
// dispatches from one delegated listener per event type (UI_ACTIONS).

const SRC = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');
const INLINE_HANDLER = /\son[a-z]+\s*=\s*["']/g;

describe('no inline event handlers', () => {
  it.each(['index.html', 'tray-popover.html', 'renderer.js', 'tray-popover.js'])('%s has none', (name) => {
    expect(read(name).match(INLINE_HANDLER)).toBeNull();
  });

  it.each(['index.html', 'tray-popover.html'])('%s CSP script-src does not allow inline scripts', (name) => {
    const csp = read(name).match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBe("script-src 'self'");
  });
});

describe('delegated UI actions', () => {
  const renderer = read('renderer.js');
  const block = renderer.match(/const UI_ACTIONS = \{([\s\S]*?)\n\};/);
  const defined = new Set(block ? [...block[1].matchAll(/^\s+'([a-z-]+)':/gm)].map((m) => m[1]) : []);
  const used = new Set(
    [read('index.html'), renderer].flatMap((text) => [...text.matchAll(/data-(?:click|change|input|blur)="([a-z-]+)"/g)].map((m) => m[1])),
  );

  it('wires at least the static header buttons', () => {
    expect(used.has('open-settings')).toBe(true);
  });

  it('every data-click/change/input/blur names an action in UI_ACTIONS', () => {
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });
});
