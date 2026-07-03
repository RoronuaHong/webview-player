"use client";

import { useEffect, useRef } from "react";
import { buildPlaybackSourceDescriptor } from "@/lib/player-source";
import { playbackStore } from "@/lib/playback-store";
import {
  applyInlineVideoElement,
  primeNativeVideoElement,
} from "@/lib/webview-playback";
import type { FeedItem } from "@/types/feed";

type FeedAdjacentPreviewProps = {
  item: FeedItem;
  forcePrime?: boolean;
};

export default function FeedAdjacentPreview({
  item,
  forcePrime = false,
}: FeedAdjacentPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const primeRafRef = useRef<number | null>(null);
  const descriptor = buildPlaybackSourceDescriptor({
    videoId: item.id,
    url: item.url,
    poster: item.poster,
    definitions: item.definitions,
    defaultDefinition: item.defaultDefinition,
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    applyInlineVideoElement(video, { preload: "auto" });

    const absoluteSrc =
      typeof window !== "undefined"
        ? new URL(descriptor.playbackUrl, window.location.origin).href
        : descriptor.playbackUrl;
    if (video.src !== absoluteSrc) {
      video.src = descriptor.playbackUrl;
      video.load();
    }

    const startAt = playbackStore.getStartTime(item.id);
    const schedulePrime = () => {
      if (primeRafRef.current !== null) {
        cancelAnimationFrame(primeRafRef.current);
      }
      primeRafRef.current = requestAnimationFrame(() => {
        primeRafRef.current = null;
        void primeNativeVideoElement(video, startAt);
      });
    };

    video.addEventListener("loadedmetadata", schedulePrime);
    video.addEventListener("loadeddata", schedulePrime);
    video.addEventListener("canplay", schedulePrime);

    return () => {
      if (primeRafRef.current !== null) {
        cancelAnimationFrame(primeRafRef.current);
        primeRafRef.current = null;
      }
      video.removeEventListener("loadedmetadata", schedulePrime);
      video.removeEventListener("loadeddata", schedulePrime);
      video.removeEventListener("canplay", schedulePrime);
    };
  }, [descriptor.playbackUrl, item.id]);

  useEffect(() => {
    if (!forcePrime) return;

    const video = videoRef.current;
    if (!video) return;

    const startAt = playbackStore.getStartTime(item.id);
    void primeNativeVideoElement(video, startAt);
  }, [forcePrime, item.id, descriptor.playbackUrl]);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return;

    const startAt = playbackStore.getStartTime(item.id);
    let rafId = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          void primeNativeVideoElement(video, startAt);
        });
      },
      { root: null, threshold: 0.01 },
    );

    observer.observe(root);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [item.id, descriptor.playbackUrl]);

  return (
    <div
      ref={rootRef}
      className="feed-adjacent-preview pointer-events-none absolute inset-0 z-10 bg-black"
    >
      {item.poster ? (
        <img
          src={item.poster}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
          loading="eager"
          decoding="async"
        />
      ) : null}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-contain"
        poster={item.poster}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
      />
    </div>
  );
}
