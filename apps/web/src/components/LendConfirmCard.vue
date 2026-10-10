<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { BorrowRequest } from '@mj/shared';
import { useRoomStore } from '../stores/room';

const props = defineProps<{ request: BorrowRequest }>();
const store = useRoomStore();

const remaining = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

const borrower = computed(() => store.room?.players.find((p) => p.id === props.request.borrowerId));

function tick() {
  remaining.value = Math.max(0, Math.ceil((props.request.expiresAt - Date.now()) / 1000));
}

onMounted(() => {
  tick();
  timer = setInterval(tick, 500);
});
onUnmounted(() => timer && clearInterval(timer));
</script>

<template>
  <div class="lend-card">
    <div class="row-between">
      <div class="row" style="gap: 11px">
        <span class="tile green" style="width: 30px; height: 40px; font-size: 17px">借</span>
        <div>
          <div class="lend-title">{{ borrower?.name }} 想向你借点</div>
          <div class="small muted">
            借款金额 <span class="mono" style="color: var(--gold)">{{ request.amount.toLocaleString() }}</span> 点
          </div>
        </div>
      </div>
      <span class="pill gold">{{ remaining }}s</span>
    </div>
    <div class="row" style="margin-top: 12px">
      <button class="btn-primary" style="flex: 1" @click="store.borrowRespond(request.id, true)">同意</button>
      <button class="btn-danger" style="flex: 1" @click="store.borrowRespond(request.id, false)">拒绝</button>
    </div>
  </div>
</template>

<style scoped>
.lend-card {
  position: relative;
  background: linear-gradient(150deg, rgba(240, 166, 60, 0.24) 0%, rgba(52, 50, 88, 0.9) 55%, rgba(38, 43, 85, 0.92) 100%);
  border: 1px solid var(--gold-deep);
  border-radius: var(--radius);
  padding: 14px;
  box-shadow: 0 10px 26px rgba(6, 8, 26, 0.5), 0 0 24px rgba(240, 166, 60, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  animation: lendPulse 1.6s ease-in-out infinite;
}
.lend-title {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #ffe6b0;
}
@keyframes lendPulse {
  0%,
  100% {
    box-shadow: 0 10px 26px rgba(6, 8, 26, 0.5), 0 0 18px rgba(240, 166, 60, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  }
  50% {
    box-shadow: 0 10px 26px rgba(6, 8, 26, 0.5), 0 0 30px rgba(240, 166, 60, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  }
}
</style>
