import type {
  BorrowRequest,
  GameEvent,
  Player,
  RoomRecord,
  RoomState,
} from '@mj/shared';
import {
  MAX_PLAYERS,
  RuleError,
  SCHEMA_VERSION,
  assertAmount,
  assertInitialScore,
  assertPhase,
  canUndoLast,
  expireBorrowRequests,
  findPendingBorrow,
  getPlayer,
  makeBorrowRequest,
  recordToState,
  validateBorrow,
  validatePay,
  validateStart,
} from '@mj/shared';

const rid = () => crypto.randomUUID();

export interface CreateInput {
  code: string;
  name: string;
  initialScore: number;
  playerName: string;
  deviceId: string;
}
export interface JoinInput {
  playerName: string;
  deviceId: string;
}

/**
 * 单房间引擎（对应一个 Durable Object）。
 * 余额不直接存储，由「初始点数 + 事件流水」折叠得出，保证撤销与守恒天然正确。
 * 持久化由宿主（DO）负责：引擎只持有内存记录并就地变更，宿主在每次命令后 save()。
 */
export class RoomEngine {
  private rec: RoomRecord | null = null;

  load(rec: RoomRecord | null): void {
    this.rec = rec;
  }

  getRecord(): RoomRecord | null {
    return this.rec;
  }

  private mustGet(): RoomRecord {
    if (!this.rec) throw new RuleError('ROOM_NOT_FOUND', '房间不存在');
    return this.rec;
  }

  private withFreshBorrows(rec: RoomRecord): RoomRecord {
    const now = Date.now();
    const expired = expireBorrowRequests(rec.borrowRequests, now);
    const changed = expired.some((r, i) => r.status !== rec.borrowRequests[i].status);
    if (changed) rec.borrowRequests = expired;
    return rec;
  }

  private state(): RoomState {
    return recordToState(this.withFreshBorrows(this.mustGet()));
  }

  private pushEvent(event: GameEvent): RoomState {
    this.mustGet().events.push(event);
    return this.state();
  }

  private balances(): Record<string, number> {
    const st = this.state();
    return Object.fromEntries(st.players.map((p) => [p.id, p.balance]));
  }

  hasRoom(): boolean {
    return this.rec !== null;
  }

  create(input: CreateInput): { state: RoomState; playerId: string } {
    if (this.rec) throw new RuleError('ROOM_FULL', '房间已存在');
    assertInitialScore(input.initialScore);
    const name = (input.name || '未命名房间').slice(0, 24);
    const playerName = (input.playerName || '玩家').slice(0, 12);
    const now = Date.now();

    const player: Player = {
      id: rid(),
      name: playerName,
      deviceId: input.deviceId,
      seat: 0,
      balance: input.initialScore,
      online: true,
      joinedAt: now,
    };

    this.rec = {
      meta: {
        id: rid(),
        code: input.code,
        name,
        phase: 'lobby',
        initialScore: input.initialScore,
        updatedAt: now,
        schemaVersion: SCHEMA_VERSION,
      },
      players: [player],
      events: [],
      borrowRequests: [],
    };
    this.pushEvent({
      id: rid(),
      type: 'join',
      operatorId: player.id,
      playerId: player.id,
      name: player.name,
      ts: now,
    });
    return { state: this.state(), playerId: player.id };
  }

  join(input: JoinInput): { state: RoomState; playerId: string } {
    const rec = this.mustGet();
    const now = Date.now();

    // 同设备重入恢复身份（任意阶段均允许）
    const byDevice = rec.players.find((p) => p.deviceId === input.deviceId);
    if (byDevice) {
      byDevice.online = true;
      return { state: this.state(), playerId: byDevice.id };
    }

    // 新玩家仅可在大厅加入，避免对局中途注入点数破坏零和
    assertPhase({ phase: rec.meta.phase }, ['lobby']);

    if (rec.players.length >= MAX_PLAYERS) {
      throw new RuleError('ROOM_FULL', `房间已满 ${MAX_PLAYERS} 人`, { have: rec.players.length });
    }
    const name = (input.playerName || '玩家').slice(0, 12);
    if (rec.players.some((p) => p.name === name)) {
      throw new RuleError('NAME_TAKEN', '昵称已被占用');
    }

    const usedSeats = new Set(rec.players.map((p) => p.seat));
    const seat =
      ([0, 1, 2, 3] as const).find((s) => !usedSeats.has(s)) ?? 0;

    const player: Player = {
      id: rid(),
      name,
      deviceId: input.deviceId,
      seat,
      balance: rec.meta.initialScore,
      online: true,
      joinedAt: now,
    };
    rec.players.push(player);
    this.pushEvent({
      id: rid(),
      type: 'join',
      operatorId: player.id,
      playerId: player.id,
      name: player.name,
      ts: now,
    });
    return { state: this.state(), playerId: player.id };
  }

