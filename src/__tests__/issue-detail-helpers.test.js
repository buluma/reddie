import { describe, it, expect } from 'vitest';
import { relationLabel, resolveJournalValue, journalDetailLine } from '../issue-detail-helpers.js';

describe('relationLabel', () => {
  it('labels from the issue_id ("from") side using the direct map', () => {
    const relation = { issue_id: 100, issue_to_id: 200, relation_type: 'blocks' };
    expect(relationLabel(relation, 100)).toEqual({ label: 'blocks', otherId: 200 });
  });

  it('flips to the inverse label from the issue_to_id side', () => {
    const relation = { issue_id: 100, issue_to_id: 200, relation_type: 'blocks' };
    expect(relationLabel(relation, 200)).toEqual({ label: 'blocked by', otherId: 100 });
  });

  it('flips every asymmetric relation type correctly', () => {
    const cases = [
      ['duplicates', 'duplicated by'],
      ['duplicated', 'duplicates'],
      ['precedes', 'follows'],
      ['follows', 'precedes'],
      ['copied_to', 'copied from'],
      ['copied_from', 'copied to'],
    ];
    for (const [type, inverseLabel] of cases) {
      const relation = { issue_id: 1, issue_to_id: 2, relation_type: type };
      expect(relationLabel(relation, 2).label).toBe(inverseLabel);
    }
  });

  it('is symmetric for "relates" regardless of side', () => {
    const relation = { issue_id: 1, issue_to_id: 2, relation_type: 'relates' };
    expect(relationLabel(relation, 1).label).toBe('relates to');
    expect(relationLabel(relation, 2).label).toBe('relates to');
  });

  it('falls back to the raw relation_type for an unrecognized value', () => {
    const relation = { issue_id: 1, issue_to_id: 2, relation_type: 'some_future_type' };
    expect(relationLabel(relation, 1).label).toBe('some_future_type');
  });

  it('compares issue_id loosely (string vs number ids from different call sites)', () => {
    const relation = { issue_id: '100', issue_to_id: 200, relation_type: 'blocks' };
    expect(relationLabel(relation, 100).label).toBe('blocks');
  });
});

describe('resolveJournalValue', () => {
  const lookups = {
    statuses: [{ id: 1, name: 'New' }, { id: 2, name: 'In Progress' }],
    priorities: [{ id: 5, name: 'High' }],
    members: [{ id: 194, name: 'MBU' }],
    trackers: [{ id: 10, name: 'Subtask' }],
    categories: [{ id: 130, name: 'system' }],
    versions: [{ id: 7, name: 'v2.0' }],
  };

  it('returns an em dash for null/empty values', () => {
    expect(resolveJournalValue('status_id', null, lookups)).toBe('—');
    expect(resolveJournalValue('status_id', '', lookups)).toBe('—');
  });

  it('resolves status_id/priority_id/assigned_to_id/tracker_id/category_id/fixed_version_id by name', () => {
    expect(resolveJournalValue('status_id', 2, lookups)).toBe('In Progress');
    expect(resolveJournalValue('priority_id', 5, lookups)).toBe('High');
    expect(resolveJournalValue('assigned_to_id', 194, lookups)).toBe('MBU');
    expect(resolveJournalValue('tracker_id', 10, lookups)).toBe('Subtask');
    expect(resolveJournalValue('category_id', 130, lookups)).toBe('system');
    expect(resolveJournalValue('fixed_version_id', 7, lookups)).toBe('v2.0');
  });

  it('falls back to a raw #id when the value is not in the provided lookup', () => {
    expect(resolveJournalValue('status_id', 999, lookups)).toBe('#999');
    expect(resolveJournalValue('tracker_id', 999, lookups)).toBe('#999');
  });

  it('falls back to "user #id" specifically for an unresolved assignee', () => {
    expect(resolveJournalValue('assigned_to_id', 999, lookups)).toBe('user #999');
  });

  it('coerces is_private truthy forms to Yes/No', () => {
    expect(resolveJournalValue('is_private', '1', lookups)).toBe('Yes');
    expect(resolveJournalValue('is_private', true, lookups)).toBe('Yes');
    expect(resolveJournalValue('is_private', '0', lookups)).toBe('No');
    expect(resolveJournalValue('is_private', false, lookups)).toBe('No');
  });

  it('returns plain scalar fields (dates, text) as-is', () => {
    expect(resolveJournalValue('due_date', '2026-07-17', lookups)).toBe('2026-07-17');
    expect(resolveJournalValue('subject', 'New subject', lookups)).toBe('New subject');
  });
});

describe('journalDetailLine', () => {
  const lookups = {
    statuses: [{ id: 1, name: 'New' }, { id: 2, name: 'In Progress' }],
    priorities: [],
    members: [],
    trackers: [],
    categories: [],
    versions: [],
  };

  it('formats an attribute change as "Label: old → new"', () => {
    const detail = { property: 'attr', name: 'status_id', old_value: '1', new_value: '2' };
    expect(journalDetailLine(detail, lookups)).toBe('Status: New → In Progress');
  });

  it('special-cases description to avoid dumping the full body text', () => {
    const detail = { property: 'attr', name: 'description', old_value: 'old body...', new_value: 'new body...' };
    expect(journalDetailLine(detail, lookups)).toBe('Description updated');
  });

  it('uses the raw field name as the label when no human label is known', () => {
    const detail = { property: 'attr', name: 'some_custom_field', old_value: 'a', new_value: 'b' };
    expect(journalDetailLine(detail, lookups)).toBe('some_custom_field: a → b');
  });

  it('falls back to "<label> changed" for a non-attr property (attachment/relation/cf)', () => {
    const detail = { property: 'attachment', name: 'filename.png', old_value: null, new_value: '123' };
    expect(journalDetailLine(detail, lookups)).toBe('filename.png changed');
  });
});
