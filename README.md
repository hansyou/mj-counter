# 麻将计分器（mj-counter）项目方案

> 一个多人实时麻将点数计分器：创建房间时设定初始点数（上限 100000），3-4 名玩家各自使用手机加入同一房间；任意玩家可开始游戏；对局中支持玩家间支付、点数存入供托区、余额不足时向其他玩家借点，全部操作实时同步、留痕、可撤销。

---

## 0. 快速开始

```bash
pnpm install          # 安装依赖（只用 pnpm，勿用 npm）
pnpm test             # 运行领域规则单测
pnpm build            # 构建前端产物到 apps/web/dist
pnpm preview          # 本地启动 Cloudflare Workers（wrangler dev，端口 8787）
```

启动后浏览器打开 `http://localhost:8787`（局域网设备访问 `http://<本机IP>:8787`）即可建房/加入。

开发模式（前端热更新 + Worker）：

```bash
pnpm dev              # 构建后并行启动 vite(5173) + wrangler dev(8787)
# 浏览器访问 http://localhost:5173（/api 与 /ws 由 vite 代理到 8787）
```

端到端冒烟测试（需先启动 wrangler dev / preview）：

```bash
cd apps/web && node smoke/smoke.mjs   # 覆盖建房/加入/开局/支付/供托/借点/还款/撤销/结算/断线恢复
```

部署到 Cloudflare（公网）：

```bash
npx wrangler login    # 浏览器授权 Cloudflare 账号（一次性）
pnpm deploy           # 构建前端并部署 Worker + 静态资源 + Durable Objects
```

- 部署后获得 `https://<项目名>.<子域>.workers.dev`，各设备通过该地址加入。
- 房间状态持久化在 Durable Object 的 SQLite 存储中，进程/实例重启后自动恢复。

---

## 1. 项目概述

| 项 | 决策 |
|---|---|
| 使用场景 | 线下牌桌，每名玩家使用自己的手机加入同一房间 |
| 架构 | 前后端分离：Vue 3 SPA + 轻量实时服务端（WebSocket）；服务端为状态唯一权威 |
| 房间标识 | 6 位短码 + 服务器地址；提供可扫码的加入链接 |
| 人数 | 3 或 4 人，每人独占一个座位与一台设备 |
| 房主概念 | 无。加入人数 ≥ 3 后，任意已入座玩家可点击「开始游戏」（需二次确认） |
| 初始点数 | 创建房间时统一设定，整数范围 `0 ~ 100000`（默认 25000） |
| 点数上限 | 单人持有点数**不设硬上限**；系统内点数总量守恒，理论最大值 = 人数 × 初始点数 ≤ 400000（4 人 × 100000） |
| 撤销 | 支持撤销最近一条由本机发起的操作 |

### 1.1 术语定义

| 术语 | 定义 |
|---|---|
| 房间 | 一局游戏的完整状态容器，由短码标识，独立于设备存在 |
| 座位 | 房间内的固定席位（0-3），与一名玩家绑定；3 人局空一席 |
| 供托区 | 房间内的公共点数池。玩家存入点数即从其余额划出并计入供托总额；供托只记录总额，不记录归属，终局按结算规则分配 |
| 债务 | 玩家间借点产生的记录，含借款人、出借人、原始金额、剩余未还金额 |
| 操作人 | 当前设备所绑定的玩家；所有写操作以操作人身份发起 |
| 事件流水 | 房间内全部操作的追加式（append-only）日志 |

---

## 2. 功能需求

### 2.1 首页（`/`）

- 创建房间：房间名（可选）、初始点数（`0 ~ 100000`，整数，非法输入即时提示）、首位玩家昵称。
- 加入房间：输入服务器地址（默认同源）+ 6 位房间短码 + 昵称。
- 扫码加入：展示包含房间短码的加入链接二维码。
- 最近房间列表（本机缓存，便于续局）。

### 2.2 加入与身份（多端）

