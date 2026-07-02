"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Player from "xgplayer";
import XgPlayer from "@/components/XgPlayer";
import { useFeedViewportGestures } from "@/hooks/useFeedViewportGestures";
import {
  buildDisplayItems,
  FEED_TRANSITION_MS,
  getFeedTrackTransform,
  snapTrackElement,
  toRealIndex,
  toTranslateIndex,
} from "@/lib/feed-carousel";
import { findDefinition, findFeedItemIndex, resolveSavedFeedIndex, syncFeedPositionToUrl, toXgDefinitionList } from "@/lib/feed-utils";
import { feedPositionStore } from "@/lib/feed-position-store";
import {
  runAfterDoubleFrame,
  syncImmersiveViewportMetrics,
  createLayoutRefreshHandler,
} from "@/lib/immersive-viewport";
import { PlayerBridge } from "@/lib/jsbridge";
import { lifecycleManager } from "@/lib/lifecycle-manager";
import { changePlayerDefinition } from "@/lib/player-definition";
import { playbackStore } from "@/lib/playback-store";
import { playerSettings } from "@/lib/player-settings";
import { readPlayerVideoOrientation, type VideoOrientation } from "@/lib/video-orientation";
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
  const bridgeRef = useRef<PlayerBridge | null>(null);
  const itemsRef = useRef(items);
  const definitionsRef = useRef<Map<string, VideoDefinition[]>>(new Map());
  const switchingRef = useRef(false);
  const translateIndexRef = useRef(0);
  const pendingSlideRef = useRef<{ target: number; prev: number } | null>(null);
  const pendingSnapRef = useRef<"head" | "tail" | null>(null);
  const switchTimerRef = useRef<number | null>(null);
  const perfProfileRef = useRef(getWebViewPerformanceProfile());

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
  const [isImmersive, setIsImmersive] = useState(false);
  const isImmersiveRef = useRef(false);
  const [immersiveOrientation, setImmersiveOrientation] =
    useState<VideoOrientation>("portrait");
  const immersiveOrientationRef = useRef<VideoOrientation>("portrait");
  const [lowEndClass, setLowEndClass] = useState("");

  translateIndexRef.current = translateIndex;
  itemsRef.current = items;
  activeIndexRef.current = activeIndex;
  isImmersiveRef.current = isImmersive;
  immersiveOrientationRef.current = immersiveOrientation;

  items.forEach((item) => {
    if (item.definitions?.length) {
      definitionsRef.current.set(item.id, item.definitions);
    }
  });

  const getActiveItem = () => itemsRef.current[activeIndexRef.current];

  const getPlayerByRealIndex = (index: number) => {
    const displayIndex = toTranslateIndex(index, loop);
    const displayItem = displayItemsRef.current[displayIndex];
    if (!displayItem) return null;
    return playersRef.current.get(displayItem.displayKey) ?? null;
  };

  const getActivePlayer = () => {
    const displayItem = displayItemsRef.current[translateIndexRef.current];
    if (!displayItem) return null;
    return playersRef.current.get(displayItem.displayKey) ?? null;
  };

  const getItemDefinitions = (videoId?: string) => {
    if (!videoId) return [];
    return definitionsRef.current.get(videoId) ?? [];
  };

  const exitImmersive = useCallback(() => {
    if (!isImmersiveRef.current) return;

    setTransitionEnabled(false);
    const idx = translateIndexRef.current;
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
  }, []);

  const layoutRefreshRef = useRef(
    createLayoutRefreshHandler(
      () => {
        syncImmersiveViewportMetrics(viewportRef.current);
        getActivePlayer()?.resize?.();
      },
      perfProfileRef.current.resizeDebounceMs,
    ),
  );

  useEffect(() => {
    setLowEndClass(
      perfProfileRef.current.lowEnd ? " feed-viewport--low-end" : "",
    );
  }, []);

  const saveProgressByIndex = useCallback((index: number, immediate = true) => {
    const item = itemsRef.current[index];
    if (!item) return;
    const player = getPlayerByRealIndex(index);
    if (!player) return;

    const currentTime = player.currentTime ?? 0;
    const duration = player.duration ?? 0;
    const existing = playbackStore.get(item.id);

    if (duration <= 0 && currentTime <= 0 && existing && existing.currentTime > 0) {
      return;
    }

    playbackStore.update(
      {
        videoId: item.id,
        url: item.url,
        currentTime,
        duration,
        wasPlaying: !player.paused,
        playbackRate: player.playbackRate,
        definition:
          player.curDefinition?.definition ??
          existing?.definition,
      },
      { immediate },
    );
  }, []);

  const saveActiveProgress = useCallback(
    (immediate = true) => {
      saveProgressByIndex(activeIndexRef.current, immediate);
    },
    [saveProgressByIndex],
  );

  const persistFeedPosition = useCallback((index: number) => {
    feedPositionStore.save(itemsRef.current, index);
    syncFeedPositionToUrl(itemsRef.current, index);
  }, []);

  const emitSlideChange = useCallback(
    (targetIndex: number, prevIndex: number, isLoop: boolean) => {
      const nextItem = itemsRef.current[targetIndex];
      persistFeedPosition(targetIndex);
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

  const saveActiveFeedPosition = useCallback(() => {
    persistFeedPosition(activeIndexRef.current);
  }, [persistFeedPosition]);

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

      if (trackRef.current) {
        void trackRef.current.offsetHeight;
      }

      translateIndexRef.current = nextTranslateIndex;
      setTranslateIndex(nextTranslateIndex);
      activeIndexRef.current = nextRealIndex;
      setActiveIndex(nextRealIndex);

      const pending = pendingSlideRef.current;
      if (pending) {
        emitSlideChange(pending.target, pending.prev, true);
        pendingSlideRef.current = null;
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTransitionEnabled(true);
          finishSwitch();
        });
      });
    },
    [emitSlideChange, finishSwitch],
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

  const switchDefinition = (
    player: Player,
    item: FeedItem,
    definitionName?: string,
    definitionUrl?: string,
  ) => {
    const definitions = getItemDefinitions(item.id);
    const target = findDefinition(definitions, definitionName, definitionUrl);
    if (!target) {
      throw new Error("Definition not found");
    }

    changePlayerDefinition(player, target);

    bridgeRef.current?.emit("definition_change", {
      videoId: item.id,
      definition: target.definition,
      url: target.url,
      index: activeIndexRef.current,
    });

    return {
      videoId: item.id,
      definition: target.definition,
      url: target.url,
    };
  };

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
      saveProgressByIndex(prevRealIndex, true);
      exitImmersive();

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
          emitSlideChange(nextRealIndex, prevRealIndex, false);
        }
      }

      scheduleSwitchFallback();
    },
    [
      emitSlideChange,
      loop,
      saveProgressByIndex,
      scheduleSwitchFallback,
      exitImmersive,
    ],
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

  const buildFeedCatalog = useCallback(() => {
    return itemsRef.current.map((item, index) => ({
      index,
      videoId: item.id,
      url: item.url,
      title: item.title,
      definitions: item.definitions?.map((definition) => ({
        definition: definition.definition,
        url: definition.url,
      })),
    }));
  }, []);

  const handleTrackTransitionEnd = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (event.target !== trackRef.current || event.propertyName !== "transform") {
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
    playbackStore.hydrate();

    const bridge = new PlayerBridge(bridgeName);
    bridgeRef.current = bridge;

    bridge.register("play", () => {
      const player = getActivePlayer();
      void safePlayerPlay(player);
    });
    bridge.register("pause", () => {
      saveActiveProgress(true);
      getActivePlayer()?.pause();
    });
    bridge.register("togglePlay", () => {
      const player = getActivePlayer();
      if (!player) return;
      if (player.paused) {
        void safePlayerPlay(player);
      } else {
        player.pause();
      }
    });
    bridge.register("seek", (data) => {
      const time = Number(data?.time);
      const player = getActivePlayer();
      if (player && Number.isFinite(time)) {
        player.currentTime = time;
      }
    });
    bridge.register("scrollToIndex", (data) => {
      const index = Number(data?.index);
      if (Number.isFinite(index)) {
        return { index: scrollToIndex(index) };
      }
      throw new Error("Invalid index");
    });
    bridge.register("scrollToVideoId", (data) => {
      const videoId = typeof data?.videoId === "string" ? data.videoId : "";
      if (!videoId) {
        throw new Error("videoId is required");
      }
      return { index: scrollToVideoId(videoId), videoId };
    });
    bridge.register("scrollToUrl", (data) => {
      const url = typeof data?.url === "string" ? data.url : "";
      if (!url) {
        throw new Error("url is required");
      }
      return { index: scrollToUrl(url), url };
    });
    bridge.register("getIndexByVideoId", (data) => {
      const videoId = typeof data?.videoId === "string" ? data.videoId : "";
      const index = findFeedItemIndex(itemsRef.current, { videoId });
      return { index, videoId, found: index >= 0 };
    });
    bridge.register("getIndexByUrl", (data) => {
      const url = typeof data?.url === "string" ? data.url : "";
      const index = findFeedItemIndex(itemsRef.current, { url });
      return { index, url, found: index >= 0 };
    });
    bridge.register("getFeedCatalog", () => ({
      items: buildFeedCatalog(),
    }));
    bridge.register("getActiveIndex", () => ({
      index: activeIndexRef.current,
      videoId: getActiveItem()?.id,
      url: getActiveItem()?.url,
    }));
    bridge.register("getAllProgress", () => ({
      records: playbackStore.exportAll(),
    }));
    bridge.register("setAllProgress", (data) => {
      const records = data?.records;
      if (Array.isArray(records)) {
        playbackStore.importAll(
          records as Parameters<typeof playbackStore.importAll>[0],
        );
      }
    });
    bridge.register("getState", () => {
      const item = getActiveItem();
      const player = getActivePlayer();
      return {
        index: activeIndexRef.current,
        videoId: item?.id,
        url: item?.url,
        playing: player ? !player.paused : false,
        currentTime: player?.currentTime ?? 0,
        duration: player?.duration ?? 0,
        playbackRate: player?.playbackRate ?? playerSettings.getPlaybackRate(),
        definition:
          player?.curDefinition?.definition ??
          playbackStore.get(item?.id ?? "")?.definition,
        definitions: item ? getItemDefinitions(item.id) : [],
        lifecycle: lifecycleManager.getPhase(),
        progress: item ? playbackStore.get(item.id) : undefined,
      };
    });
    bridge.register("setPlaybackRate", (data) => {
      const rate = Number(data?.rate);
      const normalized = playerSettings.setPlaybackRate(rate);
      playersRef.current.forEach((player) => {
        player.playbackRate = normalized;
      });
      bridge.emit("playback_rate_change", {
        rate: normalized,
        index: activeIndexRef.current,
      });
      return { rate: normalized };
    });
    bridge.register("getPlaybackRate", () => ({
      rate: playerSettings.getPlaybackRate(),
    }));
    bridge.register("setDefinition", (data) => {
      const item = getActiveItem();
      const player = getActivePlayer();
      if (!item || !player) {
        throw new Error("No active player");
      }
      return switchDefinition(
        player,
        item,
        typeof data?.definition === "string" ? data.definition : undefined,
        typeof data?.url === "string" ? data.url : undefined,
      );
    });
    bridge.register("getDefinitions", (data) => {
      const videoId =
        typeof data?.videoId === "string"
          ? data.videoId
          : getActiveItem()?.id;
      const definitions = getItemDefinitions(videoId);
      return {
        videoId,
        definitions,
        list: toXgDefinitionList(definitions),
      };
    });

    lifecycleManager.mount(bridge);
    bridge.mount();

    const unsubscribeFlush = playbackStore.onFlush((records) => {
      const item = getActiveItem();
      bridge.emit("progress_saved", {
        records,
        index: activeIndexRef.current,
        videoId: item?.id,
      });
    });

    bridge.emit("feed_ready", {
      count: itemsRef.current.length,
      records: playbackStore.exportAll(),
      items: buildFeedCatalog(),
      index: activeIndexRef.current,
      videoId: getActiveItem()?.id,
      url: getActiveItem()?.url,
    });

    return () => {
      saveActiveProgress(true);
      unsubscribeFlush();
      lifecycleManager.unmount();
      bridge.unmount();
      bridgeRef.current = null;
    };
  }, [bridgeName, saveActiveProgress, scrollToIndex, scrollToVideoId, scrollToUrl, buildFeedCatalog]);

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

    bridgeRef.current?.emit("feed_ready", {
      count: length,
      records: playbackStore.exportAll(),
      items: buildFeedCatalog(),
      index: activeIndexRef.current,
      videoId: items[clamped]?.id,
      url: items[clamped]?.url,
    });
  }, [items, buildFeedCatalog]);

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
  }, [items, initialIndex, persistFeedPosition, scrollToIndex]);

  useEffect(() => {
    const handlePageHide = () => {
      saveActiveProgress(true);
      saveActiveFeedPosition();
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [saveActiveProgress, saveActiveFeedPosition]);

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

  const handleDefinitionChange = useCallback(
    (videoId: string, index: number, definition: VideoDefinition) => {
      bridgeRef.current?.emit("definition_change", {
        videoId,
        definition: definition.definition,
        url: definition.url,
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

  const handleVideoOrientation = useCallback(
    (displayIndex: number, orientation: VideoOrientation) => {
      if (displayIndex !== translateIndexRef.current) return;
      setImmersiveOrientation(orientation);
    },
    [],
  );

  const toggleImmersive = useCallback(() => {
    if (isImmersiveRef.current) {
      exitImmersive();
      return;
    }

    const player = getActivePlayer();
    if (player) {
      setImmersiveOrientation(readPlayerVideoOrientation(player));
    }

    setTransitionEnabled(false);
    setIsImmersive(true);
    layoutRefreshRef.current.refreshNow();

    runAfterDoubleFrame(() => {
      layoutRefreshRef.current.refreshNow();
      setTransitionEnabled(true);
    });
  }, [exitImmersive]);

  useEffect(() => {
    if (isImmersiveRef.current) return;

    const player = getActivePlayer();
    if (!player) return;
    setImmersiveOrientation(readPlayerVideoOrientation(player));
  }, [translateIndex, activeIndex]);

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

  useFeedViewportGestures({
    enabled: items.length > 0,
    swipeEnabled: !isImmersive,
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
    immersiveOrientation === "landscape"
      ? "feed-immersive--landscape"
      : "feed-immersive--portrait";

  const trackTransform = getFeedTrackTransform(
    translateIndex,
    isImmersive && immersiveOrientation === "landscape",
  );

  const mountRadius = perfProfileRef.current.playerMountRadius;

  return (
    <div
      ref={viewportRef}
      className={`feed-viewport relative h-full w-full overflow-hidden bg-black${lowEndClass}${isImmersive ? ` feed-immersive ${immersiveModeClass}` : ""}`}
    >
      <div
        ref={trackRef}
        className={`feed-track flex flex-col${transitionEnabled ? "" : " feed-track--instant"}`}
        style={{ transform: trackTransform }}
        onTransitionEnd={handleTrackTransitionEnd}
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
                isImmersive={isActive && isImmersive}
                onToggleImmersive={isActive ? toggleImmersive : undefined}
                onVideoOrientation={(orientation) =>
                  handleVideoOrientation(displayIndex, orientation)
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
                onDefinitionChange={(definition) =>
                  handleDefinitionChange(item.id, item.realIndex, definition)
                }
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

      {!isImmersive ? (
        <div className="pointer-events-none absolute right-3 top-[max(1rem,env(safe-area-inset-top))] z-50 rounded-full bg-black/40 px-2 py-1 text-[10px] text-white/70">
          {activeIndex + 1}/{items.length}
        </div>
      ) : null}
    </div>
  );
}
