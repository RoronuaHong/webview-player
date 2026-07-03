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

export function applyInlineVideoElement(
  video: HTMLVideoElement,
  options?: { preload?: "none" | "metadata" | "auto" },
) {
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
  video.setAttribute("preload", options?.preload ?? "auto");
}

export function findPlayerVideoElement(player: Player): HTMLVideoElement | null {
  const root = player.root as HTMLElement | undefined;
  if (!root) return null;

  const video = root.querySelector("video");
  return video instanceof HTMLVideoElement ? video : null;
}

export function setPlayerVideoPreload(
  player: Player,
  preload: "none" | "metadata" | "auto",
) {
  const video = findPlayerVideoElement(player);
  if (video) {
    video.preload = preload;
    video.setAttribute("preload", preload);
  }
}

export function hidePlayerPoster(player: Player) {
  const root = player.root as HTMLElement | undefined;
  if (!root) return;

  root.querySelector(".xgplayer-poster")?.classList.add("hide");
}

export function hasDecodedPreviewFrame(video: HTMLVideoElement) {
  return (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0
  );
}

export function playerHasPreviewFrame(player: Player): boolean {
  const video = findPlayerVideoElement(player);
  return video ? hasDecodedPreviewFrame(video) : false;
}

function seekNativeVideoPreview(
  video: HTMLVideoElement,
  startTime: number,
) {
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;

  const target = Math.max(0, startTime);
  if (Math.abs(video.currentTime - target) <= 0.05) return;

  try {
    video.currentTime = target;
  } catch {
  }
}

function waitForVideoCanPrime(video: HTMLVideoElement): Promise<void> {
  if (
    video.readyState >= HTMLMediaElement.HAVE_METADATA &&
    video.networkState !== HTMLMediaElement.NETWORK_LOADING
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("loadedmetadata", finish);
      video.removeEventListener("loadeddata", finish);
      video.removeEventListener("canplay", finish);
      resolve();
    };

    video.addEventListener("loadedmetadata", finish);
    video.addEventListener("loadeddata", finish);
    video.addEventListener("canplay", finish);
  });
}

export function isBenignPlayError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === "NotAllowedError" || error.name === "AbortError";
}

const inflightNativePrime = new WeakMap<
  HTMLVideoElement,
  Promise<boolean>
>();

export async function primeNativeVideoElement(
  video: HTMLVideoElement,
  startTime = 0,
): Promise<boolean> {
  const inflight = inflightNativePrime.get(video);
  if (inflight) return inflight;

  const task = (async () => {
    seekNativeVideoPreview(video, startTime);

    if (hasDecodedPreviewFrame(video)) {
      return true;
    }

    await waitForVideoCanPrime(video);
    seekNativeVideoPreview(video, startTime);

    if (hasDecodedPreviewFrame(video)) {
      return true;
    }

    const wasMuted = video.muted;
    video.muted = true;

    try {
      await video.play();
    } catch (error) {
      if (!isBenignPlayError(error)) {
        console.warn("[WebView] preview play() rejected:", error);
      }
    } finally {
      if (!video.paused) {
        video.pause();
      }
      seekNativeVideoPreview(video, startTime);
      video.muted = wasMuted;
    }

    return hasDecodedPreviewFrame(video);
  })().finally(() => {
    inflightNativePrime.delete(video);
  });

  inflightNativePrime.set(video, task);
  return task;
}

/** Decode and pause at the saved position for adjacent feed cards. */
export async function primePlayerPreviewFrame(
  player: Player,
  startTime = 0,
): Promise<boolean> {
  const video = findPlayerVideoElement(player);
  if (!video) return false;

  const primed = await primeNativeVideoElement(video, startTime);
  if (primed) {
    hidePlayerPoster(player);
  }

  return primed;
}

export function ensurePlayerVideoInline(
  player: Player,
  options?: { preload?: "none" | "metadata" | "auto" },
) {
  const video = findPlayerVideoElement(player);
  if (video) {
    applyInlineVideoElement(video, options);
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
    if (isBenignPlayError(error)) {
      return false;
    }

    console.warn("[WebView] play() rejected:", error);
    return false;
  }
}
