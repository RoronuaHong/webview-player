"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Player from "xgplayer";
import {
  runAfterDoubleFrame,
  syncImmersiveViewportMetrics,
  createLayoutRefreshHandler,
} from "@/lib/immersive-viewport";
import { snapTrackElement } from "@/lib/feed-carousel";
import { readPlayerVideoOrientation, type VideoOrientation } from "@/lib/video-orientation";
import { getWebViewPerformanceProfile } from "@/lib/webview-runtime";

type UseImmersivePlayerLayoutOptions = {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  trackRef: React.RefObject<HTMLDivElement | null>;
  translateIndex: number;
  translateIndexRef: React.RefObject<number>;
  activeIndex: number;
  getActivePlayer: () => Player | null;
  setTransitionEnabled: (enabled: boolean) => void;
};

export function useImmersivePlayerLayout({
  viewportRef,
  trackRef,
  translateIndex,
  translateIndexRef,
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
    const idx = translateIndexRef.current ?? 0;
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
        snapTrackElement(trackRef.current, idx);
        requestAnimationFrame(finishExit);
      });
      return;
    }

    snapTrackElement(trackRef.current, idx);
    finishExit();
  }, [setTransitionEnabled, trackRef, translateIndexRef]);

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
    (displayIndex: number, orientation: VideoOrientation) => {
      if (displayIndex !== translateIndexRef.current) return;
      setImmersiveOrientation(orientation);
    },
    [translateIndexRef],
  );

  useEffect(() => {
    if (isImmersiveRef.current) return;

    const player = getActivePlayer();
    if (!player) return;
    setImmersiveOrientation(readPlayerVideoOrientation(player));
  }, [translateIndex, activeIndex, getActivePlayer]);

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
  }, [isImmersive, immersiveOrientation, translateIndex, activeIndex]);

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
