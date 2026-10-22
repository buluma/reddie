import { describe, it, expect, vi } from 'vitest';
import { createTimerController } from '../timer-controller';

function setup() {
  let resolve, reject;
  const submit = vi.fn(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  const controller = createTimerController({ submit, now: () => 3600000 });
  controller.start({ ticketId: 42, subject: 'Work' });
  return { controller, submit, resolve: () => resolve(), reject: () => reject(new Error('offline')) };
}

describe('timer submission boundary', () => {
  it('submits once and refuses duplicate completion and all transitions until settled', async () => {
    const { controller, submit, resolve } = setup();
    const completion = controller.complete({ activityId: 1 });
    await expect(controller.complete({ activityId: 1 })).rejects.toThrow(/in progress/);
    for (const action of ['start', 'pause', 'reset', 'cancel']) {
      expect(() => controller[action]({ ticketId: 99 })).toThrow(/in progress/);
    }
    expect(submit).toHaveBeenCalledTimes(1);
    resolve();
    await completion;
    expect(controller.getState().status).toBe('idle');
    controller.start({ ticketId: 99 });
    expect(controller.getState().ticketId).toBe(99);
  });

  it('preserves time after a failed write and allows an explicit retry', async () => {
    const { controller, submit, reject, resolve } = setup();
    const before = controller.getState();
    const completion = controller.complete({ activityId: 1 });
    reject();
    await expect(completion).rejects.toThrow('offline');
    expect(controller.getState()).toEqual(before);
    expect(controller.isSubmitting()).toBe(false);
    const retry = controller.complete({ activityId: 1 });
    resolve();
    await retry;
    expect(submit).toHaveBeenCalledTimes(2);
    expect(controller.getState().status).toBe('idle');
  });
});
