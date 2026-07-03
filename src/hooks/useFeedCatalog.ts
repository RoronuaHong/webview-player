"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerBridge } from "@/lib/jsbridge";
import {
  FeedCatalogState,
  type FeedCatalogSnapshot,
  type FeedLoadRequest,
} from "@/lib/feed-catalog-state";
import type { FeedItem, VideoDefinition } from "@/types/feed";

type UseFeedCatalogOptions = {
  initialItems: FeedItem[];
  bridgeRef: React.RefObject<PlayerBridge | null>;
};

export function useFeedCatalog({
  initialItems,
  bridgeRef,
}: UseFeedCatalogOptions) {
  const catalogRef = useRef(
    new FeedCatalogState(initialItems),
  );
  const [version, setVersion] = useState(0);

  const bump = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    catalogRef.current = new FeedCatalogState(initialItems);
    bump();
  }, [bump, initialItems]);

  const totalCount = catalogRef.current.totalCount;
  const catalogId = catalogRef.current.catalogId;

  const getItem = useCallback((index: number) => {
    return catalogRef.current.getItem(index);
  }, []);

  const getLoadedItems = useCallback(() => {
    return catalogRef.current.listLoadedEntries().map((entry) => entry.item);
  }, []);

  const getSnapshot = useCallback((): FeedCatalogSnapshot => {
    return catalogRef.current.getSnapshot();
  }, []);

  const setCatalog = useCallback(
    (options: {
      catalogId?: string;
      totalCount?: number;
      reset?: boolean;
      items?: FeedItem[];
      offset?: number;
    }) => {
      catalogRef.current.setCatalog(options);
      bump();
    },
    [bump],
  );

  const appendItems = useCallback(
    (offset: number, items: FeedItem[]) => {
      catalogRef.current.appendItems(offset, items);
      bump();
    },
    [bump],
  );

  const findLoadedIndex = useCallback(
    (options: { videoId?: string | null; url?: string | null }) => {
      return catalogRef.current.findLoadedIndex(options);
    },
    [],
  );

  const requestLoadIfNeeded = useCallback(
    (centerIndex: number) => {
      const request = catalogRef.current.getMissingLoadRequest(centerIndex);
      if (!request) return null;

      bridgeRef.current?.emit("feed_load_request", request);
      return request;
    },
    [bridgeRef],
  );

  const ensureRangeLoaded = useCallback(
    (centerIndex: number) => {
      return requestLoadIfNeeded(centerIndex);
    },
    [requestLoadIfNeeded],
  );

  const resolveLoadRequest = useCallback(
    (request: FeedLoadRequest, items: FeedItem[]) => {
      catalogRef.current.clearPendingRequest(request);
      catalogRef.current.appendItems(request.offset, items);
      bump();
    },
    [bump],
  );

  const definitionsById = useMemo(() => {
    const map = new Map<string, VideoDefinition[]>();
    catalogRef.current.listLoadedEntries().forEach(({ item }) => {
      if (item.definitions?.length) {
        map.set(item.id, item.definitions);
      }
    });
    return map;
  }, [version]);

  return {
    version,
    catalogId,
    totalCount,
    catalogRef,
    getItem,
    getLoadedItems,
    getSnapshot,
    setCatalog,
    appendItems,
    findLoadedIndex,
    ensureRangeLoaded,
    resolveLoadRequest,
    definitionsById,
  };
}
