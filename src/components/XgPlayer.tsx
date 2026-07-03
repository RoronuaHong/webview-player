"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Player, { Events, MobilePreset } from "xgplayer";
import "xgplayer/dist/index.min.css";
import CustomControls from "@/components/CustomControls";
import { toXgDefinitionList } from "@/lib/feed-utils";
import { lifecycleManager } from "@/lib/lifecycle-manager";
import { playbackStore } from "@/lib/playback-store";
import { playerSettings } from "@/lib/player-settings";
import { getHlsPlayerConfig, getHlsPlugins } from "@/lib/player-utils";
import {
  applyPlaybackSource,
  buildPlaybackSourceDescriptor,
  canHotSwitchSources,
  isSamePlaybackSource,
  type PlaybackSourceDescriptor,
} from "@/lib/player-source";
import {
  ensurePlayerVideoInline,
  getWebViewVideoAttributes,
  hasDecodedPreviewFrame,
  hidePlayerPoster,
  playerHasPreviewFrame,
  primePlayerPreviewFrame,
  safePlayerPlay,
  setPlayerVideoPreload,
  findPlayerVideoElement,
} from "@/lib/webview-playback";
import { getWebViewPerformanceProfile, type VideoPreloadTier } from "@/lib/webview-runtime";
import {
  readPlayerVideoOrientation,
  type VideoOrientation,
} from "@/lib/video-orientation";
import type { PlaybackRate, VideoDefinition } from "@/types/feed";

export type XgPlayerProps = {
  videoId: string;
  url: string;
  poster?: string;
  active?: boolean;
  autoPlay?: boolean;
  enabled?: boolean;
  primePreview?: boolean;
  preloadTier?: VideoPreloadTier;
  isLive?: boolean;
  startTime?: number;
  definitions?: VideoDefinition[];
  defaultDefinition?: string;
  onPlayerInstance?: (videoId: string, player: Player | null) => void;
  onPlaybackRateChange?: (rate: PlaybackRate) => void;
  onDefinitionChange?: (definition: VideoDefinition) => void;
  onEnded?: () => void;
  isImmersive?: boolean;
  onToggleImmersive?: () => void;
  onVideoOrientation?: (orientation: VideoOrientation) => void;
  onPlaybackError?: (error: unknown) => void;
  onPlaybackIntentChange?: (playing: boolean) => void;
};

const HIDDEN_CONTROLS = [
  "start",
  "play",
  "progress",
  "time",
  "volume",
  "fullscreen",
  "cssfullscreen",
  "playbackrate",
  "definition",
  "loading",
  "replay",
  "mobile",
  "pc",
] as const;