- 每台设备通过「短码 + 昵称」加入房间，服务端分配座位；昵称房间内唯一。
- 房间人数硬上限 4：已满 4 人时后续加入请求一律拒绝（返回 `ROOM_FULL`），不设口令/密码。
- 同一设备重复加入同一房间时恢复原身份（基于本机 `deviceId`）。
- 玩家可随时退出，座位释放（`lobby` 阶段）；`playing` 阶段退出标记为离线但保留座位与点数。
- 操作权限：每台设备只能以自己绑定的玩家身份发起操作（支付、存供托、借点、还款、撤销）。
- 断线自动重连；重连后以服务端全量状态快照为准。

### 2.3 大厅与开局（`phase = lobby`）

- 牌桌布局（东南西北四席环绕）实时显示已入座玩家与人数。
- 加入人数 < 3：显示「还需 N 人」，开始按钮禁用。
- 加入人数 ≥ 3：任意已入座玩家可点击「开始游戏」，弹二次确认，广播状态切换为 `playing`。
- 人数变化实时推送到所有客户端。

### 2.4 对局操作（`phase = playing`）

1. **支付**：选择目标玩家 + 金额 → 校验余额 → 付款方扣减、收款方增加，双方设备实时更新。
2. **存入供托**：金额 → 扣减操作人余额 → 供托总额增加。
3. **取出供托**：默认仅结算阶段可分配；对局中手动取出需二次确认并记入流水。
4. **借点**：支付时余额不足 → 弹出借点子流程 → 选择出借人 → 发起借款请求 → **出借人在其设备上确认**后，原子完成「借入 + 支付 + 生成债务」；拒绝或超时则请求失效，原支付不成立。同一时间借款人至多存在 1 条待确认请求。
5. **还款**：从余额还款给出借人，冲减债务剩余金额，支持部分还款。
6. **记分板**：实时显示各玩家余额、债务徽标、供托总额、排名。
7. **事件流水**：倒序展示全部操作，支持撤销最近一条本机发起的操作。
8. **结束游戏**：任意玩家可发起，二次确认后进入 `settled`。

### 2.5 结算（`phase = settled`）

- 供托区分配：指定一名或多名玩家分配（或均分）。
- 债务处理：展示未清偿债务清单，支持「一键结清」（按余额自动还款，余额不足则标记未结清并高亮）。
- 输出最终点数榜、总收支（`最终 − 初始`）、供托与借贷历史。
- 「再来一局」：保留房间与玩家，重置余额、债务、供托与流水；或解散房间。

### 2.6 横切需求

- **持久化**：服务端持久化房间状态（SQLite），进程重启后房间可恢复；客户端仅缓存最近房间与 `deviceId`。
- **一致性**：所有写操作在服务端校验与提交，失败返回明确错误码，客户端提示且不改变状态。
- **实时性**：状态变更广播延迟目标 < 300ms（局域网内）。
- **部署形态**：Cloudflare Workers——静态资源由 Workers Static Assets 托管，实时通信走原生 WebSocket，房间状态存于 Durable Objects（每房间一实例，内置 SQLite）。本地用 `wrangler dev` 运行同一套代码。

---

## 3. 业务规则

### 3.1 点数守恒（核心不变量）

```
sum(所有玩家余额) + 供托区总额 = 初始点数 × 人数   （任何操作前后恒等）
```

支付、存供托、借点、还款、供托分配均为系统内部转移，不产生也不销毁点数——系统不设打破恒等的调分操作。该不变量是单元测试的首要断言。

### 3.2 上限规则

| 项 | 规则 |
|---|---|
| 初始点数 | `0 ≤ x ≤ 100000`，整数 |
| 单人余额 | 允许超过 100000，不设上限；受系统总量约束 |
| 系统总量 | 恒等于 `人数 × 初始点数`，最大 400000 |
| 房间人数 | 3-4 人；第 5 人及以上的加入请求一律拒绝（`ROOM_FULL`） |
| 单笔金额 | 仅允许整数值（禁止小数），且为正整数，不超过操作方可用余额（借点时不超过操作方余额 + 出借人余额） |

### 3.3 支付校验

