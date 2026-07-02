import type Player from "xgplayer";
import { lifecycleManager } from "@/lib/lifecycle-manager";

/** Attributes recommended by xgplayer + WKWebView / Android WebView docs */
export function getWebViewVideoAttributes() {
  return {
    playsInline: true,
    "webkit-playsinline": "true",
    "x-webkit-airplay": "allow",
    "x5-playsinline": "true",
    "x5-video-player-type": "h5",
    "x5-video-orientation": "portrait",
    "x5-video-player-fullscreen": "false",
    disablePictureInPicture: true,
    controlsList: "nodownload noplaybackrate noremoteplayback",
  } as const;
}

export function applyInlineVideoElement(video: HTMLVideoElement) {
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("x5-playsinline", "true");
  video.playsInline = true;
  video.disablePictureInPicture = true;
  video.controls = false;
  video.setAttribute(
    "controlsList",
    "nodownload noplaybackrate noremoteplayback",
  );
  video.setAttribute("preload", "auto");
}

export function findPlayerVideoElement(player: Player): HTMLVideoElement | null {
  const root = player.root as HTMLElement | undefined;
  if (!root) return null;

  const video = root.querySelector("video");
  return video instanceof HTMLVideoElement ? video : null;
}

export function ensurePlayerVideoInline(player: Player) {
  const video = findPlayerVideoElement(player);
  if (video) {
    applyInlineVideoElement(video);
  }
}

export async function safePlayerPlay(
  player: Player | null | undefined,
  options?: { ignoreLifecycle?: boolean },
): Promise<boolean> {
  if (!player) return false;

  if (!options?.ignoreLifecycle && typeof document !== "undefined") {
    if (document.visibilityState !== "visible") return false;
    if (lifecycleManager.getPhase() !== "active") return false;
  }

  try {
    await player.play();
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      return false;
    }

    console.warn("[WebView] play() rejected:", error);
    return false;
  }
}
