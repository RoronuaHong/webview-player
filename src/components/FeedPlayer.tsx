"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Player from "xgplayer";
import XgPlayer from "@/components/XgPlayer";
import { useFeedBridge } from "@/hooks/useFeedBridge";
import { useFeedCarousel } from "@/hooks/useFeedCarousel";
import { useFeedCatalog } from "@/hooks/useFeedCatalog";
import { useFeedRestoreAndUrlSync } from "@/hooks/useFeedRestoreAndUrlSync";
import { useFeedSession } from "@/hooks/useFeedSession";
import { useFeedViewportGestures } from "@/hooks/useFeedViewportGestures";
import { useImmersivePlayerLayout } from "@/hooks/useImmersivePlayerLayout";
import {
  FEED_SLOT_ORDER,
  getSlotFeedItem,
  getSlotPreloadTier,
  getSlotRealIndex,
  getVirtualTrackTransform,
  snapVirtualTrackElement,
  type FeedSlot,
} from "@/lib/feed-carousel";
import { playbackStore } from "@/lib/playback-store";
import { playerSettings } from "@/lib/player-settings";
import {
  primePlayerPreviewFrame,
  safePlayerPlay,
} from "@/lib/webview-playback";
import { getWebViewPerformanceProfile } from "@/lib/webview-runtime";
import type { FeedItem, PlaybackRate, VideoDefinition } from "@/types/feed";

