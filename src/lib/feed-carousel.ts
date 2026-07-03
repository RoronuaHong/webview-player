import type { FeedItem } from "@/types/feed";
import type { VideoPreloadTier } from "@/lib/webview-runtime";

export const FEED_TRANSITION_MS = 280;

export const FEED_SLOT_ORDER = ["prev", "current", "next"] as const;

export type FeedSlot = (typeof FEED_SLOT_ORDER)[number];

/** -1 = 动画中显示下一张, 0 = 静止, 1 = 动画中显示上一张 */
export type FeedSlidePhase = -1 | 0 | 1;

export type FeedSlotSnapshot = {
  prev: FeedItem | null;
  current: FeedItem | null;
  next: FeedItem | null;
  prevIndex: number;
  currentIndex: number;
  nextIndex: number;
};

export function wrapFeedIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

export function resolveFeedSlots(
  getItem: (index: number) => FeedItem | null,
  totalCount: number,
  activeIndex: number,
  loop: boolean,
): FeedSlotSnapshot {
  const length = totalCount;

  if (length === 0) {
    return {
      prev: null,
      current: null,
      next: null,
      prevIndex: -1,
      currentIndex: -1,
      nextIndex: -1,
    };
  }

  const currentIndex = Math.min(Math.max(activeIndex, 0), length - 1);

  if (length === 1) {
    return {
      prev: null,
      current: getItem(0),
      next: null,
      prevIndex: -1,
      currentIndex: 0,
      nextIndex: -1,
    };
  }

  let prevIndex = -1;
  let nextIndex = -1;

  if (loop) {
    prevIndex = wrapFeedIndex(currentIndex - 1, length);
    nextIndex = wrapFeedIndex(currentIndex + 1, length);
  } else {
    if (currentIndex > 0) prevIndex = currentIndex - 1;
    if (currentIndex < length - 1) nextIndex = currentIndex + 1;
  }

  return {
    prev: prevIndex >= 0 ? getItem(prevIndex) : null,
    current: getItem(currentIndex),
    next: nextIndex >= 0 ? getItem(nextIndex) : null,
    prevIndex,
    currentIndex,
    nextIndex,
  };
}

export function getSlotFeedItem(
  snapshot: FeedSlotSnapshot,
  slot: FeedSlot,
): FeedItem | null {
  if (slot === "prev") return snapshot.prev;
  if (slot === "current") return snapshot.current;
  return snapshot.next;
}

export function getSlotRealIndex(
  snapshot: FeedSlotSnapshot,
  slot: FeedSlot,
): number {
  if (slot === "prev") return snapshot.prevIndex;
  if (slot === "current") return snapshot.currentIndex;
  return snapshot.nextIndex;
}

export function getSlotPreloadTier(slot: FeedSlot): VideoPreloadTier {
  return "auto";
}

export function getVirtualTrackTransform(
  slidePhase: FeedSlidePhase,
  dragOffsetPx = 0,
  landscapeImmersive = false,
): string {
  if (landscapeImmersive) {
    return "translate3d(0, 0, 0)";
  }

  // 三槽纵向排列（各 100dvh），基准位移 -100dvh 使 current 对齐视口
  if (dragOffsetPx !== 0) {
    return `translate3d(0, calc(-100dvh + ${dragOffsetPx}px), 0)`;
  }

  if (slidePhase === 0) {
    return "translate3d(0, -100dvh, 0)";
  }

  if (slidePhase === -1) {
    return "translate3d(0, -200dvh, 0)";
  }

  return "translate3d(0, 0, 0)";
}

export function snapVirtualTrackElement(
  track: HTMLElement | null,
  slidePhase: FeedSlidePhase,
) {
  if (!track) return;
  track.style.transform = getVirtualTrackTransform(slidePhase);
  void track.offsetHeight;
}

export function isLoopSlide(
  prevIndex: number,
  targetIndex: number,
  length: number,
  loop: boolean,
): boolean {
  if (!loop || length <= 1) return false;

  return (
    (prevIndex === length - 1 && targetIndex === 0) ||
    (prevIndex === 0 && targetIndex === length - 1)
  );
}
