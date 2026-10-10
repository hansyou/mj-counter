<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RoomState } from '@mj/shared';
import { useRoomStore } from '../stores/room';

const props = defineProps<{ room: RoomState }>();
const store = useRoomStore();

const selected = ref<string[]>([]);

const ranking = computed(() => [...props.room.players].sort((a, b) => b.balance - a.balance));
const openDebts = computed(() => props.room.debts.filter((d) => d.remaining > 0));

function toggle(id: string) {
  if (selected.value.includes(id)) selected.value = selected.value.filter((x) => x !== id);
  else selected.value.push(id);
}

function distributeEven() {
  selected.value = props.room.players.map((p) => p.id);
  store.settleDeposit(selected.value);
}

function distributeSelected() {
  if (selected.value.length === 0) {
    store.toast('请选择分配目标', 'err');
    return;
  }
  store.settleDeposit(selected.value);
}

function settleAll() {
  const me = store.me?.id;
  let budget = props.room.players.find((p) => p.id === me)?.balance ?? 0;
  for (const d of openDebts.value) {
    if (d.borrowerId !== me) continue;
    const amt = Math.min(d.remaining, budget);
    if (amt > 0) {
      store.repay(d.lenderId, d.id, amt);
      budget -= amt;
    }
  }
}
</script>

<template>
  <div class="stack">
    <div class="card">
      <div class="card-title">最终点数榜</div>
      <div v-for="(p, i) in ranking" :key="p.id" class="list-row rank-row">
        <div class="row">
          <span class="rank" :class="i === 0 ? 'first' : ''">{{ i + 1 }}</span>
          <span>{{ p.name }}</span>
        </div>
        <div class="balance" style="font-size: 18px">{{ p.balance.toLocaleString() }}<span class="unit">点</span></div>
      </div>
    </div>

    <div class="card">
      <div class="row-between">
        <div class="card-title" style="margin-bottom: 0">供托区</div>
        <div class="vault-coin" style="width: 34px; height: 34px; font-size: 15px">供</div>
      </div>
      <div class="balance" style="margin: 8px 0 2px">{{ room.depositTotal.toLocaleString() }}<span class="unit">点</span></div>
      <div class="small muted" style="margin: 6px 0 12px">选择分配目标，将供托区点数分配给他们</div>
      <div class="row" style="flex-wrap: wrap">
        <button
          v-for="p in room.players"
          :key="p.id"
          class="btn-sm"
          :class="selected.includes(p.id) ? 'btn-gold' : 'btn-ghost'"
          @click="toggle(p.id)"
        >
          {{ p.name }}
        </button>
      </div>
      <div class="row" style="margin-top: 12px">
        <button class="btn-sm btn-primary" style="flex: 1" :disabled="room.depositTotal === 0" @click="distributeEven">均分全员</button>
        <button class="btn-sm btn-gold" style="flex: 1" :disabled="room.depositTotal === 0" @click="distributeSelected">分配所选</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">未清偿债务</div>
      <div v-if="openDebts.length === 0" class="muted small">无</div>
      <div v-for="d in openDebts" :key="d.id" class="list-row">
        <div class="small">
          {{ room.players.find((p) => p.id === d.borrowerId)?.name }} 欠
          {{ room.players.find((p) => p.id === d.lenderId)?.name }}
        </div>
        <div class="mono" style="color: var(--gold)">{{ d.remaining.toLocaleString() }}</div>
      </div>
      <button class="btn-sm btn-primary btn-block" style="margin-top: 12px" :disabled="openDebts.length === 0" @click="settleAll">
        一键结清我的债务
      </button>
    </div>

    <div class="row">
      <button class="btn-primary btn-block" style="flex: 1" @click="store.nextRound()">再来一局</button>
    </div>
  </div>
</template>

<style scoped>
.rank-row {
  padding: 10px 0;
}
.rank {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 13px;
  font-weight: 800;
  color: var(--text-dim);
  background: linear-gradient(180deg, rgba(59, 66, 121, 0.8), rgba(38, 43, 85, 0.9));
  border: 1px solid var(--line);
}
.rank.first {
  color: #5c3606;
  background: radial-gradient(circle at 32% 26%, #ffeab6 0%, var(--gold) 42%, var(--gold-deep) 100%);
  border-color: #ffe3a8;
  box-shadow: 0 2px 8px rgba(240, 166, 60, 0.4);
}
</style>
