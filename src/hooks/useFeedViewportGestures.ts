import { useEffect, useRef } from "react";
import { isPlayerInteractiveTarget } from "@/lib/pointer-utils";

const SWIPE_THRESHOLD = 56;
const TAP_MOVEMENT_THRESHOLD = 12;

type UseFeedViewportGesturesOptions = {
  enabled?: boolean;
  swipeEnabled?: boolean;
  tapEnabled?: boolean;
  viewportRef: React.RefObject<HTMLElement | null>;
  onSwipeNext?: () => void;
  onSwipePrev?: () => void;
  onTap?: () => void;
};

export function useFeedViewportGestures({
  enabled = true,
  swipeEnabled = true,
  tapEnabled = true,
  viewportRef,
  onSwipeNext,
  onSwipePrev,
  onTap,
}: UseFeedViewportGesturesOptions) {
  const onSwipeNextRef = useRef(onSwipeNext);
  const onSwipePrevRef = useRef(onSwipePrev);
  const onTapRef = useRef(onTap);

  onSwipeNextRef.current = onSwipeNext;
  onSwipePrevRef.current = onSwipePrev;
  onTapRef.current = onTap;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !enabled) return;

    let startY = 0;
    let startX = 0;
    let tracking = false;
    let startedOnControls = false;
    let movedBeyondTap = false;

    const reset = () => {
      tracking = false;
      startedOnControls = false;
      movedBeyondTap = false;
    };

    const completeGesture = (deltaY: number, deltaX: number) => {
      const absY = Math.abs(deltaY);
      const absX = Math.abs(deltaX);

      if (
        tapEnabled &&
        !movedBeyondTap &&
        absY < SWIPE_THRESHOLD &&
        absX < SWIPE_THRESHOLD
      ) {
        onTapRef.current?.();
        return;
      }

      if (!swipeEnabled || absY < SWIPE_THRESHOLD || absY <= absX) return;

      if (deltaY < 0) {
        onSwipeNextRef.current?.();
        return;
      }

      onSwipePrevRef.current?.();
    };

    const onTouchStart = (event: TouchEvent) => {
      startedOnControls = isPlayerInteractiveTarget(event.target);
      if (startedOnControls) return;

      const touch = event.touches[0];
      if (!touch) return;

      tracking = true;
      movedBeyondTap = false;
      startY = touch.clientY;
      startX = touch.clientX;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || startedOnControls) return;

      const touch = event.touches[0];
      if (!touch) return;

      const deltaY = touch.clientY - startY;
      const deltaX = touch.clientX - startX;

      if (
        Math.abs(deltaY) > TAP_MOVEMENT_THRESHOLD ||
        Math.abs(deltaX) > TAP_MOVEMENT_THRESHOLD
      ) {
        movedBeyondTap = true;
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!tracking || startedOnControls) {
        reset();
        return;
      }

      const touch = event.changedTouches[0];
      if (!touch) {
        reset();
        return;
      }

      const deltaY = touch.clientY - startY;
      const deltaX = touch.clientX - startX;
      reset();
      completeGesture(deltaY, deltaX);
    };

    const onTouchCancel = () => {
      reset();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      startedOnControls = isPlayerInteractiveTarget(event.target);
      if (startedOnControls) return;

      tracking = true;
      movedBeyondTap = false;
      startY = event.clientY;
      startX = event.clientX;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;

      if (!tracking || startedOnControls) {
        reset();
        return;
      }

      const deltaY = event.clientY - startY;
      const deltaX = event.clientX - startX;
      reset();
      completeGesture(deltaY, deltaX);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      reset();
    };

    const supportsTouch =
      typeof window !== "undefined" &&
      ("ontouchstart" in window || navigator.maxTouchPoints > 0);

    if (supportsTouch) {
      viewport.addEventListener("touchstart", onTouchStart, {
        capture: true,
        passive: true,
      });
      viewport.addEventListener("touchmove", onTouchMove, {
        capture: true,
        passive: true,
      });
      viewport.addEventListener("touchend", onTouchEnd, { capture: true });
      viewport.addEventListener("touchcancel", onTouchCancel, { capture: true });
    } else {
      viewport.addEventListener("pointerdown", onPointerDown, { capture: true });
      viewport.addEventListener("pointerup", onPointerUp, { capture: true });
      viewport.addEventListener("pointercancel", onPointerCancel, {
        capture: true,
      });
    }

    return () => {
      if (supportsTouch) {
        viewport.removeEventListener("touchstart", onTouchStart, {
          capture: true,
        });
        viewport.removeEventListener("touchmove", onTouchMove, { capture: true });
        viewport.removeEventListener("touchend", onTouchEnd, { capture: true });
        viewport.removeEventListener("touchcancel", onTouchCancel, {
          capture: true,
        });
        return;
      }

      viewport.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
      viewport.removeEventListener("pointerup", onPointerUp, { capture: true });
      viewport.removeEventListener("pointercancel", onPointerCancel, {
        capture: true,
      });
    };
  }, [enabled, swipeEnabled, tapEnabled, viewportRef]);
}
