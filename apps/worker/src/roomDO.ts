import { DurableObject } from 'cloudflare:workers';
import { RuleError, type RoomRecord, type RoomState } from '@mj/shared';
import { RoomEngine, type CreateInput, type JoinInput } from './roomService';

interface WsAttachment {
  deviceId?: string;
  playerId?: string;
}

/**
 * 每个房间一个 Durable Object 实例。
 * - WebSocket：接受本房间所有玩家连接，消息为 { id, event, payload }，应答 { id, ok, result|error }
 * - 广播：room:state 发给本房间全部连接
 * - 持久化：整个 RoomRecord 存入 DO 的同步 KV（休眠后可从存储恢复）
 */
export class RoomDO extends DurableObject {
  private engine = new RoomEngine();
  private loaded = false;

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.loaded = true;
      const rec = this.ctx.storage.kv.get<RoomRecord>('room') ?? null;
      this.engine.load(rec);
    }
  }

  private save(): void {
    const rec = this.engine.getRecord();
    if (rec) this.ctx.storage.kv.put('room', rec);
    else this.ctx.storage.kv.delete('room');
  }

  private broadcastState(state: RoomState): void {
    const msg = JSON.stringify({ event: 'room:state', payload: { room: state } });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* socket closing */
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket 升级：接受连接
    if (request.headers.get('Upgrade') === 'websocket') {
      const deviceId = url.searchParams.get('deviceId') ?? '';
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ deviceId } satisfies WsAttachment);
      return new Response(null, { status: 101, webSocket: client });
    }

    // 建房（由 Worker 转发）
    if (request.method === 'POST' && url.pathname.endsWith('/create')) {
      this.ensureLoaded();
      try {
        const body = (await request.json()) as CreateInput;
        const result = this.engine.create(body);
        this.save();
        return Response.json({ code: body.code, state: result.state, playerId: result.playerId });
      } catch (err) {
        const error =
          err instanceof RuleError
            ? { code: err.code, message: err.message, data: err.data }
            : { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
        return Response.json({ error }, { status: 400 });
      }
    }

    return new Response('Not Found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.ensureLoaded();
    let id: number | null = null;
    try {
      const { id: msgId, event, payload } = JSON.parse(String(message)) as {
        id: number;
        event: string;
        payload: Record<string, unknown>;
      };
      id = msgId ?? null;

      const att = (ws.deserializeAttachment() as WsAttachment | null) ?? {};
      const result = this.dispatch(event, payload ?? {}, att, ws);
      // join/attach 可能改变绑定，回写附件
      ws.serializeAttachment(att);

      // 统一为 { state, ...extra }
      const wrapped = result && typeof result === 'object' && 'state' in result ? result : { state: result };
      this.save();
      const state = (wrapped as { state: RoomState }).state;
      this.broadcastState(state);
      ws.send(JSON.stringify({ id, ok: true, result: wrapped }));
    } catch (err) {
      // 分发过程中可能已就地变更（如借点请求置为过期），一并落盘
      this.save();
      const error =
        err instanceof RuleError
          ? { code: err.code, message: err.message, data: err.data }
          : { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
      ws.send(JSON.stringify({ id, ok: false, error }));
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.ensureLoaded();
    const att = (ws.deserializeAttachment() as WsAttachment | null) ?? {};
    if (att.playerId) {
      this.engine.setOnline(att.playerId, false);
      this.save();
      if (this.engine.hasRoom()) {
        try {
          this.broadcastState(this.engine.getState());
        } catch {
          /* room gone */
        }
      }
    }
  }

  private dispatch(
    event: string,
    payload: Record<string, unknown>,
    att: WsAttachment,
    _ws: WebSocket
  ): unknown {
    const operatorId = att.playerId;
    const requireOperator = (): string => {
      if (!operatorId) throw new RuleError('INVALID_PLAYER', '未绑定玩家，请先加入房间');
      return operatorId;
    };

    switch (event) {
      case 'room:join': {
        const input = payload as unknown as JoinInput;
        const result = this.engine.join({ playerName: input.playerName, deviceId: att.deviceId ?? '' });
        att.playerId = result.playerId;
        return result;
      }
      case 'room:attach': {
        const result = this.engine.attach(att.deviceId ?? '');
        att.playerId = result.playerId;
        return result;
      }
      case 'room:leave': {
        const pid = requireOperator();
        att.playerId = undefined;
        return this.engine.leave(pid);
      }
      case 'game:start':
        return this.engine.start(requireOperator());
      case 'game:end':
        requireOperator(); // 仅校验已绑定玩家（任意玩家可结束）
        return this.engine.endGame();
      case 'game:next':
        return this.engine.nextRound();
      case 'tx:pay':
        return this.engine.pay(requireOperator(), String(payload.toId), Number(payload.amount));
      case 'tx:deposit':
        return this.engine.deposit(requireOperator(), Number(payload.amount));
      case 'tx:repay':
        return this.engine.repay(
          requireOperator(),
          String(payload.lenderId),
          String(payload.debtId),
          Number(payload.amount)
        );
      case 'tx:settle':
        return this.engine.settleDeposit(requireOperator(), (payload.targets as string[]) ?? []);
      case 'undo':
        return this.engine.undo(requireOperator());
      case 'borrow:request':
        return this.engine.requestBorrow(
          requireOperator(),
          String(payload.lenderId),
          Number(payload.amount)
        );
      case 'borrow:respond':
        return this.engine.respondBorrow(
          requireOperator(),
          String(payload.requestId),
          !!payload.approve
        );
      case 'borrow:cancel':
        return this.engine.cancelBorrow(requireOperator(), String(payload.requestId));
      default:
        throw new RuleError('INVALID_AMOUNT', `未知事件: ${event}`);
    }
  }
}
