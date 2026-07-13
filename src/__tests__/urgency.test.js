import { describe, it, expect } from 'vitest';
import { issueUrgencyLevel, issueUrgencyRank, classifyTrayUrgency } from '../urgency.js';

// Redmine's default priority scale, in the order the enumerations endpoint
// returns it (least urgent first) - the same shape the renderer holds in its
// `priorities` var and feeds to these functions.
const DEFAULT_PRIORITIES = [
  { id: 3, name: 'Low' },
  { id: 4, name: 'Normal' },
  { id: 5, name: 'High' },
  { id: 6, name: 'Urgent' },
  { id: 7, name: 'Immediate' },
];

const issue = (name, id) => ({ priority: name ? { name, id } : undefined });

describe('issueUrgencyLevel (name-first)', () => {
  it('maps the standard English priority names the way the tray always has', () => {
    expect(issueUrgencyLevel(issue('Immediate'), DEFAULT_PRIORITIES)).toBe('high');
    expect(issueUrgencyLevel(issue('Urgent'), DEFAULT_PRIORITIES)).toBe('high');
    expect(issueUrgencyLevel(issue('High'), DEFAULT_PRIORITIES)).toBe('high');
    expect(issueUrgencyLevel(issue('Normal'), DEFAULT_PRIORITIES)).toBe('medium');
    expect(issueUrgencyLevel(issue('Low'), DEFAULT_PRIORITIES)).toBe('low');
  });

  it('treats an issue with no priority as low', () => {
    expect(issueUrgencyLevel(issue(null), DEFAULT_PRIORITIES)).toBe('low');
  });
});

describe('issueUrgencyLevel (position fallback for non-English/custom names)', () => {
  // A localized instance whose names match none of the English keywords -
  // the old name-only heuristic classified every one of these as 'low',
  // hiding real urgency. Position in the ordered scale must drive it instead.
  const FRENCH = [
    { id: 1, name: 'Basse' },      // idx 0/4 -> 0.0  -> low
    { id: 2, name: 'Moyenne' },    // idx 1/4 -> 0.25 -> low
    { id: 3, name: 'Élevée' },     // idx 2/4 -> 0.5  -> medium
    { id: 4, name: 'Critique' },   // idx 3/4 -> 0.75 -> high
    { id: 5, name: 'Bloquante' },  // idx 4/4 -> 1.0  -> high
  ];

  it('ranks by scale position when the name is unrecognized', () => {
    expect(issueUrgencyLevel({ priority: FRENCH[0] }, FRENCH)).toBe('low');
    expect(issueUrgencyLevel({ priority: FRENCH[2] }, FRENCH)).toBe('medium');
    expect(issueUrgencyLevel({ priority: FRENCH[4] }, FRENCH)).toBe('high');
  });

  it('is low when the priority is not in the provided scale', () => {
    expect(issueUrgencyLevel({ priority: { id: 999, name: 'Ghost' } }, FRENCH)).toBe('low');
  });

  it('is low when no scale has loaded yet', () => {
    expect(issueUrgencyLevel({ priority: { id: 5, name: 'Bloquante' } }, [])).toBe('low');
  });
});

describe('issueUrgencyRank', () => {
  it('orders most-urgent-first (high < medium < low) for sorting', () => {
    const rows = [issue('Low'), issue('Immediate'), issue('Normal')];
    const sorted = [...rows].sort(
      (a, b) => issueUrgencyRank(a, DEFAULT_PRIORITIES) - issueUrgencyRank(b, DEFAULT_PRIORITIES),
    );
    expect(sorted.map((r) => r.priority.name)).toEqual(['Immediate', 'Normal', 'Low']);
  });
});

describe('classifyTrayUrgency', () => {
  it('returns the single worst urgency across the set', () => {
    expect(classifyTrayUrgency([issue('Low'), issue('High'), issue('Normal')], DEFAULT_PRIORITIES)).toBe('high');
    expect(classifyTrayUrgency([issue('Low'), issue('Normal')], DEFAULT_PRIORITIES)).toBe('medium');
    expect(classifyTrayUrgency([issue('Low'), issue('Low')], DEFAULT_PRIORITIES)).toBe('low');
  });

  it('returns low for an empty set (callers map a zero count to "none" separately)', () => {
    expect(classifyTrayUrgency([], DEFAULT_PRIORITIES)).toBe('low');
  });
});
