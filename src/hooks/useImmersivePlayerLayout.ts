"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Player from "xgplayer";
import {
  runAfterDoubleFrame,
  syncImmersiveViewportMetrics,
  createLayoutRefreshHandler,
} from "@/lib/immersive-viewport";
import {
  snapVirtualTrackElement,
  type FeedSlot,
} from "@/lib/feed-carousel";
import { readPlayerVideoOrientation, type VideoOrientation } from "@/lib/video-orientation";
import { getWebViewPerformanceProfile } from "@/lib/webview-runtime";

type UseImmersivePlayerLayoutOptions = {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  trackRef: React.RefObject<HTMLDivElement | null>;
  activeIndex: number;
  getActivePlayer: () => Player | null;
  setTransitionEnabled: (enabled: boolean) => void;
};

export function useImmersivePlayerLayout({
  viewportRef,
  trackRef,
  activeIndex,
  getActivePlayer,
  setTransitionEnabled,
}: UseImmersivePlayerLayoutOptions) {
  const [isImmersive, setIsImmersive] = useState(false);
  const isImmersiveRef = useRef(false);
  const [immersiveOrientation, setImmersiveOrientation] =
    useState<VideoOrientation>("portrait");
  const immersiveOrientationRef = useRef<VideoOrientation>("portrait");
  const perfProfileRef = useRef(getWebViewPerformanceProfile());

  isImmersiveRef.current = isImmersive;
  immersiveOrientationRef.current = immersiveOrientation;

  const layoutRefreshRef = useRef(
    createLayoutRefreshHandler(
      () => {
        syncImmersiveViewportMetrics(viewportRef.current);
        getActivePlayer()?.resize?.();
      },
      perfProfileRef.current.resizeDebounceMs,
    ),
  );

  const exitImmersive = useCallback(() => {
    if (!isImmersiveRef.current) return;

    setTransitionEnabled(false);
    const wasLandscape = immersiveOrientationRef.current === "landscape";

    const finishExit = () => {
      setIsImmersive(false);
      runAfterDoubleFrame(() => {
        setTransitionEnabled(true);
      });
    };

    if (wasLandscape) {
      setImmersiveOrientation("portrait");
      requestAnimationFrame(() => {
        snapVirtualTrackElement(trackRef.current, 0);
        requestAnimationFrame(finishExit);
      });
      return;
    }

    snapVirtualTrackElement(trackRef.current, 0);
    finishExit();
  }, [setTransitionEnabled, trackRef]);

  const toggleImmersive = useCallback(() => {
    if (isImmersiveRef.current) {
      exitImmersive();
      return;
    }

    const player = getActivePlayer();
    if (player) {
      setImmersiveOrientation(readPlayerVideoOrientation(player));
    }

    setIsImmersive(true);
    setTransitionEnabled(false);
    layoutRefreshRef.current.refreshNow();

    runAfterDoubleFrame(() => {
      layoutRefreshRef.current.refreshNow();
      setTransitionEnabled(true);
    });
  }, [exitImmersive, getActivePlayer, setTransitionEnabled]);

  const handleVideoOrientation = useCallback(
    (slot: FeedSlot, orientation: VideoOrientation) => {
      if (slot !== "current") return;
      setImmersiveOrientation(orientation);
    },
    [],
  );

  useEffect(() => {
    if (isImmersiveRef.current) return;

    const player = getActivePlayer();
    if (!player) return;
    setImmersiveOrientation(readPlayerVideoOrientation(player));
  }, [activeIndex, getActivePlayer]);

  useEffect(() => {
    const layout = layoutRefreshRef.current;

    const onLayoutChange = () => {
      layout.refresh();
    };

    layout.refresh();

    window.addEventListener("orientationchange", onLayoutChange);
    window.visualViewport?.addEventListener("resize", onLayoutChange);

    return () => {
      layout.cancel();
      window.removeEventListener("orientationchange", onLayoutChange);
      window.visualViewport?.removeEventListener("resize", onLayoutChange);
    };
  }, [isImmersive, immersiveOrientation, activeIndex]);

  return {
    isImmersive,
    isImmersiveRef,
    immersiveOrientation,
    exitImmersive,
    toggleImmersive,
    handleVideoOrientation,
    layoutRefreshRef,
  };
}
