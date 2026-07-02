"use client";

import { useEffect, useRef } from "react";
import { resolveSavedFeedIndex } from "@/lib/feed-utils";
import type { FeedItem } from "@/types/feed";

type UseFeedRestoreAndUrlSyncOptions = {
  items: FeedItem[];
  initialIndex: number;
  activeIndexRef: React.RefObject<number>;
  scrollToIndex: (index: number) => number;
  persistFeedPosition: (index: number) => void;
};

export function useFeedRestoreAndUrlSync({
  items,
  initialIndex,
  activeIndexRef,
  scrollToIndex,
  persistFeedPosition,
}: UseFeedRestoreAndUrlSyncOptions) {
  const restoredPositionRef = useRef(false);

  useEffect(() => {
    restoredPositionRef.current = false;
  }, [items]);

  useEffect(() => {
    if (items.length === 0 || restoredPositionRef.current) return;
    restoredPositionRef.current = true;

    const savedIndex = resolveSavedFeedIndex(items);
    const targetIndex =
      savedIndex >= 0
        ? savedIndex
        : Math.min(
            Math.max(initialIndex, 0),
            Math.max(items.length - 1, 0),
          );

    if (targetIndex !== activeIndexRef.current) {
      scrollToIndex(targetIndex);
    }

    persistFeedPosition(targetIndex);
  }, [
    activeIndexRef,
    initialIndex,
    items,
    persistFeedPosition,
    scrollToIndex,
  ]);
}