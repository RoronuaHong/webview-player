import type { FeedItem } from "@/types/feed";

const STORAGE_KEY = "webview_feed_position_v1";

type SavedFeedPosition = {
  videoId: string;
  url: string;
  index: number;
  updatedAt: number;
};

export function getFeedFingerprint(items: FeedItem[]) {
  if (items.length === 0) return "empty";
  return items.map((item) => item.id).join("\u001f");
}

class FeedPositionStore {
  private cache = new Map<string, SavedFeedPosition>();
  private hydrated = false;

  hydrate() {
    if (this.hydrated || typeof window === "undefined") return;
    this.hydrated = true;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Record<string, SavedFeedPosition>;
      if (!parsed || typeof parsed !== "object") return;

      Object.entries(parsed).forEach(([feedKey, record]) => {
        if (record?.videoId) {
          this.cache.set(feedKey, record);
        }
      });
    } catch {
      // ignore corrupted cache
    }
  }

  getForItems(items: FeedItem[]) {
    this.hydrate();
    if (items.length === 0) return undefined;
    return this.cache.get(getFeedFingerprint(items));
  }

  save(items: FeedItem[], index: number) {
    this.hydrate();

    const item = items[index];
    if (!item) return;

    const feedKey = getFeedFingerprint(items);
    this.cache.set(feedKey, {
      videoId: item.id,
      url: item.url,
      index,
      updatedAt: Date.now(),
    });
    this.persistNow();
  }

  private persistNow() {
    if (typeof window === "undefined") return;

    try {
      const payload = Object.fromEntries(this.cache.entries());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // storage full or disabled in webview
    }
  }
}

export const feedPositionStore = new FeedPositionStore();
