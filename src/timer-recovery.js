// Recovery never submits time. A possibly completed submission requires a
// deliberate reconciliation choice; a mismatched account keeps the saved
// timer untouched until that account is reconnected or the user discards it.
function createTimerRecovery({ store, controller, getScope, choose }) {
  let pending = store.load();
  let prompting = false;
  return {
    hasPending: () => !!pending,
    async offer() {
      if (!pending || prompting) return;
      prompting = true;
      try {
        const matches = pending.connectionScope === getScope() && !!getScope();
        const decision = await choose({ snapshot: pending, matches });
        if (decision === 'discard') {
          store.clear();
          pending = null;
        } else if (decision === 'recover' && matches) {
          controller.restore(pending, { acknowledgePending: true });
          pending = null;
        }
      } finally {
        prompting = false;
      }
    },
  };
}

module.exports = { createTimerRecovery };
