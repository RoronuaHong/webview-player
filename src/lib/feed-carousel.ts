import type { FeedItem } from "@/types/feed";

export const FEED_TRANSITION_MS = 280;

export type DisplayFeedItem = FeedItem & {
  displayKey: string;
  realIndex: number;
};

export function buildDisplayItems(items: FeedItem[]): DisplayFeedItem[] {
  if (items.length <= 1) {
    return items.map((item, index) => ({
      ...item,
      displayKey: item.id,
      realIndex: index,
    }));
  }

  const last = items[items.length - 1];
  const first = items[0];

  return [
    {
      ...last,
      displayKey: `${last.id}__clone-head`,
      realIndex: items.length - 1,
    },
    ...items.map((item, index) => ({
      ...item,
      displayKey: item.id,
      realIndex: index,
    })),
    {
      ...first,
      displayKey: `${first.id}__clone-tail`,
      realIndex: 0,
    },
  ];
}

export function toTranslateIndex(realIndex: number, loop: boolean) {
  return loop ? realIndex + 1 : realIndex;
}

export function toRealIndex(
  translateIndex: number,
  length: number,
  loop: boolean,
) {
  if (!loop || length <= 1) return translateIndex;
  if (translateIndex === 0) return length - 1;
  if (translateIndex === length + 1) return 0;
  return translateIndex - 1;
}

export function getFeedTrackTransform(
  translateIndex: number,
  landscapeImmersive = false,
) {
  if (landscapeImmersive) return "none";
  return `translate3d(0, calc(-${translateIndex} * 100dvh), 0)`;
}

export function snapTrackElement(
  track: HTMLElement | null,
  translateIndex: number,
) {
  if (!track) return;
  track.style.transform = getFeedTrackTransform(translateIndex);
  void track.offsetHeight;
}
