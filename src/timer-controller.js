const timer = require('./timer');
const { pausedRecovery } = require('./timer-store');

// Owns the asynchronous write boundary as well as the timer state. While a
// submission is pending, every transition is refused so its eventual result
// cannot overwrite a newer timer or create a duplicate time entry.
function createTimerController({ submit, now = Date.now, persist = () => {}, getConnectionScope = () => '' }) {
  let state = timer.initialTimerState();
  let submitting = false;
  let connectionScope = '';
  function save(next = state, scope = connectionScope) {
    persist({ version: 1, state: next, connectionScope: scope, savedAt: now(), submissionPending: submitting });
  }
  function assertAvailable() {
    if (submitting) throw new Error('Time entry submission is in progress');
  }
  function transition(action, ...args) {
    assertAvailable();
    const next = action(state, ...args);
    const scope = next.status === 'idle' ? '' : (state.status === 'idle' ? getConnectionScope() : connectionScope);
    save(next, scope);
    state = next;
    connectionScope = scope;
    return state;
  }
  return {
    getState: () => state,
    isSubmitting: () => submitting,
    checkpoint() { if (state.status !== 'idle') save(); },
    restore(snapshot, { acknowledgePending = false } = {}) {
      assertAvailable();
      if (state.status !== 'idle') throw new Error('A timer is already active');
      if (snapshot.connectionScope !== getConnectionScope()) throw new Error('Saved timer belongs to another Redmine account');
      if (snapshot.submissionPending && !acknowledgePending) throw new Error('Check Redmine before recovering an uncertain submission');
      const recovered = pausedRecovery(snapshot);
      save(recovered, snapshot.connectionScope);
      state = recovered;
      connectionScope = snapshot.connectionScope;
      return state;
    },
    start(ticket) {
      const ticketId = Number(ticket.ticketId);
      if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error('Invalid timer ticket id');
      return transition(timer.start, { ticketId, subject: String(ticket.subject || `Issue #${ticketId}`) }, now());
    },
    pause: () => transition(timer.pause, now()),
    reset: () => transition(timer.reset),
    cancel: () => transition(timer.cancel),
    async complete(entry = {}) {
      assertAvailable();
      if (connectionScope !== getConnectionScope()) throw new Error('Timer belongs to another Redmine account');
      const { state: completed, submission } = timer.complete(state, now());
      const hours = timer.msToHours(submission.elapsedMs);
      submitting = true;
      let submitted = false;
      try {
        save();
        await submit(submission.ticketId, { ...entry, hours });
        submitted = true;
        state = completed;
        connectionScope = '';
        submitting = false;
        try { save(); } catch (err) {
          throw new Error(`Time was logged, but the saved timer could not be cleared. Check Redmine before recovery: ${err.message}`, { cause: err });
        }
        return { state, hours };
      } finally {
        submitting = false;
        if (!submitted) save();
      }
    },
  };
}

module.exports = { createTimerController };
