import { describe, it, expect, vi } from 'vitest';
import { createConnectionManager } from '../connection-manager';

function setup(options = {}) {
  const persist = vi.fn();
  const clients = new Map();
  const manager = createConnectionManager({
    initialConfig: { redmineBaseUrl: 'https://old.example', redmineApiKey: 'old', textFormat: 'auto' },
    createClient: ({ redmineApiKey }) => {
      if (!clients.has(redmineApiKey)) clients.set(redmineApiKey, {
        getCurrentUser: vi.fn(async () => ({ id: 1 })),
        listStatuses: async () => [{ id: 1, name: 'New' }],
        listActivities: async () => [], listPriorities: async () => [],
      });
      return clients.get(redmineApiKey);
    }, persist, ...options,
  });
  return { manager, persist, clients };
}

describe('connection transactions', () => {
  it('leaves configuration, client and metadata intact after candidate validation fails', async () => {
    const { manager, clients, persist } = setup();
    await manager.check();
    const original = manager.getState();
    clients.set('bad', { ...original.client, getCurrentUser: async () => { throw new Error('Unauthorized'); } });
    await expect(manager.save({ redmineApiKey: 'bad' })).rejects.toThrow('Unauthorized');
    expect(manager.getState()).toBe(original);
    expect(persist).not.toHaveBeenCalled();
  });
  it('commits normalized credentials and metadata only after successful persistence', async () => {
    const { manager, persist } = setup();
    const result = await manager.save({ redmineBaseUrl: ' https://new.example/ ', redmineApiKey: ' new ' });
    expect(result.scopeChanged).toBe(true);
    expect(manager.getState().scope).toBe('https://new.example|1');
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ redmineApiKey: 'new', redmineBaseUrl: 'https://new.example' }));
  });
  it('does not activate a candidate if disk persistence fails', async () => {
    const { manager } = setup({ persist: () => { throw new Error('Disk full'); } });
    const original = manager.getState();
    await expect(manager.save({ redmineApiKey: 'new' })).rejects.toThrow('Disk full');
    expect(manager.getState()).toBe(original);
  });
  it('rejects malformed metadata without persisting or replacing the active connection', async () => {
    const { manager, persist, clients } = setup();
    await manager.check();
    const original = manager.getState();
    clients.set('bad-metadata', {
      ...original.client,
      listStatuses: async () => null,
    });
    await expect(manager.save({ redmineApiKey: 'bad-metadata' })).rejects.toThrow(/metadata/);
    expect(manager.getState()).toBe(original);
    expect(persist).not.toHaveBeenCalled();
  });
  it('refuses switching with an active timer and preserves the original connection', async () => {
    const { manager, persist } = setup({ beforeCommit: (next, prev) => {
      if (next.scope !== prev.scope) throw new Error('Complete or cancel the active timer');
    } });
    await manager.check();
    const original = manager.getState();
    await expect(manager.save({ redmineBaseUrl: 'https://new.example' })).rejects.toThrow(/active timer/);
    expect(manager.getState()).toBe(original);
    expect(persist).not.toHaveBeenCalled();
  });
  it('serializes concurrent saves and preference writes while probing', async () => {
    const { manager, clients } = setup();
    let release;
    clients.set('slow', { ...manager.getState().client, getCurrentUser: () => new Promise(resolve => { release = resolve; }) });
    const save = manager.save({ redmineApiKey: 'slow' });
    await expect(manager.save({ redmineApiKey: 'new' })).rejects.toThrow(/already/);
    expect(() => manager.updatePreferences({ textFormat: 'textile' })).toThrow(/Wait/);
    release({ id: 2 });
    await save;
    expect(manager.getState().scope).toBe('https://old.example|2');
  });
  it('allows simultaneous checks of the same unchanged connection', async () => {
    const { manager } = setup();
    const results = await Promise.all([manager.check(), manager.check()]);
    expect(results.every(r => r.ok)).toBe(true);
  });
  it('rejects unsafe URL schemes before making a request', async () => {
    const { manager } = setup();
    await expect(manager.save({ redmineBaseUrl: 'file:///tmp/test' })).rejects.toThrow(/HTTP/);
  });
});
