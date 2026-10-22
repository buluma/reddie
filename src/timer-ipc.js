function registerTimerIpc({ ipcMain, controller, recovery, broadcast }) {
  ipcMain.handle('timer-get-state', async () => controller.getState());
  ipcMain.handle('timer-recover', async () => {
    try {
      const hadPending = recovery.hasPending();
      await recovery.offer();
      broadcast();
      return { ok: true, hadPending, state: controller.getState() };
    } catch (error) {
      return { error: error.message };
    }
  });
  for (const action of ['start', 'pause', 'reset', 'cancel', 'complete']) {
    ipcMain.handle(`timer-${action}`, async (event, payload = {}) => {
      try {
        if (action === 'start' && recovery.hasPending()) throw new Error('Recover or discard the saved timer in Settings before starting another');
        const result = action === 'complete'
          ? await controller.complete(payload)
          : { state: controller[action](payload) };
        broadcast();
        return { ok: true, ...result };
      } catch (error) {
        broadcast();
        return { error: error.message };
      }
    });
  }
}

module.exports = { registerTimerIpc };
