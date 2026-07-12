import { describe, it, expect } from 'vitest';
import { buildColumnMapping } from '../redmine-client.js';

// Real status list from redmine.nasctech.com (fetched 2026-07-12), used to
// ground this test in an actual customized instance rather than a made-up
// one - this is the exact data the direct-Redmine pivot was verified
// against.
const REAL_STATUSES = [
  { id: 1, name: 'New', is_closed: false },
  { id: 7, name: 'Hold', is_closed: false },
  { id: 2, name: 'In Progress', is_closed: false },
  { id: 3, name: 'Resolved', is_closed: false },
  { id: 4, name: 'Feedback', is_closed: false },
  { id: 5, name: 'Closed', is_closed: true },
  { id: 9, name: 'ReDev', is_closed: false },
  { id: 6, name: 'Pause', is_closed: false },
  { id: 10, name: 'Testing', is_closed: false },
  { id: 11, name: 'Need testing', is_closed: false },
  { id: 12, name: 'Success', is_closed: false },
  { id: 13, name: 'On hold testing', is_closed: false },
  { id: 14, name: 'Wait merging', is_closed: false },
  { id: 15, name: 'Review', is_closed: false },
  { id: 16, name: 'Need to deploy', is_closed: false },
  { id: 19, name: 'Escalation', is_closed: false },
  { id: 21, name: 'PASS', is_closed: false },
  { id: 22, name: 'FAIL', is_closed: false },
  { id: 23, name: 'BLOCKED', is_closed: false },
  { id: 24, name: 'N/A', is_closed: false },
  { id: 25, name: 'NOT READY', is_closed: false },
  { id: 26, name: 'Waiting for deploy', is_closed: false },
];

describe('buildColumnMapping', () => {
  it('classifies Redmine default statuses (New/In Progress/Resolved/Feedback/Closed) as expected', () => {
    const { statusIdToColumn } = buildColumnMapping(REAL_STATUSES);
    expect(statusIdToColumn[1]).toBe('backlog'); // New
    expect(statusIdToColumn[2]).toBe('in-progress'); // In Progress
    expect(statusIdToColumn[3]).toBe('done'); // Resolved - not is_closed here, needed the name-based fallback
    expect(statusIdToColumn[4]).toBe('todo'); // Feedback
    expect(statusIdToColumn[5]).toBe('done'); // Closed, is_closed: true
  });

  it('picks the lowest-id status per column for the reverse (drag -> statusId) direction', () => {
    const { columnToStatusId } = buildColumnMapping(REAL_STATUSES);
    // Same reverse mapping the app already had hardcoded before the
    // dynamic pivot - this is the regression guard for that parity.
    expect(columnToStatusId).toEqual({
      backlog: 1,
      'in-progress': 2,
      done: 3,
      todo: 4,
    });
  });

  it('treats is_closed as authoritative for done even without a matching name', () => {
    const { statusIdToColumn } = buildColumnMapping([
      { id: 99, name: 'Archived', is_closed: true },
    ]);
    expect(statusIdToColumn[99]).toBe('done');
  });

  it('falls back to backlog for unrecognized status names', () => {
    const { statusIdToColumn } = buildColumnMapping([
      { id: 42, name: 'Some Custom Thing', is_closed: false },
    ]);
    expect(statusIdToColumn[42]).toBe('backlog');
  });

  it('handles an empty status list without throwing', () => {
    const mapping = buildColumnMapping([]);
    expect(mapping.statusIdToColumn).toEqual({});
    expect(mapping.columnToStatusId).toEqual({});
  });
});
