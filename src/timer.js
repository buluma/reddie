// Pure state machine for the per-ticket time tracker (SHA-24). One active
// timer at a time - idle / running / paused. Every transition takes an
// explicit `now` (ms) rather than reading the clock itself, so elapsed-time
// math is fully deterministic in tests; the caller (main.js) supplies
// Date.now(). Shared like urgency.js/text-format.js: CommonJS for the test
// suite, `window.reddieTimer` when loaded as a <script>.
//
// Switching to a different ticket while one is running or paused is a
// deliberately invalid transition (throws) - the UI layer must cancel() or
// complete() the active timer first. That "which do you want?" prompt is a
// product decision, not state-machine logic, so it stays out of this module.
(function (global) {
  'use strict';

  function initialTimerState() {
    return { status: 'idle', ticketId: null, subject: null, elapsedMs: 0, runningSince: null };
  }

  // Elapsed time as of `now`, folding in the live running segment.
  function elapsedMs(state, now) {
    if (state.status === 'running') return state.elapsedMs + (now - state.runningSince);
    return state.elapsedMs;
  }

  function start(state, { ticketId, subject }, now) {
    if (state.status === 'idle') {
      return { status: 'running', ticketId, subject, elapsedMs: 0, runningSince: now };
    }
    if (state.ticketId !== ticketId) {
      throw new Error(`A timer is already active for ticket #${state.ticketId} - complete or cancel it first`);
    }
    if (state.status === 'running') return state; // already running this ticket
    // paused, same ticket: resume
    return { ...state, status: 'running', runningSince: now };
  }

  function pause(state, now) {
    if (state.status === 'idle') throw new Error('No active timer to pause - it is idle');
    if (state.status === 'paused') return state;
    return { ...state, status: 'paused', elapsedMs: elapsedMs(state, now), runningSince: null };
  }

  function reset(state) {
    if (state.status === 'idle') throw new Error('No active timer to reset - it is idle');
    return { status: 'paused', ticketId: state.ticketId, subject: state.subject, elapsedMs: 0, runningSince: null };
  }

  function cancel(state) {
    if (state.status === 'idle') return state;
    return initialTimerState();
  }

  // Returns { state, submission } - `state` is the new (idle) timer state,
  // `submission` is what the caller submits as a Redmine time entry.
  function complete(state, now) {
    if (state.status === 'idle') throw new Error('No active timer to complete - it is idle');
    const submission = { ticketId: state.ticketId, subject: state.subject, elapsedMs: elapsedMs(state, now) };
    return { state: initialTimerState(), submission };
  }

  // Redmine's time_entries.hours must be > 0 - never round a real, nonzero
  // duration down to exactly 0 just because it was under a minute.
  function msToHours(ms) {
    const hours = ms / 3600000;
    const rounded = Math.round(hours * 100) / 100;
    return rounded > 0 || ms <= 0 ? rounded : 0.01;
  }

  function formatElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  const api = { initialTimerState, elapsedMs, start, pause, reset, cancel, complete, msToHours, formatElapsed };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.reddieTimer = api;
  }
})(typeof self !== 'undefined' ? self : this);
