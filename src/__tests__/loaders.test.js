import { describe, it, expect, vi } from 'vitest';
import { createBoardLoader, buildBoardState } from '../board-loader';
import { createIssueDetailLoader } from '../issue-detail-loader';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('board loader', () => {
  it('discards obsolete modes, connection scopes, and older same-mode results', async () => {
    let context = { mode: 'assigned', connection: 1 };
    const pending = [];
    const fetch = () => { const request = deferred(); pending.push(request); return request.promise; };
    const onResult = vi.fn();
    const loader = createBoardLoader({ getContext: () => context, fetchIssues: fetch, fetchAuthoredIssues: fetch, onResult, onError: vi.fn() });
    const assigned = loader.load();
    context = { ...context, mode: 'authored' };
    const authored = loader.load();
    pending[1].resolve({ items: [{ id: 2 }] }); await authored;
    pending[0].resolve({ items: [{ id: 1 }] });
    await expect(assigned).resolves.toEqual({ stale: true });
    expect(onResult).toHaveBeenCalledTimes(1);
    const oldScope = loader.load();
    context = { ...context, connection: 2 };
    pending[2].resolve({ items: [{ id: 3 }] });
    await expect(oldScope).resolves.toEqual({ stale: true });
    const old = loader.load(), latest = loader.load();
    pending[4].resolve({ items: [{ id: 5 }] }); await latest;
    pending[3].resolve({ items: [{ id: 4 }] });
    await expect(old).resolves.toEqual({ stale: true });
    expect(onResult.mock.calls.map(([response]) => response.items[0].id)).toEqual([2, 5]);
  });
  it('surfaces current failures and ignores obsolete failures', async () => {
    const requests = [deferred(), deferred()]; let index = 0;
    const onError = vi.fn();
    const loader = createBoardLoader({ getContext: () => ({ mode: 'assigned', connection: 1 }), fetchIssues: () => requests[index++].promise, onResult: vi.fn(), onError });
    const first = loader.load(), second = loader.load();
    requests[0].reject(new Error('old')); await first;
    requests[1].reject(new Error('offline')); await second;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('offline');
  });
  it('rebuilds remote state while preserving scratch cards in their columns', () => {
    const scratch = { id: 'local', content: 'Personal', issueId: null };
    const result = buildBoardState([{ id: 2, subject: 'Done', status: { done: true } }], { todo: [scratch, { id: 'old', issueId: 1 }] }, status => status.done ? 'done' : 'backlog');
    expect(result.mergedState.todo).toEqual([scratch]);
    expect(result.mergedState.done[0].issueId).toBe(2);
    expect(result.unfinished).toEqual([]);
  });
});

describe('issue detail loader', () => {
  it('discards detail and metadata after navigation, and invalidates closed views', async () => {
    const details = [deferred(), deferred()];
    const members = deferred(); let index = 0;
    const onLoad = vi.fn(), onError = vi.fn();
    const loader = createIssueDetailLoader({ api: {
      fetchIssueDetail: () => details[index++].promise,
      fetchProjectMembers: () => members.promise,
      fetchProjectTrackers: async () => ({ items: [] }), fetchProjectCategories: async () => ({ items: [] }), fetchProjectVersions: async () => ({ items: [] }),
    }, onStart: vi.fn(), onLoad, onError });
    const old = loader.load(1);
    details[0].resolve({ issue: { id: 1, project: { id: 10 } } });
    await Promise.resolve();
    const latest = loader.load(2);
    details[1].resolve({ issue: { id: 2 } }); await latest;
    members.resolve({ items: [{ id: 3, name: 'Old member' }] });
    await expect(old).resolves.toEqual({ stale: true });
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0][0].issue.id).toBe(2);
    const captured = loader.capture(); loader.invalidate();
    expect(loader.isCurrent(captured)).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });
  it('discards a pending issue when its connection changes without navigation', async () => {
    let connection = 1;
    const response = deferred();
    const onLoad = vi.fn(), onError = vi.fn();
    const loader = createIssueDetailLoader({
      api: { fetchIssueDetail: () => response.promise }, getConnection: () => connection,
      onStart: vi.fn(), onLoad, onError,
    });
    const loading = loader.load(42);
    const mutationContext = loader.capture();
    connection = 2;
    response.resolve({ issue: { id: 42, subject: 'Old account' } });
    await expect(loading).resolves.toEqual({ stale: true });
    expect(loader.isCurrent(mutationContext)).toBe(false);
    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
  it('reports current load failures without throwing into the UI event handler', async () => {
    const onError = vi.fn();
    const loader = createIssueDetailLoader({ api: { fetchIssueDetail: async () => ({ error: 'Denied' }) }, onStart: vi.fn(), onLoad: vi.fn(), onError });
    await expect(loader.load(1)).resolves.toEqual({ error: 'Denied' });
    expect(onError.mock.calls[0][0].message).toBe('Denied');
  });
});
