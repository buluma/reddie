import { describe, it, expect } from 'vitest';
import { sameInstanceImagePath } from '../redmine-client.js';

// This guard is the reason the X-Redmine-API-Key header never leaks to a
// third-party host: a ticket description can embed an <img> pointing
// anywhere, and fetchBinary always attaches the key. Anything that doesn't
// resolve to the configured origin must come back null so main.js refuses
// to fetch it authenticated.
const BASE = 'https://redmine.example.com';

describe('sameInstanceImagePath', () => {
  it('returns the path+query for a relative attachment URL on the instance', () => {
    expect(sameInstanceImagePath('attachments/download/61/foo.png', BASE))
      .toBe('/attachments/download/61/foo.png');
  });

  it('returns the path+query for an absolute URL on the same origin', () => {
    expect(sameInstanceImagePath('https://redmine.example.com/attachments/download/61/foo.png?x=1', BASE))
      .toBe('/attachments/download/61/foo.png?x=1');
  });

  it('returns null for a URL on a different host (would leak the API key)', () => {
    expect(sameInstanceImagePath('https://evil.example.net/steal.png', BASE)).toBeNull();
  });

  it('returns null for a same-host URL on a different port', () => {
    expect(sameInstanceImagePath('https://redmine.example.com:8443/x.png', BASE)).toBeNull();
  });

  it('allows a same-host URL on a different scheme (Redmine reports http content_url on an https instance)', () => {
    // Safe: the fetch always goes to the configured https base, so the API
    // key only ever reaches the configured host. Rejecting this would leave
    // every inline image broken on such an instance.
    expect(sameInstanceImagePath('http://redmine.example.com/x.png', BASE)).toBe('/x.png');
  });

  it('handles a base URL that carries a trailing path without cross-origin false negatives', () => {
    // Origin is scheme+host+port only, so a base with a subpath still matches
    // an absolute same-origin URL.
    expect(sameInstanceImagePath('https://redmine.example.com/attachments/download/9/a.png', 'https://redmine.example.com/redmine'))
      .toBe('/attachments/download/9/a.png');
  });
});
