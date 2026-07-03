"use client";

import { useCallback, useEffect, useRef } from "react";
import type Player from "xgplayer";
import { findDefinition, findFeedItemIndex, toXgDefinitionList } from "@/lib/feed-utils";
import type { FeedCatalogSnapshot } from "@/lib/feed-catalog-state";
import { PlayerBridge } from "@/lib/jsbridge";
import { lifecycleManager } from "@/lib/lifecycle-manager";
import { changePlayerDefinition } from "@/lib/player-definition";
import { playbackStore } from "@/lib/playback-store";
import { playerSettings } from "@/lib/player-settings";
import { safePlayerPlay } from "@/lib/webview-playback";
import type { FeedItem, VideoDefinition } from "@/types/feed";

type UseFeedBridgeOptions = {
  sessionId: string;
  bridgeName: string;
  bridgeRef: React.MutableRefObject<PlayerBridge | null>;
  items: FeedItem[];
  itemsRef: React.RefObject<FeedItem[]>;
  activeIndexRef: React.RefObject<number>;
  playersRef: React.RefObject<Map<string, Player>>;
  definitionsById: Map<string, VideoDefinition[]>;
  getActiveItem: () => FeedItem | undefined;
  getActivePlayer: () => Player | null;
  scrollToIndex: (index: number) => number;
  scrollToVideoId: (videoId: string) => number;
  scrollToUrl: (url: string) => number;
  saveActiveProgress: (immediate?: boolean) => void;
  getFeedCatalogSnapshot?: () => FeedCatalogSnapshot;
  setFeedCatalog?: (options: {
    catalogId?: string;
    totalCount?: number;
    reset?: boolean;
    items?: FeedItem[];
    offset?: number;
  }) => void;
  appendFeedItems?: (offset: number, items: FeedItem[]) => void;
  findLoadedIndex?: (options: {
    videoId?: string | null;
    url?: string | null;
  }) => number;
  onDefinitionChange?: (
    videoId: string,
    index: number,
    definition: VideoDefinition,
  ) => void;
  setPlaybackIntent?: (playing: boolean) => void;
};

export function useFeedBridge({
  sessionId,
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
  saveActiveProgress,
  getFeedCatalogSnapshot,
  setFeedCatalog,
  appendFeedItems,
  findLoadedIndex,
  onDefinitionChange,
  setPlaybackIntent,
}: UseFeedBridgeOptions) {
  const onDefinitionChangeRef = useRef(onDefinitionChange);
  onDefinitionChangeRef.current = onDefinitionChange;
  const setPlaybackIntentRef = useRef(setPlaybackIntent);
  setPlaybackIntentRef.current = setPlaybackIntent;

  const getItemDefinitions = useCallback(
    (videoId?: string) => {
      if (!videoId) return [];
      return definitionsById.get(videoId) ?? [];
    },
    [definitionsById],
  );

  const buildFeedCatalog = useCallback(() => {
    return (itemsRef.current ?? []).map((item, index) => ({
      index,
      videoId: item.id,
      url: item.url,
      title: item.title,
      definitions: item.definitions?.map((definition) => ({
        definition: definition.definition,
        url: definition.url,
      })),
    }));
  }, [itemsRef]);

  const emitFeedReady = useCallback(() => {
    const currentItems = itemsRef.current ?? [];
    const index = activeIndexRef.current ?? 0;
    bridgeRef.current?.emit("feed_ready", {
      count: currentItems.length,
      records: playbackStore.exportAll(),
      items: buildFeedCatalog(),
      index,
      videoId: currentItems[index]?.id,
      url: currentItems[index]?.url,
    });
  }, [activeIndexRef, buildFeedCatalog, itemsRef]);

  const switchDefinition = useCallback(
    (
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

      onDefinitionChangeRef.current?.(
        item.id,
        activeIndexRef.current ?? 0,
        target,
      );

      return {
        videoId: item.id,
        definition: target.definition,
        url: target.url,
      };
    },
    [activeIndexRef, getItemDefinitions],
  );

  useEffect(() => {
    const bridge = new PlayerBridge(bridgeName);
    bridgeRef.current = bridge;

    bridge.register("play", () => {
      setPlaybackIntentRef.current?.(true);
      void safePlayerPlay(getActivePlayer());
    });
    bridge.register("pause", () => {
      saveActiveProgress(true);
      setPlaybackIntentRef.current?.(false);
      getActivePlayer()?.pause();
    });
    bridge.register("togglePlay", () => {
      const player = getActivePlayer();
      if (!player) return;
      if (player.paused) {
        setPlaybackIntentRef.current?.(true);
        void safePlayerPlay(player);
      } else {
        setPlaybackIntentRef.current?.(false);
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
      const index =
        findLoadedIndex?.({ videoId }) ??
        findFeedItemIndex(itemsRef.current ?? [], { videoId });
      return { index, videoId, found: index >= 0 };
    });
    bridge.register("getIndexByUrl", (data) => {
      const url = typeof data?.url === "string" ? data.url : "";
      const index =
        findLoadedIndex?.({ url }) ??
        findFeedItemIndex(itemsRef.current ?? [], { url });
      return { index, url, found: index >= 0 };
    });
    bridge.register("getFeedCatalog", () => ({
      ...(getFeedCatalogSnapshot?.() ?? {}),
      items: buildFeedCatalog(),
    }));
    bridge.register("setFeedCatalog", (data) => {
      if (!setFeedCatalog) {
        throw new Error("Paged feed catalog is not available");
      }

      const records = Array.isArray(data?.items)
        ? (data.items as FeedItem[])
        : undefined;
      setFeedCatalog({
        catalogId:
          typeof data?.catalogId === "string" ? data.catalogId : undefined,
        totalCount:
          typeof data?.totalCount === "number" ? data.totalCount : undefined,
        reset: data?.reset !== false,
        offset:
          typeof data?.offset === "number" ? data.offset : undefined,
        items: records,
      });

      return getFeedCatalogSnapshot?.();
    });
    bridge.register("appendFeedItems", (data) => {
      if (!appendFeedItems) {
        throw new Error("Paged feed catalog is not available");
      }

      const offset = Number(data?.offset);
      const records = data?.items;
      if (!Number.isFinite(offset) || !Array.isArray(records)) {
        throw new Error("offset and items are required");
      }

      appendFeedItems(offset, records as FeedItem[]);
      return getFeedCatalogSnapshot?.();
    });
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
      playersRef.current?.forEach((player) => {
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

    lifecycleManager.mount(bridge, sessionId);
    bridge.mount(sessionId);
    emitFeedReady();

    return () => {
      saveActiveProgress(true);
      lifecycleManager.unmount(sessionId);
      bridge.unmount(sessionId);
      bridgeRef.current = null;
    };
  }, [
    bridgeName,
    buildFeedCatalog,
    emitFeedReady,
    getActiveItem,
    getActivePlayer,
    getItemDefinitions,
    getFeedCatalogSnapshot,
    setFeedCatalog,
    appendFeedItems,
    findLoadedIndex,
    itemsRef,
    playersRef,
    saveActiveProgress,
    scrollToIndex,
    scrollToUrl,
    scrollToVideoId,
    sessionId,
    switchDefinition,
    activeIndexRef,
  ]);

  useEffect(() => {
    if (items.length === 0) return;
    emitFeedReady();
  }, [emitFeedReady, items]);

  return {
    emitFeedReady,
  };
}
