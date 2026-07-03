import type Player from "xgplayer";
import {
  getHlsPlaybackMode,
  resolveInitialDefinition,
  resolvePlaybackUrl,
} from "@/lib/player-utils";
import { playbackStore } from "@/lib/playback-store";
import { playerSettings } from "@/lib/player-settings";
import { safePlayerPlay } from "@/lib/webview-playback";
import type { VideoDefinition } from "@/types/feed";

export type PlaybackSourceDescriptor = {
  videoId: string;
  sourceUrl: string;
  playbackUrl: string;
  hlsMode: ReturnType<typeof getHlsPlaybackMode>;
  isLive: boolean;
  poster?: string;
  initialDefinition?: string;
  definitionsKey: string;
};

export function buildPlaybackSourceDescriptor(options: {
  videoId: string;
  url: string;
  poster?: string;
  isLive?: boolean;
  definitions?: VideoDefinition[];
  defaultDefinition?: string;
  startTime?: number;
}): PlaybackSourceDescriptor {
  const {
    videoId,
    url,
    poster,
    isLive = false,
    definitions = [],
    defaultDefinition,
    startTime = 0,
  } = options;

  const saved = playbackStore.get(videoId);
  const initialDefinition =
    resolveInitialDefinition(definitions, {
      savedDefinition: saved?.definition,
      defaultDefinition,
      preferLowOnMobile: true,
    }) ?? defaultDefinition ?? definitions[0]?.definition;

  const playbackUrl = resolvePlaybackUrl(url, definitions, initialDefinition);

  return {
    videoId,
    sourceUrl: url,
    playbackUrl,
    hlsMode: getHlsPlaybackMode(playbackUrl),
    isLive,
    poster,
    initialDefinition,
    definitionsKey: JSON.stringify(definitions),
  };
}

export function canHotSwitchSources(
  previous: PlaybackSourceDescriptor,
  next: PlaybackSourceDescriptor,
): boolean {
  return (
    previous.hlsMode === next.hlsMode &&
    previous.isLive === next.isLive &&
    previous.playbackUrl !== next.playbackUrl
  );
}

export function isSamePlaybackSource(
  previous: PlaybackSourceDescriptor | null,
  next: PlaybackSourceDescriptor,
): boolean {
  if (!previous) return false;

  return (
    previous.videoId === next.videoId &&
    previous.playbackUrl === next.playbackUrl &&
    previous.definitionsKey === next.definitionsKey &&
    previous.isLive === next.isLive &&
    previous.poster === next.poster
  );
}

export async function applyPlaybackSource(
  player: Player,
  descriptor: PlaybackSourceDescriptor,
  options?: {
    startTime?: number;
    autoplay?: boolean;
    onReady?: () => void;
  },
): Promise<boolean> {
  const resumeAt =
    options?.startTime ??
    playbackStore.getStartTime(descriptor.videoId);
  const rate =
    playbackStore.get(descriptor.videoId)?.playbackRate ??
    playerSettings.getPlaybackRate();

  const currentUrl = String(player.config?.url ?? "");

  if (currentUrl === descriptor.playbackUrl) {
    if (resumeAt > 0 && Math.abs((player.currentTime ?? 0) - resumeAt) > 0.5) {
      player.currentTime = resumeAt;
    }
    player.playbackRate = rate;
    if (descriptor.poster !== undefined) {
      player.poster = descriptor.poster;
    }
    if (options?.autoplay) {
      await safePlayerPlay(player);
    }
    options?.onReady?.();
    return true;
  }

  if (typeof player.switchURL === "function") {
    try {
      await player.switchURL(descriptor.playbackUrl, {
        currentTime: resumeAt > 0 ? resumeAt : 0,
      });
      player.playbackRate = rate;
      if (descriptor.poster !== undefined) {
        player.poster = descriptor.poster;
      }
      if (options?.autoplay) {
        await safePlayerPlay(player);
      }
      options?.onReady?.();
      return true;
    } catch (error) {
      console.warn("[XgPlayer] switchURL failed, recreate player:", error);
      return false;
    }
  }

  return false;
}
