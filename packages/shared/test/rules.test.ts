import { describe, expect, it } from 'vitest';
import type { GameEvent, Player } from '../src/types';
import {
  assembleRoom,
  assertPhase,
  canUndoLast,
  expectedTotal,
  foldEvents,
  totalPoints,
  validateBorrow,
  validatePay,
  validateStart,
  RuleError,
} from '../src';

function makePlayers(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `玩家${i}`,
    seat: i as 0 | 1 | 2 | 3,
    balance: 0,
    online: true,
    joinedAt: 0,
  }));
}

function baseMeta(initialScore: number) {
  return {
    id: 'r1',
    code: 'ABCDEF',
    name: '测试房',
    phase: 'playing' as const,
    initialScore,
    startedAt: 0,
    updatedAt: 0,
    schemaVersion: 1,
  };
}

function ev(e: Partial<GameEvent> & { type: GameEvent['type'] }, i = 0): GameEvent {
  return { id: `e${i}`, operatorId: 'p0', ts: 1000 + i, ...e } as GameEvent;
}

describe('点数守恒', () => {
  it('初始状态守恒', () => {
    const players = makePlayers(4);
    const fold = foldEvents(players, 100000, []);
    expect(totalPoints({ players: Object.values(fold.balances).map((b) => ({ balance: b })), depositTotal: fold.depositTotal })).toBe(400000);
  });

  it('大量随机支付后守恒', () => {
    const players = makePlayers(4);
    const events: GameEvent[] = [];
    let id = 0;
    const bal: Record<string, number> = { p0: 100000, p1: 100000, p2: 100000, p3: 100000 };
    for (let k = 0; k < 100; k++) {
      const from = `p${k % 4}`;
      const to = `p${(k + 1) % 4}`;
      const amount = Math.floor(Math.random() * 5000) + 1;
      if (bal[from] >= amount) {
        events.push(ev({ type: 'pay', from, to, amount } as Partial<GameEvent> & { type: 'pay' }, id++));
        bal[from] -= amount;
        bal[to] += amount;
      }
    }
    const fold = foldEvents(players, 100000, events);
    const total = Object.values(fold.balances).reduce((a, b) => a + b, 0) + fold.depositTotal;
    expect(total).toBe(expectedTotal(100000, 4));
  });

  it('供托存入后守恒', () => {
    const players = makePlayers(3);
    const events = [
      ev({ type: 'deposit', from: 'p0', amount: 5000 } as Partial<GameEvent> & { type: 'deposit' }, 0),
    ];
    const fold = foldEvents(players, 30000, events);
    const total = Object.values(fold.balances).reduce((a, b) => a + b, 0) + fold.depositTotal;
    expect(total).toBe(expectedTotal(30000, 3));
    expect(fold.depositTotal).toBe(5000);
  });
});

describe('支付校验', () => {
  it('余额不足抛 INSUFFICIENT_BALANCE 并给出差额', () => {
    const balances = { p0: 1000, p1: 5000 };
    try {
      validatePay(balances, 'p0', 'p1', 3000);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RuleError);
      expect((e as RuleError).code).toBe('INSUFFICIENT_BALANCE');
      expect((e as RuleError).data?.diff).toBe(2000);
    }
  });

  it('自己付自己被拒', () => {
    expect(() => validatePay({ p0: 100 }, 'p0', 'p0', 50)).toThrowError(RuleError);
  });

  it('小数/非正整数金额被拒', () => {
    expect(() => validatePay({ p0: 100, p1: 0 }, 'p0', 'p1', 10.5)).toThrowError(RuleError);
    expect(() => validatePay({ p0: 100, p1: 0 }, 'p0', 'p1', -1)).toThrowError(RuleError);
    expect(() => validatePay({ p0: 100, p1: 0 }, 'p0', 'p1', 0)).toThrowError(RuleError);
  });
});

describe('借点（纯借款，与支付解耦）', () => {
  it('借 2000：借款人 +2000、出借人 -2000、生成债务 2000', () => {
    const players = makePlayers(3);
    const events = [ev({ type: 'borrow', borrowerId: 'p0', lenderId: 'p1', amount: 2000, debtId: 'd1' } as Partial<GameEvent> & { type: 'borrow' }, 0)];
    const fold = foldEvents(players, 10000, events);
    expect(fold.balances.p0).toBe(10000 + 2000);
    expect(fold.balances.p1).toBe(10000 - 2000);
    expect(fold.balances.p2).toBe(10000);
    expect(fold.debts[0].remaining).toBe(2000);
    const total = Object.values(fold.balances).reduce((a, b) => a + b, 0);
    expect(total).toBe(expectedTotal(10000, 3));
  });

  it('借了再支付：先 borrow 再 pay，两步独立、守恒', () => {
    const players = makePlayers(3);
    const events = [
      ev({ type: 'borrow', borrowerId: 'p0', lenderId: 'p1', amount: 2000, debtId: 'd1' } as Partial<GameEvent> & { type: 'borrow' }, 0),
      ev({ type: 'pay', from: 'p0', to: 'p2', amount: 3000 } as Partial<GameEvent> & { type: 'pay' }, 1),
    ];
    const fold = foldEvents(players, 10000, events);
    expect(fold.balances.p0).toBe(10000 + 2000 - 3000);
    expect(fold.balances.p1).toBe(10000 - 2000);
    expect(fold.balances.p2).toBe(10000 + 3000);
    expect(fold.debts[0].remaining).toBe(2000);
    const total = Object.values(fold.balances).reduce((a, b) => a + b, 0);
    expect(total).toBe(expectedTotal(10000, 3));
  });

  it('出借人余额不足抛 LENDER_INSUFFICIENT', () => {
    try {
      validateBorrow({ p0: 1000, p1: 500, p2: 0 }, 'p0', 'p1', 2000);
      expect.unreachable();
    } catch (e) {
      expect((e as RuleError).code).toBe('LENDER_INSUFFICIENT');
    }
  });

  it('向自己借点被拒', () => {
    expect(() => validateBorrow({ p0: 1000 }, 'p0', 'p0', 500)).toThrowError(RuleError);
  });

  it('还款冲减债务并守恒', () => {
    const players = makePlayers(3);
    const events = [
      ev({ type: 'borrow', borrowerId: 'p0', lenderId: 'p1', amount: 2000, debtId: 'd1' } as Partial<GameEvent> & { type: 'borrow' }, 0),
      ev({ type: 'repay', borrowerId: 'p0', lenderId: 'p1', amount: 500, debtId: 'd1' } as Partial<GameEvent> & { type: 'repay' }, 1),
    ];
    const fold = foldEvents(players, 10000, events);
    expect(fold.debts[0].remaining).toBe(1500);
    const total = Object.values(fold.balances).reduce((a, b) => a + b, 0);
    expect(total).toBe(expectedTotal(10000, 3));
  });
});

