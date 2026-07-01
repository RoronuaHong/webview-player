import type { PlaybackProgress } from "@/types/feed";

const STORAGE_KEY = "webview_player_progress_v1";

type ProgressListener = (record: PlaybackProgress) => void;
type FlushListener = (records: PlaybackProgress[]) => void;

function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    hash = (hash << 5) - hash + url.charCodeAt(i);
    hash |= 0;
  }
  return `v_${Math.abs(hash)}`;
}

export function resolveVideoId(url: string, explicitId?: string): string {
  return explicitId?.trim() || hashUrl(url);
}

class PlaybackStore {
  private cache = new Map<string, PlaybackProgress>();
  private listeners = new Set<ProgressListener>();
  private flushListeners = new Set<FlushListener>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private hydrated = false;

  hydrate() {
    if (this.hydrated || typeof window === "undefined") return;
    this.hydrated = true;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const records = JSON.parse(raw) as PlaybackProgress[];
      records.forEach((record) => {
        if (record?.videoId) {
          this.cache.set(record.videoId, record);
        }
      });
    } catch {
      // ignore corrupted cache
    }
  }

  get(videoId: string): PlaybackProgress | undefined {
    this.hydrate();
    return this.cache.get(videoId);
  }

  getStartTime(videoId: string): number {
    const record = this.get(videoId);
    if (!record || record.completed) return 0;
    if (!Number.isFinite(record.currentTime) || record.currentTime <= 0) {
      return 0;
    }
    return record.currentTime;
  }

  update(
    partial: Pick<PlaybackProgress, "videoId" | "url"> &
      Partial<PlaybackProgress>,
    options?: { immediate?: boolean },
  ) {
    this.hydrate();

    const prev = this.cache.get(partial.videoId);
    const record: PlaybackProgress = {
      videoId: partial.videoId,
      url: partial.url,
      currentTime: partial.currentTime ?? prev?.currentTime ?? 0,
      duration: partial.duration ?? prev?.duration ?? 0,
      updatedAt: Date.now(),
      wasPlaying: partial.wasPlaying ?? prev?.wasPlaying,
      completed: partial.completed ?? prev?.completed,
      playbackRate: partial.playbackRate ?? prev?.playbackRate,
      definition: partial.definition ?? prev?.definition,
    };

    if (
      record.duration > 0 &&
      record.currentTime >= record.duration - 0.5
    ) {
      record.completed = true;
      record.currentTime = 0;
    }

    this.cache.set(record.videoId, record);
    this.listeners.forEach((listener) => listener(record));

    if (options?.immediate) {
      this.persistNow();
      return;
    }

    this.schedulePersist();
  }

  importAll(records: PlaybackProgress[]) {
    this.hydrate();
    records.forEach((record) => {
      if (record?.videoId) {
        this.cache.set(record.videoId, {
          ...record,
          updatedAt: record.updatedAt ?? Date.now(),
        });
      }
    });
    this.persistNow();
  }

  exportAll(): PlaybackProgress[] {
    this.hydrate();
    return Array.from(this.cache.values());
  }

  onProgress(listener: ProgressListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onFlush(listener: FlushListener) {
    this.flushListeners.add(listener);
    return () => {
      this.flushListeners.delete(listener);
    };
  }

  flush() {
    this.persistNow();
    const records = this.exportAll();
    this.flushListeners.forEach((listener) => listener(records));
    return records;
  }

  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 1500);
  }

  private persistNow() {
    if (typeof window === "undefined") return;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(this.exportAll()),
      );
    } catch {
      // storage full or disabled in webview
    }
  }
}

export const playbackStore = new PlaybackStore();
