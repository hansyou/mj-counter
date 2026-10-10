export type ErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'LENDER_INSUFFICIENT'
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'NAME_TAKEN'
  | 'NOT_ENOUGH_PLAYERS'
  | 'SELF_TRANSFER'
  | 'INVALID_AMOUNT'
  | 'INVALID_INITIAL_SCORE'
  | 'INVALID_PLAYER'
  | 'WRONG_PHASE'
  | 'BORROW_PENDING'
  | 'BORROW_EXPIRED'
  | 'BORROW_NOT_FOUND'
  | 'NOT_YOUR_REQUEST'
  | 'DEBT_NOT_FOUND'
  | 'UNDO_BLOCKED'
  | 'NO_UNDO_TARGET'
  | 'UNDO_LIMIT_REACHED';

export class RuleError extends Error {
  code: ErrorCode;
  data?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, data?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'RuleError';
    this.code = code;
    this.data = data;
  }
}
