import { describe, it, expect } from 'vitest';
import { initialTimerState, start, pause, reset, cancel, complete, elapsedMs, msToHours, formatElapsed } from '../timer.js';

// Pure state machine for the per-ticket time tracker. One active timer at a
// time (idle/running/paused). All transitions take an explicit `now` so
// elapsed-time math never depends on wall-clock during tests.

describe('initialTimerState', () => {
  it('starts idle with no ticket and zero elapsed', () => {
    expect(initialTimerState()).toEqual({
      status: 'idle', ticketId: null, subject: null, elapsedMs: 0, runningSince: null,
    });
  });
});

describe('start', () => {
  it('starts a new timer from idle', () => {
    const s = start(initialTimerState(), { ticketId: 42, subject: 'Fix bug' }, 1000);
    expect(s).toEqual({ status: 'running', ticketId: 42, subject: 'Fix bug', elapsedMs: 0, runningSince: 1000 });
  });

  it('resumes a paused timer for the same ticket, preserving elapsed', () => {
    const paused = { status: 'paused', ticketId: 42, subject: 'Fix bug', elapsedMs: 5000, runningSince: null };
    const s = start(paused, { ticketId: 42, subject: 'Fix bug' }, 9000);
    expect(s).toEqual({ status: 'running', ticketId: 42, subject: 'Fix bug', elapsedMs: 5000, runningSince: 9000 });
  });

  it('is a no-op when starting the ticket that is already running', () => {
    const running = { status: 'running', ticketId: 42, subject: 'x', elapsedMs: 0, runningSince: 1000 };
    expect(start(running, { ticketId: 42, subject: 'x' }, 5000)).toBe(running);
  });

  it('throws when starting a different ticket while one is running', () => {
    const running = { status: 'running', ticketId: 42, subject: 'x', elapsedMs: 0, runningSince: 1000 };
    expect(() => start(running, { ticketId: 99, subject: 'y' }, 2000)).toThrow(/already/i);
  });

  it('throws when starting a different ticket while one is paused', () => {
    const paused = { status: 'paused', ticketId: 42, subject: 'x', elapsedMs: 5000, runningSince: null };
    expect(() => start(paused, { ticketId: 99, subject: 'y' }, 2000)).toThrow(/already/i);
  });
});

describe('pause', () => {
  it('freezes elapsed time when pausing a running timer', () => {
    const running = { status: 'running', ticketId: 42, subject: 'x', elapsedMs: 1000, runningSince: 5000 };
    const s = pause(running, 8000);
    expect(s).toEqual({ status: 'paused', ticketId: 42, subject: 'x', elapsedMs: 4000, runningSince: null });
  });

  it('is a no-op when already paused', () => {
    const paused = { status: 'paused', ticketId: 42, subject: 'x', elapsedMs: 4000, runningSince: null };
    expect(pause(paused, 9000)).toBe(paused);
  });

  it('throws when pausing from idle', () => {
    expect(() => pause(initialTimerState(), 1000)).toThrow(/idle|nothing/i);
  });
});

describe('reset', () => {
  it('zeroes elapsed and stops, keeping the ticket', () => {
    const running = { status: 'running', ticketId: 42, subject: 'x', elapsedMs: 1000, runningSince: 5000 };
    const s = reset(running);
    expect(s).toEqual({ status: 'paused', ticketId: 42, subject: 'x', elapsedMs: 0, runningSince: null });
  });

  it('zeroes elapsed from a paused timer too', () => {
    const paused = { status: 'paused', ticketId: 42, subject: 'x', elapsedMs: 4000, runningSince: null };
    expect(reset(paused)).toEqual({ status: 'paused', ticketId: 42, subject: 'x', elapsedMs: 0, runningSince: null });
  });

  it('throws when resetting from idle', () => {
    expect(() => reset(initialTimerState())).toThrow(/idle|nothing/i);
  });
});

describe('cancel', () => {
  it('discards a running timer back to idle', () => {
    const running = { status: 'running', ticketId: 42, subject: 'x', elapsedMs: 1000, runningSince: 5000 };
    expect(cancel(running)).toEqual(initialTimerState());
  });

  it('discards a paused timer back to idle', () => {
    const paused = { status: 'paused', ticketId: 42, subject: 'x', elapsedMs: 4000, runningSince: null };
    expect(cancel(paused)).toEqual(initialTimerState());
  });

  it('is a no-op when already idle', () => {
    const idle = initialTimerState();
    expect(cancel(idle)).toBe(idle);
  });
});

describe('complete', () => {
  it('submits the final elapsed time from a running timer and returns to idle', () => {
    const running = { status: 'running', ticketId: 42, subject: 'Fix bug', elapsedMs: 1000, runningSince: 5000 };
    const { state, submission } = complete(running, 9000);
    expect(state).toEqual(initialTimerState());
    expect(submission).toEqual({ ticketId: 42, subject: 'Fix bug', elapsedMs: 5000 });
  });

  it('submits the frozen elapsed time from a paused timer', () => {
    const paused = { status: 'paused', ticketId: 42, subject: 'Fix bug', elapsedMs: 4000, runningSince: null };
    const { state, submission } = complete(paused, 99999);
    expect(state).toEqual(initialTimerState());
    expect(submission).toEqual({ ticketId: 42, subject: 'Fix bug', elapsedMs: 4000 });
  });

  it('throws when completing from idle', () => {
    expect(() => complete(initialTimerState(), 1000)).toThrow(/idle|nothing/i);
  });
});

describe('elapsedMs', () => {
  it('adds the live running segment to the frozen elapsed', () => {
    const running = { status: 'running', ticketId: 1, subject: 'x', elapsedMs: 2000, runningSince: 5000 };
    expect(elapsedMs(running, 8000)).toBe(5000);
  });

  it('returns the frozen elapsed as-is when paused', () => {
    const paused = { status: 'paused', ticketId: 1, subject: 'x', elapsedMs: 4000, runningSince: null };
    expect(elapsedMs(paused, 99999)).toBe(4000);
  });

  it('is zero when idle', () => {
    expect(elapsedMs(initialTimerState(), 12345)).toBe(0);
  });
});

describe('msToHours', () => {
  it('converts milliseconds to hours rounded to 2 decimal places', () => {
    expect(msToHours(3600000)).toBe(1);
    expect(msToHours(1800000)).toBe(0.5);
    expect(msToHours(90000)).toBe(0.03); // 25s -> 0.025h rounds to 0.03
  });

  it('never rounds a nonzero duration down to 0 (Redmine rejects a 0-hour entry)', () => {
    expect(msToHours(1000)).toBeGreaterThan(0);
    expect(msToHours(1)).toBeGreaterThan(0);
  });
});

describe('formatElapsed', () => {
  it('formats sub-hour durations as M:SS', () => {
    expect(formatElapsed(65000)).toBe('1:05');
    expect(formatElapsed(5000)).toBe('0:05');
  });

  it('formats durations an hour or longer as H:MM:SS', () => {
    expect(formatElapsed(3661000)).toBe('1:01:01');
    expect(formatElapsed(3600000)).toBe('1:00:00');
  });

  it('formats zero', () => {
    expect(formatElapsed(0)).toBe('0:00');
  });
});
