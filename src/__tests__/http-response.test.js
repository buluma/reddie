import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { RedmineClient } from '../redmine-client';

let server;
afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
});
async function serve(handler) {
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return new RedmineClient(`http://127.0.0.1:${server.address().port}`, 'test-key');
}
function interrupt(res) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 1000 });
  res.write('{"issues":[');
  setImmediate(() => res.destroy());
}

describe('HTTP response lifecycle', () => {
  it('retries an interrupted GET and returns the complete replacement response', async () => {
    let calls = 0;
    const client = await serve((req, res) => {
      if (++calls === 1) return interrupt(res);
      res.end(JSON.stringify({ issues: [{ id: 42 }] }));
    });
    await expect(client.listMyIssues()).resolves.toEqual([{ id: 42 }]);
    expect(calls).toBe(2);
  });
  it('rejects after bounded retries when every response is interrupted', async () => {
    let calls = 0;
    const client = await serve((req, res) => { calls++; interrupt(res); });
    await expect(client.listMyIssues()).rejects.toThrow(/interrupt|abort|closed/i);
    expect(calls).toBe(3);
  });
  it('rejects an interrupted write without retrying it', async () => {
    let calls = 0;
    const client = await serve((req, res) => { calls++; req.resume(); interrupt(res); });
    await expect(client.addComment(42, 'Hello')).rejects.toThrow(/interrupt|abort|closed/i);
    expect(calls).toBe(1);
  });
  it('handles interrupted binary responses through the same retry boundary', async () => {
    let calls = 0;
    const client = await serve((req, res) => {
      if (++calls === 1) return interrupt(res);
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from([1, 2, 3]));
    });
    await expect(client.fetchBinary('/attachment')).resolves.toEqual({ buffer: Buffer.from([1, 2, 3]), contentType: 'image/png' });
    expect(calls).toBe(2);
  });
  it('rejects malformed successful JSON instead of returning an empty board', async () => {
    const client = await serve((req, res) => res.end('<html>proxy error</html>'));
    await expect(client.listMyIssues()).rejects.toThrow(/invalid JSON/);
  });
  it('accepts an empty successful write response', async () => {
    const client = await serve((req, res) => { req.resume(); res.writeHead(204); res.end(); });
    await expect(client.addComment(42, 'Hello')).resolves.toEqual({});
  });
});