| 规则 | 说明 |
|---|---|
| 阶段校验 | 仅 `playing` 阶段可执行支付/供托/借贷 |
| 余额校验 | `付款方余额 ≥ 金额` 才可直接支付 |
| 余额不足 | 拒绝并返回 `INSUFFICIENT_BALANCE` 及差额，客户端据此进入借点流程 |
| 自己付自己 | 拒绝（`SELF_TRANSFER`） |
| 目标校验 | 目标必须为同房间且未离线结算的玩家 |

### 3.4 借点规则

- 借款指定**单一出借人**（v1 不支持多人拆借）。
- **借点必须经出借人确认**：
  - 借款人发起请求（含目标出借人、金额、关联支付）后进入 `pending` 状态，服务端校验出借人余额（不足则立即拒绝 `LENDER_INSUFFICIENT`）。
  - 出借人在其设备上收到确认卡片，执行「同意 / 拒绝」。
  - 同意 → 「借入 + 支付 + 生成债务」在同一原子事务中提交并广播；拒绝或超时（默认 60 秒）→ 请求关闭，支付不成立，状态无任何变化。
  - 同一借款人同一时间至多 1 条待确认请求；待确认期间不可发起第二条，也不可对自己发起的该笔支付执行撤销（请求本身可由借款人取消）。
- 出借人余额必须 ≥ 借款额，否则拒绝（`LENDER_INSUFFICIENT`）。
- 部分还款：每次还款为 `1 ≤ 金额 ≤ 剩余未还` 的整数。
- 借款上限：借款人余额可至 0，不允许为负。

### 3.5 供托区规则

- 存入：任意玩家随时可存，金额立即从余额划出。
- 取出：仅结算阶段分配；对局中手动取出需二次确认并记入流水。
- 供托只保存总额，明细通过事件流水追溯。

### 3.6 撤销规则

- 事件流水追加式存储，记录操作类型、操作人、涉及方、金额、时间戳。
- 撤销 = 对目标事件施加逆操作并追加 `undo` 事件（不物理删除）。
- 仅可撤销本机操作人最近一条事件；若该事件之后已产生依赖操作（如借点后已还款），则标记为不可撤销，UI 置灰并提示原因。

---

## 4. 数据模型（TypeScript，`packages/shared`）

```ts
type PlayerId = string;
type Phase = 'lobby' | 'playing' | 'settled';

interface Player {
  id: PlayerId;
  name: string;          // 房间内唯一
  deviceId?: string;     // 绑定的客户端设备
  seat: 0 | 1 | 2 | 3;   // 东/南/西/北，3 人局空一席
  balance: number;       // ≥ 0，理论最大 400000
  online: boolean;
  joinedAt: number;
}

interface Debt {
  id: string;
  borrowerId: PlayerId;
  lenderId: PlayerId;
  amount: number;        // 原始借款
  remaining: number;     // 剩余未还
  createdAt: number;
  settledAt?: number;
}

interface BorrowRequest {
  id: string;
  borrowerId: PlayerId;
  lenderId: PlayerId;
  toId: PlayerId;        // 支付目标
  amount: number;        // 借款额
  payAmount: number;     // 关联支付金额
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
  createdAt: number;
  expiresAt: number;     // 默认创建后 60s
}

interface RoomState {
  id: string;            // 内部 UUID
  code: string;           // 6 位短码
  name: string;
  phase: Phase;
  initialScore: number;   // 0..100000
  players: Player[];
  debts: Debt[];
  borrowRequests: BorrowRequest[];  // 含 pending 及历史
  depositTotal: number;   // 供托区总额
  events: GameEvent[];    // append-only 流水
  startedAt?: number;
  endedAt?: number;
  updatedAt: number;
  schemaVersion: number;
}

type GameEvent =
  | { id: string; type: 'join' | 'leave';  playerId: PlayerId; ts: number }
  | { id: string; type: 'start';           ts: number; operatorId: PlayerId }
  | { id: string; type: 'pay';             from: PlayerId; to: PlayerId; amount: number; ts: number; operatorId: PlayerId }
  | { id: string; type: 'deposit';         from: PlayerId; amount: number; ts: number; operatorId: PlayerId }
  | { id: string; type: 'borrow';          borrowerId: PlayerId; lenderId: PlayerId; amount: number; debtId: string; ts: number; operatorId: PlayerId }
  | { id: string; type: 'repay';           borrowerId: PlayerId; lenderId: PlayerId; amount: number; debtId: string; ts: number; operatorId: PlayerId }
  | { id: string; type: 'settle_deposit';  targets: PlayerId[]; ts: number; operatorId: PlayerId }
  | { id: string; type: 'undo';            targetEventId: string; ts: number; operatorId: PlayerId };
```

