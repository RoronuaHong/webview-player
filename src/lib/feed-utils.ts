import type { FeedItem, VideoDefinition } from "@/types/feed";
import { resolveVideoId } from "@/lib/playback-store";
import { isHlsUrl } from "@/lib/player-utils";

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

export function buildFeedPlayerHref(items: FeedItem[]): string {
  if (items.length === 0) return "/player";

  const urls = items.map((item) => item.url).join(LIST_SEPARATOR);
  const ids = items.map((item) => item.id).join(LIST_SEPARATOR);

  const params = new URLSearchParams({
    urls,
    ids,
  });

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

export function shouldAutoplayLive(url: string, isLive: boolean): boolean {
  return isLive || isHlsUrl(url);
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
