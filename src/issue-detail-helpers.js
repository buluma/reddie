// Pure logic behind the issue detail modal's relation labels and full
// changelog (journal.details) rendering - shared by the renderer (loaded as
// a plain <script> exposing `window.reddieIssueDetailHelpers`) and the test
// suite (required as a CommonJS module). No DOM, no Electron, no I/O.
(function (global) {
  'use strict';

  // Redmine always reports relation_type from the issue_id ("from") side -
  // the inverse map is needed when rendering from the issue_to_id side, so
  // "blocks" reads as "blocked by" from that end instead of implying this
  // issue blocks the other one.
  const RELATION_LABELS = {
    relates: 'relates to',
    duplicates: 'duplicates',
    duplicated: 'duplicated by',
    blocks: 'blocks',
    blocked: 'blocked by',
    precedes: 'precedes',
    follows: 'follows',
    copied_to: 'copied to',
    copied_from: 'copied from',
  };
  const RELATION_LABELS_INVERSE = {
    relates: 'relates to',
    duplicates: 'duplicated by',
    duplicated: 'duplicates',
    blocks: 'blocked by',
    blocked: 'blocks',
    precedes: 'follows',
    follows: 'precedes',
    copied_to: 'copied from',
    copied_from: 'copied to',
  };

  // { label, otherId } for one relation object, from the perspective of
  // currentIssueId.
  function relationLabel(relation, currentIssueId) {
    const isFrom = String(relation.issue_id) === String(currentIssueId);
    const otherId = isFrom ? relation.issue_to_id : relation.issue_id;
    const label = (isFrom ? RELATION_LABELS : RELATION_LABELS_INVERSE)[relation.relation_type] || relation.relation_type;
    return { label, otherId };
  }

  // Full changelog (journal.details) support - Redmine ships old_value/
  // new_value as raw IDs for reference fields, so anything reddie already
  // has a name lookup for (status/priority/project members/trackers/
  // categories/versions) gets resolved; everything else falls back to the
  // raw value rather than dropping the entry.
  const JOURNAL_FIELD_LABELS = {
    status_id: 'Status',
    priority_id: 'Priority',
    assigned_to_id: 'Assignee',
    tracker_id: 'Tracker',
    category_id: 'Category',
    parent_id: 'Parent',
    subject: 'Subject',
    description: 'Description',
    start_date: 'Start date',
    due_date: 'Due date',
    done_ratio: '% Done',
    estimated_hours: 'Estimation',
    is_private: 'Private',
    fixed_version_id: 'Target version',
  };

  // lookups: { statuses, priorities, members, trackers, categories, versions }
  // - each an array of { id, name }, matching what the renderer already
  // holds for the currently open issue's project.
  function resolveJournalValue(name, value, lookups) {
    if (value == null || value === '') return '—';
    const find = (list) => (list || []).find((item) => String(item.id) === String(value));
    if (name === 'status_id') {
      const s = find(lookups.statuses);
      return s ? s.name : `#${value}`;
    }
    if (name === 'priority_id') {
      const p = find(lookups.priorities);
      return p ? p.name : `#${value}`;
    }
    if (name === 'assigned_to_id') {
      // Only resolves against the currently open issue's project members -
      // an old assignee who's since left the project falls back to the ID,
      // same tradeoff as the assignee dropdown elsewhere in this view.
      const m = find(lookups.members);
      return m ? m.name : `user #${value}`;
    }
    if (name === 'tracker_id') {
      const t = find(lookups.trackers);
      return t ? t.name : `#${value}`;
    }
    if (name === 'category_id') {
      const c = find(lookups.categories);
      return c ? c.name : `#${value}`;
    }
    if (name === 'fixed_version_id') {
      const v = find(lookups.versions);
      return v ? v.name : `#${value}`;
    }
    if (name === 'is_private') return value === '1' || value === 'true' || value === true ? 'Yes' : 'No';
    return String(value);
  }

  // journal.details entries aren't all attribute changes (property can also
  // be 'attachment', 'relation', or 'cf' for a custom field) - those don't
  // have a human-friendly name lookup available client-side, so they render
  // with their raw property name rather than being silently dropped. Plain
  // text, not HTML - the caller is responsible for escaping.
  function journalDetailLine(detail, lookups) {
    const label = JOURNAL_FIELD_LABELS[detail.name] || detail.name;
    if (detail.property !== 'attr') {
      return `${label} changed`;
    }
    if (detail.name === 'description') {
      return `${label} updated`;
    }
    const oldValue = resolveJournalValue(detail.name, detail.old_value, lookups);
    const newValue = resolveJournalValue(detail.name, detail.new_value, lookups);
    return `${label}: ${oldValue} → ${newValue}`;
  }

  const api = {
    RELATION_LABELS,
    RELATION_LABELS_INVERSE,
    JOURNAL_FIELD_LABELS,
    relationLabel,
    resolveJournalValue,
    journalDetailLine,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.reddieIssueDetailHelpers = api;
  }
})(typeof self !== 'undefined' ? self : this);