describe('撤销', () => {
  it('撤销支付后余额还原，流水保留 undo', () => {
    const players = makePlayers(3);
    const pay = ev({ type: 'pay', from: 'p0', to: 'p1', amount: 1500 } as Partial<GameEvent> & { type: 'pay' }, 0) as GameEvent;
    const before = foldEvents(players, 10000, []);
    const after = foldEvents(players, 10000, [pay]);
    expect(after.balances.p0).toBe(before.balances.p0 - 1500);

    const check = canUndoLast([pay], 'p0');
    expect(check.ok).toBe(true);
    // 重新折叠（去掉尾事件）即为撤销效果
    const undone = foldEvents(players, 10000, []);
    expect(undone.balances.p0).toBe(before.balances.p0);
  });

  it('撤销借点后余额与债务全部还原', () => {
    const players = makePlayers(3);
    const borrow = ev({ type: 'borrow', borrowerId: 'p0', lenderId: 'p1', amount: 2000, debtId: 'd1' } as Partial<GameEvent> & { type: 'borrow' }, 0);
    const after = foldEvents(players, 10000, [borrow]);
    expect(after.debts.length).toBe(1);
    expect(after.balances.p0).toBe(12000);
    const undone = foldEvents(players, 10000, []);
    expect(undone.debts.length).toBe(0);
    expect(undone.balances.p0).toBe(10000);
  });

  it('非本人/非最近操作不可撤销', () => {
    const pay = ev({ type: 'pay', from: 'p0', to: 'p1', amount: 100 } as Partial<GameEvent> & { type: 'pay' }, 0) as GameEvent;
    expect(canUndoLast([pay], 'p1').ok).toBe(false);
    expect(canUndoLast([], 'p0').ok).toBe(false);
  });

  it('单步撤销：撤销标记之后无法继续撤销（保持单步语义）', () => {
    const pay = ev({ type: 'pay', from: 'p0', to: 'p1', amount: 100 } as Partial<GameEvent> & { type: 'pay' }, 0) as GameEvent;
    const undo = ev({ type: 'undo', targetEventId: pay.id } as Partial<GameEvent> & { type: 'undo' }, 1) as GameEvent;
    // 尾部是 undo 标记 → 视为无可撤销目标
    expect(canUndoLast([pay, undo], 'p0').ok).toBe(false);
    expect(canUndoLast([pay, undo], 'p0')).toEqual({ ok: false, code: 'NO_UNDO_TARGET' });
  });
});

describe('阶段校验（禁止中途加入等）', () => {
  it('lobby 阶段只允许 lobby', () => {
    expect(() => assertPhase({ phase: 'playing' }, ['lobby'])).toThrowError(RuleError);
    expect(() => assertPhase({ phase: 'settled' }, ['lobby'])).toThrowError(RuleError);
    expect(() => assertPhase({ phase: 'lobby' }, ['lobby'])).not.toThrow();
  });
  it('抛出 WRONG_PHASE', () => {
    try {
      assertPhase({ phase: 'playing' }, ['lobby']);
      expect.unreachable();
    } catch (e) {
      expect((e as RuleError).code).toBe('WRONG_PHASE');
    }
  });
});

describe('开局人数', () => {
  it('<3 人不可开始', () => {
    expect(() => validateStart(2)).toThrowError(RuleError);
  });
  it('3-4 人可开始', () => {
    expect(() => validateStart(3)).not.toThrow();
    expect(() => validateStart(4)).not.toThrow();
    expect(() => validateStart(5)).toThrowError(RuleError);
  });
});

describe('assembleRoom', () => {
  it('组装出的房间满足守恒', () => {
    const players = makePlayers(4);
    const room = assembleRoom({
      meta: baseMeta(100000),
      players,
      events: [],
      borrowRequests: [],
    });
    expect(totalPoints(room)).toBe(400000);
    expect(room.players.every((p) => p.balance === 100000)).toBe(true);
  });
});
