import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWebSocketClient,
  type WebSocketClient,
  type WebSocketClientOptions,
  type WebSocketStatus,
} from './websocket.js';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  closeCalls = 0;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  static reset() {
    FakeWebSocket.instances = [];
  }

  close() {
    this.closeCalls += 1;
  }

  emitClose() {
    this.onclose?.({} as CloseEvent);
  }

  emitError() {
    this.onerror?.(new Event('error'));
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitOpen() {
    this.onopen?.(new Event('open'));
  }

  send(data: string) {
    this.sent.push(data);
  }
}

const createOptions = (
  onMessage: (message: unknown) => void,
  onStatusChange: (status: WebSocketStatus) => void = () => undefined,
): WebSocketClientOptions => ({
  url: 'wss://notifications.example.test/ws',
  reconnect: {
    shouldRetry: () => true,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    jitterMs: 500,
  },
  heartbeat: {
    message: '{"Command": "ping"}',
    responseMessage: 'pong',
    intervalMs: 60_000,
    timeoutMs: 1_000,
  },
  onMessage,
  onStatusChange,
});

const latestSocket = () => {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error('Expected a fake WebSocket instance.');
  return socket;
};

let clients: WebSocketClient[] = [];

const createClient = (options: WebSocketClientOptions) => {
  const client = createWebSocketClient(options);
  clients.push(client);
  return client;
};

describe('createWebSocketClient', () => {
  beforeEach(() => {
    clients = [];
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    for (const client of clients) client.dispose();
    clients = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('delivers each valid JSON frame in arrival order after malformed traffic', () => {
    const messages: unknown[] = [];
    const client = createClient(createOptions((message) => messages.push(message)));

    client.connect();
    const socket = latestSocket();
    socket.emitOpen();
    socket.emitMessage('{"id": 1}');
    socket.emitMessage('{"id": 1}');
    socket.emitMessage('not json');
    socket.emitMessage('{"id": 2}');

    expect(messages).toEqual([{ id: 1 }, { id: 1 }, { id: 2 }]);
  });

  it('treats configured pong and other traffic as heartbeat activity without forwarding pong', () => {
    vi.useFakeTimers();
    const messages: unknown[] = [];
    const client = createClient(createOptions((message) => messages.push(message)));

    client.connect();
    const socket = latestSocket();
    socket.emitOpen();
    vi.advanceTimersByTime(60_000);
    expect(socket.sent).toEqual(['{"Command": "ping"}']);

    socket.emitMessage('pong');
    socket.emitMessage('not json');
    socket.emitMessage(new Uint8Array([1]));
    socket.emitMessage('{"id": 1}');
    vi.advanceTimersByTime(1_000);

    vi.advanceTimersByTime(59_000);
    expect(socket.sent).toEqual(['{"Command": "ping"}', '{"Command": "ping"}']);
    socket.emitMessage('{"id": 2}');
    vi.advanceTimersByTime(1_000);

    expect(socket.closeCalls).toBe(0);
    expect(messages).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('closes silent heartbeats with capped jittered retries and resets delays after opening', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const client = createClient(createOptions(() => undefined));

    client.connect();
    const first = latestSocket();
    first.emitOpen();
    vi.advanceTimersByTime(61_000);
    expect(first.closeCalls).toBe(1);
    vi.advanceTimersByTime(2_498);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    latestSocket().emitClose();
    vi.advanceTimersByTime(4_499);
    latestSocket().emitClose();
    vi.advanceTimersByTime(8_499);
    latestSocket().emitClose();
    vi.advanceTimersByTime(16_499);
    latestSocket().emitClose();
    vi.advanceTimersByTime(30_498);
    expect(FakeWebSocket.instances).toHaveLength(5);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(6);

    latestSocket().emitOpen();
    latestSocket().emitClose();
    vi.advanceTimersByTime(2_498);
    expect(FakeWebSocket.instances).toHaveLength(6);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(7);
  });

  it('uses one retry path when error and close both fire', () => {
    vi.useFakeTimers();
    const client = createClient(createOptions(() => undefined));

    client.connect();
    const socket = latestSocket();
    socket.emitError();
    socket.emitClose();
    vi.advanceTimersByTime(2_500);

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('checks retry eligibility when scheduling and when a queued timer executes', () => {
    vi.useFakeTimers();
    let allowed = false;
    const noRetryOptions = createOptions(() => undefined);
    noRetryOptions.reconnect.shouldRetry = () => allowed;
    const client = createClient(noRetryOptions);
    const messages: unknown[] = [];
    const retryOptions = createOptions((message) => messages.push(message));
    retryOptions.reconnect.shouldRetry = () => allowed;
    const queuedClient = createClient(retryOptions);

    client.connect();
    latestSocket().emitClose();
    allowed = true;
    queuedClient.connect();
    latestSocket().emitClose();
    allowed = false;
    vi.advanceTimersByTime(2_500);

    expect(FakeWebSocket.instances).toHaveLength(2);
    allowed = true;
    queuedClient.connect();
    const restartedSocket = latestSocket();
    restartedSocket.emitOpen();
    restartedSocket.emitMessage('{"restarted": true}');

    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(messages).toEqual([{ restarted: true }]);
  });

  it('cancels queued retries, restarts from the first delay, and ignores late events after disposal', () => {
    vi.useFakeTimers();
    const messages: unknown[] = [];
    const statuses: WebSocketStatus[] = [];
    const client = createClient(
      createOptions(
        (message) => messages.push(message),
        (status) => statuses.push(status),
      ),
    );

    client.connect();
    const first = latestSocket();
    first.emitOpen();
    first.emitClose();
    client.disconnect();
    const statusesAfterDisconnect = [...statuses];
    first.emitOpen();
    first.emitMessage('{"late": true}');
    vi.runAllTimers();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(messages).toEqual([]);
    expect(statuses).toEqual(statusesAfterDisconnect);

    client.connect();
    const second = latestSocket();
    second.emitClose();
    vi.advanceTimersByTime(2_500);
    const third = latestSocket();
    third.emitOpen();
    third.emitMessage('{"reconnected": true}');
    third.emitClose();
    client.dispose();
    const statusesAfterDispose = [...statuses];
    third.emitOpen();
    third.emitMessage('{"late": true}');
    vi.runAllTimers();
    client.connect();

    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(messages).toEqual([{ reconnected: true }]);
    expect(statuses).toEqual(statusesAfterDispose);
  });

  it('creates independent clients and remains safe to construct without a browser WebSocket', () => {
    vi.stubGlobal('WebSocket', undefined);
    const firstMessages: unknown[] = [];
    const secondMessages: unknown[] = [];
    const first = createClient(createOptions((message) => firstMessages.push(message)));
    const second = createClient(createOptions((message) => secondMessages.push(message)));

    vi.stubGlobal('WebSocket', FakeWebSocket);
    first.connect();
    second.connect();
    const [firstSocket, secondSocket] = FakeWebSocket.instances;
    if (!firstSocket || !secondSocket) throw new Error('Expected independent fake WebSockets.');
    firstSocket.emitOpen();
    secondSocket.emitOpen();
    firstSocket.emitMessage('{"client": 1}');
    secondSocket.emitMessage('{"client": 2}');
    first.disconnect();
    secondSocket.emitMessage('{"client": 2, "next": true}');

    expect(firstMessages).toEqual([{ client: 1 }]);
    expect(secondMessages).toEqual([{ client: 2 }, { client: 2, next: true }]);
  });
});
