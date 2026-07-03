import HlsPlugin from "xgplayer-hls";
import { isMobileWebView } from "@/lib/webview-runtime";
import type { VideoDefinition } from "@/types/feed";

/** 本地示例视频，避免外链过期 */
export const PORTRAIT_VIDEO_1080_URL = "/videos/sample-720p.mp4";
export const PORTRAIT_VIDEO_720_URL = "/videos/sample-360p.mp4";
export const PORTRAIT_VIDEO_3_URL = "/videos/sample-douyin.mp4";
export const PORTRAIT_POSTER_1080_URL =
  "https://placeholdervideo.dev/poster/1080x1920";
export const PORTRAIT_POSTER_720_URL =
  "https://placeholdervideo.dev/poster/720x1280";

export const DEFAULT_MP4_URL = PORTRAIT_VIDEO_1080_URL;

export const DEFAULT_HLS_URL =
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

export function isHlsUrl(url: string): boolean {
  const normalized = url.split("?")[0].toLowerCase();
  return normalized.endsWith(".m3u8") || normalized.includes(".m3u8");
}

export function supportsNativeHls(): boolean {
  if (typeof document === "undefined") return false;
  const video = document.createElement("video");
  return (
    video.canPlayType("application/vnd.apple.mpegurl") !== "" ||
    video.canPlayType("application/x-mpegURL") !== ""
  );
}

export function getHlsPlugins(url: string) {
  if (!isHlsUrl(url)) return [];

  // iOS / Safari WebView: native HLS only — xgplayer-hls needs MSE and breaks playback.
  if (supportsNativeHls()) {
    return [];
  }

  if (HlsPlugin.isSupported()) {
    return [HlsPlugin];
  }

  return [];
}

export function getHlsPlaybackMode(url: string): "native" | "hls.js" | "mp4" | "none" {
  if (!isHlsUrl(url)) return "mp4";

  if (supportsNativeHls()) return "native";
  if (HlsPlugin.isSupported()) return "hls.js";
  return "none";
}

function parseDefinitionBitrate(definition: string): number {
  const match = definition.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

export function pickLowestDefinition(
  definitions: VideoDefinition[],
): VideoDefinition | undefined {
  if (!definitions.length) return undefined;

  return [...definitions].sort(
    (left, right) =>
      parseDefinitionBitrate(left.definition) -
      parseDefinitionBitrate(right.definition),
  )[0];
}

export function resolveInitialDefinition(
  definitions: VideoDefinition[],
  options?: {
    savedDefinition?: string;
    defaultDefinition?: string;
    preferLowOnMobile?: boolean;
  },
): string | undefined {
  if (!definitions.length) return undefined;

  const savedDefinition = options?.savedDefinition;
  if (
    savedDefinition &&
    definitions.some((item) => item.definition === savedDefinition)
  ) {
    return savedDefinition;
  }

  const preferLow =
    options?.preferLowOnMobile !== false && isMobileWebView();
  if (preferLow) {
    return pickLowestDefinition(definitions)?.definition;
  }

  const defaultDefinition = options?.defaultDefinition;
  if (
    defaultDefinition &&
    definitions.some((item) => item.definition === defaultDefinition)
  ) {
    return defaultDefinition;
  }

  return definitions[0]?.definition;
}

export function resolvePlaybackUrl(
  url: string,
  definitions: VideoDefinition[],
  definitionName?: string,
): string {
  if (!definitions.length || !definitionName) return url;

  const matched = definitions.find(
    (item) => item.definition === definitionName,
  );
  return matched?.url ?? url;
}

/** Android WebView MSE HLS: faster first frame, smaller buffer footprint */
export function getHlsPlayerConfig():
  | {
      preloadTime: number;
      minSegmentsStartPlay: number;
      bufferBehind: number;
      loadTimeout: number;
      manifestLoadTimeout: number;
    }
  | undefined {
  if (supportsNativeHls() || !HlsPlugin.isSupported()) {
    return undefined;
  }

  return {
    preloadTime: 15,
    minSegmentsStartPlay: 1,
    bufferBehind: 8,
    loadTimeout: 15000,
    manifestLoadTimeout: 10000,
  };
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