  /** 按 deviceId 重新绑定会话（刷新 / 断线重连恢复），不新增玩家、不限阶段 */
  attach(deviceId: string): { state: RoomState; playerId: string } {
    const rec = this.mustGet();
    const player = rec.players.find((p) => p.deviceId === deviceId);
    if (!player) throw new RuleError('INVALID_PLAYER', '未找到该设备对应的玩家，请重新加入');
    if (!player.online) player.online = true;
    return { state: this.state(), playerId: player.id };
  }

  leave(playerId: string): RoomState {
    const rec = this.mustGet();
    const now = Date.now();
    const player = getPlayer({ players: rec.players }, playerId);

    if (rec.meta.phase === 'lobby') {
      rec.players = rec.players.filter((p) => p.id !== playerId);
    } else {
      player.online = false;
    }
    this.pushEvent({
      id: rid(),
      type: 'leave',
      operatorId: playerId,
      playerId,
      ts: now,
    });
    return this.state();
  }

  setOnline(playerId: string, online: boolean): void {
    const p = this.rec?.players.find((x) => x.id === playerId);
    if (p && p.online !== online) p.online = online;
  }

  start(operatorId: string): RoomState {
    const rec = this.mustGet();
    assertPhase({ phase: rec.meta.phase }, ['lobby']);
    validateStart(rec.players.length);
    rec.meta.phase = 'playing';
    rec.meta.startedAt = Date.now();
    return this.pushEvent({
      id: rid(),
      type: 'start',
      operatorId,
      ts: Date.now(),
    });
  }

  pay(operatorId: string, toId: string, amount: number): RoomState {
    const rec = this.mustGet();
    assertPhase({ phase: rec.meta.phase }, ['playing']);
    assertAmount(amount);
    const from = getPlayer({ players: rec.players }, operatorId);
    const to = getPlayer({ players: rec.players }, toId);
    validatePay(this.balances(), from.id, to.id, amount);

    return this.pushEvent({
      id: rid(),
      type: 'pay',
      operatorId,
      from: from.id,
      to: to.id,
      amount,
      ts: Date.now(),
    });
  }

  deposit(operatorId: string, amount: number): RoomState {
    const rec = this.mustGet();
    assertPhase({ phase: rec.meta.phase }, ['playing']);
    assertAmount(amount);
    const from = getPlayer({ players: rec.players }, operatorId);
    const bal = this.balances()[from.id] ?? 0;
    if (bal < amount) {
      throw new RuleError('INSUFFICIENT_BALANCE', '余额不足', { diff: amount - bal });
    }
    return this.pushEvent({
      id: rid(),
      type: 'deposit',
      operatorId,
      from: from.id,
      amount,
      ts: Date.now(),
    });
  }

  /** 发起借点请求（待出借人确认）——纯借款，不含支付 */
  requestBorrow(
    operatorId: string,
    lenderId: string,
    borrowAmount: number
  ): { state: RoomState; request: BorrowRequest } {
    const rec = this.mustGet();
    assertPhase({ phase: rec.meta.phase }, ['playing']);
    const borrower = getPlayer({ players: rec.players }, operatorId);
    const lender = getPlayer({ players: rec.players }, lenderId);

    if (findPendingBorrow(rec.borrowRequests, borrower.id)) {
      throw new RuleError('BORROW_PENDING', '已有待确认的借点请求');
    }
    validateBorrow(this.balances(), borrower.id, lender.id, borrowAmount);

    const now = Date.now();
    const request = makeBorrowRequest({
      id: rid(),
      borrowerId: borrower.id,
      lenderId: lender.id,
      amount: borrowAmount,
      now,
    });
    rec.borrowRequests.push(request);
    return { state: this.state(), request };
  }

  cancelBorrow(operatorId: string, requestId: string): { state: RoomState; request: BorrowRequest } {
    const rec = this.mustGet();
    const req = rec.borrowRequests.find((r) => r.id === requestId);
    if (!req) throw new RuleError('BORROW_NOT_FOUND', '借点请求不存在');
    if (req.borrowerId !== operatorId) throw new RuleError('NOT_YOUR_REQUEST', '只能撤回自己的请求');
    if (req.status !== 'pending') throw new RuleError('BORROW_EXPIRED', '请求已关闭');
    req.status = 'cancelled';
    return { state: this.state(), request: req };
  }

