const fs = require('fs');
const { writeJsonAtomic } = require('./atomic-json');
const timer = require('./timer');

function isTimerSnapshot(value) {
  const state = value?.state;
  if (value?.version !== 1 || !Number.isFinite(value.savedAt) || typeof value.connectionScope !== 'string' || typeof value.submissionPending !== 'boolean' || !state) return false;
  if (state.status === 'idle') return true;
  return ['running', 'paused'].includes(state.status)
    && Number.isInteger(state.ticketId) && state.ticketId > 0
    && typeof state.subject === 'string'
    && Number.isFinite(state.elapsedMs) && state.elapsedMs >= 0
    && (state.status !== 'running' || Number.isFinite(state.runningSince));
}

function pausedRecovery(snapshot) {
  if (!isTimerSnapshot(snapshot) || snapshot.state.status === 'idle') throw new Error('No recoverable timer');
  const state = snapshot.state;
  const elapsedMs = state.status === 'running'
    ? state.elapsedMs + Math.max(0, snapshot.savedAt - state.runningSince)
    : state.elapsedMs;
  return { ...state, status: 'paused', elapsedMs, runningSince: null };
}

function createTimerStore(file) {
  return {
    load() {
      if (!fs.existsSync(file)) return null;
      try {
        const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
        return isTimerSnapshot(snapshot) && snapshot.state.status !== 'idle' ? snapshot : null;
      } catch (err) {
        console.error('Could not read saved timer:', err.message);
        return null;
      }
    },
    save: (snapshot) => writeJsonAtomic(file, snapshot),
    clear() {
      writeJsonAtomic(file, { version: 1, savedAt: Date.now(), connectionScope: '', state: timer.initialTimerState(), submissionPending: false });
    },
  };
}

module.exports = { createTimerStore, isTimerSnapshot, pausedRecovery };
