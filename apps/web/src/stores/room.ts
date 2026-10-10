import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { BorrowRequest, Player, RoomState } from '@mj/shared';
import { connectSocket, emit as wsEmit, getDeviceId, on, onConnect } from '../composables/useSocket';

export interface Toast {
  id: number;
  msg: string;
  kind: 'info' | 'err' | 'ok';
}

let toastSeq = 0;

export const useRoomStore = defineStore('room', () => {
  const room = ref<RoomState | null>(null);
  const playerId = ref<string | null>(null);
  const loading = ref(false);
  const toasts = ref<Toast[]>([]);

  const me = computed<Player | null>(
    () => room.value?.players.find((p) => p.id === playerId.value) ?? null
  );
  const others = computed<Player[]>(
    () => room.value?.players.filter((p) => p.id !== playerId.value) ?? []
  );
  const ranking = computed<Player[]>(() =>
    room.value ? [...room.value.players].sort((a, b) => b.balance - a.balance) : []
  );
  const pendingBorrowsForMe = computed<BorrowRequest[]>(
    () =>
      room.value?.borrowRequests.filter(
        (r) => r.lenderId === playerId.value && r.status === 'pending'
      ) ?? []
  );
  const myPendingBorrow = computed<BorrowRequest | null>(
    () =>
      room.value?.borrowRequests.find(
        (r) => r.borrowerId === playerId.value && r.status === 'pending'
      ) ?? null
  );
  const myDebts = computed(() =>
    room.value ? room.value.debts.filter((d) => d.borrowerId === playerId.value && d.remaining > 0) : []
  );

  function toast(msg: string, kind: Toast['kind'] = 'info') {
    const id = ++toastSeq;
    toasts.value.push({ id, msg, kind });
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 2600);
  }

  let bound = false;
  let session: { code: string } | null = null;

  function bindSocket() {
    if (bound) return;
    bound = true;
    on('room:state', (payload: { room: RoomState }) => {
      if (payload?.room) room.value = payload.room;
    });
    // 连接建立 / 自动重连后，重新绑定会话（否则服务端会忘记本连接属于哪个玩家）
    onConnect(() => {
      if (session) attach(session.code);
    });
  }

  function attach(code: string) {
    session = { code };
    connectSocket(code);
    wsEmit('room:attach', { deviceId: getDeviceId() }, (res: any) => {
      if (res?.state) {
        room.value = res.state;
        playerId.value = res.playerId ?? playerId.value;
      }
    });
  }

  function createRoom(opts: {
    name: string;
    initialScore: number;
    playerName: string;
    cb: (code: string) => void;
  }) {
    bindSocket();
    loading.value = true;
    fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: opts.name,
        initialScore: opts.initialScore,
        playerName: opts.playerName,
        deviceId: getDeviceId(),
      }),
    })
      .then((r) => r.json())
      .then((res: any) => {
        loading.value = false;
        if (res?.error) {
          toast(res.error.message || res.error.code, 'err');
          return;
        }
        room.value = res.state;
        playerId.value = res.playerId ?? null;
        session = { code: res.code };
        connectSocket(res.code); // 连上后 onConnect 会 attach，把本连接绑定到该玩家
        toast('房间已创建', 'ok');
        opts.cb(res.code);
      })
      .catch(() => {
        loading.value = false;
        toast('创建房间失败，请检查网络', 'err');
      });
  }

  function joinRoom(opts: { code: string; playerName: string; cb: (code: string) => void }) {
    bindSocket();
    session = null; // 先清空，避免首次连接触发针对旧房间的 attach
    loading.value = true;
    connectSocket(opts.code);
    wsEmit(
      'room:join',
      { playerName: opts.playerName, deviceId: getDeviceId() },
      (res: any) => {
        loading.value = false;
        if (res?.error) {
          toast(res.error.message || res.error.code, 'err');
          return;
        }
        room.value = res.state;
        playerId.value = res.playerId ?? null;
        session = { code: opts.code };
        toast('已加入房间', 'ok');
        opts.cb(opts.code);
      }
    );
  }

  function emit(name: string, payload: Record<string, unknown> = {}, cb?: (r: any) => void) {
    wsEmit(name, payload, (res: any) => {
      if (res?.error) {
        toast(res.error.message || res.error.code, 'err');
        cb?.(res);
        return;
      }
      if (res?.state) room.value = res.state;
      cb?.(res);
    });
  }

  // 命令封装
  const startGame = () => emit('game:start');
  const endGame = () => emit('game:end');
  const nextRound = () => emit('game:next');
  const pay = (toId: string, amount: number) => emit('tx:pay', { toId, amount });
  const deposit = (amount: number) => emit('tx:deposit', { amount });
  const repay = (lenderId: string, debtId: string, amount: number) =>
    emit('tx:repay', { lenderId, debtId, amount });
  const settleDeposit = (targets: string[]) => emit('tx:settle', { targets });
  const undo = () => emit('undo');
  const borrowRequest = (lenderId: string, amount: number) =>
    emit('borrow:request', { lenderId, amount });
  const borrowRespond = (requestId: string, approve: boolean) =>
    emit('borrow:respond', { requestId, approve });
  const borrowCancel = (requestId: string) => emit('borrow:cancel', { requestId });

  return {
    room,
    playerId,
    loading,
    toasts,
    me,
    others,
    ranking,
    pendingBorrowsForMe,
    myPendingBorrow,
    myDebts,
    toast,
    createRoom,
    joinRoom,
    attach,
    startGame,
    endGame,
    nextRound,
    pay,
    deposit,
    repay,
    settleDeposit,
    undo,
    borrowRequest,
    borrowRespond,
    borrowCancel,
    bindSocket,
  };
});
