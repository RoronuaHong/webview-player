"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Player from "xgplayer";
import XgPlayer from "@/components/XgPlayer";
import { useFeedViewportGestures } from "@/hooks/useFeedViewportGestures";
import { PlayerBridge } from "@/lib/jsbridge";
import { findDefinition, toXgDefinitionList } from "@/lib/feed-utils";
import { lifecycleManager } from "@/lib/lifecycle-manager";
import { playbackStore } from "@/lib/playback-store";
import { playerSettings } from "@/lib/player-settings";
import { readPlayerVideoOrientation, type VideoOrientation } from "@/lib/video-orientation";
import { safePlayerPlay } from "@/lib/webview-playback";
import type { FeedItem, PlaybackRate, VideoDefinition } from "@/types/feed";

type FeedPlayerProps = {
  items: FeedItem[];
  initialIndex?: number;
  isLive?: boolean;
  bridgeName?: string;
};

type DisplayFeedItem = FeedItem & {
  displayKey: string;
  realIndex: number;
};

const TRANSITION_MS = 280;

function buildDisplayItems(items: FeedItem[]): DisplayFeedItem[] {
  if (items.length <= 1) {
    return items.map((item, index) => ({
      ...item,
      displayKey: item.id,
      realIndex: index,
    }));
  }

  const last = items[items.length - 1];
  const first = items[0];

  return [
    {
      ...last,
      displayKey: `${last.id}__clone-head`,
      realIndex: items.length - 1,
    },
    ...items.map((item, index) => ({
      ...item,
      displayKey: item.id,
      realIndex: index,
    })),
    {
      ...first,
      displayKey: `${first.id}__clone-tail`,
      realIndex: 0,
    },
  ];
}

function toTranslateIndex(realIndex: number, loop: boolean) {
  return loop ? realIndex + 1 : realIndex;
}

function toRealIndex(translateIndex: number, length: number, loop: boolean) {
  if (!loop || length <= 1) return translateIndex;
  if (translateIndex === 0) return length - 1;
  if (translateIndex === length + 1) return 0;
  return translateIndex - 1;
}

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

    const snapTrack = () => {
      if (trackRef.current) {
        trackRef.current.style.transform = `translate3d(0, calc(-${idx} * 100dvh), 0)`;
        void trackRef.current.offsetHeight;
      }
    };

    const finishExit = () => {
      setIsImmersive(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTransitionEnabled(true);
        });
      });
    };

    if (wasLandscape) {
      // Drop landscape layout first (restores track translate) while overlay stays.
      setImmersiveOrientation("portrait");
      requestAnimationFrame(() => {
        snapTrack();
        requestAnimationFrame(finishExit);
      });
      return;
    }

    snapTrack();
    finishExit();
  }, []);

  const saveProgressByIndex = useCallback((index: number, immediate = true) => {
    const item = itemsRef.current[index];
    if (!item) return;
    const player = getPlayerByRealIndex(index);
    if (!player) return;

    playbackStore.update(
      {
        videoId: item.id,
        url: item.url,
        currentTime: player.currentTime ?? 0,
        duration: player.duration ?? 0,
        wasPlaying: !player.paused,
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

  const emitSlideChange = useCallback(
    (targetIndex: number, prevIndex: number, isLoop: boolean) => {
      const nextItem = itemsRef.current[targetIndex];
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
    }, TRANSITION_MS + 80);
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

    const current = player.currentTime ?? 0;
    const wasPlaying = !player.paused;

    player.changeDefinition({
      definition: target.definition,
      url: target.url,
      text: target.text ?? target.definition,
    });

    player.once("canplay", () => {
      if (current > 0) {
        player.currentTime = current;
      }
      if (wasPlaying) {
        void safePlayerPlay(player);
      }
    });

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

      if (!loop) {
        scheduleSwitchFallback();
        return;
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
    },
    [goToTranslateIndex, loop],
  );

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
        scrollToIndex(index);
      }
    });
    bridge.register("getActiveIndex", () => ({
      index: activeIndexRef.current,
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
    });

    return () => {
      saveActiveProgress(true);
      unsubscribeFlush();
      lifecycleManager.unmount();
      bridge.unmount();
      bridgeRef.current = null;
    };
  }, [bridgeName, saveActiveProgress, scrollToIndex]);

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
    });
  }, [items]);

  useEffect(() => {
    if (initialIndex > 0) {
      scrollToIndex(initialIndex);
    }
  }, [initialIndex, scrollToIndex]);

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

  const syncImmersiveViewportMetrics = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const vv = window.visualViewport;
    const w = vv?.width ?? window.innerWidth;
    const h = vv?.height ?? window.innerHeight;
    viewport.style.setProperty("--immersive-vw", `${w}px`);
    viewport.style.setProperty("--immersive-vh", `${h}px`);
  }, []);

  const toggleImmersive = useCallback(() => {
    if (isImmersiveRef.current) {
      exitImmersive();
      return;
    }

    const player = getActivePlayer();
    const orientation = player
      ? readPlayerVideoOrientation(player)
      : immersiveOrientationRef.current;

    if (player) {
      setImmersiveOrientation(orientation);
    }

    setTransitionEnabled(false);
    setIsImmersive(true);
    syncImmersiveViewportMetrics();

    const resizePlayer = () => {
      getActivePlayer()?.resize?.();
    };

    requestAnimationFrame(() => {
      resizePlayer();
      requestAnimationFrame(() => {
        resizePlayer();
        setTransitionEnabled(true);
      });
    });
  }, [exitImmersive, syncImmersiveViewportMetrics]);

  useEffect(() => {
    const player = getActivePlayer();
    if (!player) return;
    setImmersiveOrientation(readPlayerVideoOrientation(player));
  }, [translateIndex, activeIndex]);

  useEffect(() => {
    const resizeActivePlayer = () => {
      syncImmersiveViewportMetrics();
      const player = getActivePlayer();
      player?.resize?.();
    };

    requestAnimationFrame(resizeActivePlayer);

    window.addEventListener("orientationchange", resizeActivePlayer);
    window.visualViewport?.addEventListener("resize", resizeActivePlayer);
    window.visualViewport?.addEventListener("scroll", resizeActivePlayer);

    return () => {
      window.removeEventListener("orientationchange", resizeActivePlayer);
      window.visualViewport?.removeEventListener("resize", resizeActivePlayer);
      window.visualViewport?.removeEventListener("scroll", resizeActivePlayer);
    };
  }, [isImmersive, translateIndex, activeIndex, immersiveOrientation, syncImmersiveViewportMetrics]);

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

  const trackTransform =
    isImmersive && immersiveOrientation === "landscape"
      ? "none"
      : `translate3d(0, calc(-${translateIndex} * 100dvh), 0)`;

  return (
    <div
      ref={viewportRef}
      className={`feed-viewport relative h-full w-full overflow-hidden bg-black${isImmersive ? ` feed-immersive ${immersiveModeClass}` : ""}`}
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

          return (
            <section
              key={item.displayKey}
              data-index={item.realIndex}
              data-active={isActive ? "true" : "false"}
              className="feed-card relative h-[100dvh] w-full shrink-0"
            >
              <XgPlayer
                videoId={item.id}
                url={item.url}
                poster={item.poster}
                active={isActive}
                isLive={isLive}
                isImmersive={isActive && isImmersive}
                onToggleImmersive={isActive ? toggleImmersive : undefined}
                onVideoOrientation={(orientation) =>
                  handleVideoOrientation(displayIndex, orientation)
                }
                startTime={playbackStore.getStartTime(item.id)}
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
