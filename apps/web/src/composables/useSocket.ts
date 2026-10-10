import { reactive } from 'vue';

export interface SocketStatus {
  connected: boolean;
  lastError: string | null;
}

type Handler = (payload: any) => void;
type Ack = (res: any) => void;

let ws: WebSocket | null = null;
let currentCode: string | null = null;
let nextId = 1;
let shouldReconnect = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const handlers = new Map<string, Set<Handler>>();
const pending = new Map<number, Ack>();
const connectCbs = new Set<() => void>();
const outbox: string[] = [];

export const socketStatus = reactive<SocketStatus>({
  connected: false,
  lastError: null,
});

export function getDeviceId(): string {
  const KEY = 'mj-device-id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(KEY, id);
  }
  return id;
}

function wsUrl(code: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws/${code}?deviceId=${encodeURIComponent(getDeviceId())}`;
}

/** 建立到某房间的连接（同房间幂等） */
export function connectSocket(code: string): void {
  if (ws && currentCode === code && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  currentCode = code;
  shouldReconnect = true;
  open();
}

function open(): void {
  if (!currentCode) return;
  try {
    ws = new WebSocket(wsUrl(currentCode));
  } catch (err) {
    socketStatus.lastError = '连接失败';
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    socketStatus.connected = true;
    socketStatus.lastError = null;
    while (outbox.length) ws?.send(outbox.shift()!);
    connectCbs.forEach((cb) => cb());
  };
  ws.onmessage = (e) => {
    try {
      handleMessage(JSON.parse(e.data));
    } catch {
      /* ignore malformed */
    }
  };
  ws.onerror = () => {
    socketStatus.lastError = '连接出错';
  };
  ws.onclose = () => {
    socketStatus.connected = false;
    scheduleReconnect();
  };
}

function scheduleReconnect(): void {
  if (!shouldReconnect || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    open();
  }, 1200);
}

function handleMessage(msg: any): void {
  // ack：带 id 且有等待中的回调
  if (msg && msg.id != null && pending.has(msg.id)) {
    const cb = pending.get(msg.id)!;
    pending.delete(msg.id);
    cb(msg.ok ? (msg.result ?? {}) : { ok: false, error: msg.error });
    return;
  }
  // 广播：带 event
  if (msg && msg.event && handlers.has(msg.event)) {
    handlers.get(msg.event)!.forEach((h) => h(msg.payload));
  }
}

/** 连接建立（含自动重连）后触发；返回注销函数 */
export function onConnect(handler: () => void): () => void {
  connectCbs.add(handler);
  return () => connectCbs.delete(handler);
}

export function on(event: string, handler: Handler): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler);
  return () => handlers.get(event)!.delete(handler);
}

export function emit(event: string, payload: Record<string, unknown> = {}, cb?: Ack): void {
  const id = nextId++;
  if (cb) pending.set(id, cb);
  const raw = JSON.stringify({ id, event, payload });
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(raw);
  } else {
    outbox.push(raw);
  }
}
