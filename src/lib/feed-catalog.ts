import fs from "node:fs";
import path from "node:path";
import type { FeedItem, VideoDefinition } from "@/types/feed";
import { resolveVideoId } from "@/lib/playback-store";

const VIDEO_DIR = path.join(process.cwd(), "public", "videos");

function buildDefinitions(playback720: string, playback360: string): VideoDefinition[] {
  return [
    {
      definition: "360p",
      url: playback360,
      text: "360P",
    },
    {
      definition: "720p",
      url: playback720,
      text: "720P",
    },
  ];
}

function toTitle(fileName: string, index: number): string {
  const base = fileName.replace(/\.mp4$/i, "").replace(/[-_]+/g, " ").trim();
  return base ? base : `视频 ${index + 1}`;
}

export function loadDefaultFeedItems(): FeedItem[] {
  if (!fs.existsSync(VIDEO_DIR)) {
    return [];
  }

  const files = fs
    .readdirSync(VIDEO_DIR)
    .filter((name) => name.toLowerCase().endsWith(".mp4"))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const playback720 =
    files.find((name) => /720/i.test(name)) ?? files[0] ?? null;
  const playback360 =
    files.find((name) => /360/i.test(name)) ?? files[1] ?? files[0] ?? null;

  return files.map((file, index) => {
    const url = `/videos/${file}`;
    const id = resolveVideoId(url, `feed-${String(index + 1).padStart(2, "0")}`);
    const item: FeedItem = {
      id,
      url,
      title: toTitle(file, index),
    };

    if (index === 0 && playback720 && playback360) {
      item.definitions = buildDefinitions(
        `/videos/${playback720}`,
        `/videos/${playback360}`,
      );
      item.defaultDefinition = "720p";
    }

    return item;
  });
}
