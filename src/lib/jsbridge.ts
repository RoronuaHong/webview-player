export type BridgeEventType =
  | "ready"
  | "feed_ready"
  | "play"
  | "pause"
  | "ended"
  | "timeupdate"
  | "error"
  | "seeking"
  | "seeked"
  | "buffering"
  | "canplay"
  | "slide_change"
  | "progress_saved"
  | "lifecycle"
  | "bridge_reply"
  | "bridge_request"
  | "playback_rate_change"
  | "definition_change";

export type BridgeOutboundMessage = {
  type: BridgeEventType | string;
  data?: Record<string, unknown>;
  requestId?: string;
  timestamp: number;
};

export type BridgeInboundMessage = {
  method: string;
  data?: Record<string, unknown>;
  requestId?: string;
};

export type BridgeReplyPayload = {
  requestId: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
};

export type BridgeCommandHandler = (
  data: Record<string, unknown> | undefined,
  requestId?: string,
) => void | Promise<void> | unknown;

type WebKitMessageHandler = {
  postMessage: (message: unknown) => void;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

declare global {
  interface Window {
    WebPlayerBridge?: {
      invoke: (
        method: string,
        data?: Record<string, unknown>,
        requestId?: string,
      ) => void;
      request: (
        type: string,
        data?: Record<string, unknown>,
        requestId?: string,
      ) => Promise<unknown>;
    };
    webkit?: {
      messageHandlers?: Record<string, WebKitMessageHandler>;
    };
    AndroidBridge?: {
      postMessage: (message: string) => void;
      invoke?: (method: string, payload: string) => void;
    };
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
  }
}

export class PlayerBridge {
  private handlers = new Map<string, BridgeCommandHandler>();
  private pending = new Map<string, PendingRequest>();
  private bridgeName: string;
  private requestCounter = 0;

  constructor(bridgeName = "WebViewBridge") {
    this.bridgeName = bridgeName;
  }

  register(method: string, handler: BridgeCommandHandler) {
    this.handlers.set(method, handler);
  }

  unregister(method: string) {
    this.handlers.delete(method);
  }

  mount() {
    window.WebPlayerBridge = {
      invoke: (method, data, requestId) => {
        void this.handleInvoke({ method, data, requestId });
      },
      request: (type, data, requestId) => this.request(type, data, { requestId }),
    };

    window.addEventListener("message", this.onWindowMessage);
  }

  unmount() {
    window.removeEventListener("message", this.onWindowMessage);
    this.pending.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new Error("Bridge unmounted"));
    });
    this.pending.clear();

    if (window.WebPlayerBridge) {
      delete window.WebPlayerBridge;
    }
  }

  createRequestId(prefix = "h5") {
    this.requestCounter += 1;
    return `${prefix}_${Date.now()}_${this.requestCounter}`;
  }

  emit(
    type: BridgeEventType | string,
    data?: Record<string, unknown>,
    requestId?: string,
  ) {
    const message: BridgeOutboundMessage = {
      type,
      data,
      requestId,
      timestamp: Date.now(),
    };

    const payload = JSON.stringify(message);

    const webkitHandler =
      window.webkit?.messageHandlers?.[this.bridgeName] ??
      window.webkit?.messageHandlers?.WebViewBridge;

    if (webkitHandler) {
      webkitHandler.postMessage(message);
      return;
    }

    if (window.AndroidBridge?.postMessage) {
      window.AndroidBridge.postMessage(payload);
      return;
    }

    if (window.AndroidBridge?.invoke) {
      window.AndroidBridge.invoke(type, payload);
      return;
    }

    if (window.ReactNativeWebView?.postMessage) {
      window.ReactNativeWebView.postMessage(payload);
      return;
    }

    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, "*");
    }
  }

  request<T = unknown>(
    type: string,
    data?: Record<string, unknown>,
    options?: { requestId?: string; timeout?: number },
  ): Promise<T> {
    const requestId = options?.requestId ?? this.createRequestId();
    const timeout = options?.timeout ?? 15000;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Bridge request timeout: ${type}`));
      }, timeout);

      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      this.emit(type, data, requestId);
    });
  }

  reply(requestId: string | undefined, result: unknown, error?: string) {
    if (!requestId) return;

    this.emit("bridge_reply", {
      requestId,
      result,
      error,
      ok: !error,
    });
  }

  handleBridgeReply(payload?: BridgeReplyPayload | Record<string, unknown>) {
    if (!payload || typeof payload !== "object") return false;

    const requestId = String(payload.requestId ?? "");
    if (!requestId) return false;

    const pending = this.pending.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pending.delete(requestId);

    const error =
      typeof payload.error === "string" ? payload.error : undefined;
    const ok = payload.ok !== false && !error;

    if (!ok) {
      pending.reject(new Error(error || "Bridge request failed"));
      return true;
    }

    pending.resolve(payload.result ?? { ok: true });
    return true;
  }

  private onWindowMessage = (event: MessageEvent) => {
    if (!event.data || typeof event.data !== "object") return;

    const payload = event.data as BridgeInboundMessage & BridgeReplyPayload;

    if (payload.requestId && (payload.ok !== undefined || payload.result !== undefined || payload.error)) {
      if (this.handleBridgeReply(payload)) return;
    }

    const { method, data, requestId } = payload;
    if (!method) return;

    void this.handleInvoke({ method, data, requestId });
  };

  private async handleInvoke(message: BridgeInboundMessage) {
    if (message.method === "bridge_reply") {
      this.handleBridgeReply(message.data);
      return;
    }

    const handler = this.handlers.get(message.method);
    if (!handler) {
      this.reply(message.requestId, null, `Unknown method: ${message.method}`);
      return;
    }

    try {
      const result = await handler(message.data, message.requestId);
      this.reply(message.requestId, result ?? { ok: true });
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : "Bridge command failed";
      this.reply(message.requestId, null, errMsg);
    }
  }
}
