import { describe, it, expect, vi } from 'vitest';
import { collectAllPages } from '../redmine-client.js';

// collectAllPages is the pure paging loop behind every list endpoint: Redmine
// caps `limit` at 100 per page and reports `total_count`, so anything past the
// first page is silently dropped unless we walk `offset` to the end. The loop
// is decoupled from HTTP via a fetchPage(offset, limit) -> { items, total_count }
// callback so it can be tested without a live instance.

describe('collectAllPages', () => {
  it('walks every page and concatenates in order until total_count is reached', async () => {
    // 150 items across two pages of 100.
    const page1 = Array.from({ length: 100 }, (_, i) => i);
    const page2 = Array.from({ length: 50 }, (_, i) => 100 + i);
    const fetchPage = vi.fn(async (offset) =>
      offset === 0 ? { items: page1, total_count: 150 } : { items: page2, total_count: 150 },
    );

    const all = await collectAllPages(fetchPage, 100);

    expect(all).toHaveLength(150);
    expect(all[0]).toBe(0);
    expect(all[149]).toBe(149);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 100);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 100, 100);
  });

  it('makes only one request when everything fits on the first page', async () => {
    const fetchPage = vi.fn(async () => ({ items: [1, 2, 3], total_count: 3 }));
    const all = await collectAllPages(fetchPage, 100);
    expect(all).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('stops on a short page even when total_count is missing (never trusts a full page as the end)', async () => {
    // No total_count in the response - the loop must keep going while pages
    // come back full and stop only when one comes back short.
    const page1 = Array.from({ length: 100 }, (_, i) => i);
    const fetchPage = vi.fn(async (offset) =>
      offset === 0 ? { items: page1 } : { items: [100, 101] },
    );
    const all = await collectAllPages(fetchPage, 100);
    expect(all).toHaveLength(102);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('handles an empty result set', async () => {
    const fetchPage = vi.fn(async () => ({ items: [], total_count: 0 }));
    const all = await collectAllPages(fetchPage, 100);
    expect(all).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('does not loop forever if the server keeps claiming there is more than it returns', async () => {
    // Pathological server: always full page, total_count always huge. The
    // iteration cap must bound this rather than hang the board load.
    const page = Array.from({ length: 100 }, (_, i) => i);
    const fetchPage = vi.fn(async () => ({ items: page, total_count: 10 ** 9 }));
    const all = await collectAllPages(fetchPage, 100);
    expect(fetchPage.mock.calls.length).toBeLessThanOrEqual(1000);
    expect(all.length).toBeGreaterThan(0);
  });
});
