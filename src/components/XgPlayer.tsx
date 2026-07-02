"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Player, { Events, MobilePreset } from "xgplayer";
import "xgplayer/dist/index.min.css";
import CustomControls from "@/components/CustomControls";
import { toXgDefinitionList } from "@/lib/feed-utils";
import { lifecycleManager } from "@/lib/lifecycle-manager";
import { playbackStore } from "@/lib/playback-store";
import { playerSettings } from "@/lib/player-settings";
import { getHlsPlaybackMode, getHlsPlugins } from "@/lib/player-utils";
import {
  ensurePlayerVideoInline,
  getWebViewVideoAttributes,
  safePlayerPlay,
  setPlayerVideoPreload,
} from "@/lib/webview-playback";
import { getWebViewPerformanceProfile } from "@/lib/webview-runtime";
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
  enabled?: boolean;
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
  enabled = true,
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
  const currentDefinitionRef = useRef(
    defaultDefinition ?? definitions[0]?.definition,
  );
  const [player, setPlayer] = useState<Player | null>(null);
  const [currentDefinition, setCurrentDefinition] = useState(
    defaultDefinition ?? definitions[0]?.definition,
  );
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastProgressReportRef = useRef(0);
  const perfProfileRef = useRef(getWebViewPerformanceProfile());

  activeRef.current = active;
  onEndedRef.current = onEnded;
  onPlayerInstanceRef.current = onPlayerInstance;
  onPlaybackRateChangeRef.current = onPlaybackRateChange;
  onDefinitionChangeRef.current = onDefinitionChange;
  onVideoOrientationRef.current = onVideoOrientation;
  onPlaybackErrorRef.current = onPlaybackError;

  const reportVideoOrientation = (instance: Player) => {
    onVideoOrientationRef.current?.(readPlayerVideoOrientation(instance));
  };

  const definitionsKey = useMemo(
    () => JSON.stringify(definitions),
    [definitions],
  );

  const reportProgress = (wasPlaying: boolean, immediate = false) => {
    const instance = playerRef.current;
    if (!instance) return;

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
        videoId,
        url: String(instance.config?.url ?? url),
        currentTime: instance.currentTime ?? 0,
        duration: instance.duration ?? 0,
        wasPlaying,
        playbackRate: instance.playbackRate,
        definition: currentDefinitionRef.current,
      },
      { immediate },
    );
  };

  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    const profile = perfProfileRef.current;
    const plugins = getHlsPlugins(url);
    const hlsMode = getHlsPlaybackMode(url);
    if (hlsMode === "none") {
      console.warn(
        "[XgPlayer] HLS is not supported in this WebView:",
        url,
      );
    }
    const saved = playbackStore.get(videoId);
    const savedStartTime =
      startTime > 0 ? startTime : playbackStore.getStartTime(videoId);
    const initialRate = saved?.playbackRate ?? playerSettings.getPlaybackRate();
    const initialDefinition =
      saved?.definition ?? defaultDefinition ?? definitions[0]?.definition;

    currentDefinitionRef.current = initialDefinition;
    setCurrentDefinition(initialDefinition);

    const instance = new Player({
      el: container,
      url,
      poster,
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
              defaultDefinition: initialDefinition,
            }
          : undefined,
      ignores: [...HIDDEN_CONTROLS],
      videoAttributes: { ...getWebViewVideoAttributes() },
    });

    instance.playbackRate = initialRate;
    playerRef.current = instance;
    setPlayer(instance);
    onPlayerInstanceRef.current?.(videoId, instance);

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
      lifecycleManager.setWasPlaying(false);
      playbackStore.update(
        {
          videoId,
          url: String(instance.config?.url ?? url),
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
      reportProgress(!instance.paused);
    };

    const onPlay = () => {
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
      lifecycleManager.notifySystemPause();
    };

    instance.on(Events.PLAY, onPlay);
    instance.on(Events.PAUSE, onPause);
    instance.on(Events.ENDED, onEnded);
    instance.on(Events.TIME_UPDATE, onTimeUpdate);
    instance.on(Events.DEFINITION_CHANGE, onDefinitionChange);
    instance.on(Events.LOADED_METADATA, onLoadedMetadata);
    instance.on(Events.VIDEO_RESIZE, onVideoResize);
    instance.on(Events.CANPLAY, onCanPlay);
    instance.on(Events.READY, onReady);
    instance.on(Events.ERROR, onError);

    ensurePlayerVideoInline(instance);
    reportVideoOrientation(instance);

    progressTimerRef.current = setInterval(() => {
      if (!instance.paused) {
        reportProgress(true);
      }
    }, profile.progressBackupIntervalMs);

    if (activeRef.current && lifecycleManager.getPhase() === "active") {
      void safePlayerPlay(instance);
    }

    return () => {
      reportProgress(!instance.paused, true);
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }

      instance.off(Events.PLAY, onPlay);
      instance.off(Events.PAUSE, onPause);
      instance.off(Events.ENDED, onEnded);
      instance.off(Events.TIME_UPDATE, onTimeUpdate);
      instance.off(Events.DEFINITION_CHANGE, onDefinitionChange);
      instance.off(Events.LOADED_METADATA, onLoadedMetadata);
      instance.off(Events.VIDEO_RESIZE, onVideoResize);
      instance.off(Events.CANPLAY, onCanPlay);
      instance.off(Events.READY, onReady);
      instance.off(Events.ERROR, onError);

      instance.destroy();
      playerRef.current = null;
      setPlayer(null);
      onPlayerInstanceRef.current?.(videoId, null);
    };
  }, [enabled, videoId, url, poster, isLive, definitionsKey, defaultDefinition]);

  useEffect(() => {
    const instance = playerRef.current;
    if (!instance || !enabled) return;

    setPlayerVideoPreload(instance, active ? "auto" : "metadata");
  }, [active, enabled]);

  useEffect(() => {
    const instance = playerRef.current;
    if (!instance || !enabled) return;

    const canPlay =
      active &&
      lifecycleManager.getPhase() === "active" &&
      document.visibilityState === "visible";

    if (canPlay) {
      const resumeAt = playbackStore.getStartTime(videoId);
      if (resumeAt > 0 && Math.abs((instance.currentTime ?? 0) - resumeAt) > 0.5) {
        instance.currentTime = resumeAt;
      }
      instance.playbackRate = playerSettings.getPlaybackRate();
      void safePlayerPlay(instance);
      return;
    }

    if (!instance.paused) {
      reportProgress(false, true);
      instance.pause();
    }
  }, [active, enabled, videoId]);

  useEffect(() => {
    if (!enabled) return;
    return lifecycleManager.subscribe(({ phase, shouldResume }) => {
      const instance = playerRef.current;
      if (!instance || !activeRef.current) return;

      if (phase !== "active") {
        if (!instance.paused) {
          reportProgress(false, true);
          instance.pause();
        }
        return;
      }

      if (shouldResume) {
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

      <CustomControls
        player={player}
        visible={active}
        isImmersive={isImmersive}
        onToggleImmersive={onToggleImmersive ?? (() => {})}
        definitions={definitions}
        currentDefinition={currentDefinition}
        onPlaybackRateChange={handlePlaybackRateChange}
        onDefinitionChange={handleDefinitionChange}
      />
    </div>
  );
}
