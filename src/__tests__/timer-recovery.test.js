import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createTimerController } from '../timer-controller';
import { createTimerStore } from '../timer-store';
import { createTimerRecovery } from '../timer-recovery';

const directories = [];
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reddie-timer-'));
  directories.push(dir);
  const file = path.join(dir, 'timer.json');
  const store = createTimerStore(file);
  let clock = 1000;
  const submit = vi.fn(async () => {});
  const options = { submit, persist: store.save, getConnectionScope: () => 'server|1', now: () => clock };
  const controller = createTimerController(options);
  return { file, store, options, controller, submit, at: value => { clock = value; } };
}

describe('durable timer recovery', () => {
  it('recovers a running checkpoint as paused without counting downtime', async () => {
    const s = setup();
    s.controller.start({ ticketId: 42, subject: 'Work' });
    s.at(61000); s.controller.checkpoint();
    const snapshot = s.store.load();
    s.at(3600000);
    const restarted = createTimerController(s.options);
    const recovery = createTimerRecovery({ store: s.store, controller: restarted, getScope: s.options.getConnectionScope, choose: async () => 'recover' });
    await recovery.offer();
    expect(restarted.getState()).toEqual({ status: 'paused', ticketId: 42, subject: 'Work', elapsedMs: 60000, runningSince: null });
    expect(recovery.hasPending()).toBe(false);
    expect(snapshot.connectionScope).toBe('server|1');
    expect(s.submit).not.toHaveBeenCalled();
  });
  it('retains paused elapsed time and clears saved work only on explicit discard', async () => {
    const s = setup();
    s.controller.start({ ticketId: 42, subject: 'Work' });
    s.at(31000); s.controller.pause();
    const choose = vi.fn().mockResolvedValueOnce('keep').mockResolvedValueOnce('discard');
    const recovery = createTimerRecovery({ store: s.store, controller: createTimerController(s.options), getScope: s.options.getConnectionScope, choose });
    await recovery.offer();
    expect(s.store.load().state.elapsedMs).toBe(30000);
    expect(recovery.hasPending()).toBe(true);
    await recovery.offer();
    expect(s.store.load()).toBeNull();
  });
  it('never recovers a timer under a different account', async () => {
    const s = setup();
    s.controller.start({ ticketId: 42, subject: 'Work' });
    const restarted = createTimerController({ ...s.options, getConnectionScope: () => 'server|2' });
    const recovery = createTimerRecovery({ store: s.store, controller: restarted, getScope: () => 'server|2', choose: async ({ matches }) => { expect(matches).toBe(false); return 'recover'; } });
    await recovery.offer();
    expect(recovery.hasPending()).toBe(true);
    expect(restarted.getState().status).toBe('idle');
  });
  it('marks in-flight submissions for reconciliation and never resubmits on restart', async () => {
    const s = setup();
    let finish;
    const submitting = createTimerController({ ...s.options, submit: () => new Promise(resolve => { finish = resolve; }) });
    submitting.start({ ticketId: 42, subject: 'Work' });
    s.at(61000);
    const completion = submitting.complete({ activityId: 1 });
    const snapshot = s.store.load();
    expect(snapshot.submissionPending).toBe(true);
    const restarted = createTimerController(s.options);
    expect(() => restarted.restore(snapshot)).toThrow(/Check Redmine/);
    expect(s.submit).not.toHaveBeenCalled();
    finish(); await completion;
    expect(s.store.load()).toBeNull();
  });
  it('preserves reconciliation state when a submission rejects', async () => {
    const s = setup();
    const uncertainController = createTimerController({ ...s.options, submit: vi.fn(async () => { throw new Error('connection lost'); }) });
    uncertainController.start({ ticketId: 42, subject: 'Work' });
    s.at(61000);
    await expect(uncertainController.complete()).rejects.toThrow('connection lost');
    expect(s.store.load().submissionPending).toBe(true);
    const restarted = createTimerController(s.options);
    const recovery = createTimerRecovery({ store: s.store, controller: restarted, getScope: s.options.getConnectionScope, choose: async ({ snapshot }) => snapshot.submissionPending ? 'keep' : 'recover' });
    await recovery.offer();
    expect(recovery.hasPending()).toBe(true);
    expect(restarted.getState().status).toBe('idle');
  });
  it('does not change memory or submit a write if the initial durable save fails', async () => {
    const controller = createTimerController({ submit: vi.fn(), persist: () => { throw new Error('disk full'); } });
    expect(() => controller.start({ ticketId: 42, subject: 'Work' })).toThrow('disk full');
    expect(controller.getState().status).toBe('idle');
  });
  it('keeps memory idle if Redmine succeeds but clearing the saved record fails', async () => {
    const s = setup();
    const controller = createTimerController({ ...s.options, persist: snapshot => {
      if (snapshot.state.status === 'idle') throw new Error('disk full');
      s.store.save(snapshot);
    } });
    controller.start({ ticketId: 42, subject: 'Work' });
    s.at(61000);
    await expect(controller.complete()).rejects.toThrow(/Time was logged/);
    expect(controller.getState().status).toBe('idle');
    expect(s.store.load().submissionPending).toBe(true);
    expect(s.submit).toHaveBeenCalledTimes(1);
    await expect(controller.complete()).rejects.toThrow();
    expect(s.submit).toHaveBeenCalledTimes(1);
  });
  it('preserves rejected-submission uncertainty across checkpoints and blocks timer transitions', async () => {
    const s = setup();
    const controller = createTimerController({ ...s.options, submit: async () => { throw new Error('Response lost'); } });
    controller.start({ ticketId: 42, subject: 'Work' });
    s.at(61000);
    await expect(controller.complete()).rejects.toThrow('Response lost');
    controller.checkpoint();
    expect(s.store.load().submissionPending).toBe(true);
    expect(() => controller.pause()).toThrow(/Reconcile or discard/);
    expect(s.store.load().submissionPending).toBe(true);
    expect(() => controller.start({ ticketId: 42, subject: 'Work' })).toThrow(/Reconcile or discard/);
    controller.checkpoint();
    const snapshot = s.store.load();
    expect(snapshot.submissionPending).toBe(true);
    const restarted = createTimerController(s.options);
    expect(() => restarted.restore(snapshot)).toThrow(/Check Redmine/);
    controller.cancel();
    expect(s.store.load()).toBeNull();
  });
  it('offers in-session uncertainty for reconciliation without resubmitting', async () => {
    const s = setup();
    const controller = createTimerController({ ...s.options, submit: async () => { throw new Error('Response lost'); } });
    controller.start({ ticketId: 42, subject: 'Work' });
    s.at(61000);
    await expect(controller.complete()).rejects.toThrow('Response lost');
    const recovery = createTimerRecovery({ store: s.store, controller, getScope: s.options.getConnectionScope, choose: async ({ snapshot }) => snapshot.submissionPending ? 'recover' : 'keep' });
    expect(recovery.hasPending()).toBe(true);
    await recovery.offer();
    expect(controller.getState().status).toBe('paused');
    expect(controller.getUncertainSnapshot()).toBeNull();
    expect(recovery.hasPending()).toBe(false);
  });
  it('ignores corrupt persisted data without crashing startup', () => {
    const s = setup();
    fs.writeFileSync(s.file, '{');
    expect(s.store.load()).toBeNull();
    fs.writeFileSync(s.file, JSON.stringify({ version: 1, savedAt: 1, connectionScope: 'server|1', state: { status: 'running', ticketId: -1 } }));
    expect(s.store.load()).toBeNull();
  });
  it('ignores persisted timers with a non-boolean submission flag', async () => {
    const s = setup();
    fs.writeFileSync(s.file, JSON.stringify({
      version: 1,
      savedAt: 1000,
      connectionScope: 'server|1',
      submissionPending: 'false',
      state: { status: 'paused', ticketId: 42, subject: 'Work', elapsedMs: 0, runningSince: null },
    }));
    const choose = vi.fn();
    const recovery = createTimerRecovery({ store: s.store, controller: createTimerController(s.options), getScope: s.options.getConnectionScope, choose });
    expect(recovery.hasPending()).toBe(false);
    await recovery.offer();
    expect(choose).not.toHaveBeenCalled();
  });
});
