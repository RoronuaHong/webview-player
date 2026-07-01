import Link from "next/link";
import { loadDefaultFeedItems } from "@/lib/feed-catalog";
import { buildFeedPlayerHref } from "@/lib/feed-utils";

export const dynamic = "force-dynamic";

export default function Home() {
  const defaultItems = loadDefaultFeedItems();
  const feedHref = buildFeedPlayerHref(defaultItems);

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-white">
      <h1 className="text-2xl font-semibold">WebView Feed Player</h1>
      <p className="max-w-md text-center text-sm text-zinc-400">
        上下滑动切换视频，进度自动记忆；支持来电、闹钟、切后台、WebView
        销毁等中断恢复。
      </p>

      <div className="flex flex-col gap-3">
        <Link
          href="/player"
          className="rounded-full bg-white px-6 py-3 text-center text-sm font-medium text-black transition hover:bg-zinc-200"
        >
          竖滑 Feed（默认 {defaultItems.length} 条）
        </Link>
        <Link
          href={feedHref}
          className="rounded-full border border-white/20 px-6 py-3 text-center text-sm text-white transition hover:bg-white/10"
        >
          指定 Feed URL
        </Link>
      </div>

      <div className="max-w-lg space-y-2 text-center text-xs text-zinc-500">
        <p>
          /player?urls=url1|url2&ids=id1|id2&definitions=&#123;&quot;videoId&quot;:[&#123;&quot;definition&quot;:&quot;720p&quot;,&quot;url&quot;:&quot;...&quot;&#125;]&#125;
        </p>
        <p>倍速：WebPlayerBridge.invoke(&quot;setPlaybackRate&quot;, &#123; rate: 1.5 &#125;)</p>
        <p>清晰度：WebPlayerBridge.invoke(&quot;setDefinition&quot;, &#123; definition: &quot;720p&quot; &#125;)</p>
        <p>双向回调：WebPlayerBridge.request(&quot;native_getToken&quot;, &#123; scope: &quot;play&quot; &#125;)</p>
      </div>
    </div>
  );
}
