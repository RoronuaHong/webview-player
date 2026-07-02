"use client";

import { useCallback, useEffect, useId } from "react";
import type Player from "xgplayer";
import type { PlayerBridge } from "@/lib/jsbridge";
import { feedPositionStore } from "@/lib/feed-position-store";
import { syncFeedPositionToUrl } from "@/lib/feed-utils";
import { lifecycleManager } from "@/lib/lifecycle-manager";
import { playbackStore } from "@/lib/playback-store";
import type { FeedItem } from "@/types/feed";

type UseFeedSessionOptions = {
  itemsRef: React.RefObject<FeedItem[]>;
  activeIndexRef: React.RefObject<number>;
  getActiveItem: () => FeedItem | undefined;
  getPlayerByRealIndex: (index: number) => Player | null;
  bridgeRef: React.RefObject<PlayerBridge | null>;
};

export function useFeedSession({
  itemsRef,
  activeIndexRef,
  getActiveItem,
  getPlayerByRealIndex,
  bridgeRef,
}: UseFeedSessionOptions) {
  const sessionId = useId();

  useEffect(() => {
    playbackStore.hydrate();
  }, []);

  const saveProgressByIndex = useCallback((index: number, immediate = true) => {
    const item = itemsRef.current?.[index];
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
  }, [getPlayerByRealIndex, itemsRef]);

  const saveActiveProgress = useCallback(
    (immediate = true) => {
      saveProgressByIndex(activeIndexRef.current ?? 0, immediate);
    },
    [activeIndexRef, saveProgressByIndex],
  );

  const persistFeedPosition = useCallback(
    (index: number) => {
      const items = itemsRef.current;
      if (!items?.length) return;
      feedPositionStore.save(items, index);
      syncFeedPositionToUrl(items, index);
    },
    [itemsRef],
  );

  const saveActiveFeedPosition = useCallback(() => {
    persistFeedPosition(activeIndexRef.current ?? 0);
  }, [activeIndexRef, persistFeedPosition]);

  const emitProgressSaved = useCallback(
    (payload: {
      reason?: string;
      records: ReturnType<typeof playbackStore.exportAll>;
    }) => {
      const item = getActiveItem();
      bridgeRef.current?.emit("progress_saved", {
        reason: payload.reason,
        records: payload.records,
        index: activeIndexRef.current,
        videoId: item?.id,
        phase: lifecycleManager.getPhase(),
      });
    },
    [activeIndexRef, bridgeRef, getActiveItem],
  );

  useEffect(() => {
    const unsubscribe = lifecycleManager.onFlush(({ reason, records }) => {
      emitProgressSaved({ reason, records });
    });
    return unsubscribe;
  }, [emitProgressSaved]);

  return {
    sessionId,
    saveProgressByIndex,
    saveActiveProgress,
    persistFeedPosition,
    saveActiveFeedPosition,
    emitProgressSaved,
  };
}
