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
