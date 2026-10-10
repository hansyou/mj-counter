<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoomStore } from '../stores/room';

const props = defineProps<{ presetAmount?: number; presetLenderId?: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useRoomStore();

const lenderId = ref<string>(props.presetLenderId ?? '');
const amount = ref<number>(props.presetAmount ?? 1000);

const quick = [1000, 5000, 10000, 20000];

const lender = computed(() => store.others.find((p) => p.id === lenderId.value));

function submit() {
  const amt = Math.floor(Number(amount.value));
  if (!Number.isInteger(amt) || amt <= 0) {
    store.toast('借款金额必须是正整数', 'err');
    return;
  }
  if (!lender.value) {
    store.toast('请选择出借人', 'err');
    return;
  }
  store.borrowRequest(lender.value.id, amt);
  store.toast('已发起借点请求，等待出借人确认', 'info');
  emit('close');
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet">
      <div class="row-between">
        <div class="card-title" style="margin-bottom: 0">借点</div>
        <button class="btn-ghost btn-sm" @click="emit('close')">关闭</button>
      </div>

      <label>向谁借（出借人）</label>
      <select v-model="lenderId">
        <option value="">请选择</option>
        <option v-for="p in store.others" :key="p.id" :value="p.id">
          {{ p.name }}（余额 {{ p.balance.toLocaleString() }}）
        </option>
      </select>

      <label>借入金额（整数）</label>
      <input v-model.number="amount" type="number" inputmode="numeric" min="1" step="1" />
      <div class="amount-grid" style="margin-top: 10px">
        <button v-for="q in quick" :key="q" class="amount-btn" @click="amount = q">+{{ q.toLocaleString() }}</button>
      </div>

      <div class="row-between" style="margin-top: 14px">
        <span class="muted small">我的余额</span>
        <span class="balance" style="font-size: 17px">{{ (store.me?.balance ?? 0).toLocaleString() }}<span class="unit">点</span></span>
      </div>

      <div class="small muted" style="margin-top: 8px">
        借入后余额增加，需经出借人同意才生效；借的点数会记为债务，之后可还款。
      </div>

      <button class="btn-primary btn-block" style="margin-top: 18px" @click="submit">
        发起借点请求
      </button>
    </div>
  </div>
</template>
