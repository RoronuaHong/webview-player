import type { PlaybackRate } from "@/types/feed";
import { PLAYBACK_RATES } from "@/types/feed";

const STORAGE_KEY = "webview_player_settings_v1";

type PlayerSettings = {
  playbackRate: PlaybackRate;
};

const DEFAULT_SETTINGS: PlayerSettings = {
  playbackRate: 1,
};

class PlayerSettingsStore {
  private settings: PlayerSettings = { ...DEFAULT_SETTINGS };
  private hydrated = false;

  hydrate() {
    if (this.hydrated || typeof window === "undefined") return;
    this.hydrated = true;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
      if (parsed.playbackRate && this.isValidRate(parsed.playbackRate)) {
        this.settings.playbackRate = parsed.playbackRate;
      }
    } catch {
      // ignore
    }
  }

  getPlaybackRate(): PlaybackRate {
    this.hydrate();
    return this.settings.playbackRate;
  }

  setPlaybackRate(rate: number): PlaybackRate {
    this.hydrate();
    const normalized = this.isValidRate(rate) ? rate : 1;
    this.settings.playbackRate = normalized;
    this.persist();
    return normalized;
  }

  getAvailableRates() {
    return PLAYBACK_RATES;
  }

  private isValidRate(rate: number): rate is PlaybackRate {
    return PLAYBACK_RATES.includes(rate as PlaybackRate);
  }

  private persist() {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // ignore
    }
  }
}

export const playerSettings = new PlayerSettingsStore();