export default function XgPlayer({
  videoId,
  url,
  poster,
  active = false,
  autoPlay,
  enabled = true,
  primePreview = false,
  preloadTier,
  isLive = false,
  startTime = 0,
  definitions = [],
  defaultDefinition,
  onPlayerInstance,
  onPlaybackRateChange,
  onDefinitionChange,
  onEnded,
  isImmersive = false,
  onToggleImmersive,
  onVideoOrientation,
  onPlaybackError,
  onPlaybackIntentChange,
}: XgPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const activeRef = useRef(active);
  const onEndedRef = useRef(onEnded);
  const onPlayerInstanceRef = useRef(onPlayerInstance);
  const onPlaybackRateChangeRef = useRef(onPlaybackRateChange);
  const onDefinitionChangeRef = useRef(onDefinitionChange);
  const onVideoOrientationRef = useRef(onVideoOrientation);
  const onPlaybackErrorRef = useRef(onPlaybackError);
  const onPlaybackIntentChangeRef = useRef(onPlaybackIntentChange);
  const currentDefinitionRef = useRef<string | undefined>(
    defaultDefinition ?? definitions[0]?.definition,
  );
  const [player, setPlayer] = useState<Player | null>(null);
  const [currentDefinition, setCurrentDefinition] = useState<string | undefined>(
    defaultDefinition ?? definitions[0]?.definition,
  );
  const [isBuffering, setIsBuffering] = useState(false);
  const [recreateToken, setRecreateToken] = useState(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastProgressReportRef = useRef(0);
  const perfProfileRef = useRef(getWebViewPerformanceProfile());
  const activeSourceRef = useRef<PlaybackSourceDescriptor | null>(null);

  activeRef.current = active;
  onEndedRef.current = onEnded;
  onPlayerInstanceRef.current = onPlayerInstance;
  onPlaybackRateChangeRef.current = onPlaybackRateChange;
  onDefinitionChangeRef.current = onDefinitionChange;
  onVideoOrientationRef.current = onVideoOrientation;
  onPlaybackErrorRef.current = onPlaybackError;
  onPlaybackIntentChangeRef.current = onPlaybackIntentChange;

  const wantsAutoPlay = autoPlay ?? active;
  const wantsAutoPlayRef = useRef(wantsAutoPlay);
  wantsAutoPlayRef.current = wantsAutoPlay;

  const reportVideoOrientation = (instance: Player) => {
    onVideoOrientationRef.current?.(readPlayerVideoOrientation(instance));
  };

  const definitionsKey = useMemo(
    () => JSON.stringify(definitions),
    [definitions],
  );
  const sourceDescriptor = useMemo(
    () =>
      buildPlaybackSourceDescriptor({
        videoId,
        url,
        poster,
        isLive,
        definitions,
        defaultDefinition,
        startTime,
      }),
    [
      videoId,
      url,
      poster,
      isLive,
      definitionsKey,
      defaultDefinition,
      startTime,
    ],
  );
  const sourceDescriptorRef = useRef(sourceDescriptor);
  sourceDescriptorRef.current = sourceDescriptor;

  const reportProgress = (wasPlaying: boolean, immediate = false) => {
    const instance = playerRef.current;
    if (!instance) return;
    if (!immediate && !activeRef.current) return;
    const source = activeSourceRef.current ?? sourceDescriptorRef.current;

    const now = Date.now();
    if (
      !immediate &&
      now - lastProgressReportRef.current <
        perfProfileRef.current.progressThrottleMs
    ) {
      return;
    }
    lastProgressReportRef.current = now;

    playbackStore.update(
      {
        videoId: source.videoId,
        url: String(instance.config?.url ?? source.sourceUrl),
        currentTime: instance.currentTime ?? 0,
        duration: instance.duration ?? 0,
        wasPlaying,
        playbackRate: instance.playbackRate,
        definition: currentDefinitionRef.current,
      },
      { immediate },
    );
  };

  const reportFinalProgress = (instance: Player) => {
    const source = activeSourceRef.current ?? sourceDescriptorRef.current;
    playbackStore.update(
      {
        videoId: source.videoId,
        url: String(instance.config?.url ?? source.sourceUrl),
        currentTime: instance.currentTime ?? 0,
        duration: instance.duration ?? 0,
        wasPlaying: !instance.paused,
        playbackRate: instance.playbackRate,
        definition: currentDefinitionRef.current,
      },
      { immediate: true },
    );
  };

  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    const profile = perfProfileRef.current;
    const descriptor = sourceDescriptorRef.current;
    const saved = playbackStore.get(descriptor.videoId);
    const savedStartTime =
      startTime > 0 ? startTime : playbackStore.getStartTime(descriptor.videoId);
    const initialRate = saved?.playbackRate ?? playerSettings.getPlaybackRate();
    const plugins = getHlsPlugins(descriptor.playbackUrl);
    if (descriptor.hlsMode === "none") {
      console.warn(
        "[XgPlayer] HLS is not supported in this WebView:",
        descriptor.playbackUrl,
      );
    }
    const hlsConfig = getHlsPlayerConfig();

    activeSourceRef.current = descriptor;
    currentDefinitionRef.current = descriptor.initialDefinition;
    setCurrentDefinition(descriptor.initialDefinition);

    const instance = new Player({
      el: container,
      url: descriptor.playbackUrl,
      poster: descriptor.poster,
      width: "100%",
      height: "100%",
      fluid: profile.fluidPlayer,
      isLive,
      playsinline: true,
      autoplay: false,
      autoplayMuted: false,
      controls: false,
      marginControls: false,
      presets: [MobilePreset],
      plugins,
      hls: hlsConfig,
      lang: "zh-cn",
      videoFillMode: "contain",
      rotate: false,
      cssFullscreen: false,
      closeVideoClick: false,
      startTime: savedStartTime,
      defaultPlaybackRate: initialRate,
      definition:
        definitions.length > 0
          ? {
              list: toXgDefinitionList(definitions),
              defaultDefinition: descriptor.initialDefinition,
            }
          : undefined,
      ignores: [...HIDDEN_CONTROLS],
      videoAttributes: { ...getWebViewVideoAttributes() },
    });

    instance.playbackRate = initialRate;
    playerRef.current = instance;
    setPlayer(instance);
    onPlayerInstanceRef.current?.(descriptor.videoId, instance);

    const onPause = () => {
      reportProgress(false, true);
      if (
        lifecycleManager.getPhase() === "active" &&
        activeRef.current
      ) {
        lifecycleManager.setWasPlaying(false);
      }
    };

    const onEnded = () => {
      const source = activeSourceRef.current ?? sourceDescriptorRef.current;
      lifecycleManager.setWasPlaying(false);
      playbackStore.update(
        {
          videoId: source.videoId,
          url: String(instance.config?.url ?? source.sourceUrl),
          currentTime: 0,
          duration: instance.duration ?? 0,
          wasPlaying: false,
          completed: true,
          playbackRate: instance.playbackRate,
          definition: currentDefinitionRef.current,
        },
        { immediate: true },
      );
      onEndedRef.current?.();
    };

    const onTimeUpdate = () => {
      if (!activeRef.current) return;
      reportProgress(!instance.paused);
    };

    const onWaiting = () => {
      if (!activeRef.current) return;
      const video = findPlayerVideoElement(instance);
      if (video && hasDecodedPreviewFrame(video)) return;
      setIsBuffering(true);
    };

    const onPlaying = () => {
      setIsBuffering(false);
    };

    const onPlay = () => {
      if (!activeRef.current) return;
      lifecycleManager.setWasPlaying(true);
      reportProgress(true);
    };

    const onDefinitionChange = () => {
      const activeDefinition = instance.curDefinition?.definition as
        | string
        | undefined;
      if (activeDefinition) {
        currentDefinitionRef.current = activeDefinition;
        setCurrentDefinition(activeDefinition);
        reportProgress(!instance.paused, true);
      }
    };

    const onLoadedMetadata = () => {
      reportVideoOrientation(instance);
    };

    const onVideoResize = () => {
      reportVideoOrientation(instance);
    };

    const onCanPlay = () => {
      ensurePlayerVideoInline(instance);
      reportVideoOrientation(instance);
    };

    const onReady = () => {
      ensurePlayerVideoInline(instance);
    };

    const onError = (error: unknown) => {
      console.warn("[XgPlayer] playback error:", error);
      onPlaybackErrorRef.current?.(error);
      if (!instance.paused) {
        reportProgress(false, true);
        instance.pause();
      }
    };

    instance.on(Events.PLAY, onPlay);
    instance.on(Events.PAUSE, onPause);
    instance.on(Events.ENDED, onEnded);
    instance.on(Events.TIME_UPDATE, onTimeUpdate);
    instance.on(Events.WAITING, onWaiting);
    instance.on(Events.PLAYING, onPlaying);
    instance.on(Events.DEFINITION_CHANGE, onDefinitionChange);
    instance.on(Events.LOADED_METADATA, onLoadedMetadata);
    instance.on(Events.VIDEO_RESIZE, onVideoResize);
    instance.on(Events.CANPLAY, onCanPlay);
    instance.on(Events.READY, onReady);
    instance.on(Events.ERROR, onError);

    const resolvedPreload = preloadTier ?? "auto";
    setPlayerVideoPreload(instance, resolvedPreload);
    ensurePlayerVideoInline(instance, { preload: resolvedPreload });
    reportVideoOrientation(instance);

    if (primePreview && !activeRef.current) {
      void primePlayerPreviewFrame(instance, savedStartTime);
    }

    progressTimerRef.current = setInterval(() => {
      if (!activeRef.current || instance.paused) return;
      reportProgress(true);
    }, profile.progressBackupIntervalMs);

    if (
      activeRef.current &&
      wantsAutoPlayRef.current &&
      lifecycleManager.getPhase() === "active"
    ) {
      void safePlayerPlay(instance);
    }

    return () => {
      reportFinalProgress(instance);
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }

      instance.off(Events.PLAY, onPlay);
      instance.off(Events.PAUSE, onPause);
      instance.off(Events.ENDED, onEnded);
      instance.off(Events.TIME_UPDATE, onTimeUpdate);
      instance.off(Events.WAITING, onWaiting);
      instance.off(Events.PLAYING, onPlaying);
      instance.off(Events.DEFINITION_CHANGE, onDefinitionChange);
      instance.off(Events.LOADED_METADATA, onLoadedMetadata);
      instance.off(Events.VIDEO_RESIZE, onVideoResize);
      instance.off(Events.CANPLAY, onCanPlay);
      instance.off(Events.READY, onReady);
      instance.off(Events.ERROR, onError);

      instance.destroy();
      playerRef.current = null;
      setPlayer(null);
      onPlayerInstanceRef.current?.(descriptor.videoId, null);
    };
  }, [enabled, preloadTier, primePreview, sourceDescriptor.hlsMode, sourceDescriptor.isLive, recreateToken]);

  useEffect(() => {
    const instance = playerRef.current;
    if (!instance || !enabled) return;

    const previous = activeSourceRef.current;
    if (isSamePlaybackSource(previous, sourceDescriptor)) return;

    if (!previous) {
      activeSourceRef.current = sourceDescriptor;
      return;
    }

    if (!canHotSwitchSources(previous, sourceDescriptor)) {
      setRecreateToken((current) => current + 1);
      return;
    }

    let cancelled = false;
    reportFinalProgress(instance);
    setIsBuffering(
      active &&
        !playerHasPreviewFrame(instance),
    );

    void applyPlaybackSource(instance, sourceDescriptor, {
      autoplay:
        active &&
        wantsAutoPlayRef.current &&
        lifecycleManager.getPhase() === "active" &&
        document.visibilityState === "visible",
      onReady: () => {
        ensurePlayerVideoInline(instance);
        reportVideoOrientation(instance);
      },
    }).then((switched) => {
      if (cancelled) return;

      if (!switched) {
        setRecreateToken((current) => current + 1);
        return;
      }

      activeSourceRef.current = sourceDescriptor;
      currentDefinitionRef.current = sourceDescriptor.initialDefinition;
      setCurrentDefinition(sourceDescriptor.initialDefinition);
      setIsBuffering(false);
    });

    return () => {
      cancelled = true;
    };
  }, [active, enabled, sourceDescriptor]);

  useEffect(() => {
    const instance = playerRef.current;
    if (!instance || !enabled) return;

    const resolvedPreload = preloadTier ?? "auto";
    setPlayerVideoPreload(instance, resolvedPreload);
  }, [active, enabled, preloadTier]);

  useEffect(() => {
    if (!active) setIsBuffering(false);
  }, [active]);

  useEffect(() => {
    const instance = playerRef.current;
    if (!instance || !enabled || active || !primePreview) return;

    let cancelled = false;
    let rafId = 0;
    const startAt = playbackStore.getStartTime(videoId);

    const runPrime = () => {
      if (cancelled || activeRef.current) return;
      if (sourceDescriptorRef.current.videoId !== videoId) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (cancelled || activeRef.current) return;
        void primePlayerPreviewFrame(instance, startAt);
      });
    };

    instance.on(Events.LOADED_DATA, runPrime);
    instance.on(Events.CANPLAY, runPrime);
    instance.on(Events.READY, runPrime);
    runPrime();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      instance.off(Events.LOADED_DATA, runPrime);
      instance.off(Events.CANPLAY, runPrime);
      instance.off(Events.READY, runPrime);
    };
  }, [active, enabled, primePreview, videoId, recreateToken]);

  useEffect(() => {
    const instance = playerRef.current;
    if (!instance || !enabled) return;
    if (activeSourceRef.current?.videoId !== videoId) return;

    const tryPlay = () => {
      if (
        !activeRef.current ||
        !wantsAutoPlayRef.current ||
        lifecycleManager.getPhase() !== "active" ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      const video = findPlayerVideoElement(instance);
      if (video && hasDecodedPreviewFrame(video)) {
        hidePlayerPoster(instance);
        setIsBuffering(false);
      }

      const resumeAt = playbackStore.getStartTime(videoId);
      if (resumeAt > 0 && Math.abs((instance.currentTime ?? 0) - resumeAt) > 0.5) {
        instance.currentTime = resumeAt;
      }
      instance.playbackRate = playerSettings.getPlaybackRate();
      void safePlayerPlay(instance);
    };

    if (active && wantsAutoPlay) {
      tryPlay();
      instance.on(Events.CANPLAY, tryPlay);
      instance.on(Events.LOADED_DATA, tryPlay);
      return () => {
        instance.off(Events.CANPLAY, tryPlay);
        instance.off(Events.LOADED_DATA, tryPlay);
      };
    }

    if (!instance.paused) {
      reportProgress(false, true);
      instance.pause();
    }
  }, [active, autoPlay, enabled, videoId, recreateToken, wantsAutoPlay]);

  useEffect(() => {
    if (!enabled) return;
    return lifecycleManager.subscribe(({ phase, shouldResume }) => {
      const instance = playerRef.current;
      if (!instance || !activeRef.current) return;
      if (activeSourceRef.current?.videoId !== videoId) return;

      if (phase !== "active") {
        if (!instance.paused) {
          reportProgress(false, true);
          instance.pause();
        }
        return;
      }

      if (shouldResume && wantsAutoPlayRef.current) {
        const resumeAt = playbackStore.getStartTime(videoId);
        if (resumeAt > 0) {
          instance.currentTime = resumeAt;
        }
        instance.playbackRate = playerSettings.getPlaybackRate();
        void safePlayerPlay(instance);
      }
    });
  }, [enabled, videoId, url]);

  const handlePlaybackRateChange = (rate: PlaybackRate) => {
    onPlaybackRateChangeRef.current?.(rate);
    reportProgress(!playerRef.current?.paused, true);
  };

  const handleDefinitionChange = (definition: VideoDefinition) => {
    currentDefinitionRef.current = definition.definition;
    setCurrentDefinition(definition.definition);
    onDefinitionChangeRef.current?.(definition);
    reportProgress(!playerRef.current?.paused, true);
  };

  if (!enabled) {
    return (
      <div className="portrait-player relative h-full w-full bg-black">
        {poster ? (
          <img
            src={poster}
            alt=""
            className="h-full w-full object-contain"
            loading="lazy"
            decoding="async"
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="portrait-player relative h-full w-full bg-black">
      <div ref={containerRef} className="xgplayer-host h-full w-full" />

      {active && isBuffering ? (
        <div
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/20"
          aria-hidden
        >
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/25 border-t-white/90" />
        </div>
      ) : null}

      <CustomControls
        player={player}
        visible={active}
        isImmersive={isImmersive}
        onToggleImmersive={onToggleImmersive ?? (() => {})}
        definitions={definitions}
        currentDefinition={currentDefinition}
        onPlaybackRateChange={handlePlaybackRateChange}
        onDefinitionChange={handleDefinitionChange}
        onPlayStateIntent={(playing) =>
          onPlaybackIntentChangeRef.current?.(playing)
        }
      />
    </div>
  );
}
