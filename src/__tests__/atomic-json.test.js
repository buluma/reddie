import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it, expect } from 'vitest';
import { writeJsonAtomic } from '../atomic-json';

it('replaces readable JSON without retaining temporary files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reddie-json-'));
  const file = path.join(dir, 'state.json');
  try {
    writeJsonAtomic(file, { value: 1 });
    writeJsonAtomic(file, { value: 2 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ value: 2 });
    expect(fs.readdirSync(dir)).toEqual(['state.json']);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const circular = {}; circular.self = circular;
    expect(() => writeJsonAtomic(file, circular)).toThrow();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ value: 2 });
    expect(fs.readdirSync(dir)).toEqual(['state.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
