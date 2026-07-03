export type WebViewPerformanceProfile = {
  lowEnd: boolean;
  mobileWebView: boolean;
  playerMountRadius: number;
  playerUnmountDelayMs: number;
  positionPersistDebounceMs: number;
  progressThrottleMs: number;
  progressBackupIntervalMs: number;
  fluidPlayer: boolean;
  resizeDebounceMs: number;
};

export type VideoPreloadTier = "auto" | "metadata" | "none";

function getIosMajorVersion(): number | null {
  if (typeof navigator === "undefined") return null;

  const match = navigator.userAgent.match(/OS (\d+)[._]/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function getAndroidMajorVersion(): number | null {
  if (typeof navigator === "undefined") return null;

  const match = navigator.userAgent.match(/Android (\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function isMobileWebView(): boolean {
  if (typeof navigator === "undefined") return false;

  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export function isLowEndWebView(): boolean {
  if (typeof navigator === "undefined") return false;

  const iosVersion = getIosMajorVersion();
  if (iosVersion !== null && iosVersion < 14) return true;

  const androidVersion = getAndroidMajorVersion();
  if (androidVersion !== null && androidVersion < 8) return true;

  const cores = navigator.hardwareConcurrency ?? 4;
  if (cores > 0 && cores <= 2) return true;

  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined && memory > 0 && memory <= 2) return true;

  return false;
}

export function getWebViewPerformanceProfile(): WebViewPerformanceProfile {
  const lowEnd = isLowEndWebView();
  const mobileWebView = isMobileWebView();

  return {
    lowEnd,
    mobileWebView,
    playerMountRadius: lowEnd ? 1 : 2,
    playerUnmountDelayMs: lowEnd ? 2000 : 3000,
    positionPersistDebounceMs: 300,
    progressThrottleMs: lowEnd ? 2000 : 1000,
    progressBackupIntervalMs: lowEnd ? 6000 : 3000,
    fluidPlayer: !mobileWebView,
    resizeDebounceMs: lowEnd ? 300 : 150,
  };
}

export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  waitMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: T | null = null;

  const debounced = (...args: T) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const pendingArgs = lastArgs;
      lastArgs = null;
      if (pendingArgs) fn(...pendingArgs);
    }, waitMs);
  };

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  debounced.flush = () => {
    if (!timer || !lastArgs) return;
    clearTimeout(timer);
    timer = null;
    const pendingArgs = lastArgs;
    lastArgs = null;
    fn(...pendingArgs);
  };

  return debounced;
}
