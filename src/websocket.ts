/** Connection lifecycle status reported by a WebSocket client instance. @public */
export type WebSocketStatus = 'CONNECTING' | 'OPEN' | 'CLOSED';

/** Host-owned configuration for one framework-free WebSocket client instance. @public */
export interface WebSocketClientOptions {
  /** Browser WebSocket endpoint for this client instance. */
  url: string;
  /** Reconnect predicate and delay settings owned by the host runtime. */
  reconnect: {
    /** Returns whether the current host state permits another connection attempt. */
    shouldRetry: () => boolean;
    /** Base reconnect delay in milliseconds. */
    baseDelayMs: number;
    /** Maximum reconnect delay in milliseconds before jitter. */
    maxDelayMs: number;
    /** Exclusive upper bound for integer reconnect jitter in milliseconds. */
    jitterMs: number;
  };
  /** Application heartbeat messages and timing. */
  heartbeat: {
    /** Exact text frame sent for each heartbeat. */
    message: string;
    /** Exact text frame that is heartbeat activity but not a business message. */
    responseMessage: string;
    /** Milliseconds between heartbeat messages. */
    intervalMs: number;
    /** Milliseconds to wait for any incoming frame after a heartbeat. */
    timeoutMs: number;
  };
  /** Receives connection status changes for this client instance. */
  onStatusChange: (status: WebSocketStatus) => void;
  /** Receives each valid JSON text frame in native arrival order. */
  onMessage: (message: unknown) => void;
}

/** Explicit lifecycle controls for one framework-free WebSocket client. @public */
export interface WebSocketClient {
  /** Starts one connection attempt when no connection or retry is active. */
  connect(): void;
  /** Stops the active connection and cancels scheduled reconnects. */
  disconnect(): void;
  /** Permanently stops the client and ignores all later native callbacks. */
  dispose(): void;
}

interface ConnectionAttempt {
  socket?: WebSocket;
}

interface TimerToken {
  handle: ReturnType<typeof setTimeout>;
}

/**
 * Creates an instance-scoped native WebSocket client. The factory is safe during
 * server rendering because it reads the browser WebSocket constructor only when
 * `connect()` starts an attempt.
 *
 * @public
 */
