const timer = require('./timer');

// Owns the asynchronous write boundary as well as the timer state. While a
// submission is pending, every transition is refused so its eventual result
// cannot overwrite a newer timer or create a duplicate time entry.
function createTimerController({ submit, now = Date.now }) {
  let state = timer.initialTimerState();
  let submitting = false;
  function assertAvailable() {
    if (submitting) throw new Error('Time entry submission is in progress');
  }
  function transition(action, ...args) {
    assertAvailable();
    state = action(state, ...args);
    return state;
  }
  return {
    getState: () => state,
    isSubmitting: () => submitting,
    start: (ticket) => transition(timer.start, ticket, now()),
    pause: () => transition(timer.pause, now()),
    reset: () => transition(timer.reset),
    cancel: () => transition(timer.cancel),
    async complete(entry = {}) {
      assertAvailable();
      const { state: completed, submission } = timer.complete(state, now());
      const hours = timer.msToHours(submission.elapsedMs);
      submitting = true;
      try {
        await submit(submission.ticketId, { ...entry, hours });
        state = completed;
        return { state, hours };
      } finally {
        submitting = false;
      }
    },
  };
}

module.exports = { createTimerController };
