// Recovery never submits time. A possibly completed submission requires a
// deliberate reconciliation choice; a mismatched account keeps the saved
// timer untouched until that account is reconnected or the user discards it.
function createTimerRecovery({ store, controller, getScope, choose }) {
  let pending = store.load();
  let prompting = false;
  function currentPending() {
    return controller.getUncertainSnapshot?.() || pending;
  }
  return {
    hasPending: () => !!currentPending(),
    async offer() {
      const candidate = currentPending();
      if (!candidate || prompting) return;
      prompting = true;
      try {
        const inSession = !!controller.getUncertainSnapshot?.();
        const matches = candidate.connectionScope === getScope() && !!getScope();
        const decision = await choose({ snapshot: candidate, matches, inSession });
        if (decision === 'discard') {
          if (controller.getUncertainSnapshot?.()) controller.cancel();
          else store.clear();
          pending = null;
        } else if (decision === 'recover' && matches) {
          if (controller.getUncertainSnapshot?.()) controller.reconcileUncertain();
          else controller.restore(candidate, { acknowledgePending: true });
          pending = null;
        }
      } finally {
        prompting = false;
      }
    },
  };
}

module.exports = { createTimerRecovery };