---

## 5. 架构与通信协议

### 5.1 架构

```
┌──────────────┐  原生 WebSocket /ws/:code  ┌──────────────────────────┐
│ 手机 A (Vue) │◄──────────────────────────►│  Cloudflare Worker       │
│ 手机 B (Vue) │◄──────────────────────────►│  - 静态资源（Static Assets）│
│ 手机 C (Vue) │◄──────────────────────────►│  - /api/rooms 建房        │
│ 手机 D (Vue) │◄──────────────────────────►│  - 按房间码路由到 DO       │
└──────────────┘                            └────────────┬─────────────┘
                                                         ▼
                                        ┌────────────────────────────────┐
                                        │ RoomDO（每房间一实例，可休眠）    │
                                        │  - 房间状态（权威）              │
                                        │  - 规则校验（shared）            │
                                        │  - SQLite 持久化（DO 存储）      │
                                        │  - 房间内 WebSocket 广播         │
                                        └────────────────────────────────┘
```

- **pnpm monorepo**：
  - `packages/shared` — 类型定义、规则校验（`rules.ts`）、事件折叠（`foldEvents`），**前端与 Worker 共用**，保证两端一致。
  - `apps/web` — Vue 3 前端，原生 WebSocket 传输层（自实现重连 / ack）。
  - `apps/worker` — Cloudflare Worker + Durable Object（`RoomDO`）。
- Worker 为无状态路由；**每个房间对应一个 Durable Object 实例**，是该房间的唯一权威：接收命令 → 校验 → 提交 → 广播房间快照。客户端不做本地写提交。
- 每条命令写入 DO 的 SQLite 存储，实例休眠/重启后从存储恢复（状态由「初始点数 + 事件流水」折叠重建）。
- WebSocket 消息为 JSON 信封：请求 `{ id, event, payload }` → 应答 `{ id, ok, result | error }`；服务端广播 `{ event: 'room:state', payload: { room } }`。

### 5.2 消息协议

建房（HTTP，Worker 前置）：

```
POST /api/rooms  { name, initialScore, playerName, deviceId }
      → { code, state, playerId }   // 失败返回 { error: { code, message } }
```

WebSocket（`/ws/:code`，请求 `{ id, event, payload }` → 应答 `{ id, ok, result | error }`）：

```
room:join    { playerName }      // 加入（同 deviceId 重入时恢复身份）
room:attach  { }                 // 刷新/断线后按 deviceId 恢复绑定
room:leave   { }
game:start   { }
game:end     { }
game:next    { }
tx:pay       { toId, amount }
tx:deposit   { amount }
tx:repay     { lenderId, debtId, amount }
tx:settle    { targets[] }
undo         { }
borrow:request { lenderId, amount }   // 发起借点（纯借款，待出借人确认）
borrow:respond { requestId, approve } // 出借人同意/拒绝
borrow:cancel  { requestId }          // 借款人撤回请求
```

服务端 → 客户端（广播）：

```
room:state   { room }   // 全量房间快照（每次变更后广播给房间内全部连接）
```

应答信封中 `result` 为 `{ state, ...extra }`（成功）或 `error: { code, message, data? }`（失败）。
错误码（`data` 携带差额等补充信息）：

