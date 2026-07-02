import type Player from "xgplayer";
import { safePlayerPlay } from "@/lib/webview-playback";
import type { VideoDefinition } from "@/types/feed";

export function changePlayerDefinition(
  player: Player,
  definition: VideoDefinition,
) {
  const current = player.currentTime ?? 0;
  const wasPlaying = !player.paused;

  player.changeDefinition({
    definition: definition.definition,
    url: definition.url,
    text: definition.text ?? definition.definition,
  });

  player.once("canplay", () => {
    if (current > 0) {
      player.currentTime = current;
    }
    if (wasPlaying) {
      void safePlayerPlay(player);
    }
  });
}
