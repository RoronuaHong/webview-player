export type WebViewPerformanceProfile = {
  lowEnd: boolean;
  playerMountRadius: number;
  progressThrottleMs: number;
  progressBackupIntervalMs: number;
  fluidPlayer: boolean;
  resizeDebounceMs: number;
};

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

  return {
    lowEnd,
    playerMountRadius: lowEnd ? 1 : 2,
    progressThrottleMs: lowEnd ? 2000 : 1000,
    progressBackupIntervalMs: lowEnd ? 6000 : 3000,
    fluidPlayer: !lowEnd,
    resizeDebounceMs: lowEnd ? 300 : 150,
  };
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  waitMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}

export function shouldMountFeedPlayer(
  displayIndex: number,
  translateIndex: number,
  mountRadius: number,
) {
  return Math.abs(displayIndex - translateIndex) <= mountRadius;
}
