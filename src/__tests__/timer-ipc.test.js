import { describe, it, expect, vi } from 'vitest';
import { createTimerController } from '../timer-controller';
import { registerTimerIpc } from '../timer-ipc';

describe('timer IPC contract', () => {
  it('serializes writes and reports pending transition errors through the public response shape', async () => {
    let finish;
    const submit = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const controller = createTimerController({ submit, now: () => 1000 });
    const handlers = new Map();
    const broadcast = vi.fn();
    registerTimerIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, controller, recovery: { hasPending: () => false }, broadcast });
    const invoke = (action, payload) => handlers.get(`timer-${action}`)(null, payload);
    expect((await invoke('start', { ticketId: 42, subject: 'Work' })).state.ticketId).toBe(42);
    const first = invoke('complete', { activityId: 1 });
    await expect(invoke('complete', { activityId: 1 })).resolves.toEqual({ error: expect.stringMatching(/in progress/) });
    await expect(invoke('cancel')).resolves.toEqual({ error: expect.stringMatching(/in progress/) });
    expect(submit).toHaveBeenCalledTimes(1);
    finish();
    await expect(first).resolves.toMatchObject({ ok: true, state: { status: 'idle' } });
    expect(broadcast).toHaveBeenCalled();
  });
  it('blocks new timers until saved work is resolved and exposes recovery state', async () => {
    const handlers = new Map();
    const controller = createTimerController({ submit: vi.fn() });
    const recovery = { hasPending: () => true, offer: vi.fn(async () => {}) };
    registerTimerIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, controller, recovery, broadcast: vi.fn() });
    await expect(handlers.get('timer-start')(null, { ticketId: 1 })).resolves.toMatchObject({ error: expect.stringMatching(/saved timer/) });
    await expect(handlers.get('timer-recover')()).resolves.toMatchObject({ ok: true, hadPending: true, state: { status: 'idle' } });
    expect(recovery.offer).toHaveBeenCalledTimes(1);
  });
});
