<script setup lang="ts">
import type { Player } from '@mj/shared';

defineProps<{
  player: Player;
  isMe: boolean;
  debtCount?: number;
}>();

const emit = defineEmits<{ tap: [] }>();

const winds = ['东', '南', '西', '北'];
</script>

<template>
  <div
    class="seat"
    :class="{ me: isMe, offline: !player.online }"
    @click="emit('tap')"
  >
    <div class="row-between">
      <div class="row" style="gap: 11px">
        <span class="wind">{{ winds[player.seat] }}</span>
        <div>
          <div class="seat-name">
            {{ player.name }}
            <span v-if="isMe" class="pill accent" style="margin-left: 4px">我</span>
          </div>
          <div class="small muted seat-sub">
            <span v-if="!player.online" class="offline-tag">离线</span>
            <span v-else class="dot-line"><span class="dot"></span>在座</span>
          </div>
        </div>
      </div>
      <div style="text-align: right">
        <div class="balance" :style="{ color: player.balance < 0 ? 'var(--danger)' : 'var(--gold)' }">
          {{ player.balance.toLocaleString() }}<span class="unit">点</span>
        </div>
        <div v-if="debtCount" class="debt-tag">欠 {{ debtCount }} 笔</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.seat {
  position: relative;
  background: linear-gradient(158deg, rgba(59, 66, 121, 0.72) 0%, rgba(38, 43, 85, 0.88) 100%);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 13px 15px;
  overflow: hidden;
  box-shadow: 0 8px 20px rgba(6, 8, 26, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  transition: border-color 0.15s ease, transform 0.08s ease;
}
.seat:active {
  transform: scale(0.99);
}
.seat::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 3px;
  background: linear-gradient(180deg, var(--line-strong), transparent);
}
.seat.me {
  border-color: var(--accent);
  background: linear-gradient(158deg, rgba(240, 166, 60, 0.2) 0%, rgba(52, 50, 88, 0.9) 62%, rgba(38, 43, 85, 0.9) 100%);
  box-shadow: 0 8px 22px rgba(6, 8, 26, 0.45), 0 0 0 1px rgba(240, 166, 60, 0.5), 0 0 22px rgba(240, 166, 60, 0.22);
}
.seat.me::before {
  background: linear-gradient(180deg, var(--gold), var(--accent-2));
}
.seat.offline {
  opacity: 0.55;
  filter: saturate(0.5);
}
.wind {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  font-family: 'Songti SC', 'SimSun', serif;
  font-size: 19px;
  font-weight: 900;
  color: #5c3606;
  background: radial-gradient(circle at 32% 26%, #ffeab6 0%, var(--gold) 38%, var(--gold-deep) 100%);
  box-shadow:
    0 3px 8px rgba(0, 0, 0, 0.45),
    inset 0 -3px 6px rgba(120, 74, 12, 0.45),
    inset 0 3px 5px rgba(255, 255, 255, 0.5);
}
.seat-name {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 1px;
}
.seat-sub {
  margin-top: 1px;
  letter-spacing: 1px;
}
.dot-line {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.offline-tag {
  color: var(--text-dim);
  letter-spacing: 2px;
}
.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 6px rgba(85, 201, 142, 0.8);
}
.debt-tag {
  display: inline-block;
  margin-top: 3px;
  padding: 1px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--gold);
  background: rgba(255, 210, 119, 0.14);
  border: 1px solid rgba(255, 210, 119, 0.4);
}
</style>
