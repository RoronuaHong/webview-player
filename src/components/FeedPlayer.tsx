"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Player from "xgplayer";
import XgPlayer from "@/components/XgPlayer";
import { useFeedBridge } from "@/hooks/useFeedBridge";
import { useFeedCarousel } from "@/hooks/useFeedCarousel";
import { useFeedRestoreAndUrlSync } from "@/hooks/useFeedRestoreAndUrlSync";
import { useFeedSession } from "@/hooks/useFeedSession";
import { useFeedViewportGestures } from "@/hooks/useFeedViewportGestures";
import { useImmersivePlayerLayout } from "@/hooks/useImmersivePlayerLayout";
import { getFeedTrackTransform, toTranslateIndex } from "@/lib/feed-carousel";
import { playbackStore } from "@/lib/playback-store";
import { safePlayerPlay } from "@/lib/webview-playback";
import {
  getWebViewPerformanceProfile,
  shouldMountFeedPlayer,
} from "@/lib/webview-runtime";
import type { FeedItem, PlaybackRate, VideoDefinition } from "@/types/feed";

type FeedPlayerProps = {
  items: FeedItem[];
  initialIndex?: number;
  isLive?: boolean;
  bridgeName?: string;
};

export default function FeedPlayer({
  items,
  initialIndex = 0,
  isLive = false,
  bridgeName = "WebViewBridge",
}: FeedPlayerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const playersRef = useRef<Map<string, Player>>(new Map());
  const itemsRef = useRef(items);
  const bridgeRef = useRef<import("@/lib/jsbridge").PlayerBridge | null>(null);
  const perfProfileRef = useRef(getWebViewPerformanceProfile());
  const [lowEndClass, setLowEndClass] = useState("");

  itemsRef.current = items;

  const definitionsById = useMemo(() => {
    const map = new Map<string, VideoDefinition[]>();
    items.forEach((item) => {
      if (item.definitions?.length) {
        map.set(item.id, item.definitions);
      }
    });
    return map;
  }, [items]);

  const saveProgressByIndexRef = useRef<(index: number, immediate?: boolean) => void>(
    () => {},
  );
  const persistFeedPositionRef = useRef<(index: number) => void>(() => {});
  const exitImmersiveRef = useRef<() => void>(() => {});

  const onSlideChange = useCallback(
    (targetIndex: number, prevIndex: number, isLoop: boolean) => {
      const nextItem = itemsRef.current[targetIndex];
      persistFeedPositionRef.current(targetIndex);
      bridgeRef.current?.emit("slide_change", {
        index: targetIndex,
        prevIndex,
        loop: isLoop,
        videoId: nextItem?.id,
        url: nextItem?.url,
        progress: nextItem ? playbackStore.get(nextItem.id) : undefined,
      });
    },
    [],
  );

  const carousel = useFeedCarousel({
    items,
    initialIndex,
    onBeforeSlide: (prevIndex) => {
      saveProgressByIndexRef.current(prevIndex, true);
    },
    onSlideChange,
    onExitImmersive: () => exitImmersiveRef.current(),
  });

  const {
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
  } = carousel;

  const getActiveItem = useCallback(
    () => itemsRef.current[activeIndexRef.current],
    [activeIndexRef],
  );

  const getPlayerByRealIndex = useCallback(
    (index: number) => {
      const displayIndex = toTranslateIndex(index, loop);
      const displayItem = displayItemsRef.current[displayIndex];
      if (!displayItem) return null;
      return playersRef.current.get(displayItem.displayKey) ?? null;
    },
    [displayItemsRef, loop],
  );

  const getActivePlayer = useCallback(() => {
    const displayItem = displayItemsRef.current[translateIndexRef.current];
    if (!displayItem) return null;
    return playersRef.current.get(displayItem.displayKey) ?? null;
  }, [displayItemsRef, translateIndexRef]);

  const session = useFeedSession({
    itemsRef,
    activeIndexRef,
    getActiveItem,
    getPlayerByRealIndex,
    bridgeRef,
  });

  saveProgressByIndexRef.current = session.saveProgressByIndex;
  persistFeedPositionRef.current = session.persistFeedPosition;

  const immersive = useImmersivePlayerLayout({
    viewportRef,
    trackRef,
    translateIndex,
    translateIndexRef,
    activeIndex,
    getActivePlayer,
    setTransitionEnabled,
  });

  exitImmersiveRef.current = immersive.exitImmersive;

  useFeedBridge({
    sessionId: session.sessionId,
    bridgeName,
    bridgeRef,
    items,
    itemsRef,
    activeIndexRef,
    playersRef,
    definitionsById,
    getActiveItem,
    getActivePlayer,
    scrollToIndex,
    scrollToVideoId,
    scrollToUrl,
    saveActiveProgress: session.saveActiveProgress,
    onDefinitionChange: (videoId, index, definition) => {
      bridgeRef.current?.emit("definition_change", {
        videoId,
        definition: definition.definition,
        url: definition.url,
        index,
      });
    },
  });

  useFeedRestoreAndUrlSync({
    items,
    initialIndex,
    activeIndexRef,
    scrollToIndex,
    persistFeedPosition: session.persistFeedPosition,
  });

  useEffect(() => {
    setLowEndClass(
      perfProfileRef.current.lowEnd ? " feed-viewport--low-end" : "",
    );
  }, []);

  useEffect(() => {
    const handlePageHide = () => {
      session.saveActiveProgress(true);
      session.saveActiveFeedPosition();
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [session.saveActiveFeedPosition, session.saveActiveProgress]);

  const handlePlayerInstance = useCallback(
    (displayKey: string, player: Player | null) => {
      if (player) {
        playersRef.current.set(displayKey, player);
        return;
      }
      playersRef.current.delete(displayKey);
    },
    [],
  );

  const handlePlaybackRateChange = useCallback(
    (videoId: string, index: number, rate: PlaybackRate) => {
      bridgeRef.current?.emit("playback_rate_change", {
        rate,
        videoId,
        index,
      });
    },
    [],
  );

  const handlePlaybackError = useCallback(
    (videoId: string, index: number, error: unknown) => {
      bridgeRef.current?.emit("error", {
        videoId,
        index,
        message: error instanceof Error ? error.message : String(error),
      });
    },
    [],
  );

  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;

  const goPrevRef = useRef(goPrev);
  goPrevRef.current = goPrev;

  useFeedViewportGestures({
    enabled: items.length > 0,
    swipeEnabled: !immersive.isImmersive,
    tapEnabled: true,
    viewportRef,
    onSwipeNext: () => goNextRef.current(),
    onSwipePrev: () => goPrevRef.current(),
    onTap: () => {
      const player = getActivePlayer();
      if (!player) return;
      if (player.paused) {
        void safePlayerPlay(player);
      } else {
        player.pause();
      }
    },
  });

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-sm text-white/70">
        暂无可播放视频
      </div>
    );
  }

  const immersiveModeClass =
    immersive.immersiveOrientation === "landscape"
      ? "feed-immersive--landscape"
      : "feed-immersive--portrait";

  const trackTransform = getFeedTrackTransform(
    translateIndex,
    immersive.isImmersive && immersive.immersiveOrientation === "landscape",
  );

  const mountRadius = perfProfileRef.current.playerMountRadius;

  return (
    <div
      ref={viewportRef}
      className={`feed-viewport relative h-full w-full overflow-hidden bg-black${lowEndClass}${immersive.isImmersive ? ` feed-immersive ${immersiveModeClass}` : ""}`}
    >
      <div
        ref={trackRef}
        className={`feed-track flex flex-col${transitionEnabled ? "" : " feed-track--instant"}`}
        style={{ transform: trackTransform }}
        onTransitionEnd={(event) =>
          handleTrackTransitionEnd(event, trackRef.current)
        }
      >
        {displayItems.map((item, displayIndex) => {
          const isActive = displayIndex === translateIndex;
          const isClone = item.displayKey.includes("__clone");
          const shouldMount = shouldMountFeedPlayer(
            displayIndex,
            translateIndex,
            mountRadius,
          );

          return (
            <section
              key={item.displayKey}
              data-index={item.realIndex}
              data-active={isActive ? "true" : "false"}
              className="feed-card relative w-full shrink-0"
            >
              <XgPlayer
                videoId={item.id}
                url={item.url}
                poster={item.poster}
                enabled={shouldMount}
                active={isActive}
                isLive={isLive}
                isImmersive={isActive && immersive.isImmersive}
                onToggleImmersive={isActive ? immersive.toggleImmersive : undefined}
                onVideoOrientation={(orientation) =>
                  immersive.handleVideoOrientation(displayIndex, orientation)
                }
                startTime={0}
                definitions={item.definitions}
                defaultDefinition={item.defaultDefinition}
                onEnded={
                  isActive &&
                  !isClone &&
                  item.realIndex === activeIndexRef.current
                    ? () => goNextRef.current()
                    : undefined
                }
                onPlayerInstance={(_videoId, player) =>
                  handlePlayerInstance(item.displayKey, player)
                }
                onPlaybackRateChange={(rate) =>
                  handlePlaybackRateChange(item.id, item.realIndex, rate)
                }
                onDefinitionChange={(definition) => {
                  bridgeRef.current?.emit("definition_change", {
                    videoId: item.id,
                    definition: definition.definition,
                    url: definition.url,
                    index: item.realIndex,
                  });
                }}
                onPlaybackError={(error) =>
                  handlePlaybackError(item.id, item.realIndex, error)
                }
              />

              {item.title ? (
                <div className="pointer-events-none absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-50 rounded-full bg-black/40 px-3 py-1 text-xs text-white/90">
                  {item.title}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {!immersive.isImmersive ? (
        <div className="pointer-events-none absolute right-3 top-[max(1rem,env(safe-area-inset-top))] z-50 rounded-full bg-black/40 px-2 py-1 text-[10px] text-white/70">
          {activeIndex + 1}/{items.length}
        </div>
      ) : null}
    </div>
  );
}
