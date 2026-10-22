const timer = require('./timer');
const { pausedRecovery } = require('./timer-store');

// Owns the asynchronous write boundary as well as the timer state. While a
// submission is pending, every transition is refused so its eventual result
// cannot overwrite a newer timer or create a duplicate time entry.
function createTimerController({ submit, now = Date.now, persist = () => {}, getConnectionScope = () => '' }) {
  let state = timer.initialTimerState();
  let submitting = false;
  let connectionScope = '';
  let uncertainSubmission = false;
  function save(next = state, scope = connectionScope, uncertain = uncertainSubmission) {
    persist({ version: 1, state: next, connectionScope: scope, savedAt: now(), submissionPending: submitting || uncertain });
  }
  function assertAvailable() {
    if (submitting) throw new Error('Time entry submission is in progress');
  }
  function assertCertain(action) {
    if (uncertainSubmission && action !== timer.cancel) throw new Error('Reconcile or discard the uncertain time entry first');
  }
  function transition(action, ...args) {
    assertAvailable();
    assertCertain(action);
    const next = action(state, ...args);
    const scope = next.status === 'idle' ? '' : (state.status === 'idle' ? getConnectionScope() : connectionScope);
    const uncertain = next.status === 'idle' ? false : uncertainSubmission;
    save(next, scope, uncertain);
    state = next;
    uncertainSubmission = uncertain;
    connectionScope = scope;
    return state;
  }
  return {
    getState: () => state,
    isSubmitting: () => submitting,
    getUncertainSnapshot: () => uncertainSubmission ? { version: 1, state, connectionScope, savedAt: now(), submissionPending: true } : null,
    reconcileUncertain() {
      assertAvailable();
      if (!uncertainSubmission) throw new Error('No uncertain time entry to reconcile');
      const next = state.status === 'running' ? timer.pause(state, now()) : state;
      save(next, connectionScope, false);
      state = next;
      uncertainSubmission = false;
      return state;
    },
    checkpoint() { if (state.status !== 'idle') save(); },
    restore(snapshot, { acknowledgePending = false } = {}) {
      assertAvailable();
      if (state.status !== 'idle') throw new Error('A timer is already active');
      if (snapshot.connectionScope !== getConnectionScope()) throw new Error('Saved timer belongs to another Redmine account');
      if (snapshot.submissionPending && !acknowledgePending) throw new Error('Check Redmine before recovering an uncertain submission');
      const recovered = pausedRecovery(snapshot);
      save(recovered, snapshot.connectionScope, false);
      state = recovered;
      uncertainSubmission = false;
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
      assertCertain();
      if (connectionScope !== getConnectionScope()) throw new Error('Timer belongs to another Redmine account');
      const { state: completed, submission } = timer.complete(state, now());
      const hours = timer.msToHours(submission.elapsedMs);
      submitting = true;
      let submitted = false;
      let requestStarted = false;
      try {
        save();
        requestStarted = true;
        uncertainSubmission = true;
        await submit(submission.ticketId, { ...entry, hours });
        submitted = true;
        uncertainSubmission = false;
        state = completed;
        connectionScope = '';
        submitting = false;
        try { save(); } catch (err) {
          throw new Error(`Time was logged, but the saved timer could not be cleared. Check Redmine before recovery: ${err.message}`, { cause: err });
        }
        return { state, hours };
      } finally {
        submitting = false;
        if (!submitted && !requestStarted) save();
      }
    },
  };
}

module.exports = { createTimerController };
