import { describe, it, expect } from 'vitest';
import { RedmineClient, assertId } from '../redmine-client.js';

// Ids arrive over IPC from the renderer and get interpolated straight into
// Redmine URL paths/query strings (`/issues/${issueId}.json`). The renderer
// only ever sends numeric ids, but if it were compromised a crafted id like
// `1.json?key=x` or `../users/1` would let it steer authenticated requests
// anywhere on the instance - so the client refuses anything that isn't a
// plain positive integer before building the URL.

describe('assertId', () => {
  it('accepts positive integers and digit strings (the renderer sends both)', () => {
    expect(assertId(109211, 'issue id')).toBe('109211');
    expect(assertId('109211', 'issue id')).toBe('109211');
  });

  it.each([
    ['path traversal', '../users/1'],
    ['query injection', '1&tracker_id=2'],
    ['extension smuggling', '1.json?include=x'],
    ['zero', 0],
    ['negative', -5],
    ['fractional', 1.5],
    ['empty string', ''],
    ['leading zero', '0123'],
    ['undefined', undefined],
    ['null', null],
    ['object', { id: 1 }],
  ])('rejects %s', (_label, value) => {
    expect(() => assertId(value, 'issue id')).toThrow(/Invalid issue id/);
  });
});

// Every client method that interpolates an id must validate it before any
// request is made - stub the transport and check nothing goes out.
describe('RedmineClient id validation', () => {
  function stubbedClient() {
    const client = new RedmineClient('https://redmine.example.com', 'k');
    const sent = [];
    const record = (method) => (path) => {
      sent.push(`${method} ${path}`);
      return Promise.resolve({});
    };
    client.get = record('GET');
    client.put = record('PUT');
    client.post = record('POST');
    return { client, sent };
  }

  const BAD = '1.json?x=';

  it.each([
    ['getIssueDetail', (c) => c.getIssueDetail(BAD)],
    ['updateStatus', (c) => c.updateStatus(BAD, 2)],
    ['updatePriority', (c) => c.updatePriority(BAD, 2)],
    ['updateSubject', (c) => c.updateSubject(BAD, 's')],
    ['updateIssue', (c) => c.updateIssue(BAD, {})],
    ['updateAssignee', (c) => c.updateAssignee(BAD, 3)],
    ['addComment', (c) => c.addComment(BAD, 'hi')],
    ['attachToIssue', (c) => c.attachToIssue(BAD, 'tok', 'f.png')],
    ['listProjectTrackers', (c) => c.listProjectTrackers(BAD)],
    ['listProjectCategories', (c) => c.listProjectCategories(BAD)],
    ['listProjectVersions', (c) => c.listProjectVersions(BAD)],
    ['listProjectMembers', (c) => c.listProjectMembers(BAD)],
    ['listTrackerCustomFields (project)', (c) => c.listTrackerCustomFields(BAD, 1)],
    ['listTrackerCustomFields (tracker)', (c) => c.listTrackerCustomFields(1, BAD)],
  ])('%s rejects a crafted id without sending a request', async (_name, call) => {
    const { client, sent } = stubbedClient();
    await expect((async () => call(client))()).rejects.toThrow(/Invalid/);
    expect(sent).toEqual([]);
  });

  it('still sends the normal request for a valid string id', async () => {
    const { client, sent } = stubbedClient();
    await client.updateStatus('109211', 3);
    await client.listProjectTrackers(42);
    expect(sent).toEqual(['PUT /issues/109211.json', 'GET /projects/42.json?include=trackers']);
  });
});
