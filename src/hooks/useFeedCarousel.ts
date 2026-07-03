"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FEED_TRANSITION_MS,
  type FeedSlidePhase,
  type FeedSlotSnapshot,
  isLoopSlide,
  resolveFeedSlots,
  wrapFeedIndex,
} from "@/lib/feed-carousel";
import type { FeedItem } from "@/types/feed";

const DRAG_DISTANCE_RATIO = 0.25;
const DRAG_VELOCITY_THRESHOLD = 0.45;
const EDGE_RESISTANCE = 0.25;

type SlideChangeHandler = (
  targetIndex: number,
  prevIndex: number,
  isLoop: boolean,
) => void;

type UseFeedCarouselOptions = {
  totalCount: number;
  getItem: (index: number) => FeedItem | null;
  catalogVersion: number;
  initialIndex: number;
  onBeforeSlide?: (prevIndex: number) => void;
  onSlideChange: SlideChangeHandler;
  onExitImmersive?: () => void;
};

export function useFeedCarousel({
  totalCount,
  getItem,
  catalogVersion,
  initialIndex,
  onBeforeSlide,
  onSlideChange,
  onExitImmersive,
}: UseFeedCarouselOptions) {
  const getItemRef = useRef(getItem);
  getItemRef.current = getItem;

  const totalCountRef = useRef(totalCount);
  totalCountRef.current = totalCount;

  const loop = totalCount > 1;

  const clampedInitial = Math.min(
    Math.max(initialIndex, 0),
    Math.max(totalCount - 1, 0),
  );

  const activeIndexRef = useRef(clampedInitial);
  const [activeIndex, setActiveIndex] = useState(clampedInitial);
  const [slidePhase, setSlidePhase] = useState<FeedSlidePhase>(0);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [transitionEnabled, setTransitionEnabled] = useState(true);

  const switchingRef = useRef(false);
  const slidePhaseRef = useRef<FeedSlidePhase>(0);
  const switchTimerRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef(0);

  slidePhaseRef.current = slidePhase;
  activeIndexRef.current = activeIndex;
  isDraggingRef.current = isDragging;
  dragOffsetRef.current = dragOffsetPx;

  const slots = useMemo(
    () =>
      resolveFeedSlots(
        (index) => getItemRef.current(index),
        totalCount,
        activeIndex,
        loop,
      ),
    [activeIndex, catalogVersion, loop, totalCount],
  );
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const finishSwitch = useCallback(() => {
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }
    switchingRef.current = false;
    setIsSettling(false);
  }, []);

  const commitSlide = useCallback(
    (phase: FeedSlidePhase) => {
      const length = totalCountRef.current;
      if (length <= 1 || phase === 0) {
        finishSwitch();
        return;
      }

      const prevIndex = activeIndexRef.current;
      const nextIndex =
        phase === -1
          ? loop
            ? wrapFeedIndex(prevIndex + 1, length)
            : Math.min(prevIndex + 1, length - 1)
          : loop
            ? wrapFeedIndex(prevIndex - 1, length)
            : Math.max(prevIndex - 1, 0);

      setTransitionEnabled(false);
      setSlidePhase(0);
      slidePhaseRef.current = 0;
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);

      requestAnimationFrame(() => {
        onSlideChange(
          nextIndex,
          prevIndex,
          isLoopSlide(prevIndex, nextIndex, length, loop),
        );

        requestAnimationFrame(() => {
          setTransitionEnabled(true);
          finishSwitch();
        });
      });
    },
    [finishSwitch, loop, onSlideChange],
  );

  const scheduleSwitchFallback = useCallback(
    (expectedPhase: FeedSlidePhase) => {
      if (switchTimerRef.current) {
        clearTimeout(switchTimerRef.current);
      }

      switchTimerRef.current = window.setTimeout(() => {
        switchTimerRef.current = null;
        if (!switchingRef.current) return;
        if (slidePhaseRef.current !== expectedPhase) return;
        commitSlide(expectedPhase);
      }, FEED_TRANSITION_MS + 80);
    },
    [commitSlide],
  );

  const beginSlide = useCallback(
    (phase: 1 | -1) => {
      const length = totalCountRef.current;
      if (length <= 1 || switchingRef.current) return;

      const current = activeIndexRef.current;
      if (phase === -1 && !loop && current >= length - 1) return;
      if (phase === 1 && !loop && current <= 0) return;

      const targetIndex =
        phase === -1
          ? loop
            ? wrapFeedIndex(current + 1, length)
            : current + 1
          : loop
            ? wrapFeedIndex(current - 1, length)
            : current - 1;

      if (!getItemRef.current(targetIndex)) return;

      switchingRef.current = true;
      setIsSettling(true);
      onBeforeSlide?.(current);
      onExitImmersive?.();
      setTransitionEnabled(true);
      setSlidePhase(phase);
      slidePhaseRef.current = phase;
      scheduleSwitchFallback(phase);
    },
    [loop, onBeforeSlide, onExitImmersive, scheduleSwitchFallback],
  );

  const goNext = useCallback(() => {
    beginSlide(-1);
  }, [beginSlide]);

  const goPrev = useCallback(() => {
    beginSlide(1);
  }, [beginSlide]);

  const getTargetIndex = useCallback(
    (phase: 1 | -1) => {
      const length = totalCountRef.current;
      const current = activeIndexRef.current;

      if (length <= 1) return -1;
      if (phase === -1 && !loop && current >= length - 1) return -1;
      if (phase === 1 && !loop && current <= 0) return -1;

      return phase === -1
        ? loop
          ? wrapFeedIndex(current + 1, length)
          : current + 1
        : loop
          ? wrapFeedIndex(current - 1, length)
          : current - 1;
    },
    [loop],
  );

  const canSettleToPhase = useCallback(
    (phase: 1 | -1) => {
      const targetIndex = getTargetIndex(phase);
      return targetIndex >= 0 && Boolean(getItemRef.current(targetIndex));
    },
    [getTargetIndex],
  );

  const getBoundedDragOffset = useCallback(
    (deltaY: number) => {
      if (deltaY === 0) return 0;

      const phase: 1 | -1 = deltaY < 0 ? -1 : 1;
      if (canSettleToPhase(phase)) return deltaY;

      return deltaY * EDGE_RESISTANCE;
    },
    [canSettleToPhase],
  );

  const handleDragStart = useCallback(() => {
    if (switchingRef.current || totalCountRef.current <= 1) return;

    setTransitionEnabled(false);
    setSlidePhase(0);
    slidePhaseRef.current = 0;
    setIsDragging(true);
    isDraggingRef.current = true;
    setDragOffsetPx(0);
    dragOffsetRef.current = 0;
  }, []);

  const handleDragMove = useCallback(
    ({ deltaY }: { deltaY: number; deltaX: number }) => {
      if (switchingRef.current || totalCountRef.current <= 1) return;

      if (!isDraggingRef.current) {
        setIsDragging(true);
        isDraggingRef.current = true;
        setTransitionEnabled(false);
      }

      const nextOffset = getBoundedDragOffset(deltaY);
      setDragOffsetPx(nextOffset);
      dragOffsetRef.current = nextOffset;
    },
    [getBoundedDragOffset],
  );

  const handleDragEnd = useCallback(
    ({
      deltaY,
      deltaX,
      velocityY,
      viewportHeight,
    }: {
      deltaY: number;
      deltaX: number;
      velocityY: number;
      viewportHeight: number;
    }) => {
      if (!isDraggingRef.current) return false;

      const absY = Math.abs(deltaY);
      const absX = Math.abs(deltaX);

      if (absY <= absX || absY < 1) {
        setTransitionEnabled(true);
        setIsDragging(false);
        isDraggingRef.current = false;
        setDragOffsetPx(0);
        dragOffsetRef.current = 0;
        return false;
      }

      const phase: 1 | -1 = deltaY < 0 ? -1 : 1;
      const distancePassed = absY > viewportHeight * DRAG_DISTANCE_RATIO;
      const velocityPassed = Math.abs(velocityY) > DRAG_VELOCITY_THRESHOLD;
      const shouldCommit =
        canSettleToPhase(phase) && (distancePassed || velocityPassed);

      setTransitionEnabled(true);
      setIsDragging(false);
      isDraggingRef.current = false;
      setDragOffsetPx(0);
      dragOffsetRef.current = 0;

      if (!shouldCommit) {
        setSlidePhase(0);
        slidePhaseRef.current = 0;
        return true;
      }

      const current = activeIndexRef.current;
      switchingRef.current = true;
      setIsSettling(true);
      onBeforeSlide?.(current);
      onExitImmersive?.();
      setSlidePhase(phase);
      slidePhaseRef.current = phase;
      scheduleSwitchFallback(phase);
      return true;
    },
    [
      canSettleToPhase,
      onBeforeSlide,
      onExitImmersive,
      scheduleSwitchFallback,
    ],
  );

  const handleDragCancel = useCallback(() => {
    if (!isDraggingRef.current) return;

    setTransitionEnabled(true);
    setIsDragging(false);
    isDraggingRef.current = false;
    setDragOffsetPx(0);
    dragOffsetRef.current = 0;
    setSlidePhase(0);
    slidePhaseRef.current = 0;
  }, []);

  const scrollToIndex = useCallback(
    (index: number) => {
      const length = totalCountRef.current;
      const clamped = Math.max(0, Math.min(length - 1, index));
      const prevIndex = activeIndexRef.current;

      if (clamped === prevIndex) return clamped;
      if (!getItemRef.current(clamped)) {
        throw new Error(`Feed item not loaded at index ${clamped}`);
      }

      if (switchTimerRef.current) {
        window.clearTimeout(switchTimerRef.current);
        switchTimerRef.current = null;
      }

      switchingRef.current = false;
      onBeforeSlide?.(prevIndex);
      setTransitionEnabled(false);
      setSlidePhase(0);
      slidePhaseRef.current = 0;
      activeIndexRef.current = clamped;
      setActiveIndex(clamped);

      requestAnimationFrame(() => {
        setTransitionEnabled(true);
      });

      onSlideChange(
        clamped,
        prevIndex,
        isLoopSlide(prevIndex, clamped, length, loop),
      );

      return clamped;
    },
    [loop, onBeforeSlide, onSlideChange],
  );

  const scrollToVideoId = useCallback(
    (videoId: string, findIndex: (videoId: string) => number) => {
      const index = findIndex(videoId);
      if (index < 0) {
        throw new Error(`Video not loaded: ${videoId}`);
      }
      return scrollToIndex(index);
    },
    [scrollToIndex],
  );

  const scrollToUrl = useCallback(
    (url: string, findIndex: (url: string) => number) => {
      const index = findIndex(url);
      if (index < 0) {
        throw new Error(`Video not loaded: ${url}`);
      }
      return scrollToIndex(index);
    },
    [scrollToIndex],
  );

  const handleTrackTransitionEnd = useCallback(
    (
      event: React.TransitionEvent<HTMLDivElement>,
      track: HTMLDivElement | null,
    ) => {
      if (event.target !== track || event.propertyName !== "transform") {
        return;
      }

      if (!switchingRef.current) return;

      const phase = slidePhaseRef.current;
      if (phase === 0) {
        finishSwitch();
        return;
      }

      commitSlide(phase);
    },
    [commitSlide, finishSwitch],
  );

  useEffect(() => {
    const length = totalCount;
    if (length === 0) return;

    if (switchTimerRef.current) {
      window.clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }

    switchingRef.current = false;

    const clamped = Math.min(
      Math.max(activeIndexRef.current, 0),
      length - 1,
    );

    activeIndexRef.current = clamped;
    setActiveIndex(clamped);
    setSlidePhase(0);
    slidePhaseRef.current = 0;
    setDragOffsetPx(0);
    dragOffsetRef.current = 0;
    setIsDragging(false);
    isDraggingRef.current = false;
    setTransitionEnabled(true);
  }, [totalCount]);

  return {
    loop,
    slots,
    slotsRef,
    activeIndex,
    activeIndexRef,
    slidePhase,
    slidePhaseRef,
    dragOffsetPx,
    isDragging,
    isSettling,
    transitionEnabled,
    setTransitionEnabled,
    goNext,
    goPrev,
    scrollToIndex,
    scrollToVideoId,
    scrollToUrl,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
    handleTrackTransitionEnd,
  };
}
