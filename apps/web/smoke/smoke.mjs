// 端到端冒烟测试：对 wrangler dev (8787) 走原生 WebSocket + fetch。
// 用法：先 `pnpm preview`（或 wrangler dev）启动，再 `node smoke/smoke.mjs`。
const BASE = process.env.BASE || 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');

let failures = 0;
function check(label, cond, extra = '') {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label} ${extra}`);
    failures++;
  }
}
const sum = (room) => room.players.reduce((s, p) => s + p.balance, 0) + room.depositTotal;

function makeClient(deviceId) {
  return {
    deviceId,
    ws: null,
    nextId: 1,
    pending: new Map(),
    connect(code) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${WS_BASE}/ws/${code}?deviceId=${encodeURIComponent(deviceId)}`);
        this.ws = ws;
        const to = setTimeout(() => reject(new Error('ws connect timeout')), 3000);
        ws.onopen = () => {
          clearTimeout(to);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(to);
          reject(new Error('ws error'));
        };
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg && msg.id != null && this.pending.has(msg.id)) {
            const cb = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            cb(msg.ok ? (msg.result ?? {}) : { ok: false, error: msg.error });
          }
        };
      });
    },
    emit(event, payload = {}) {
      return new Promise((resolve) => {
        const id = this.nextId++;
        this.pending.set(id, resolve);
        this.ws.send(JSON.stringify({ id, event, payload }));
        setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            resolve({ timeout: true });
          }
        }, 3000);
      });
    },
    close() {
      try {
        this.ws?.close();
      } catch {}
    },
  };
}

async function createRoom(name, initialScore, playerName, deviceId) {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, initialScore, playerName, deviceId }),
  });
  return res.json();
}