| code | 含义 |
|---|---|
| `INSUFFICIENT_BALANCE` | 余额不足，`data.diff` 为差额 |
| `LENDER_INSUFFICIENT` | 出借人余额不足 |
| `ROOM_FULL` | 房间已满 4 人，无法加入 |
| `BORROW_PENDING` | 该借款人已有待确认的借点请求 |
| `BORROW_EXPIRED` | 借点请求超时/已关闭，不可确认 |
| `NOT_ENOUGH_PLAYERS` | 加入人数 < 3 |
| `SELF_TRANSFER` | 自己付自己 |
| `INVALID_AMOUNT` | 金额非法（非正整数 / 超出可用范围） |
| `WRONG_PHASE` | 当前阶段不允许该操作 |
| `UNDO_BLOCKED` | 目标事件已被后续操作依赖，不可撤销 |

---

## 6. 状态管理（Pinia，客户端）

Store：`useRoomStore`（当前房间镜像 + 命令发送）、`useSessionStore`（`deviceId`、短码、昵称、最近房间）。

- `roomStore` 持有服务端下发的 `RoomState` 镜像，所有写操作通过命令方法发送，结果以服务端 `room:state` 为准。
- getter：`totalBalance`、`depositTotal`、`canStart`、`activeDebts`、`ranking`、`lastUndoableEvent`、`myPlayer`。
- 连接管理：`useSocket` composable 负责连接、断线重连、`sync:request` 全量拉取、连接状态 UI 提示。

---

## 7. 页面与组件结构

### 路由

| 路径 | 页面 | 说明 |
|---|---|---|
| `/` | `HomePage` | 创建房间 / 输入短码加入 / 扫码加入 / 最近房间 |
| `/room/:code` | `RoomPage` | 大厅 + 对局 + 结算（按 `phase` 切换视图） |

### 组件树

```
apps/web/src/
├── pages/
│   ├── HomePage.vue            # 创建(0-100000 校验) / 加入表单 / 二维码
│   └── RoomPage.vue            # 按 phase 分发 + 连接状态条
├── components/
│   ├── table/
│   │   ├── TableLayout.vue     # 牌桌布局：东南西北四席环绕
│   │   └── PlayerSeat.vue      # 单席：昵称/余额/债务徽标/在线状态
│   ├── actions/
│   │   ├── ActionBar.vue       # 底部主操作：支付 / 存供托 / 借还 / 撤销 / 结束
│   │   ├── PayDialog.vue       # 选目标 + 金额 + 快捷金额(+1000/+5000/+10000)
│   │   ├── BorrowDialog.vue    # 余额不足时弹出：选出借人、借入差额、等待确认状态
│   │   ├── LendConfirmCard.vue # 出借人收到的确认卡片：同意 / 拒绝（含倒计时）
│   │   ├── DepositPanel.vue    # 供托区：总额、存入、取出(结算期)
│   │   └── DebtPanel.vue       # 债务列表、还款
│   ├── panels/
│   │   ├── ScoreBoard.vue      # 实时记分板 + 排名
│   │   ├── EventLog.vue        # 流水 + 撤销按钮
│   │   └── SettlementView.vue  # 结算：供托分配、债务结清、收支榜
│   └── common/
│       ├── AmountInput.vue     # 金额输入(正整数、快捷步进)
│       ├── ConnectionBadge.vue # 连接/重连状态
│       └── ConfirmDialog.vue
├── composables/
│   ├── useSocket.ts            # 连接、重连、命令收发
│   └── usePersist.ts           # deviceId、最近房间本地缓存
├── stores/
│   ├── room.store.ts
│   └── session.store.ts
└── router/index.ts
```

---

