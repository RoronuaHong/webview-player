import type Player from "xgplayer";
import { findPlayerVideoElement } from "@/lib/webview-playback";

export type VideoOrientation = "portrait" | "landscape" | "square";

const LANDSCAPE_RATIO = 1.05;
const PORTRAIT_RATIO = 0.95;

export function getVideoOrientation(
  width: number,
  height: number,
): VideoOrientation {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "portrait";
  }

  const ratio = width / height;
  if (ratio >= LANDSCAPE_RATIO) return "landscape";
  if (ratio <= PORTRAIT_RATIO) return "portrait";
  return "square";
}

export function readPlayerVideoOrientation(player: unknown): VideoOrientation {
  const source = player as {
    media?: unknown;
    root?: HTMLElement | null;
    _videoWidth?: number;
    _videoHeight?: number;
  };

  const video = findPlayerVideoElement(player as Player);
  if (video?.videoWidth && video.videoHeight) {
    return getVideoOrientation(video.videoWidth, video.videoHeight);
  }

  if (source._videoWidth && source._videoHeight) {
    return getVideoOrientation(source._videoWidth, source._videoHeight);
  }

  const media = source.media as
    | { videoWidth?: number; videoHeight?: number }
    | null
    | undefined;

  if (media?.videoWidth && media.videoHeight) {
    return getVideoOrientation(media.videoWidth, media.videoHeight);
  }

  return "portrait";
}
