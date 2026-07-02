/**
 * SPEC-203 §2.5 — bounded LRU used for the terminal "last-screen" cache (instant switch-back).
 *
 * A tiny insertion-ordered LRU (Map keeps insertion order; a re-`set`/`get` moves the key to the
 * most-recent end). The terminal cache stores ONLY redacted pane screens (invariant ②) and is
 * bounded by `TERMINAL_LRU_MAX`; exposure-off purges it wholesale (`clear`) so a cached screen can
 * never bypass the exposure gate (SPEC-203 §2.5 LRU-vs-exposure precedence, AC-05/AC-10).
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v); // promote to most-recent
    }
    return v;
  }

  set(key: K, val: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, val);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get size(): number {
    return this.map.size;
  }
}
