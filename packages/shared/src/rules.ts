import type {
  BorrowRequest,
  Debt,
  GameEvent,
  Phase,
  Player,
  PlayerId,
  RoomRecord,
  RoomState,
} from './types';
import { BORROW_TTL_MS, MAX_INITIAL_SCORE, MAX_PLAYERS, MIN_PLAYERS } from './types';
import { RuleError } from './errors';

export function assertInitialScore(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_INITIAL_SCORE) {
    throw new RuleError('INVALID_INITIAL_SCORE', `初始点数必须是 0~${MAX_INITIAL_SCORE} 的整数`, {
      value,
    });
  }
}

export function assertAmount(value: number, max?: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RuleError('INVALID_AMOUNT', '金额必须是正整数', { value });
  }
  if (max !== undefined && value > max) {
    throw new RuleError('INVALID_AMOUNT', '金额超出可用范围', { value, max });
  }
}

export function assertPhase(state: Pick<RoomState, 'phase'>, allowed: Phase[]): void {
  if (!allowed.includes(state.phase)) {
    throw new RuleError('WRONG_PHASE', `当前阶段（${state.phase}）不允许该操作`, {
      phase: state.phase,
    });
  }
}

export function getPlayer(state: { players: Player[] }, id: PlayerId): Player {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new RuleError('INVALID_PLAYER', '玩家不存在', { id });
  return p;
}

export function totalPoints(state: {
  players: { balance: number }[];
  depositTotal: number;
}): number {
  return state.players.reduce((s, p) => s + p.balance, 0) + state.depositTotal;
}

export function expectedTotal(initialScore: number, playerCount: number): number {
  return initialScore * playerCount;
}

// ---------------------------------------------------------------------------
// 事件折叠（Event Sourcing）
// 状态 = foldEvents(开局基线, 事件序列)。撤销 = 去掉尾部事件重新折叠，天然正确。
// ---------------------------------------------------------------------------

export interface FoldState {
  balances: Record<PlayerId, number>;
  depositTotal: number;
  debts: Debt[];
}

export function foldEvents(
  players: Player[],
  initialScore: number,
  events: GameEvent[]
): FoldState {
  const balances: Record<PlayerId, number> = {};
  for (const p of players) balances[p.id] = initialScore;
  let depositTotal = 0;
  const debts: Debt[] = [];

  for (const e of events) {
    switch (e.type) {
      case 'pay': {
        balances[e.from] -= e.amount;
        balances[e.to] += e.amount;
        break;
      }
      case 'deposit': {
        balances[e.from] -= e.amount;
        depositTotal += e.amount;
        break;
      }
      case 'borrow': {
        balances[e.lenderId] -= e.amount;
        balances[e.borrowerId] += e.amount;
        debts.push({
          id: e.debtId,
          borrowerId: e.borrowerId,
          lenderId: e.lenderId,
          amount: e.amount,
          remaining: e.amount,
          createdAt: e.ts,
        });
        break;
      }
      case 'repay': {
        balances[e.borrowerId] -= e.amount;
        balances[e.lenderId] += e.amount;
        const d = debts.find((x) => x.id === e.debtId);
        if (d) {
          d.remaining = Math.max(0, d.remaining - e.amount);
          if (d.remaining === 0) d.settledAt = e.ts;
        }
        break;
      }
      case 'settle_deposit': {
        const share = splitEvenly(depositTotal, e.targets.length);
        e.targets.forEach((t, i) => {
          balances[t] += share[i];
        });
        depositTotal = 0;
        break;
      }
      default:
        break;
    }
  }

  return { balances, depositTotal, debts };
}

function splitEvenly(amount: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(amount / parts);
  const remainder = amount - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** 由基线 + 事件 + 附加元数据组装完整 RoomState */
export function assembleRoom(base: RoomRecord): RoomState {
  const fold = foldEvents(base.players, base.meta.initialScore, base.events);
  const players: Player[] = base.players.map((p) => ({
    ...p,
    balance: fold.balances[p.id] ?? 0,
  }));
  return {
    ...base.meta,
    players,
    events: base.events,
    debts: fold.debts,
    depositTotal: fold.depositTotal,
    borrowRequests: base.borrowRequests,
  };
}

export const recordToState = assembleRoom;

// ---------------------------------------------------------------------------
// 撤销判定
// ---------------------------------------------------------------------------

const UNDOABLE_TYPES = new Set([
  'pay',
  'deposit',
  'borrow',
  'repay',
  'settle_deposit',
]);

export function canUndoLast(
  events: GameEvent[],
  playerId: PlayerId
): { ok: true; event: GameEvent } | { ok: false; code: 'NO_UNDO_TARGET' | 'UNDO_BLOCKED' } {
  const last = events[events.length - 1];
  if (!last) return { ok: false, code: 'NO_UNDO_TARGET' };
  if (last.type === 'undo') return { ok: false, code: 'NO_UNDO_TARGET' };
  if (!UNDOABLE_TYPES.has(last.type)) return { ok: false, code: 'UNDO_BLOCKED' };
  if (last.operatorId !== playerId) return { ok: false, code: 'UNDO_BLOCKED' };
  return { ok: true, event: last };
}

// ---------------------------------------------------------------------------
// 具体业务校验
// ---------------------------------------------------------------------------

export function validateStart(players: number): void {
  if (players < MIN_PLAYERS) {
    throw new RuleError('NOT_ENOUGH_PLAYERS', `至少需要 ${MIN_PLAYERS} 人才能开始`, {
      need: MIN_PLAYERS,
      have: players,
    });
  }
  if (players > MAX_PLAYERS) {
    throw new RuleError('ROOM_FULL', `最多 ${MAX_PLAYERS} 人`, { have: players });
  }
}

export function validatePay(
  balances: Record<PlayerId, number>,
  from: PlayerId,
  to: PlayerId,
  amount: number
): void {
  if (from === to) throw new RuleError('SELF_TRANSFER', '不能支付给自己');
  assertAmount(amount);
  const bal = balances[from] ?? 0;
  if (bal < amount) {
    throw new RuleError('INSUFFICIENT_BALANCE', '余额不足', {
      diff: amount - bal,
      balance: bal,
    });
  }
}

export function validateBorrow(
  balances: Record<PlayerId, number>,
  borrowerId: PlayerId,
  lenderId: PlayerId,
  borrowAmount: number
): void {
  if (borrowerId === lenderId) throw new RuleError('SELF_TRANSFER', '不能向自己借点');
  assertAmount(borrowAmount);
  const lenderBal = balances[lenderId] ?? 0;
  if (lenderBal < borrowAmount) {
    throw new RuleError('LENDER_INSUFFICIENT', '出借人余额不足', {
      diff: borrowAmount - lenderBal,
    });
  }
}

export function makeBorrowRequest(params: {
  id: string;
  borrowerId: PlayerId;
  lenderId: PlayerId;
  amount: number;
  now: number;
}): BorrowRequest {
  return {
    id: params.id,
    borrowerId: params.borrowerId,
    lenderId: params.lenderId,
    amount: params.amount,
    status: 'pending',
    createdAt: params.now,
    expiresAt: params.now + BORROW_TTL_MS,
  };
}

export function findPendingBorrow(
  requests: BorrowRequest[],
  borrowerId: PlayerId
): BorrowRequest | undefined {
  return requests.find((r) => r.borrowerId === borrowerId && r.status === 'pending');
}

export function expireBorrowRequests(requests: BorrowRequest[], now: number): BorrowRequest[] {
  return requests.map((r) =>
    r.status === 'pending' && r.expiresAt <= now ? { ...r, status: 'expired' } : r
  );
}
