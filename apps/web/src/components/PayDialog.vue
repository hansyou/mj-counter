<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Player } from '@mj/shared';
import { useRoomStore } from '../stores/room';

const props = defineProps<{
  target: Player;
  presetAmount?: number;
}>();
const emit = defineEmits<{ close: []; borrow: [diff: number] }>();
const store = useRoomStore();

const amount = ref<number>(props.presetAmount ?? 1000);

const myBalance = computed(() => store.me?.balance ?? 0);
const diff = computed(() => Math.max(0, Math.floor(Number(amount.value || 0)) - myBalance.value));

const quick = [1000, 5000, 10000, 20000];

function submit() {
  const amt = Math.floor(Number(amount.value));
  if (!Number.isInteger(amt) || amt <= 0) {
    store.toast('金额必须是正整数', 'err');
    return;
  }
  if (amt > myBalance.value) {
    store.toast('余额不足，请先借点', 'err');
    return;
  }
  store.pay(props.target.id, amt);
  emit('close');
}

function goBorrow() {
  emit('borrow', diff.value || 1000);
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet">
      <div class="row-between">
        <div class="card-title" style="margin-bottom: 0">支付给 {{ target.name }}</div>
        <button class="btn-ghost btn-sm" @click="emit('close')">关闭</button>
      </div>

      <label>金额（整数）</label>
      <input v-model.number="amount" type="number" inputmode="numeric" min="1" step="1" />
      <div class="amount-grid" style="margin-top: 10px">
        <button v-for="q in quick" :key="q" class="amount-btn" @click="amount = q">+{{ q.toLocaleString() }}</button>
      </div>

      <div class="row-between" style="margin-top: 14px">
        <span class="muted small">我的余额</span>
        <span class="balance" style="font-size: 17px">{{ myBalance.toLocaleString() }}<span class="unit">点</span></span>
      </div>

      <div v-if="diff > 0" class="insufficient">
        <div class="small">
          余额不足，差额 <span class="mono" style="color: var(--gold)">{{ diff.toLocaleString() }}</span> 点
        </div>
        <div class="small muted" style="margin-top: 2px">可先借点补齐余额，再回来支付</div>
        <button class="btn-gold btn-block btn-sm" style="margin-top: 10px" @click="goBorrow">去借点</button>
      </div>

      <button class="btn-primary btn-block" style="margin-top: 18px" :disabled="diff > 0" @click="submit">
        确认支付
      </button>
    </div>
  </div>
</template>

<style scoped>
.insufficient {
  margin-top: 14px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(240, 166, 60, 0.12);
  border: 1px solid var(--gold-deep);
}
</style>
