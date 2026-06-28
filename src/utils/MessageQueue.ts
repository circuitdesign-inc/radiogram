/**
 * 汎用の非同期 FIFO キュー。
 *
 * 無線で非同期に届く受信メッセージを保持し、消費側は dequeue(timeoutMs) で
 * Promise として 1 件ずつ取り出す。キューが空なら待機し、enqueue または
 * タイムアウトで解決する。
 */

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class QueueTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`メッセージ受信がタイムアウトしました (${timeoutMs}ms)`);
    this.name = 'QueueTimeoutError';
  }
}

export class MessageQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Waiter<T>[] = [];

  /** 要素を追加する。待機者がいれば即座に渡す。 */
  enqueue(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(item);
      return;
    }
    this.items.push(item);
  }

  /**
   * 要素を 1 件取り出す。空なら最大 timeoutMs まで待機する。
   * timeoutMs <= 0 の場合は無期限に待機する。
   */
  dequeue(timeoutMs = 30000): Promise<T> {
    const existing = this.items.shift();
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }

    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter<T> = { resolve, reject, timer: null };
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
          reject(new QueueTimeoutError(timeoutMs));
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  /** 現在キューに溜まっている要素数。 */
  get size(): number {
    return this.items.length;
  }

  /** 待機中の取り出し要求をすべて拒否し、溜まった要素を破棄する。 */
  clear(reason = 'キューがクリアされました'): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    this.items.length = 0;
  }
}