## 8. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 前端框架 | Vue 3 + `<script setup>` + TypeScript | 组合式 API，类型安全 |
| 构建 | Vite | 秒级启动 |
| 状态 | Pinia | 官方推荐 |
| 路由 | Vue Router | 房间短码 URL 化 |
| 实时通信 | 原生 WebSocket（自实现重连 / ack 信封） | Workers 无 Socket.IO 服务端支持；信封协议轻量可控 |
| 服务端 | Cloudflare Worker + Durable Object（`RoomDO`） | 每房间一实例、可休眠、天然隔离并发 |
| 持久化 | Durable Object 内置 SQLite（`ctx.storage.kv`） | 房间私有、事务性强、实例休眠/重启后自动恢复 |
| UI | Naive UI / Element Plus（或手写轻量组件） | 对话框、表单、消息提示现成 |
| 样式 | SCSS + CSS 变量，深色牌桌主题，移动优先 | 手机屏幕操作，大按钮、高对比 |
| 测试 | Vitest（`shared` 规则层单测为主） | 不变量必须覆盖 |
| 部署 | Cloudflare Workers：`pnpm deploy` 部署 Worker + 静态资源 + Durable Objects；本地 `pnpm preview`（wrangler dev）运行同一套代码 | 单一 Workers 运行时，前端/实时/持久化一体；本地与线上同构 |

### 8.1 开发注意事项

- **Node.js 环境**：本机已预装 Node.js，直接使用，无需重复安装；确认版本即可（建议 ≥ 20 LTS）。
- **包管理器：只用 pnpm**：
  - 所有依赖安装、脚本执行一律使用 `pnpm`（如 `pnpm add`、`pnpm i`、`pnpm dev`、`pnpm build`）。
  - **禁止使用 npm / yarn**：不要执行 `npm install`、`npm run`，避免生成 `package-lock.json` / `yarn.lock` 与 pnpm-lock.yaml 混用导致依赖漂移。
  - 仓库已启用 `pnpm-workspace.yaml`（monorepo）与 `packageManager` 字段；若首次使用 pnpm，可用 `corepack enable` 激活。
- **代理**：网络较慢影响安装效率时，使用本地代理 `http(s)://10.0.0.1:7890`：

  ```bash
  # pnpm 走代理
  pnpm config set proxy http://10.0.0.1:7890
  pnpm config set https-proxy http://10.0.0.1:7890

  # 或以环境变量方式（对 git、vite 等同样生效）
  export HTTP_PROXY=http://10.0.0.1:7890
  export HTTPS_PROXY=http://10.0.0.1:7890
  ```

  网络本身顺畅时可不启用代理，以实际速度为准。

---

## 9. 开发里程碑

- **M1 — 骨架与房间**：monorepo 脚手架、创建/加入房间（短码、0-100000 初始点数校验）、座位分配、WebSocket 连通、大厅人数与开始游戏。
- **M2 — 核心操作**：支付、存供托、记分板、事件流水、撤销；`shared` 规则层单测（点数守恒）。
- **M3 — 借贷**：余额不足流程、借点请求与出借人确认（含超时/拒绝/撤回）、原子事务、债务面板、还款、错误码全链路提示。
- **M4 — 结算与打磨**：供托分配、一键结清、收支榜、再来一局、断线重连与离线状态、移动端 UI、本地部署联调（`pnpm build` + 服务端托管静态资源）。

验收用例（写入 `tests/`）：

- 4 人 100000 分房间，任意两人完成 100 次随机支付后，`sum(balance) + depositTotal === 400000` 恒成立。
- 余额 1000 时支付 3000 → 服务端返回 `INSUFFICIENT_BALANCE(2000)`，双方状态不变。
- 借 2000 支付 3000 并经出借人同意后：借款人余额 `1000 + 2000 − 3000 = 0`，出借人减少 2000，债务 `remaining = 2000`；在出借人点击同意前，双方余额与债务均无变化。
- 借点请求被拒绝或 60 秒超时 → 请求关闭，支付不成立，状态无变化。
- 房间已有 4 人时第 5 人加入 → 返回 `ROOM_FULL`。
- 撤销最近一次还款后，债务还原至还款前，流水保留 `undo` 记录。
- Durable Object 实例休眠/重启后，房间状态从 DO SQLite 恢复，各客户端重连一致。
- 仅 2 人时点击开始 → 返回 `NOT_ENOUGH_PLAYERS`。

---

## 10. 待确认问题

1. **借点是否需要上限或多人拆借？** 当前为无上限、单一出借人。
2. **借点请求超时时间**当前定为 60 秒，是否需要可配置？
