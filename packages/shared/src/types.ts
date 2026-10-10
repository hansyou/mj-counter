export type PlayerId = string;
export type Phase = 'lobby' | 'playing' | 'settled';

export interface Player {
  id: PlayerId;
  name: string;
  deviceId?: string;
  seat: 0 | 1 | 2 | 3;
  balance: number;
  online: boolean;
  joinedAt: number;
}

export interface Debt {
  id: string;
  borrowerId: PlayerId;
  lenderId: PlayerId;
  amount: number;
  remaining: number;
  createdAt: number;
  settledAt?: number;
}

export type BorrowStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

export interface BorrowRequest {
  id: string;
  borrowerId: PlayerId;
  lenderId: PlayerId;
  amount: number;
  status: BorrowStatus;
  createdAt: number;
  expiresAt: number;
}

export type EventType =
  | 'join'
  | 'leave'
  | 'start'
  | 'pay'
  | 'deposit'
  | 'borrow'
  | 'repay'
  | 'settle_deposit'
  | 'undo';

export interface GameEventBase {
  id: string;
  type: EventType;
  operatorId: PlayerId;
  ts: number;
}

export interface JoinEvent extends GameEventBase {
  type: 'join';
  playerId: PlayerId;
  name: string;
}
export interface LeaveEvent extends GameEventBase {
  type: 'leave';
  playerId: PlayerId;
}
export interface StartEvent extends GameEventBase {
  type: 'start';
}
export interface PayEvent extends GameEventBase {
  type: 'pay';
  from: PlayerId;
  to: PlayerId;
  amount: number;
}
export interface DepositEvent extends GameEventBase {
  type: 'deposit';
  from: PlayerId;
  amount: number;
}
export interface BorrowEvent extends GameEventBase {
  type: 'borrow';
  borrowerId: PlayerId;
  lenderId: PlayerId;
  amount: number;
  debtId: string;
}
export interface RepayEvent extends GameEventBase {
  type: 'repay';
  borrowerId: PlayerId;
  lenderId: PlayerId;
  amount: number;
  debtId: string;
}
export interface SettleDepositEvent extends GameEventBase {
  type: 'settle_deposit';
  targets: PlayerId[];
}
export interface UndoEvent extends GameEventBase {
  type: 'undo';
  targetEventId: string;
}

export type GameEvent =
  | JoinEvent
  | LeaveEvent
  | StartEvent
  | PayEvent
  | DepositEvent
  | BorrowEvent
  | RepayEvent
  | SettleDepositEvent
  | UndoEvent;

export interface RoomState {
  id: string;
  code: string;
  name: string;
  phase: Phase;
  initialScore: number;
  players: Player[];
  debts: Debt[];
  borrowRequests: BorrowRequest[];
  depositTotal: number;
  events: GameEvent[];
  startedAt?: number;
  endedAt?: number;
  updatedAt: number;
  schemaVersion: number;
}

/** 持久化的房间记录：元数据 + 名册 + 事件流水 + 借点请求（余额由流水折叠得出） */
export interface RoomMeta {
  id: string;
  code: string;
  name: string;
  phase: Phase;
  initialScore: number;
  startedAt?: number;
  endedAt?: number;
  updatedAt: number;
  schemaVersion: number;
}

export interface RoomRecord {
  meta: RoomMeta;
  players: Player[];
  events: GameEvent[];
  borrowRequests: BorrowRequest[];
}

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 3;
export const MAX_INITIAL_SCORE = 100000;
export const BORROW_TTL_MS = 60_000;
export const SCHEMA_VERSION = 1;
