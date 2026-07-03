import type { FeedItem, VideoDefinition } from "@/types/feed";
import { feedPositionStore } from "@/lib/feed-position-store";
import { resolveVideoId } from "@/lib/playback-store";

export {
  PORTRAIT_VIDEO_1080_URL,
  PORTRAIT_VIDEO_720_URL,
} from "@/lib/player-utils";

const LIST_SEPARATOR = "|";

function splitParamList(raw?: string | null): string[] {
  if (!raw) return [];

  const separator = raw.includes(LIST_SEPARATOR) ? LIST_SEPARATOR : ",";
  return raw
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDefinitionsJson(raw?: string | null): Record<string, VideoDefinition[]> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, VideoDefinition[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function buildFeedPlayerHref(
  items: FeedItem[],
  options?: { index?: number; videoId?: string; url?: string },
): string {
  if (items.length === 0) return "/player";

  const urls = items.map((item) => item.url).join(LIST_SEPARATOR);
  const ids = items.map((item) => item.id).join(LIST_SEPARATOR);

  const params = new URLSearchParams({
    urls,
    ids,
  });

  if (options?.videoId) {
    params.set("videoId", options.videoId);
  } else if (options?.url) {
    params.set("targetUrl", options.url);
  } else if (options?.index !== undefined) {
    params.set("index", String(options.index));
  }

  return `/player?${params.toString()}`;
}

export function parseFeedFromSearchParams(
  params: {
    url?: string | null;
    urls?: string | null;
    ids?: string | null;
    posters?: string | null;
    definitions?: string | null;
  },
  defaultItems: FeedItem[] = [],
): FeedItem[] {
  const definitionMap = parseDefinitionsJson(params.definitions);

  if (params.urls) {
    const ids = splitParamList(params.ids);
    const urls = splitParamList(params.urls);

    // 旧版仅 urls、无 ids 的链接会覆盖本地 Feed，统一回退到扫描结果
    if (ids.length === 0 && defaultItems.length > 0) {
      return defaultItems;
    }

    if (urls.length === 0) {
      return defaultItems;
    }

    const posters = splitParamList(params.posters);

    return urls.map((url, index) => {
      const id = resolveVideoId(url, ids[index]);
      const definitions = definitionMap[id] ?? definitionMap[url];
      const defaultDefinition = definitions?.[definitions.length - 1]?.definition;

      return {
        id,
        url: definitions?.find((item) => item.definition === defaultDefinition)?.url ?? url,
        poster: posters[index] || undefined,
        definitions,
        defaultDefinition,
      };
    });
  }

  if (params.url) {
    const id = resolveVideoId(params.url);
    const definitions = definitionMap[id] ?? definitionMap[params.url];

    return [
      {
        id,
        url: params.url,
        definitions,
        defaultDefinition: definitions?.[0]?.definition,
      },
    ];
  }

  return defaultItems;
}

export function normalizeMediaUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed, "https://feed.local");
    return parsed.pathname.split("?")[0].toLowerCase();
  } catch {
    return trimmed.split("?")[0].toLowerCase();
  }
}

function normalizeExactMediaUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed, "https://feed.local");
    return `${parsed.origin}${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function feedItemMatchesUrlExact(item: FeedItem, targetUrl: string) {
  const target = normalizeExactMediaUrl(targetUrl);
  if (!target) return false;

  if (normalizeExactMediaUrl(item.url) === target) return true;

  return (
    item.definitions?.some(
      (definition) => normalizeExactMediaUrl(definition.url) === target,
    ) ?? false
  );
}

function feedItemMatchesUrlPath(item: FeedItem, targetUrl: string) {
  const target = normalizeMediaUrl(targetUrl);
  if (!target) return false;

  if (normalizeMediaUrl(item.url) === target) return true;

  return (
    item.definitions?.some(
      (definition) => normalizeMediaUrl(definition.url) === target,
    ) ?? false
  );
}

export function feedItemMatchesUrl(item: FeedItem, targetUrl: string) {
  return (
    feedItemMatchesUrlExact(item, targetUrl) ||
    feedItemMatchesUrlPath(item, targetUrl)
  );
}

export function findFeedItemIndex(
  items: FeedItem[],
  options: { videoId?: string | null; url?: string | null },
) {
  const videoId = options.videoId?.trim();
  if (videoId) {
    const byId = items.findIndex((item) => item.id === videoId);
    if (byId >= 0) return byId;
  }

  const url = options.url?.trim();
  if (url) {
    const byExact = items.findIndex((item) =>
      feedItemMatchesUrlExact(item, url),
    );
    if (byExact >= 0) return byExact;

    return items.findIndex((item) => feedItemMatchesUrlPath(item, url));
  }

  return -1;
}

export function resolveSavedFeedIndex(items: FeedItem[]) {
  const saved = feedPositionStore.getForItems(items);
  if (!saved) return -1;

  return findFeedItemIndex(items, {
    videoId: saved.videoId,
    url: saved.url,
  });
}

const FEED_POSITION_PARAM_KEYS = [
  "index",
  "videoId",
  "id",
  "video_id",
  "targetUrl",
  "videoUrl",
  "target_url",
] as const;

export function syncFeedPositionToUrl(
  itemOrItems: FeedItem | FeedItem[],
  index: number,
) {
  if (typeof window === "undefined") return;

  const item = Array.isArray(itemOrItems) ? itemOrItems[index] : itemOrItems;
  if (!item) return;

  const params = new URLSearchParams(window.location.search);
  FEED_POSITION_PARAM_KEYS.forEach((key) => params.delete(key));
  params.set("videoId", item.id);
  params.set("index", String(index));

  const query = params.toString();
  const nextUrl = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname;
  const currentUrl = `${window.location.pathname}${window.location.search}`;

  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

export function resolveInitialFeedIndex(
  items: FeedItem[],
  options: {
    index?: string | number | null;
    videoId?: string | null;
    url?: string | null;
    restoreSaved?: boolean;
  },
) {
  if (items.length === 0) return 0;

  if (options.restoreSaved === true) {
    const bySaved = resolveSavedFeedIndex(items);
    if (bySaved >= 0) return bySaved;
  }

  const rawIndex = options.index;
  if (rawIndex !== null && rawIndex !== undefined && rawIndex !== "") {
    const parsed = Number(rawIndex);
    if (Number.isFinite(parsed)) {
      return Math.min(Math.max(Math.trunc(parsed), 0), items.length - 1);
    }
  }

  const byLocator = findFeedItemIndex(items, {
    videoId: options.videoId,
    url: options.url,
  });
  if (byLocator >= 0) return byLocator;

  return 0;
}

export function toXgDefinitionList(definitions: VideoDefinition[]) {
  return definitions.map((item) => ({
    definition: item.definition,
    url: item.url,
    text: item.text ?? item.definition.toUpperCase(),
  }));
}

export function findDefinition(
  definitions: VideoDefinition[] | undefined,
  definition?: string,
  url?: string,
) {
  if (!definitions?.length) return undefined;

  if (definition) {
    return definitions.find((item) => item.definition === definition);
  }

  if (url) {
    return definitions.find((item) => item.url === url);
  }

  return undefined;
}
