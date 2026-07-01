export type VideoDefinition = {
  definition: string;
  url: string;
  text?: string;
};

export type FeedItem = {
  id: string;
  url: string;
  poster?: string;
  title?: string;
  definitions?: VideoDefinition[];
  defaultDefinition?: string;
};

export type PlaybackProgress = {
  videoId: string;
  url: string;
  currentTime: number;
  duration: number;
  updatedAt: number;
  wasPlaying?: boolean;
  completed?: boolean;
  playbackRate?: number;
  definition?: string;
};

export type LifecyclePhase = "active" | "background" | "interrupted" | "frozen";

export type InterruptReason =
  | "visibility_hidden"
  | "page_hide"
  | "window_blur"
  | "app_pause"
  | "audio_interrupt"
  | "system_pause"
  | "offline";

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export type PlaybackRate = (typeof PLAYBACK_RATES)[number];
