"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Player from "xgplayer";
import { formatTime } from "@/lib/player-utils";
import { changePlayerDefinition } from "@/lib/player-definition";
import { stopPointerPropagation } from "@/lib/pointer-utils";
import { playerSettings } from "@/lib/player-settings";
import { safePlayerPlay } from "@/lib/webview-playback";
import type { PlaybackRate, VideoDefinition } from "@/types/feed";
import { PLAYBACK_RATES } from "@/types/feed";

type CustomControlsProps = {
  player: Player | null;
  visible?: boolean;
  isImmersive?: boolean;
  onToggleImmersive: () => void;
  definitions?: VideoDefinition[];
  currentDefinition?: string;
  onDefinitionChange?: (definition: VideoDefinition) => void;
  onPlaybackRateChange?: (rate: PlaybackRate) => void;
};

export default function CustomControls({
  player,
  visible = true,
  isImmersive = false,
  onToggleImmersive,
  definitions = [],
  currentDefinition,
  onDefinitionChange,
  onPlaybackRateChange,
}: CustomControlsProps) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [showUi, setShowUi] = useState(true);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);
  const [panel, setPanel] = useState<"none" | "rate" | "quality">("none");
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPlaybackRate(playerSettings.getPlaybackRate());
  }, []);

  const resetHideTimer = useCallback(() => {
    setShowUi(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (playing && panel === "none") setShowUi(false);
    }, 3000);
  }, [panel, playing]);

  useEffect(() => {
    if (!player) return;

    const syncState = () => {
      setPlaying(!player.paused);
      setCurrentTime(player.currentTime ?? 0);
      setDuration(player.duration ?? 0);

      const media = player.media;
      if (media && "buffered" in media) {
        const ranges = media.buffered;
        if (ranges && ranges.length > 0) {
          setBuffered(ranges.end(ranges.length - 1));
        }
      }

      const rate = player.playbackRate ?? playerSettings.getPlaybackRate();
      if (PLAYBACK_RATES.includes(rate as PlaybackRate)) {
        setPlaybackRate(rate as PlaybackRate);
      }
    };

    const onPlay = () => {
      setPlaying(true);
      resetHideTimer();
    };
    const onPause = () => {
      setPlaying(false);
      setShowUi(true);
    };

    player.on("play", onPlay);
    player.on("pause", onPause);
    player.on("ended", onPause);
    player.on("timeupdate", syncState);
    player.on("durationchange", syncState);
    player.on("loadedmetadata", syncState);
    player.on("progress", syncState);
    player.on("ready", syncState);
    player.on("ratechange", syncState);
    player.on("definition_change", syncState);

    syncState();

    return () => {
      player.off("play", onPlay);
      player.off("pause", onPause);
      player.off("ended", onPause);
      player.off("timeupdate", syncState);
      player.off("durationchange", syncState);
      player.off("loadedmetadata", syncState);
      player.off("progress", syncState);
      player.off("ready", syncState);
      player.off("ratechange", syncState);
      player.off("definition_change", syncState);
    };
  }, [player, resetHideTimer]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const togglePlay = () => {
    if (!player) return;
    resetHideTimer();
    if (player.paused) {
      void safePlayerPlay(player);
    } else {
      player.pause();
    }
  };

  const toggleFullscreen = () => {
    resetHideTimer();
    onToggleImmersive();
  };

  const onSeek = (value: number) => {
    if (!player || !Number.isFinite(duration) || duration <= 0) return;
    resetHideTimer();
    player.currentTime = value;
    setCurrentTime(value);
  };

  const applyPlaybackRate = (rate: PlaybackRate) => {
    if (!player) return;
    const normalized = playerSettings.setPlaybackRate(rate);
    player.playbackRate = normalized;
    setPlaybackRate(normalized);
    onPlaybackRateChange?.(normalized);
    setPanel("none");
    resetHideTimer();
  };

  const applyDefinition = (definition: VideoDefinition) => {
    if (!player) return;
    changePlayerDefinition(player, definition);
    onDefinitionChange?.(definition);
    setPanel("none");
    resetHideTimer();
  };

  const closePanel = useCallback(() => {
    setPanel("none");
    resetHideTimer();
  }, [resetHideTimer]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferProgress = duration > 0 ? (buffered / duration) * 100 : 0;
  const activeDefinition =
    currentDefinition ?? definitions[0]?.definition;

  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      {!playing ? (
        <button
          type="button"
          data-player-controls
          aria-label="播放"
          className="pointer-events-auto absolute left-1/2 top-1/2 z-10 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm"
          onPointerDown={stopPointerPropagation}
          onPointerUp={stopPointerPropagation}
          onClick={togglePlay}
        >
          <svg viewBox="0 0 24 24" className="ml-1 h-9 w-9 fill-current">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      ) : isImmersive ? (
        <button
          type="button"
          aria-label="暂停"
          className="pointer-events-auto absolute inset-x-0 top-0 bottom-36 z-[5]"
          onPointerDown={stopPointerPropagation}
          onPointerUp={stopPointerPropagation}
          onClick={togglePlay}
        />
      ) : null}

      <div
        className={`pointer-events-none absolute inset-0 flex flex-col justify-end transition-opacity duration-300 ${
          showUi ? "opacity-100" : "opacity-0"
        }`}
      >
        {panel !== "none" ? (
          <div
            data-player-controls
            className="pointer-events-auto absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={closePanel}
          />
        ) : null}

        {panel === "rate" ? (
          <div
            data-player-controls
            className="pointer-events-auto absolute bottom-28 left-4 right-4 rounded-2xl bg-zinc-900/95 p-3 text-white"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="mb-2 text-xs text-white/60">播放倍速</p>
            <div className="grid grid-cols-3 gap-2">
              {PLAYBACK_RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  className={`rounded-xl px-3 py-2 text-sm ${
                    playbackRate === rate
                      ? "bg-white text-black"
                      : "bg-white/10 text-white"
                  }`}
                  onClick={() => applyPlaybackRate(rate)}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {panel === "quality" && definitions.length > 0 ? (
          <div
            data-player-controls
            className="pointer-events-auto absolute bottom-28 left-4 right-4 rounded-2xl bg-zinc-900/95 p-3 text-white"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="mb-2 text-xs text-white/60">清晰度</p>
            <div className="flex flex-col gap-2">
              {definitions.map((definition) => (
                <button
                  key={definition.definition}
                  type="button"
                  className={`rounded-xl px-3 py-2 text-left text-sm ${
                    activeDefinition === definition.definition
                      ? "bg-white text-black"
                      : "bg-white/10 text-white"
                  }`}
                  onClick={() => applyDefinition(definition)}
                >
                  {definition.text ?? definition.definition.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div
          data-player-controls
          className="pointer-events-auto bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10"
          onMouseMove={resetHideTimer}
          onTouchStart={resetHideTimer}
        >
          <div className="relative mb-3 h-1 w-full rounded-full bg-white/20">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white/35"
              style={{ width: `${bufferProgress}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white"
              style={{ width: `${progress}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onPointerDown={stopPointerPropagation}
              onChange={(event) => onSeek(Number(event.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="播放进度"
            />
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-white/90">
            <span className="shrink-0">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-full bg-white/15 px-3 py-1 text-[11px] text-white"
                onClick={() => {
                  setPanel((prev) => (prev === "rate" ? "none" : "rate"));
                  resetHideTimer();
                }}
              >
                {playbackRate}x
              </button>

              {definitions.length > 0 ? (
                <button
                  type="button"
                  className="rounded-full bg-white/15 px-3 py-1 text-[11px] text-white"
                  onClick={() => {
                    setPanel((prev) => (prev === "quality" ? "none" : "quality"));
                    resetHideTimer();
                  }}
                >
                  {activeDefinition?.toUpperCase() ?? "清晰度"}
                </button>
              ) : null}

              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white"
                onClick={toggleFullscreen}
                aria-label={isImmersive ? "退出全屏" : "全屏"}
              >
                {isImmersive ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
                    <path d="M5 16h3v3H3v-5h2v2zm3-8H5V5H3v5h2V8zm8 8h3v2h-5v-3h2v1zM16 5v2h-2V5h-3V3h5v2z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
