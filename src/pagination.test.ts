import { describe, expect, it, vi } from 'vitest';

import { SdkAbortError, SdkConfigurationError } from './errors.js';
import { collectSdkPages, paginateSdk } from './pagination.js';

describe('bounded SDK pagination', () => {
  it('iterates and collects cursor pages within explicit page and item bounds', async () => {
    const fetchPage = vi.fn((cursor: string | undefined) =>
      Promise.resolve(
        cursor === undefined
          ? { items: [1, 2], nextCursor: 'next' }
          : { items: [3], nextCursor: null },
      ),
    );

    await expect(collectSdkPages({ fetchPage, maxPages: 2, maxItems: 3 })).resolves.toEqual([
      1, 2, 3,
    ]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'next', undefined);
  });

  it('fails closed at page and item bounds rather than returning partial over-limit data', async () => {
    const endless = () => Promise.resolve({ items: [1], nextCursor: 'again' });
    await expect(
      collectSdkPages({ fetchPage: endless, maxPages: 1, maxItems: 10 }),
    ).rejects.toMatchObject({ code: 'SDK_PAGINATION_PAGE_LIMIT_REACHED' });

    const overItemLimit = () => Promise.resolve({ items: [1, 2], nextCursor: null });
    await expect(
      collectSdkPages({ fetchPage: overItemLimit, maxPages: 1, maxItems: 1 }),
    ).rejects.toMatchObject({ code: 'SDK_PAGINATION_ITEM_LIMIT_REACHED' });
  });

  it('validates bounds and observes cancellation before fetching', async () => {
    const fetchPage = vi.fn(() => Promise.resolve({ items: [], nextCursor: null }));
    await expect(collectSdkPages({ fetchPage, maxPages: 0, maxItems: 1 })).rejects.toBeInstanceOf(
      SdkConfigurationError,
    );

    const controller = new AbortController();
    controller.abort();
    const iterator = paginateSdk({
      fetchPage,
      maxPages: 1,
      maxItems: 1,
      signal: controller.signal,
    });
    await expect(iterator.next()).rejects.toBeInstanceOf(SdkAbortError);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
