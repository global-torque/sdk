import { SdkAbortError, SdkConfigurationError } from './errors.js';

const MAX_PAGES_LIMIT = 10_000;
const MAX_ITEMS_LIMIT = 1_000_000;

/** @public */
export interface SdkPage<T, Cursor = string> {
  items: readonly T[];
  nextCursor?: Cursor | null;
}

/** @public */
export interface SdkPaginationOptions<T, Cursor = string> {
  fetchPage: (cursor: Cursor | undefined, signal?: AbortSignal) => Promise<SdkPage<T, Cursor>>;
  /** Required hard bound; pagination fails before requesting another page beyond this count. */
  maxPages: number;
  /** Required hard bound; pagination fails instead of returning a partial over-limit page. */
  maxItems: number;
  initialCursor?: Cursor;
  signal?: AbortSignal;
}

const normalizeBound = (value: number, name: string, maximum: number) => {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new SdkConfigurationError(
      'SDK_PAGINATION_BOUND_INVALID',
      `${name} must be an integer from 1 through ${String(maximum)}.`,
    );
  }
  return value;
};

const throwIfAborted = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) throw new SdkAbortError({ details: { pagination: 'aborted' } });
};

/** @public */
export async function* paginateSdk<T, Cursor = string>(
  options: SdkPaginationOptions<T, Cursor>,
): AsyncGenerator<T, void, undefined> {
  const maxPages = normalizeBound(options.maxPages, 'maxPages', MAX_PAGES_LIMIT);
  const maxItems = normalizeBound(options.maxItems, 'maxItems', MAX_ITEMS_LIMIT);
  let cursor = options.initialCursor;
  let pages = 0;
  let items = 0;

  for (;;) {
    throwIfAborted(options.signal);
    if (pages >= maxPages) {
      throw new SdkConfigurationError(
        'SDK_PAGINATION_PAGE_LIMIT_REACHED',
        'Pagination reached maxPages before the server indicated completion.',
      );
    }
    const pageCandidate: unknown = await options.fetchPage(cursor, options.signal);
    throwIfAborted(options.signal);
    pages += 1;
    if (
      typeof pageCandidate !== 'object' ||
      pageCandidate === null ||
      !('items' in pageCandidate) ||
      !Array.isArray(pageCandidate.items)
    ) {
      throw new SdkConfigurationError(
        'SDK_PAGINATION_PAGE_INVALID',
        'fetchPage must return a page with an items array.',
      );
    }
    const page = pageCandidate as unknown as SdkPage<T, Cursor>;
    if (items + page.items.length > maxItems) {
      throw new SdkConfigurationError(
        'SDK_PAGINATION_ITEM_LIMIT_REACHED',
        'Pagination reached maxItems before the server indicated completion.',
      );
    }
    for (const item of page.items) {
      items += 1;
      yield item;
    }
    if (page.nextCursor === undefined || page.nextCursor === null) return;
    cursor = page.nextCursor;
  }
}

/** @public */
export const collectSdkPages = async <T, Cursor = string>(
  options: SdkPaginationOptions<T, Cursor>,
): Promise<T[]> => {
  const items: T[] = [];
  for await (const item of paginateSdk(options)) items.push(item);
  return items;
};
