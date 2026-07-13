// Pure tray-urgency classification, shared by the renderer (loaded as a
// plain <script> exposing `window.reddieUrgency`) and the test suite
// (required as a CommonJS module). No DOM, no Electron, no I/O - so the
// classification logic can be unit tested the same way buildColumnMapping/
// classifyStatus are, instead of only being exercised by hand through the
// live tray.
//
// Level heuristic is name-first, position-second:
//   1. If the priority NAME matches known English keywords, use that - this
//      keeps a standard Redmine instance behaving exactly as before (High/
//      Urgent/Immediate -> high, Normal/Medium -> medium, Low/Minor -> low).
//   2. Otherwise (localized or custom-named priorities that match nothing),
//      fall back to the priority's POSITION in Redmine's ordered scale,
//      which is language-independent: the enumerations endpoint returns
//      priorities least-urgent-first, so a higher index means more urgent.
//      Top third of the scale -> high, bottom third -> low.
// The old name-only heuristic silently classified every non-English priority
// as 'low'; the position fallback fixes that without regressing the common
// case.
(function (global) {
  'use strict';

  const RANK = { high: 0, medium: 1, low: 2 };

  function issueUrgencyLevel(issue, priorities = []) {
    const name = (issue && issue.priority && issue.priority.name) || '';
    if (/urgent|high|immediate/i.test(name)) return 'high';
    if (/medium|normal/i.test(name)) return 'medium';
    if (/low|minor|trivial/i.test(name)) return 'low';

    // Name matched no known keyword - use the priority's rank within the
    // ordered scale instead. Unknown priority (not in the list, or no list
    // loaded yet) is treated as lowest so it never over-alerts.
    const priorityId = issue && issue.priority && issue.priority.id;
    const idx = priorityId != null ? priorities.findIndex((p) => p.id === priorityId) : -1;
    if (idx < 0 || priorities.length === 0) return 'low';
    const frac = priorities.length === 1 ? 1 : idx / (priorities.length - 1);
    if (frac >= 2 / 3) return 'high';
    if (frac >= 1 / 3) return 'medium';
    return 'low';
  }

  // Numeric rank for sorting (most-urgent-first): high < medium < low.
  function issueUrgencyRank(issue, priorities = []) {
    return RANK[issueUrgencyLevel(issue, priorities)];
  }

  // The single worst urgency across a set of issues - drives the tray icon
  // color. An empty set returns 'low'; callers map a zero count to the
  // neutral 'none' variant separately (see updateTrayAppearance in main.js).
  function classifyTrayUrgency(issues = [], priorities = []) {
    let best = 'low';
    for (const issue of issues) {
      const level = issueUrgencyLevel(issue, priorities);
      if (RANK[level] < RANK[best]) best = level;
    }
    return best;
  }

  const api = { issueUrgencyLevel, issueUrgencyRank, classifyTrayUrgency };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.reddieUrgency = api;
  }
})(typeof self !== 'undefined' ? self : this);