  /** 出借人响应借点请求；同意则原子完成「借入 + 生成债务」 */
  respondBorrow(
    operatorId: string,
    requestId: string,
    approve: boolean
  ): { state: RoomState; request: BorrowRequest } {
    const rec = this.mustGet();
    const req = rec.borrowRequests.find((r) => r.id === requestId);
    if (!req) throw new RuleError('BORROW_NOT_FOUND', '借点请求不存在');
    if (req.lenderId !== operatorId) throw new RuleError('NOT_YOUR_REQUEST', '只有出借人可以响应');
    if (req.status !== 'pending') throw new RuleError('BORROW_EXPIRED', '请求已关闭');
    if (Date.now() > req.expiresAt) {
      req.status = 'expired';
      throw new RuleError('BORROW_EXPIRED', '请求已超时');
    }

    if (!approve) {
      req.status = 'rejected';
      return { state: this.state(), request: req };
    }

    // 同意：再次校验后原子提交；若校验失败则关闭请求，避免卡在 pending
    try {
      validateBorrow(this.balances(), req.borrowerId, req.lenderId, req.amount);
    } catch (err) {
      req.status = 'expired';
      throw err;
    }
    req.status = 'approved';
    this.pushEvent({
      id: rid(),
      type: 'borrow',
      operatorId,
      borrowerId: req.borrowerId,
      lenderId: req.lenderId,
      amount: req.amount,
      debtId: rid(),
      ts: Date.now(),
    });
    return { state: this.state(), request: req };
  }

  repay(operatorId: string, lenderId: string, debtId: string, amount: number): RoomState {
    this.mustGet();
    assertPhase({ phase: this.rec!.meta.phase }, ['playing', 'settled']);
    assertAmount(amount);
    const st = this.state();
    const debt = st.debts.find((d) => d.id === debtId);
    if (!debt) throw new RuleError('DEBT_NOT_FOUND', '债务不存在');
    if (debt.borrowerId !== operatorId) throw new RuleError('NOT_YOUR_REQUEST', '只能偿还自己的债务');
    if (debt.lenderId !== lenderId) throw new RuleError('INVALID_PLAYER', '出借人不匹配');
    if (amount > debt.remaining) {
      throw new RuleError('INVALID_AMOUNT', '还款金额超过剩余未还', { remaining: debt.remaining });
    }
    const bal = st.players.find((p) => p.id === operatorId)?.balance ?? 0;
    if (bal < amount) {
      throw new RuleError('INSUFFICIENT_BALANCE', '余额不足', { diff: amount - bal });
    }

    return this.pushEvent({
      id: rid(),
      type: 'repay',
      operatorId,
      borrowerId: operatorId,
      lenderId,
      amount,
      debtId,
      ts: Date.now(),
    });
  }

  settleDeposit(operatorId: string, targets: string[]): RoomState {
    const rec = this.mustGet();
    assertPhase({ phase: rec.meta.phase }, ['playing', 'settled']);
    const valid = [...new Set(targets)].filter((t) => rec.players.some((p) => p.id === t));
    if (valid.length === 0) throw new RuleError('INVALID_PLAYER', '分配目标无效');
    return this.pushEvent({
      id: rid(),
      type: 'settle_deposit',
      operatorId,
      targets: valid,
      ts: Date.now(),
    });
  }

  undo(operatorId: string): RoomState {
    const rec = this.mustGet();
    const check = canUndoLast(rec.events, operatorId);
    if (!check.ok) {
      throw new RuleError(
        check.code === 'NO_UNDO_TARGET' ? 'NO_UNDO_TARGET' : 'UNDO_BLOCKED',
        check.code === 'NO_UNDO_TARGET' ? '没有可撤销的操作' : '该操作已被后续操作依赖，不可撤销'
      );
    }
    rec.events.pop();
    return this.pushEvent({
      id: rid(),
      type: 'undo',
      operatorId,
      targetEventId: check.event.id,
      ts: Date.now(),
    });
  }

  endGame(): RoomState {
    const rec = this.mustGet();
    assertPhase({ phase: rec.meta.phase }, ['playing']);
    rec.meta.phase = 'settled';
    rec.meta.endedAt = Date.now();
    return this.state();
  }

  nextRound(): RoomState {
    const rec = this.mustGet();
    assertPhase({ phase: rec.meta.phase }, ['settled']);
    // 名册固定（禁止中途加入），这里做一次人数兜底校验
    validateStart(rec.players.length);
    rec.meta.phase = 'playing';
    rec.meta.startedAt = Date.now();
    rec.meta.endedAt = undefined;
    rec.events = [];
    rec.borrowRequests = [];
    return this.state();
  }

  getState(): RoomState {
    return this.state();
  }
}
