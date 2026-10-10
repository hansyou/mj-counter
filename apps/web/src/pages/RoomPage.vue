<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Player } from '@mj/shared';
import { useRoomStore } from '../stores/room';
import { socketStatus } from '../composables/useSocket';
import PlayerSeat from '../components/PlayerSeat.vue';
import PayDialog from '../components/PayDialog.vue';
import BorrowDialog from '../components/BorrowDialog.vue';
import LendConfirmCard from '../components/LendConfirmCard.vue';
import EventLog from '../components/EventLog.vue';
import SettlementView from '../components/SettlementView.vue';

const props = defineProps<{ code: string }>();
const router = useRouter();
const store = useRoomStore();

const payTarget = ref<Player | null>(null);
const depositOpen = ref(false);
const depositAmount = ref<string>('');
const borrowOpen = ref(false);
const borrowPreset = ref<number>(1000);
const repayDebtId = ref<string>('');
const repayAmount = ref<string>('');

const room = computed(() => store.room);
const phase = computed(() => store.room?.phase ?? 'lobby');
const phaseLabel = computed(() =>
  phase.value === 'lobby' ? '大厅' : phase.value === 'playing' ? '对局中' : '结算'
);
const canStart = computed(() => (store.room?.players.length ?? 0) >= 3);
const toasts = computed(() => store.toasts);

onMounted(() => {
  store.bindSocket();
  if (!store.room || store.room.code !== props.code) {
    store.attach(props.code);
  }
});

function backHome() {
  router.push('/');
}

function startGame() {
  if (!canStart.value) {
    store.toast('还需更多玩家', 'err');
    return;
  }
  if (confirm('确认开始游戏？')) {
    store.startGame();
  }
}

function endGame() {
  if (confirm('确认结束游戏并进入结算？')) {
    store.endGame();
  }
}

function openPay(p: Player) {
  if (p.id === store.playerId) return;
  payTarget.value = p;
}

function openBorrow(preset = 1000) {
  borrowPreset.value = preset > 0 ? preset : 1000;
  borrowOpen.value = true;
}

// 支付时余额不足 → 转去借点（借了再支付）
function onPayNeedBorrow(diff: number) {
  payTarget.value = null;
  openBorrow(diff);
}

function openDeposit() {
  depositOpen.value = true;
  depositAmount.value = '';
}

function cancelDeposit() {
  depositOpen.value = false;
  depositAmount.value = '';
}

function doDeposit() {
  const amt = Math.floor(Number(depositAmount.value));
  if (!Number.isInteger(amt) || amt <= 0) {
    store.toast('金额必须是正整数', 'err');
    return;
  }
  store.deposit(amt);
  cancelDeposit();
}

function startRepay(d: { id: string; lenderId: string }) {
  repayDebtId.value = d.id;
  repayAmount.value = '';
}

function cancelRepay() {
  repayDebtId.value = '';
  repayAmount.value = '';
}

function doRepay(debtId: string, lenderId: string) {
  const amt = Math.floor(Number(repayAmount.value));
  if (!Number.isInteger(amt) || amt <= 0) {
    store.toast('金额必须是正整数', 'err');
    return;
  }
  store.repay(lenderId, debtId, amt);
  cancelRepay();
}

function debtCountOf(id: string) {
  return store.room?.debts.filter((d) => d.borrowerId === id && d.remaining > 0).length ?? 0;
}
</script>

