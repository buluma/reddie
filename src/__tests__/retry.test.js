import { describe, it, expect, vi } from 'vitest';
import { isRetriable, withRetry } from '../redmine-client.js';

// A single 5xx or dropped packet during a board refresh shouldn't fail the
// whole load. GETs are idempotent so one short retry smooths over transient
// blips; writes (PUT/POST) must never be blind-retried (double-posted comment
// / time entry). isRetriable is the pure policy; withRetry is the loop.

describe('isRetriable', () => {
  it('retries a GET that failed with a network/timeout error (no HTTP status)', () => {
    expect(isRetriable('GET', new Error('socket hang up'))).toBe(true);
    const timeout = new Error('Redmine request timed out after 30000ms');
    expect(isRetriable('GET', timeout)).toBe(true);
  });

  it('retries a GET that got a 5xx', () => {
    expect(isRetriable('GET', Object.assign(new Error('x'), { statusCode: 500 }))).toBe(true);
    expect(isRetriable('GET', Object.assign(new Error('x'), { statusCode: 503 }))).toBe(true);
  });

  it('does not retry a GET that got a 4xx (client error is not transient)', () => {
    expect(isRetriable('GET', Object.assign(new Error('x'), { statusCode: 422 }))).toBe(false);
    expect(isRetriable('GET', Object.assign(new Error('x'), { statusCode: 404 }))).toBe(false);
    expect(isRetriable('GET', Object.assign(new Error('x'), { statusCode: 403 }))).toBe(false);
  });

  it('never retries a write, even on a 5xx or network error', () => {
    expect(isRetriable('PUT', Object.assign(new Error('x'), { statusCode: 503 }))).toBe(false);
    expect(isRetriable('POST', new Error('ECONNRESET'))).toBe(false);
    expect(isRetriable('DELETE', Object.assign(new Error('x'), { statusCode: 500 }))).toBe(false);
  });
});

describe('withRetry', () => {
  const opts = { method: 'GET', retries: 2, backoffMs: 0 };

  it('succeeds after transient failures without surfacing them', async () => {
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('socket hang up');
      return 'ok';
    });
    await expect(withRetry(attempt, opts)).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('gives up after retries+1 attempts and throws the last error', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(withRetry(attempt, opts)).rejects.toThrow('ECONNRESET');
    expect(attempt).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('does not retry a non-retriable failure (4xx)', async () => {
    const attempt = vi.fn(async () => {
      throw Object.assign(new Error('Unprocessable'), { statusCode: 422 });
    });
    await expect(withRetry(attempt, opts)).rejects.toThrow('Unprocessable');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not retry a write even on a transient error', async () => {
    const attempt = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { statusCode: 503 });
    });
    await expect(withRetry(attempt, { method: 'PUT', retries: 2, backoffMs: 0 })).rejects.toThrow('boom');
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
