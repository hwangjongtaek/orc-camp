import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom lacks PointerEvent; provide a minimal MouseEvent-backed polyfill so fireEvent.pointer*
// carries clientX/clientY/button/pointerType (used by the #42 drag-to-pan tests).
if (typeof window !== 'undefined' && typeof window.PointerEvent !== 'function') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// jsdom (with an opaque about:blank origin) exposes no Storage, so `localStorage` is
// undefined here. The store guards every access in try/catch and silently degrades, but
// persistence assertions need a real backing store. Provide a minimal in-memory Storage so
// the UI-preference persistence (layoutMode, terminal height) is observable in tests.
if (typeof globalThis.localStorage === 'undefined') {
  class MemoryStorage implements Storage {
    private m = new Map<string, string>();
    get length(): number {
      return this.m.size;
    }
    clear(): void {
      this.m.clear();
    }
    getItem(key: string): string | null {
      return this.m.has(key) ? this.m.get(key)! : null;
    }
    key(index: number): string | null {
      return [...this.m.keys()][index] ?? null;
    }
    removeItem(key: string): void {
      this.m.delete(key);
    }
    setItem(key: string, value: string): void {
      this.m.set(key, String(value));
    }
  }
  const store = new MemoryStorage();
  globalThis.localStorage = store;
  if (typeof window !== 'undefined') window.localStorage = store;
}

// jsdom lacks matchMedia; provide a minimal stub for components that probe reduced-motion.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
});
