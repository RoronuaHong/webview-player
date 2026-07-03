"use client";

import { useCallback, useEffect, useId, useMemo } from "react";
import type Player from "xgplayer";
import type { PlayerBridge } from "@/lib/jsbridge";
import { feedPositionStore } from "@/lib/feed-position-store";
import { syncFeedPositionToUrl } from "@/lib/feed-utils";
import { lifecycleManager } from "@/lib/lifecycle-manager";
import { playbackStore } from "@/lib/playback-store";
import {
  debounce,
  getWebViewPerformanceProfile,
} from "@/lib/webview-runtime";
import type { FeedItem } from "@/types/feed";

type UseFeedSessionOptions = {
  itemsRef: React.RefObject<FeedItem[]>;
  activeIndexRef: React.RefObject<number>;
  getActiveItem: () => FeedItem | undefined;
  getItemByIndex?: (index: number) => FeedItem | null | undefined;
  catalogId?: string;
  getPlayerByRealIndex: (index: number) => Player | null;
  bridgeRef: React.RefObject<PlayerBridge | null>;
};

export function useFeedSession({
  itemsRef,
  activeIndexRef,
  getActiveItem,
  getItemByIndex,
  catalogId,
  getPlayerByRealIndex,
  bridgeRef,
}: UseFeedSessionOptions) {
  const sessionId = useId();

  useEffect(() => {
    playbackStore.hydrate();
  }, []);

  const saveProgressByIndex = useCallback((index: number, immediate = true) => {
    const item = getItemByIndex?.(index) ?? itemsRef.current?.[index];
    if (!item) return;
    const player = getPlayerByRealIndex(index);
    if (!player) return;

    const currentTime = player.currentTime ?? 0;
    const duration = player.duration ?? 0;
    const existing = playbackStore.get(item.id);

    if (
      duration <= 0 &&
      currentTime <= 0 &&
      existing &&
      existing.currentTime > 0
    ) {
      return;
    }

    playbackStore.update(
      {
        videoId: item.id,
        url: String(player.config?.url ?? item.url),
        currentTime,
        duration: duration > 0 ? duration : (existing?.duration ?? 0),
        wasPlaying: !player.paused,
        playbackRate: player.playbackRate,
        definition:
          (player.curDefinition?.definition as string | undefined) ??
          existing?.definition,
      },
      { immediate },
    );
  }, [getItemByIndex, getPlayerByRealIndex, itemsRef]);

  const saveActiveProgress = useCallback(
    (immediate = true) => {
      saveProgressByIndex(activeIndexRef.current ?? 0, immediate);
    },
    [activeIndexRef, saveProgressByIndex],
  );

  const persistFeedPositionImmediate = useCallback(
    (index: number) => {
      const items = itemsRef.current;
      const item = getItemByIndex?.(index) ?? items?.[index];
      if (!item) return;

      if (catalogId) {
        feedPositionStore.saveForCatalog(catalogId, item, index);
      } else if (items?.length) {
        feedPositionStore.save(items, index);
      }
      syncFeedPositionToUrl(item, index);
    },
    [catalogId, getItemByIndex, itemsRef],
  );

  const syncFeedPositionToUrlDebounced = useMemo(() => {
    const waitMs = getWebViewPerformanceProfile().positionPersistDebounceMs;
    return debounce((index: number) => {
      const items = itemsRef.current;
      const item = getItemByIndex?.(index) ?? items?.[index];
      if (!item) return;
      syncFeedPositionToUrl(item, index);
    }, waitMs);
  }, [getItemByIndex, itemsRef]);

  const persistFeedPosition = useCallback(
    (index: number, immediate = false) => {
      const items = itemsRef.current;
      const item = getItemByIndex?.(index) ?? items?.[index];
      if (!item) return;

      // localStorage 立即写入，避免滑动后快速刷新丢位
      if (catalogId) {
        feedPositionStore.saveForCatalog(catalogId, item, index);
      } else if (items?.length) {
        feedPositionStore.save(items, index);
      }

      if (immediate) {
        syncFeedPositionToUrlDebounced.cancel();
        syncFeedPositionToUrl(item, index);
        return;
      }

      syncFeedPositionToUrlDebounced(index);
    },
    [catalogId, getItemByIndex, itemsRef, syncFeedPositionToUrlDebounced],
  );

  const saveActiveFeedPosition = useCallback(
    (immediate = true) => {
      persistFeedPosition(activeIndexRef.current ?? 0, immediate);
    },
    [activeIndexRef, persistFeedPosition],
  );

  useEffect(() => {
    const flushUrlSync = () => {
      syncFeedPositionToUrlDebounced.flush();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushUrlSync();
      }
    };

    window.addEventListener("pagehide", flushUrlSync);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushUrlSync);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushUrlSync();
    };
  }, [syncFeedPositionToUrlDebounced]);

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
