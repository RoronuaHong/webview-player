"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import FeedPlayer from "@/components/FeedPlayer";
import { parseFeedFromSearchParams } from "@/lib/feed-utils";
import type { FeedItem } from "@/types/feed";

type PlayerContentProps = {
  defaultItems: FeedItem[];
};

export default function PlayerContent({ defaultItems }: PlayerContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urls = searchParams.get("urls");
  const ids = searchParams.get("ids");

  // 旧版仅 urls、无 ids 的书签会在客户端覆盖本地 Feed，强制回到默认页
  useEffect(() => {
    if (urls && !ids?.trim()) {
      router.replace("/player");
    }
  }, [urls, ids, router]);

  const items = parseFeedFromSearchParams(
    {
      url: searchParams.get("url"),
      urls: searchParams.get("urls"),
      ids: searchParams.get("ids"),
      posters: searchParams.get("posters"),
      definitions: searchParams.get("definitions"),
    },
    defaultItems,
  );

  const initialIndex = Number(searchParams.get("index") ?? "0");
  const isLive = searchParams.get("live") === "1";
  const bridgeName = searchParams.get("bridge") ?? "WebViewBridge";

  return (
    <FeedPlayer
      items={items}
      initialIndex={Number.isFinite(initialIndex) ? initialIndex : 0}
      isLive={isLive}
      bridgeName={bridgeName}
    />
  );
}