async function main() {
  console.log('建房（HTTP）…');
  const created = await createRoom('测试房', 100000, '东', 'dev-a');
  check('创建房间', !!created.code, JSON.stringify(created));
  const code = created.code;
  const room0 = created.state;
  check('初始守恒 sum=100000', sum(room0) === 100000, `sum=${sum(room0)}`);
  const idA = room0.players[0].id;

  console.log('连接 4 个客户端（WS）…');
  const a = makeClient('dev-a');
  const b = makeClient('dev-b');
  const c = makeClient('dev-c');
  const d = makeClient('dev-d');
  await a.connect(code);
  const aAtt = await a.emit('room:attach', {});
  check('A attach 绑定', aAtt?.state?.code === code, JSON.stringify(aAtt?.state?.code));

  await b.connect(code);
  const jb = await b.emit('room:join', { playerName: '南' });
  check('B 加入', jb?.state?.players.length === 2, JSON.stringify(jb?.state?.players?.length));

  await c.connect(code);
  const jc = await c.emit('room:join', { playerName: '西' });
  check('C 加入', jc?.state?.players.length === 3);

  await d.connect(code);
  const jd = await d.emit('room:join', { playerName: '北' });
  check('D 加入（4 人）', jd?.state?.players.length === 4, JSON.stringify(jd?.state?.players?.length));

  const e = makeClient('dev-e');
  await e.connect(code);
  const je = await e.emit('room:join', { playerName: '第五人' });
  check('第 5 人被拒 ROOM_FULL', je?.error?.code === 'ROOM_FULL', JSON.stringify(je?.error?.code || 'joined'));
  e.close();

  const idB = jb.state.players[1].id;
  const idC = jc.state.players[2].id;

  console.log('开局与人数校验…');
  const started = await a.emit('game:start', {});
  check('开始游戏 playing', started?.state?.phase === 'playing', JSON.stringify(started?.state?.phase));

  // 2 人无法开始（独立房间）
  const r2 = await createRoom('少人房', 1000, 'X', 'dev-x');
  const x = makeClient('dev-x');
  const y = makeClient('dev-y');
  await x.connect(r2.code);
  await x.emit('room:attach', {});
  await y.connect(r2.code);
  await y.emit('room:join', { playerName: 'Y' });
  const badStart = await x.emit('game:start', {});
  check('2 人无法开始 NOT_ENOUGH_PLAYERS', badStart?.error?.code === 'NOT_ENOUGH_PLAYERS', JSON.stringify(badStart?.error?.code));
  x.close();
  y.close();

  console.log('支付 / 供托…');
  let st = await a.emit('tx:pay', { toId: idB, amount: 5000 });
  check('支付 5000', st?.state?.players[0].balance === 95000, `bal=${st?.state?.players[0].balance}`);
  check('支付后守恒', sum(st.state) === 400000);

  const insuff = await a.emit('tx:pay', { toId: idB, amount: 999999 });
  check('余额不足 INSUFFICIENT_BALANCE', insuff?.error?.code === 'INSUFFICIENT_BALANCE', JSON.stringify(insuff?.error?.code));

  st = await a.emit('tx:deposit', { amount: 2000 });
  check('存供托 2000', st?.state?.depositTotal === 2000, `dep=${st?.state?.depositTotal}`);
  check('供托后守恒', sum(st.state) === 400000);

  console.log('借点（纯借款）→ 支付…');
  await c.emit('tx:pay', { toId: idA, amount: 90000 }); // C 余额 10000
  const borrow = await c.emit('borrow:request', { lenderId: idB, amount: 20000 });
  check('发起借点请求 pending', borrow?.state?.borrowRequests?.some((r) => r.status === 'pending'), JSON.stringify(borrow?.state?.borrowRequests));
  const reqId = borrow.state.borrowRequests.find((r) => r.status === 'pending').id;

  const approved = await b.emit('borrow:respond', { requestId: reqId, approve: true });
  const appReq = approved.state.borrowRequests.find((r) => r.id === reqId);
  check('借点 approved', appReq?.status === 'approved', JSON.stringify(appReq?.status));
  const debt = approved.state.debts.find((x) => x.remaining > 0);
  check('生成债务 20000', debt?.remaining === 20000, JSON.stringify(debt?.remaining));
  const cBal = approved.state.players.find((p) => p.id === idC)?.balance;
  check('纯借款：借款人 +20000（与支付解耦）', cBal === 30000, `bal=${cBal}`);
  check('借点后守恒', sum(approved.state) === 400000);

  const paidAfter = await c.emit('tx:pay', { toId: idA, amount: 30000 });
  const cBal2 = paidAfter.state.players.find((p) => p.id === idC)?.balance;
  check('借了再支付成功', cBal2 === 0, `bal=${cBal2}`);
  check('支付后守恒', sum(paidAfter.state) === 400000);

  console.log('还款 / 撤销…');
  await a.emit('tx:pay', { toId: idC, amount: 10000 });
  const repaid = await c.emit('tx:repay', { lenderId: idB, debtId: debt.id, amount: 5000 });
  const debt2 = repaid.state.debts.find((x) => x.id === debt.id);
  check('还款后债务 15000', debt2?.remaining === 15000, `rem=${debt2?.remaining}`);
  check('还款后守恒', sum(repaid.state) === 400000);

  const undone = await c.emit('undo', {});
  const debt3 = undone.state.debts.find((x) => x.id === debt.id);
  check('撤销还款后债务还原 20000', debt3?.remaining === 20000, `rem=${debt3?.remaining}`);
  check('撤销后守恒', sum(undone.state) === 400000);

  console.log('结算 / 再来一局…');
  const ended = await a.emit('game:end', {});
  check('结束游戏 settled', ended?.state?.phase === 'settled', JSON.stringify(ended?.state?.phase));
  const settled = await a.emit('tx:settle', { targets: [idA, idB] });
  check('供托分配后 deposit=0', settled?.state?.depositTotal === 0, `dep=${settled?.state?.depositTotal}`);
  check('结算后守恒', sum(settled.state) === 400000);

  const next = await a.emit('game:next', {});
  check('再来一局重置', next?.state?.phase === 'playing' && next?.state?.players.every((p) => p.balance === 100000), JSON.stringify(next?.state?.players?.map((p) => p.balance)));

  console.log('中途加入 / 断线恢复 / 去重…');
  const h = makeClient('dev-h');
  await h.connect(code);
  const lateJoin = await h.emit('room:join', { playerName: '迟到者' });
  check('对局中加入被拒 WRONG_PHASE', lateJoin?.error?.code === 'WRONG_PHASE', JSON.stringify(lateJoin?.error?.code || 'joined'));
  h.close();

  // 模拟刷新/断线重连：同 deviceId 重新 attach
  a.close();
  const a2 = makeClient('dev-a');
  await a2.connect(code);
  const attached = await a2.emit('room:attach', {});
  check('刷新后 attach 恢复身份', attached?.state?.code === code && attached?.playerId === idA,
    JSON.stringify({ code: attached?.state?.code, playerId: attached?.playerId, idA }));
  a2.close();

  const stDup = await b.emit('tx:settle', { targets: [idA, idA] });
  check('settle 去重（deposit 归零）', stDup?.state?.depositTotal === 0, `dep=${stDup?.state?.depositTotal}`);

  console.log('');
  if (failures === 0) console.log('✅ 全部端到端用例通过');
  else console.log(`❌ ${failures} 个用例失败`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
