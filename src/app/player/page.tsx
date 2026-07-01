import { Suspense } from "react";
import { redirect } from "next/navigation";
import { loadDefaultFeedItems } from "@/lib/feed-catalog";
import PlayerContent from "./PlayerContent";

export const dynamic = "force-dynamic";

type PlayerPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function hasFeedIds(ids: string | string[] | undefined): boolean {
  if (!ids) return false;
  if (Array.isArray(ids)) {
    return ids.some((id) => id.trim().length > 0);
  }
  return ids.trim().length > 0;
}

export default async function PlayerPage({ searchParams }: PlayerPageProps) {
  const params = await searchParams;
  const urls = params.urls;
  const ids = params.ids;

  if (typeof urls === "string" && urls.length > 0 && !hasFeedIds(ids)) {
    redirect("/player");
  }

  const defaultItems = loadDefaultFeedItems();

  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-black text-sm text-white/70">
          加载播放器...
        </div>
      }
    >
      <PlayerContent defaultItems={defaultItems} />
    </Suspense>
  );
}