const SLOT_LAYOUT_CLASS: Record<FeedSlot, string> = {
  prev: "feed-card--slot-prev",
  current: "feed-card--slot-current",
  next: "feed-card--slot-next",
};

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

  const feedCatalog = useFeedCatalog({
    initialItems: items,
    bridgeRef,
  });

  const loadedItems = useMemo(
    () => feedCatalog.getLoadedItems(),
    [feedCatalog, feedCatalog.version],
  );
  itemsRef.current = loadedItems;
  const definitionsById = feedCatalog.definitionsById;

  const saveProgressByIndexRef = useRef<(index: number, immediate?: boolean) => void>(
    () => {},
  );
  const persistFeedPositionRef = useRef<(index: number) => void>(() => {});
  const exitImmersiveRef = useRef<() => void>(() => {});
  const primeSlotPlayersRef = useRef<() => void>(() => {});

  const onSlideChange = useCallback(
    (targetIndex: number, prevIndex: number, isLoop: boolean) => {
      const nextItem = feedCatalog.getItem(targetIndex);
      persistFeedPositionRef.current(targetIndex);

      requestAnimationFrame(() => {
        feedCatalog.ensureRangeLoaded(targetIndex);
      });

      bridgeRef.current?.emit("slide_change", {
        index: targetIndex,
        prevIndex,
        loop: isLoop,
        videoId: nextItem?.id,
        url: nextItem?.url,
        progress: nextItem ? playbackStore.get(nextItem.id) : undefined,
      });
    },
    [feedCatalog],
  );

  const carousel = useFeedCarousel({
    totalCount: feedCatalog.totalCount,
    getItem: feedCatalog.getItem,
    catalogVersion: feedCatalog.version,
    initialIndex,
    onBeforeSlide: (prevIndex) => {
      saveProgressByIndexRef.current(prevIndex, true);
      playersRef.current.forEach((player) => {
        if (!player.paused) player.pause();
      });
      requestAnimationFrame(() => {
        primeSlotPlayersRef.current();
      });
    },
    onSlideChange,
    onExitImmersive: () => exitImmersiveRef.current(),
  });

  const {
    loop,
    slots,
    slotsRef,
    activeIndex,
    activeIndexRef,
    slidePhase,
    dragOffsetPx,
    isDragging,
    isSettling,
    transitionEnabled,
    setTransitionEnabled,
    goNext,
    goPrev,
    scrollToIndex,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
    handleTrackTransitionEnd,
  } = carousel;

  const [userPaused, setUserPaused] = useState(false);
  const userPausedRef = useRef(false);
  userPausedRef.current = userPaused;

  const setPlaybackIntent = useCallback((playing: boolean) => {
    setUserPaused(!playing);
  }, []);

  useEffect(() => {
    setUserPaused(false);
  }, [activeIndex]);

  const getActiveItem = useCallback(
    () => feedCatalog.getItem(activeIndexRef.current) ?? undefined,
    [activeIndexRef, feedCatalog],
  );

  const scrollToVideoId = useCallback(
    (videoId: string) =>
      carousel.scrollToVideoId(videoId, (targetVideoId) =>
        feedCatalog.findLoadedIndex({ videoId: targetVideoId }),
      ),
    [carousel, feedCatalog],
  );

  const scrollToUrl = useCallback(
    (url: string) =>
      carousel.scrollToUrl(url, (targetUrl) =>
        feedCatalog.findLoadedIndex({ url: targetUrl }),
      ),
    [carousel, feedCatalog],
  );

  const getPlayerByRealIndex = useCallback(
    (index: number) => {
      const snapshot = slotsRef.current;
      let item: FeedItem | null = null;

      if (index === snapshot.currentIndex) item = snapshot.current;
      else if (index === snapshot.prevIndex) item = snapshot.prev;
      else if (index === snapshot.nextIndex) item = snapshot.next;

      return item ? playersRef.current.get(item.id) ?? null : null;
    },
    [slotsRef],
  );

  const getActivePlayer = useCallback(() => {
    const item = getActiveItem();
    return item ? playersRef.current.get(item.id) ?? null : null;
  }, [getActiveItem]);

  const session = useFeedSession({
    itemsRef,
    activeIndexRef,
    getActiveItem,
    getItemByIndex: feedCatalog.getItem,
    catalogId: feedCatalog.catalogId,
    getPlayerByRealIndex,
    bridgeRef,
  });

  saveProgressByIndexRef.current = session.saveProgressByIndex;
  persistFeedPositionRef.current = session.persistFeedPosition;

  const immersive = useImmersivePlayerLayout({
    viewportRef,
    trackRef,
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
    getFeedCatalogSnapshot: feedCatalog.getSnapshot,
    setFeedCatalog: feedCatalog.setCatalog,
    appendFeedItems: feedCatalog.appendItems,
    findLoadedIndex: feedCatalog.findLoadedIndex,
    onDefinitionChange: (videoId, index, definition) => {
      bridgeRef.current?.emit("definition_change", {
        videoId,
        definition: definition.definition,
        url: definition.url,
        index,
      });
    },
    setPlaybackIntent,
  });

  useFeedRestoreAndUrlSync({
    items: loadedItems,
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
      session.saveActiveFeedPosition(true);
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [session.saveActiveFeedPosition, session.saveActiveProgress]);

  const slotVideoIds = useMemo(
    () =>
      FEED_SLOT_ORDER.map((slot) => getSlotFeedItem(slots, slot)?.id ?? null).join(
        "\0",
      ),
    [slots],
  );

  const primeSlotPlayers = useCallback(() => {
    for (const slot of FEED_SLOT_ORDER) {
      if (slot === "current") continue;

      const item = getSlotFeedItem(slotsRef.current, slot);
      if (!item) continue;

      const player = playersRef.current.get(item.id);
      if (!player) continue;

      void primePlayerPreviewFrame(
        player,
        playbackStore.getStartTime(item.id),
      );
    }
  }, [slotsRef]);

  useEffect(() => {
    feedCatalog.ensureRangeLoaded(activeIndex);
  }, [activeIndex, feedCatalog]);

  useEffect(() => {
    primeSlotPlayers();
  }, [slotVideoIds, primeSlotPlayers]);

  useEffect(() => {
    if (slidePhase === 0 && !isDragging) return;
    primeSlotPlayers();
  }, [isDragging, primeSlotPlayers, slidePhase]);

  primeSlotPlayersRef.current = primeSlotPlayers;

  const syncFeedPlayback = useCallback(() => {
    const currentItem = feedCatalog.getItem(activeIndexRef.current);
    if (!currentItem) return;

    playersRef.current.forEach((player, videoId) => {
      if (videoId !== currentItem.id && !player.paused) {
        player.pause();
      }
    });

    if (userPausedRef.current) return;

    const player = playersRef.current.get(currentItem.id);
    if (!player) return;

    const resumeAt = playbackStore.getStartTime(currentItem.id);
    if (resumeAt > 0 && Math.abs((player.currentTime ?? 0) - resumeAt) > 0.5) {
      player.currentTime = resumeAt;
    }
    player.playbackRate = playerSettings.getPlaybackRate();
    void safePlayerPlay(player);
  }, [activeIndexRef, feedCatalog]);

  useEffect(() => {
    if (isSettling || slidePhase !== 0) return;
    syncFeedPlayback();
  }, [activeIndex, isSettling, slidePhase, syncFeedPlayback]);

  useEffect(() => {
    if (slidePhase !== 0 || transitionEnabled) return;
    snapVirtualTrackElement(trackRef.current, 0);
  }, [activeIndex, slidePhase, transitionEnabled]);

  const handlePlayerInstance = useCallback(
    (videoId: string, player: Player | null) => {
      if (player) {
        playersRef.current.set(videoId, player);

        const currentItem = feedCatalog.getItem(activeIndexRef.current);
        if (currentItem?.id !== videoId) {
          void primePlayerPreviewFrame(
            player,
            playbackStore.getStartTime(videoId),
          );
        }
        return;
      }
      playersRef.current.delete(videoId);
    },
    [activeIndexRef, feedCatalog],
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

  const onDragStart = useCallback(() => {
    handleDragStart();
  }, [handleDragStart]);

  useFeedViewportGestures({
    enabled: feedCatalog.totalCount > 0,
    swipeEnabled: !immersive.isImmersive,
    tapEnabled: true,
    viewportRef,
    onSwipeNext: () => goNextRef.current(),
    onSwipePrev: () => goPrevRef.current(),
    onDragStart,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onDragCancel: handleDragCancel,
    onTap: () => {
      const player = getActivePlayer();
      if (!player) return;
      if (player.paused) {
        setPlaybackIntent(true);
        void safePlayerPlay(player);
      } else {
        setPlaybackIntent(false);
        player.pause();
      }
    },
  });

  if (feedCatalog.totalCount === 0) {
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

  const trackTransform = getVirtualTrackTransform(
    slidePhase,
    dragOffsetPx,
    immersive.isImmersive && immersive.immersiveOrientation === "landscape",
  );
  const visualSlide =
    slidePhase !== 0
      ? slidePhase
      : dragOffsetPx < 0
        ? -1
        : dragOffsetPx > 0
          ? 1
          : 0;

  return (
    <div
      ref={viewportRef}
      className={`feed-viewport relative h-full w-full overflow-hidden bg-black${lowEndClass}${immersive.isImmersive ? ` feed-immersive ${immersiveModeClass}` : ""}`}
    >
      <div
        ref={trackRef}
        className={`feed-track feed-track--virtual${transitionEnabled ? "" : " feed-track--instant"}${isDragging ? " feed-track--dragging" : ""}${isSettling || slidePhase !== 0 ? " feed-track--settling" : ""}`}
        data-slide={visualSlide === 0 ? undefined : String(visualSlide)}
        style={{ transform: trackTransform }}
        onTransitionEnd={(event) =>
          handleTrackTransitionEnd(event, trackRef.current)
        }
      >
        {FEED_SLOT_ORDER.map((slot) => {
          const item = getSlotFeedItem(slots, slot);
          const realIndex = getSlotRealIndex(slots, slot);
          const isActive = slot === "current";
          const hasItem = item !== null;
          return (
            <section
              key={slot}
              data-slot={slot}
              data-index={realIndex}
              data-active={isActive ? "true" : "false"}
              className={`feed-card ${SLOT_LAYOUT_CLASS[slot]} relative w-full h-full`}
            >
              {hasItem ? (
                <div className="feed-slot-media relative h-full w-full">
                  <div className="feed-slot-player-host h-full w-full">
                    <XgPlayer
                      key={item.id}
                      videoId={item.id}
                      url={item.url}
                      poster={item.poster}
                      enabled
                      active={isActive}
                      autoPlay={isActive && !userPaused}
                      primePreview
                      preloadTier={getSlotPreloadTier(slot)}
                      isLive={isLive}
                      isImmersive={isActive && immersive.isImmersive}
                      onToggleImmersive={
                        isActive ? immersive.toggleImmersive : undefined
                      }
                      onVideoOrientation={(orientation) =>
                        immersive.handleVideoOrientation(slot, orientation)
                      }
                      startTime={0}
                      definitions={item.definitions}
                      defaultDefinition={item.defaultDefinition}
                      onEnded={
                        isActive &&
                        (loop ||
                          activeIndexRef.current < feedCatalog.totalCount - 1)
                          ? () => goNextRef.current()
                          : undefined
                      }
                      onPlayerInstance={handlePlayerInstance}
                      onPlaybackRateChange={(rate) =>
                        handlePlaybackRateChange(item.id, realIndex, rate)
                      }
                      onDefinitionChange={(definition) => {
                        bridgeRef.current?.emit("definition_change", {
                          videoId: item.id,
                          definition: definition.definition,
                          url: definition.url,
                          index: realIndex,
                        });
                      }}
                      onPlaybackError={(error) =>
                        handlePlaybackError(item.id, realIndex, error)
                      }
                      onPlaybackIntentChange={
                        isActive ? setPlaybackIntent : undefined
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="portrait-player relative h-full w-full bg-black" />
              )}

              {item?.title ? (
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
          {activeIndex + 1}/{feedCatalog.totalCount}
        </div>
      ) : null}
    </div>
  );
}
