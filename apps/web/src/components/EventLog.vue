<script setup lang="ts">
import { computed } from 'vue';
import type { GameEvent, RoomState } from '@mj/shared';

const props = defineProps<{ room: RoomState; myId: string | null }>();
const emit = defineEmits<{ undo: [] }>();

const nameOf = (id: string) => props.room.players.find((p) => p.id === id)?.name ?? '—';

const reversed = computed(() => [...props.room.events].reverse().slice(0, 60));

const canUndo = computed(() => {
  const last = props.room.events[props.room.events.length - 1];
  if (!last || last.type === 'undo') return false;
  return last.operatorId === props.myId;
});

function describe(e: GameEvent): string {
  switch (e.type) {
    case 'join':
      return `${e.name} 加入房间`;
    case 'leave':
      return `${nameOf(e.playerId)} 离开房间`;
    case 'start':
      return '游戏开始';
    case 'pay':
      return `${nameOf(e.from)} 支付 ${nameOf(e.to)} ${e.amount.toLocaleString()} 点`;
    case 'deposit':
      return `${nameOf(e.from)} 存入供托 ${e.amount.toLocaleString()} 点`;
    case 'borrow':
      return `${nameOf(e.borrowerId)} 向 ${nameOf(e.lenderId)} 借入 ${e.amount.toLocaleString()} 点`;
    case 'repay':
      return `${nameOf(e.borrowerId)} 还款 ${nameOf(e.lenderId)} ${e.amount.toLocaleString()} 点`;
    case 'settle_deposit':
      return `供托 ${e.targets.map(nameOf).join('、')} 分配`;
    case 'undo':
      return '撤销了上一次操作';
    default:
      return e.type;
  }
}

function timeOf(e: GameEvent) {
  return new Date(e.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<template>
  <div class="card">
    <div class="card-title">
      操作流水
      <span class="spacer"></span>
      <button class="btn-sm btn-ghost" :disabled="!canUndo" @click="emit('undo')">撤销最近</button>
    </div>
    <div v-if="reversed.length === 0" class="muted small" style="margin-top: 8px">暂无记录</div>
    <div class="log">
      <div v-for="e in reversed" :key="e.id" class="log-item">
        <span class="mono small muted">{{ timeOf(e) }}</span>
        <span class="log-text">{{ describe(e) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.log {
  margin-top: 4px;
  max-height: 280px;
  overflow-y: auto;
}
.log-item {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 8px 2px 8px 10px;
  border-left: 2px solid rgba(240, 200, 120, 0.18);
  border-bottom: 1px solid rgba(240, 200, 120, 0.12);
  font-size: 13px;
}
.log-item:last-child {
  border-bottom: none;
}
.log-text {
  flex: 1;
  color: var(--text);
}
</style>