<template>
  <div class="page">
    <!-- 顶部 -->
    <div class="room-banner" style="margin-top: 8px">
      <div class="row-between">
        <div class="row" style="gap: 12px">
          <button class="btn-ghost btn-sm" @click="backHome">←</button>
          <div class="row" style="gap: 9px">
            <div class="title" style="font-size: 19px">{{ room?.name || '房间' }}</div>
            <span class="pill gold">{{ phaseLabel }}</span>
          </div>
        </div>
        <span class="pill" :class="socketStatus.connected ? 'jade' : 'danger'">
          {{ socketStatus.connected ? '在线' : '断线' }}
        </span>
      </div>
      <div class="row" style="margin-top: 10px; gap: 8px">
        <span class="small muted" style="letter-spacing: 3px">房间码</span>
        <span class="code-chip">{{ room?.code || props.code }}</span>
      </div>
    </div>

    <!-- 待确认借点卡片 -->
    <div v-if="store.pendingBorrowsForMe.length" class="stack" style="margin-top: 14px">
      <LendConfirmCard
        v-for="r in store.pendingBorrowsForMe"
        :key="r.id"
        :request="r"
      />
    </div>

    <template v-if="room">
      <!-- 供托条 -->
      <div class="card" style="margin-top: 14px">
        <div class="row-between">
          <div class="vault">
            <span class="vault-coin">供</span>
            <div>
              <div class="small muted" style="letter-spacing: 3px">供托区</div>
              <div class="balance">{{ room.depositTotal.toLocaleString() }}<span class="unit">点</span></div>
            </div>
          </div>
          <div style="text-align: right">
            <div class="small muted" style="letter-spacing: 3px">我的余额</div>
            <div class="balance">{{ (store.me?.balance ?? 0).toLocaleString() }}<span class="unit">点</span></div>
          </div>
        </div>
      </div>

      <!-- 大厅 -->
      <template v-if="phase === 'lobby'">
        <div class="card" style="margin-top: 14px">
          <div class="row-between">
            <div>
              <div class="card-title" style="margin-bottom: 2px">等待玩家加入</div>
              <div class="small muted">已入座 {{ room.players.length }}/4 人</div>
            </div>
            <button class="btn-sm btn-primary" :disabled="!canStart" @click="startGame">
              {{ canStart ? '开始游戏' : '还需 ' + (3 - room.players.length) + ' 人' }}
            </button>
          </div>
          <div class="divider"></div>
          <div class="small muted">
            把房间码 <span class="mono" style="color: var(--gold); letter-spacing: 2px">{{ room.code }}</span>
            分享给朋友，各自手机加入即可
          </div>
        </div>
      </template>

      <!-- 座位 -->
      <div class="stack" style="margin-top: 14px">
        <PlayerSeat
          v-for="p in room.players"
          :key="p.id"
          :player="p"
          :is-me="p.id === store.playerId"
          :debt-count="debtCountOf(p.id)"
          @tap="openPay(p)"
        />
      </div>

      <!-- 我的借点请求 -->
      <div v-if="store.myPendingBorrow" class="card pending-card" style="margin-top: 14px">
        <div class="row-between">
          <div class="small">
            已向 {{ room.players.find((p) => p.id === store.myPendingBorrow!.lenderId)?.name }} 发起借
            <span class="mono" style="color: var(--gold)">{{ store.myPendingBorrow.amount.toLocaleString() }}</span>
            点，等待确认…
          </div>
          <button class="btn-sm btn-danger" @click="store.borrowCancel(store.myPendingBorrow!.id)">撤回</button>
        </div>
      </div>

      <!-- 对局操作 -->
      <template v-if="phase === 'playing'">
        <div class="card" style="margin-top: 14px">
          <div class="card-title">操作</div>
          <div class="row" style="flex-wrap: wrap">
            <button class="btn-sm btn-primary" @click="openDeposit">
              存入供托
            </button>
            <button class="btn-sm btn-gold" @click="openBorrow(1000)">借点</button>
            <button class="btn-sm btn-ghost" @click="store.undo()">撤销最近</button>
            <button class="btn-sm btn-danger" @click="endGame">结束游戏</button>
          </div>
          <div v-if="depositOpen" class="row" style="margin-top: 12px">
            <input v-model="depositAmount" type="number" inputmode="numeric" min="1" placeholder="存入金额" />
            <button class="btn-sm btn-primary" @click="doDeposit">确认</button>
            <button class="btn-sm btn-ghost" @click="cancelDeposit">取消</button>
          </div>
        </div>
      </template>

      <!-- 债务 -->
      <div v-if="store.myDebts.length" class="card" style="margin-top: 14px">
        <div class="card-title">我的债务</div>
        <div v-for="d in store.myDebts" :key="d.id" class="list-row">
          <div class="small">
            欠 {{ room.players.find((p) => p.id === d.lenderId)?.name }}
            <span class="mono" style="color: var(--gold)">{{ d.remaining.toLocaleString() }}</span>
          </div>
          <div class="row">
            <template v-if="repayDebtId === d.id">
              <input
                v-model="repayAmount"
                type="number"
                inputmode="numeric"
                min="1"
                style="width: 110px"
                placeholder="还款额"
              />
              <button class="btn-sm btn-primary" @click="doRepay(d.id, d.lenderId)">确认</button>
              <button class="btn-sm btn-ghost" @click="cancelRepay">取消</button>
            </template>
            <button v-else class="btn-sm btn-ghost" @click="startRepay(d)">还款</button>
          </div>
        </div>
      </div>

      <!-- 流水 -->
      <div style="margin-top: 14px">
        <EventLog :room="room" :my-id="store.playerId" @undo="store.undo()" />
      </div>

      <!-- 结算 -->
      <div v-if="phase === 'settled'" style="margin-top: 14px">
        <div class="row" style="margin-bottom: 12px; gap: 10px">
          <span class="tile red" style="width: 26px; height: 34px; font-size: 16px">終</span>
          <div class="title">结算</div>
        </div>
        <SettlementView :room="room" />
      </div>

      <div class="small muted hint-line">点击任意座位，即可向该玩家支付点数</div>
    </template>

    <div v-else class="card" style="margin-top: 24px; text-align: center">
      <div class="muted">正在同步房间状态…</div>
    </div>

    <!-- 支付弹层 -->
    <PayDialog
      v-if="payTarget"
      :target="payTarget"
      @close="payTarget = null"
      @borrow="onPayNeedBorrow"
    />

    <!-- 借点弹层 -->
    <BorrowDialog
      v-if="borrowOpen"
      :preset-amount="borrowPreset"
      @close="borrowOpen = false"
    />

    <!-- Toast -->
    <div class="toast-wrap">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.msg }}</div>
    </div>
  </div>
</template>
