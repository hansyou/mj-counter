<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useRoomStore } from '../stores/room';
import { socketStatus } from '../composables/useSocket';

const router = useRouter();
const store = useRoomStore();

const tab = ref<'create' | 'join'>('create');
const roomName = ref('未命名房间');
const initialScore = ref(25000);
const playerName = ref('');
const joinCode = ref('');
const joinName = ref('');

const scoreError = ref('');

function validateScore() {
  const v = Number(initialScore.value);
  if (!Number.isInteger(v) || v < 0 || v > 100000) {
    scoreError.value = '初始点数必须是 0~100000 的整数';
    return false;
  }
  scoreError.value = '';
  return true;
}

function onCreate() {
  if (!validateScore()) return;
  if (!playerName.value.trim()) {
    store.toast('请输入昵称', 'err');
    return;
  }
  store.createRoom({
    name: roomName.value,
    initialScore: Number(initialScore.value),
    playerName: playerName.value.trim(),
    cb: (code) => router.push(`/room/${code}`),
  });
}

function onJoin() {
  if (!joinName.value.trim()) {
    store.toast('请输入昵称', 'err');
    return;
  }
  const code = joinCode.value.trim().toUpperCase();
  if (code.length !== 6) {
    store.toast('房间码为 6 位', 'err');
    return;
  }
  store.joinRoom({
    code,
    playerName: joinName.value.trim(),
    cb: (c) => router.push(`/room/${c}`),
  });
}
</script>

<template>
  <div class="page">
    <div class="stack" style="margin-top: 18px">
      <div class="hero">
        <div class="tile-row">
          <span class="tile green" style="--tilt: -6deg">發</span>
          <span class="tile red" style="--tilt: -2deg">中</span>
          <span class="tile blue" style="--tilt: 2deg">白</span>
          <span class="tile green" style="--tilt: 6deg">發</span>
        </div>
        <div class="title-hero">麻将计分器</div>
        <div class="muted small hero-sub">线下点数管理 · 3-4 人 · 多端同房</div>
      </div>

      <div class="row-between">
        <div class="card-title" style="margin-bottom: 0">牌局</div>
        <span class="pill" :class="socketStatus.connected ? 'jade' : 'danger'">
          {{ socketStatus.connected ? '已连接' : '连接中…' }}
        </span>
      </div>

      <div class="card">
        <div class="row" style="margin-bottom: 8px">
          <button class="btn-sm btn-block" :class="tab === 'create' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'create'">
            创建房间
          </button>
          <button class="btn-sm btn-block" :class="tab === 'join' ? 'btn-primary' : 'btn-ghost'" @click="tab = 'join'">
            加入房间
          </button>
        </div>

        <template v-if="tab === 'create'">
          <label>房间名（可选）</label>
          <input v-model="roomName" maxlength="24" placeholder="未命名房间" />

          <label>初始点数（0 ~ 100000）</label>
          <input
            v-model.number="initialScore"
            type="number"
            inputmode="numeric"
            min="0"
            max="100000"
            step="1"
            @blur="validateScore"
          />
          <div v-if="scoreError" class="small" style="color: var(--danger); margin-top: 6px">
            {{ scoreError }}
          </div>
          <div class="row" style="margin-top: 10px">
            <button class="btn-sm btn-ghost" style="flex: 1" @click="initialScore = 25000">25000</button>
            <button class="btn-sm btn-ghost" style="flex: 1" @click="initialScore = 30000">30000</button>
            <button class="btn-sm btn-ghost" style="flex: 1" @click="initialScore = 100000">100000</button>
          </div>

          <label>你的昵称</label>
          <input v-model="playerName" maxlength="12" placeholder="如：东风" />

          <button class="btn-primary btn-block" style="margin-top: 18px" :disabled="store.loading" @click="onCreate">
            创建房间
          </button>
        </template>

        <template v-else>
          <label>房间码（6 位）</label>
          <input
            v-model="joinCode"
            maxlength="6"
            placeholder="ABCDEF"
            style="text-transform: uppercase; letter-spacing: 4px; font-size: 20px; text-align: center"
          />

          <label>你的昵称</label>
          <input v-model="joinName" maxlength="12" placeholder="如：南风" />

          <button class="btn-primary btn-block" style="margin-top: 18px" :disabled="store.loading" @click="onJoin">
            加入房间
          </button>
        </template>
      </div>

      <div class="card">
        <div class="card-title">玩法说明</div>
        <div class="bullet-list muted small">
          <div class="bullet">3 人即可开局，任意玩家可开始（无房主）</div>
          <div class="bullet">支持向他人支付、存入供托区、余额不足时借点（需出借人确认）</div>
          <div class="bullet">所有点数变动实时同步，可撤销最近一次操作</div>
          <div class="bullet">房间至多 4 人，第 5 人无法加入</div>
        </div>
      </div>
    </div>
  </div>
</template>