export const createWebSocketClient = (options: WebSocketClientOptions): WebSocketClient => {
  let currentAttempt: ConnectionAttempt | undefined;
  let heartbeatInterval: TimerToken | undefined;
  let heartbeatWait: TimerToken | undefined;
  let reconnectTimer: TimerToken | undefined;
  let reconnectAttempt = 0;
  let reconnectEnabled = true;
  let disposed = false;
  let status: WebSocketStatus = 'CLOSED';

  const isCurrentAttempt = (attempt: ConnectionAttempt) => !disposed && currentAttempt === attempt;

  const reportStatus = (nextStatus: WebSocketStatus) => {
    if (status === nextStatus) return;
    status = nextStatus;
    options.onStatusChange(nextStatus);
  };

  const clearHeartbeatWait = () => {
    if (!heartbeatWait) return;
    clearTimeout(heartbeatWait.handle);
    heartbeatWait = undefined;
  };

  const clearHeartbeatResources = () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval.handle);
    heartbeatInterval = undefined;
    clearHeartbeatWait();
  };

  const clearReconnectTimer = () => {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer.handle);
    reconnectTimer = undefined;
  };

  const retryDelay = (attempt: number) =>
    Math.min(
      options.reconnect.maxDelayMs,
      options.reconnect.baseDelayMs * 2 ** Math.min(attempt, 5),
    ) + Math.floor(Math.random() * options.reconnect.jitterMs);

  let startConnection: () => void;

  const scheduleReconnect = () => {
    if (
      disposed ||
      !reconnectEnabled ||
      currentAttempt ||
      reconnectTimer ||
      !options.reconnect.shouldRetry()
    ) {
      return;
    }

    const nextAttempt = reconnectAttempt + 1;
    const timer: TimerToken = {
      handle: setTimeout(() => {
        if (reconnectTimer !== timer) return;
        reconnectTimer = undefined;
        if (disposed || !reconnectEnabled || currentAttempt || !options.reconnect.shouldRetry())
          return;
        startConnection();
      }, retryDelay(nextAttempt)),
    };
    reconnectAttempt = nextAttempt;
    reconnectTimer = timer;
  };

  const finishAttempt = (attempt: ConnectionAttempt, closeSocket: boolean) => {
    if (!isCurrentAttempt(attempt)) return;
    currentAttempt = undefined;
    clearHeartbeatResources();
    reportStatus('CLOSED');
    if (closeSocket) attempt.socket?.close();
    scheduleReconnect();
  };

  const handleFrame = (attempt: ConnectionAttempt, event: MessageEvent) => {
    if (!isCurrentAttempt(attempt)) return;
    clearHeartbeatWait();
    if (event.data === options.heartbeat.responseMessage || typeof event.data !== 'string') return;

    let message: unknown;
    try {
      message = JSON.parse(event.data) as unknown;
    } catch {
      // Malformed JSON is not a business message and cannot block later frames.
      return;
    }
    options.onMessage(message);
  };

  const sendHeartbeat = (attempt: ConnectionAttempt) => {
    if (!isCurrentAttempt(attempt)) return;
    const socket = attempt.socket;
    if (!socket) return;

    try {
      socket.send(options.heartbeat.message);
    } catch {
      finishAttempt(attempt, true);
      return;
    }

    clearHeartbeatWait();
    const timer: TimerToken = {
      handle: setTimeout(() => {
        if (heartbeatWait !== timer || !isCurrentAttempt(attempt)) return;
        heartbeatWait = undefined;
        finishAttempt(attempt, true);
      }, options.heartbeat.timeoutMs),
    };
    heartbeatWait = timer;
  };

  const startHeartbeat = (attempt: ConnectionAttempt) => {
    if (!isCurrentAttempt(attempt)) return;
    clearHeartbeatResources();
    heartbeatInterval = {
      handle: setInterval(() => sendHeartbeat(attempt), options.heartbeat.intervalMs),
    };
  };

  const handleOpen = (attempt: ConnectionAttempt) => {
    if (!isCurrentAttempt(attempt)) return;
    reconnectAttempt = 0;
    reportStatus('OPEN');
    startHeartbeat(attempt);
  };

  startConnection = () => {
    if (
      disposed ||
      !reconnectEnabled ||
      currentAttempt ||
      reconnectTimer ||
      typeof WebSocket !== 'function'
    ) {
      return;
    }

    const attempt: ConnectionAttempt = {};
    currentAttempt = attempt;
    reportStatus('CONNECTING');
    if (!isCurrentAttempt(attempt)) return;

    try {
      attempt.socket = new WebSocket(options.url);
    } catch {
      finishAttempt(attempt, false);
      return;
    }

    const { socket } = attempt;
    socket.onopen = () => handleOpen(attempt);
    socket.onmessage = (event) => handleFrame(attempt, event);
    socket.onerror = () => finishAttempt(attempt, true);
    socket.onclose = () => finishAttempt(attempt, false);
  };

  return Object.freeze<WebSocketClient>({
    connect: () => {
      if (disposed) return;
      reconnectEnabled = true;
      startConnection();
    },
    disconnect: () => {
      if (disposed) return;
      reconnectEnabled = false;
      reconnectAttempt = 0;
      const attempt = currentAttempt;
      currentAttempt = undefined;
      clearReconnectTimer();
      clearHeartbeatResources();
      reportStatus('CLOSED');
      attempt?.socket?.close();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      reconnectEnabled = false;
      const attempt = currentAttempt;
      currentAttempt = undefined;
      clearReconnectTimer();
      clearHeartbeatResources();
      reportStatus('CLOSED');
      attempt?.socket?.close();
    },
  });
};
