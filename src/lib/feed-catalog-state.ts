import { getFeedFingerprint } from "@/lib/feed-position-store";
import type { FeedItem } from "@/types/feed";

export const FEED_PREFETCH_RADIUS = 12;
export const FEED_PREFETCH_CHUNK = 20;

export type FeedLoadRequest = {
  offset: number;
  limit: number;
  centerIndex: number;
};

export type FeedCatalogSnapshot = {
  catalogId: string;
  totalCount: number;
  loadedCount: number;
  loadedIndexes: number[];
};

function rangeKey(offset: number, limit: number) {
  return `${offset}:${limit}`;
}

export class FeedCatalogState {
  catalogId: string;
  totalCount: number;
  private items = new Map<number, FeedItem>();
  private pendingRanges = new Set<string>();

  constructor(initialItems: FeedItem[], catalogId?: string) {
    this.catalogId = catalogId ?? getFeedFingerprint(initialItems);
    this.totalCount = initialItems.length;
    this.resetItems(initialItems);
  }

  private resetItems(items: FeedItem[], offset = 0) {
    items.forEach((item, index) => {
      this.items.set(offset + index, item);
    });
  }

  setCatalog(options: {
    catalogId?: string;
    totalCount?: number;
    reset?: boolean;
    items?: FeedItem[];
    offset?: number;
  }) {
    if (options.reset) {
      this.items.clear();
      this.pendingRanges.clear();
    }

    if (options.catalogId) {
      this.catalogId = options.catalogId;
    }

    if (options.totalCount !== undefined) {
      this.totalCount = Math.max(0, options.totalCount);
    }

    if (options.items?.length) {
      this.appendItems(options.offset ?? 0, options.items);
    }
  }

  appendItems(offset: number, items: FeedItem[]) {
    if (!items.length) return;

    items.forEach((item, index) => {
      this.items.set(offset + index, item);
    });

    this.pendingRanges.delete(
      rangeKey(offset, items.length),
    );
  }

  getItem(index: number): FeedItem | null {
    if (index < 0 || index >= this.totalCount) return null;
    return this.items.get(index) ?? null;
  }

  hasItem(index: number) {
    return this.items.has(index);
  }

  getLoadedCount() {
    return this.items.size;
  }

  getLoadedIndexes() {
    return [...this.items.keys()].sort((left, right) => left - right);
  }

  listLoadedEntries() {
    return this.getLoadedIndexes().map((index) => ({
      index,
      item: this.items.get(index)!,
    }));
  }

  findLoadedIndex(options: { videoId?: string | null; url?: string | null }) {
    const videoId = options.videoId?.trim();
    if (videoId) {
      for (const [index, item] of this.items.entries()) {
        if (item.id === videoId) return index;
      }
    }

    const url = options.url?.trim();
    if (url) {
      for (const [index, item] of this.items.entries()) {
        if (item.url === url) return index;
      }
    }

    return -1;
  }

  getSnapshot(): FeedCatalogSnapshot {
    return {
      catalogId: this.catalogId,
      totalCount: this.totalCount,
      loadedCount: this.items.size,
      loadedIndexes: this.getLoadedIndexes(),
    };
  }

  getMissingLoadRequest(centerIndex: number): FeedLoadRequest | null {
    if (this.totalCount <= 0) return null;

    const start = Math.max(0, centerIndex - FEED_PREFETCH_RADIUS);
    const end = Math.min(this.totalCount - 1, centerIndex + FEED_PREFETCH_RADIUS);

    let missingStart = -1;
    for (let index = start; index <= end; index += 1) {
      if (!this.items.has(index)) {
        missingStart = index;
        break;
      }
    }

    if (missingStart < 0) return null;

    let missingEnd = missingStart;
    while (
      missingEnd < end &&
      !this.items.has(missingEnd + 1) &&
      missingEnd - missingStart + 1 < FEED_PREFETCH_CHUNK
    ) {
      missingEnd += 1;
    }

    const offset = missingStart;
    const limit = missingEnd - missingStart + 1;
    const key = rangeKey(offset, limit);
    if (this.pendingRanges.has(key)) return null;

    this.pendingRanges.add(key);
    return { offset, limit, centerIndex };
  }

  clearPendingRequest(request: FeedLoadRequest) {
    this.pendingRanges.delete(rangeKey(request.offset, request.limit));
  }
}
