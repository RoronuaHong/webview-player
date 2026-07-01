import { useRef } from "react";
import {
  isPlayerInteractiveTarget,
  safeReleasePointerCapture,
} from "@/lib/pointer-utils";

const SWIPE_THRESHOLD = 56;

type UseVerticalSwipeOptions = {
  enabled?: boolean;
  onSwipeNext?: () => void;
  onSwipePrev?: () => void;
  onTap?: () => void;
};

export function useVerticalSwipe({
  enabled = true,
  onSwipeNext,
  onSwipePrev,
  onTap,
}: UseVerticalSwipeOptions) {
  const touchStartYRef = useRef(0);
  const touchStartXRef = useRef(0);
  const trackingRef = useRef(false);
  const startedOnControlsRef = useRef(false);
  const onSwipeNextRef = useRef(onSwipeNext);
  const onSwipePrevRef = useRef(onSwipePrev);
  const onTapRef = useRef(onTap);

  onSwipeNextRef.current = onSwipeNext;
  onSwipePrevRef.current = onSwipePrev;
  onTapRef.current = onTap;

  const resetTracking = () => {
    trackingRef.current = false;
    startedOnControlsRef.current = false;
  };

  const completeGesture = (deltaY: number, deltaX: number) => {
    const absY = Math.abs(deltaY);
    const absX = Math.abs(deltaX);

    if (absY < SWIPE_THRESHOLD && absX < SWIPE_THRESHOLD) {
      onTapRef.current?.();
      return;
    }

    if (absY < SWIPE_THRESHOLD || absY <= absX) return;

    if (deltaY < 0) {
      onSwipeNextRef.current?.();
      return;
    }

    onSwipePrevRef.current?.();
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!enabled) return;

    startedOnControlsRef.current = isPlayerInteractiveTarget(event.target);
    if (startedOnControlsRef.current) return;

    const touch = event.touches[0];
    if (!touch) return;

    trackingRef.current = true;
    touchStartYRef.current = touch.clientY;
    touchStartXRef.current = touch.clientX;
    event.stopPropagation();
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    event.stopPropagation();

    if (!enabled || !trackingRef.current || startedOnControlsRef.current) {
      resetTracking();
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) {
      resetTracking();
      return;
    }

    const deltaY = touch.clientY - touchStartYRef.current;
    const deltaX = touch.clientX - touchStartXRef.current;
    resetTracking();
    completeGesture(deltaY, deltaX);
  };

  const handleTouchCancel = (event: React.TouchEvent<HTMLDivElement>) => {
    event.stopPropagation();
    resetTracking();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType === "touch") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    startedOnControlsRef.current = isPlayerInteractiveTarget(event.target);
    if (startedOnControlsRef.current) return;

    trackingRef.current = true;
    touchStartYRef.current = event.clientY;
    touchStartXRef.current = event.clientX;
    event.stopPropagation();

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore capture errors from DevTools or unsupported browsers
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();

    if (event.pointerType === "touch") return;

    safeReleasePointerCapture(event.currentTarget, event.pointerId);

    if (!enabled || !trackingRef.current || startedOnControlsRef.current) {
      resetTracking();
      return;
    }

    const deltaY = event.clientY - touchStartYRef.current;
    const deltaX = event.clientX - touchStartXRef.current;
    resetTracking();
    completeGesture(deltaY, deltaX);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();

    if (event.pointerType !== "touch") {
      safeReleasePointerCapture(event.currentTarget, event.pointerId);
    }

    resetTracking();
  };

  return {
    handleTouchStart,
    handleTouchEnd,
    handleTouchCancel,
    handlePointerDown,
    handlePointerUp,
    handlePointerCancel,
  };
}
