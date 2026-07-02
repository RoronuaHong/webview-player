import type { PlayerBridge } from "@/lib/jsbridge";
import { playbackStore } from "@/lib/playback-store";
import type { InterruptReason, LifecyclePhase } from "@/types/feed";

type LifecycleListener = (event: {
  phase: LifecyclePhase;
  reason?: InterruptReason;
  shouldResume: boolean;
}) => void;

type LifecycleFlushListener = (event: {
  reason: InterruptReason;
  records: ReturnType<typeof playbackStore.exportAll>;
}) => void;

const LIFECYCLE_BRIDGE_METHODS = [
  "onAppPause",
  "onAppResume",
  "onAudioInterrupt",
  "onAudioInterruptEnd",
  "onWebViewDestroy",
  "restoreProgress",
] as const;

class LifecycleManager {
  private listeners = new Set<LifecycleListener>();
  private flushListeners = new Set<LifecycleFlushListener>();
  private phase: LifecyclePhase = "active";
  private wasPlaying = false;
  private mounted = false;
  private ownerId: string | null = null;
  private bridge: PlayerBridge | null = null;
  private lastForegroundAt = 0;

  getPhase() {
    return this.phase;
  }

  getShouldResume() {
    return this.wasPlaying;
  }

  setWasPlaying(playing: boolean) {
    if (this.phase === "active") {
      this.wasPlaying = playing;
    }
  }

  subscribe(listener: LifecycleListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onFlush(listener: LifecycleFlushListener) {
    this.flushListeners.add(listener);
    return () => {
      this.flushListeners.delete(listener);
    };
  }

  mount(bridge?: PlayerBridge, ownerId?: string) {
    const nextOwnerId = ownerId ?? "default";
    if (this.mounted && this.ownerId !== nextOwnerId) return;
    if (this.mounted || typeof window === "undefined") return;
    this.mounted = true;
    this.ownerId = nextOwnerId;
    this.bridge = bridge ?? null;

    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("pageshow", this.onPageShow);
    window.addEventListener("beforeunload", this.onBeforeUnload);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);

    document.addEventListener("freeze", this.onFreeze);
    document.addEventListener("resume", this.onResume);

    bridge?.register("onAppPause", () => {
      this.enterBackground("app_pause");
    });
    bridge?.register("onAppResume", (data) => {
      const resume =
        data?.resume === true ||
        data?.resume === "true" ||
        data?.resume === 1;
      this.enterForeground(resume);
    });
    bridge?.register("onAudioInterrupt", () => {
      this.enterInterrupted("audio_interrupt");
    });
    bridge?.register("onAudioInterruptEnd", (data) => {
      const resume =
        data?.resume === false ||
        data?.resume === "false" ||
        data?.resume === 0
          ? false
          : this.wasPlaying;
      if (this.phase === "interrupted") {
        this.enterForeground(resume);
      }
    });
    bridge?.register("onWebViewDestroy", () => {
      this.flush("page_hide");
      this.setPhase("frozen", "page_hide", false);
    });
    bridge?.register("restoreProgress", (data) => {
      const records = data?.records;
      if (Array.isArray(records)) {
        playbackStore.importAll(
          records as Parameters<typeof playbackStore.importAll>[0],
        );
      }
    });
  }

  unmount(ownerId?: string) {
    if (!this.mounted) return;
    if (ownerId && this.ownerId !== ownerId) return;
    this.mounted = false;
    this.ownerId = null;

    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("pageshow", this.onPageShow);
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    document.removeEventListener("freeze", this.onFreeze);
    document.removeEventListener("resume", this.onResume);

    const bridge = this.bridge;
    if (bridge) {
      for (const method of LIFECYCLE_BRIDGE_METHODS) {
        bridge.unregister(method);
      }
    }
    this.bridge = null;
  }

  notifySystemPause() {
    if (this.phase === "active") {
      this.enterInterrupted("system_pause");
    }
  }

  flush(reason: InterruptReason = "page_hide") {
    const records = playbackStore.flush();
    this.flushListeners.forEach((listener) => {
      listener({ reason, records });
    });
    return records;
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      this.enterBackground("visibility_hidden");
      return;
    }
    if (document.visibilityState === "visible") {
      this.enterForeground(this.wasPlaying);
    }
  };

  private onPageHide = () => {
    this.flush("page_hide");
    this.setPhase("frozen", "page_hide", false);
  };

  private onPageShow = (event: PageTransitionEvent) => {
    // Avoid duplicate resume with visibilitychange on normal foreground transitions.
    if (!event.persisted) return;
    if (document.visibilityState === "visible") {
      this.enterForeground(this.wasPlaying);
    }
  };

  private onFreeze = () => {
    this.flush("page_hide");
    this.setPhase("frozen", "page_hide", false);
  };

  private onResume = () => {
    if (document.visibilityState === "visible") {
      this.enterForeground(this.wasPlaying);
    }
  };

  private onBeforeUnload = () => {
    this.flush("page_hide");
  };

  private onOnline = () => {
    if (this.phase !== "active") {
      this.enterForeground(this.wasPlaying);
    }
  };

  private onOffline = () => {
    this.enterInterrupted("offline");
  };

  private enterBackground(reason: InterruptReason) {
    this.flush(reason);
    this.setPhase("background", reason, false);
  }

  private enterInterrupted(reason: InterruptReason) {
    this.flush(reason);
    this.setPhase("interrupted", reason, false);
  }

  private enterForeground(shouldResume: boolean) {
    const now = Date.now();
    if (now - this.lastForegroundAt < 250) return;
    this.lastForegroundAt = now;

    const resume =
      shouldResume &&
      this.wasPlaying &&
      document.visibilityState === "visible";
    this.setPhase("active", undefined, resume);
  }

  private setPhase(
    phase: LifecyclePhase,
    reason?: InterruptReason,
    shouldResume = false,
  ) {
    if (this.phase === phase) {
      if (!shouldResume) return;
      if (phase === "active") return;
    }

    this.phase = phase;
    this.listeners.forEach((listener) => {
      listener({ phase, reason, shouldResume });
    });

    this.bridge?.emit("lifecycle", {
      phase,
      reason,
      shouldResume,
      wasPlaying: this.wasPlaying,
    });
  }
}

export const lifecycleManager = new LifecycleManager();
