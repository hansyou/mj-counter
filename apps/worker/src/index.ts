import { RoomDO } from './roomDO';

export { RoomDO };

interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>;
  ASSETS: Fetcher;
}

const CODE_RE = /^[A-Z2-9]{6}$/;

function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[bytes[i] % chars.length];
  return s;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/health') {
      return Response.json({ ok: true });
    }

    // 建房：Worker 选码 → 建对应 DO → 若码被占用则换码重试
    if (path === '/api/rooms' && request.method === 'POST') {
      const body = (await request.json()) as {
        name?: string;
        initialScore?: number;
        playerName?: string;
        deviceId?: string;
      };
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = genCode();
        const stub = env.ROOMS.getByName(code);
        const res = await stub.fetch(
          new Request('https://do/internal/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              name: body.name,
              initialScore: body.initialScore,
              playerName: body.playerName,
              deviceId: body.deviceId,
            }),
          })
        );
        const data = (await res.json().catch(() => null)) as { error?: { code: string } } | null;
        if (res.ok && data) return Response.json(data);
        // 房间码冲突（ROOM_FULL=已存在）则换码重试，其余错误原样返回
        if (data?.error?.code !== 'ROOM_FULL') {
          return Response.json(data ?? { error: { code: 'INTERNAL', message: '创建失败' } }, { status: 500 });
        }
      }
      return Response.json({ error: { code: 'INTERNAL', message: '创建房间失败，请重试' } }, { status: 500 });
    }

    // 进房 WebSocket：按房间码路由到对应 DO
    if (path.startsWith('/ws/')) {
      const code = path.slice('/ws/'.length).toUpperCase();
      if (!CODE_RE.test(code)) {
        return new Response('Invalid room code', { status: 400 });
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }
      return env.ROOMS.getByName(code).fetch(request);
    }

    // 其余：静态资源（SPA 回退在 assets 配置里）
    return env.ASSETS.fetch(request);
  },
};
