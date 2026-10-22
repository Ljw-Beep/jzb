// 全局数据仓库：单一 state 对象 + 订阅 + 乐观提交。
// 所有写操作串行执行，避免连续操作时版本冲突导致后一次被丢弃。
import { api, ApiError } from './api.js';
import { clone } from './utils.js';

export const store = {
  state: null,
  rev: 0,
  subs: new Set(),
  queue: Promise.resolve(),

  async load() {
    const r = await api.getState();
    this.state = r.data;
    this.rev = r.rev;
    return this.state;
  },

  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  },

  emit() {
    for (const fn of Array.from(this.subs)) {
      try { fn(this.state); } catch (e) { console.error(e); }
    }
  },

  /**
   * 修改状态：先本地生效（界面立刻更新），再写盘。
   * 失败回滚；版本冲突则重新拉取服务端数据。
   */
  commit(mutator) {
    const exec = async () => {
      if (!this.state) throw new Error('数据尚未加载');
      const next = clone(this.state);
      mutator(next);
      const prevState = this.state;
      const prevRev = this.rev;

      this.state = next;
      this.emit();

      try {
        const r = await api.putState(next, prevRev);
        this.rev = r.rev;
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const fresh = await api.getState();
          this.state = fresh.data;
          this.rev = fresh.rev;
          this.emit();
        } else {
          this.state = prevState;
          this.rev = prevRev;
          this.emit();
        }
        throw err;
      }
    };

    // 串行队列：前一次提交完成（拿到新 rev）后才执行下一次
    const p = this.queue.then(exec, exec);
    this.queue = p.then(() => {}, () => {});
    return p;
  }
};
