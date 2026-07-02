"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildDisplayItems,
  FEED_TRANSITION_MS,
  toRealIndex,
  toTranslateIndex,
} from "@/lib/feed-carousel";
import { findFeedItemIndex } from "@/lib/feed-utils";
import type { FeedItem } from "@/types/feed";

type SlideChangeHandler = (
  targetIndex: number,
  prevIndex: number,
  isLoop: boolean,
) => void;

type UseFeedCarouselOptions = {
  items: FeedItem[];
  initialIndex: number;
  onBeforeSlide?: (prevIndex: number) => void;
  onSlideChange: SlideChangeHandler;
  onExitImmersive?: () => void;
};

export function useFeedCarousel({
  items,
  initialIndex,
  onBeforeSlide,
  onSlideChange,
  onExitImmersive,
}: UseFeedCarouselOptions) {
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const loop = items.length > 1;
  const displayItems = useMemo(() => buildDisplayItems(items), [items]);
  const displayItemsRef = useRef(displayItems);
  displayItemsRef.current = displayItems;

  const clampedInitial = Math.min(
    Math.max(initialIndex, 0),
    Math.max(items.length - 1, 0),
  );

  const activeIndexRef = useRef(clampedInitial);
  const [activeIndex, setActiveIndex] = useState(clampedInitial);
  const [translateIndex, setTranslateIndex] = useState(
    toTranslateIndex(clampedInitial, loop),
  );
  const [transitionEnabled, setTransitionEnabled] = useState(true);

  const switchingRef = useRef(false);
  const translateIndexRef = useRef(toTranslateIndex(clampedInitial, loop));
  const pendingSlideRef = useRef<{ target: number; prev: number } | null>(null);
  const pendingSnapRef = useRef<"head" | "tail" | null>(null);
  const switchTimerRef = useRef<number | null>(null);

  translateIndexRef.current = translateIndex;
  activeIndexRef.current = activeIndex;

  const finishSwitch = useCallback(() => {
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }
    pendingSnapRef.current = null;
    switchingRef.current = false;
  }, []);

  const snapWithoutTransition = useCallback(
    (nextTranslateIndex: number, nextRealIndex: number) => {
      setTransitionEnabled(false);

      translateIndexRef.current = nextTranslateIndex;
      setTranslateIndex(nextTranslateIndex);
      activeIndexRef.current = nextRealIndex;
      setActiveIndex(nextRealIndex);

      const pending = pendingSlideRef.current;
      if (pending) {
        onSlideChange(pending.target, pending.prev, true);
        pendingSlideRef.current = null;
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTransitionEnabled(true);
          finishSwitch();
        });
      });
    },
    [finishSwitch, onSlideChange],
  );

  const completeLoopSnap = useCallback(() => {
    const length = itemsRef.current.length;
    const current = translateIndexRef.current;

    if (current === length + 1) {
      snapWithoutTransition(1, 0);
      return true;
    }

    if (current === 0) {
      snapWithoutTransition(length, length - 1);
      return true;
    }

    return false;
  }, [snapWithoutTransition]);

  const scheduleSwitchFallback = useCallback(() => {
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
    }

    switchTimerRef.current = window.setTimeout(() => {
      switchTimerRef.current = null;
      if (!switchingRef.current) return;

      if (completeLoopSnap()) {
        return;
      }

      finishSwitch();
    }, FEED_TRANSITION_MS + 80);
  }, [completeLoopSnap, finishSwitch]);

  const goToTranslateIndex = useCallback(
    (nextTranslateIndex: number, options?: { loopWrap?: boolean }) => {
      const length = itemsRef.current.length;
      if (length <= 0 || switchingRef.current) return;

      const prevRealIndex = activeIndexRef.current;
      const nextRealIndex = toRealIndex(nextTranslateIndex, length, loop);

      if (
        !options?.loopWrap &&
        nextTranslateIndex === translateIndexRef.current
      ) {
        return;
      }

      switchingRef.current = true;
      onBeforeSlide?.(prevRealIndex);
      onExitImmersive?.();

      if (options?.loopWrap) {
        pendingSnapRef.current = nextTranslateIndex === 0 ? "head" : "tail";
      } else {
        pendingSnapRef.current = null;
      }

      setTransitionEnabled(true);

      const applyTranslateIndex = () => {
        translateIndexRef.current = nextTranslateIndex;
        setTranslateIndex(nextTranslateIndex);
      };

      if (options?.loopWrap) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!switchingRef.current) return;
            applyTranslateIndex();
          });
        });
      } else {
        applyTranslateIndex();
      }

      if (nextRealIndex !== prevRealIndex) {
        if (options?.loopWrap) {
          pendingSlideRef.current = {
            target: nextRealIndex,
            prev: prevRealIndex,
          };
        } else {
          activeIndexRef.current = nextRealIndex;
          setActiveIndex(nextRealIndex);
          onSlideChange(nextRealIndex, prevRealIndex, false);
        }
      }

      scheduleSwitchFallback();
    },
    [loop, onBeforeSlide, onExitImmersive, onSlideChange, scheduleSwitchFallback],
  );

  const goNext = useCallback(() => {
    const length = itemsRef.current.length;
    if (length <= 1) return;

    const current = translateIndexRef.current;
    goToTranslateIndex(current + 1, {
      loopWrap: loop && current === length,
    });
  }, [goToTranslateIndex, loop]);

  const goPrev = useCallback(() => {
    const length = itemsRef.current.length;
    if (length <= 1) return;

    const current = translateIndexRef.current;
    goToTranslateIndex(current - 1, {
      loopWrap: loop && current === 1,
    });
  }, [goToTranslateIndex, loop]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const length = itemsRef.current.length;
      const clamped = Math.max(0, Math.min(length - 1, index));
      goToTranslateIndex(toTranslateIndex(clamped, loop));
      return clamped;
    },
    [goToTranslateIndex, loop],
  );

  const scrollToVideoId = useCallback(
    (videoId: string) => {
      const index = findFeedItemIndex(itemsRef.current, { videoId });
      if (index < 0) {
        throw new Error(`Video not found: ${videoId}`);
      }
      return scrollToIndex(index);
    },
    [scrollToIndex],
  );

  const scrollToUrl = useCallback(
    (url: string) => {
      const index = findFeedItemIndex(itemsRef.current, { url });
      if (index < 0) {
        throw new Error(`Video not found: ${url}`);
      }
      return scrollToIndex(index);
    },
    [scrollToIndex],
  );

  const handleTrackTransitionEnd = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>, track: HTMLDivElement | null) => {
      if (event.target !== track || event.propertyName !== "transform") {
        return;
      }

      if (!switchingRef.current) return;

      const length = itemsRef.current.length;
      if (!loop || length <= 1) {
        finishSwitch();
        return;
      }

      if (completeLoopSnap()) {
        return;
      }

      finishSwitch();
    },
    [completeLoopSnap, finishSwitch, loop],
  );

  useEffect(() => {
    const length = items.length;
    if (length === 0) return;

    if (switchTimerRef.current) {
      window.clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }

    switchingRef.current = false;
    pendingSlideRef.current = null;
    pendingSnapRef.current = null;

    const nextLoop = length > 1;
    const clamped = Math.min(
      Math.max(activeIndexRef.current, 0),
      length - 1,
    );
    const nextTranslateIndex = toTranslateIndex(clamped, nextLoop);

    activeIndexRef.current = clamped;
    setActiveIndex(clamped);
    translateIndexRef.current = nextTranslateIndex;
    setTranslateIndex(nextTranslateIndex);
    setTransitionEnabled(true);
  }, [items]);

  return {
    loop,
    displayItems,
    displayItemsRef,
    activeIndex,
    activeIndexRef,
    translateIndex,
    translateIndexRef,
    transitionEnabled,
    setTransitionEnabled,
    goNext,
    goPrev,
    scrollToIndex,
    scrollToVideoId,
    scrollToUrl,
    handleTrackTransitionEnd,
  };
}
