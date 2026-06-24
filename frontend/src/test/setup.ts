import '@testing-library/jest-dom';

// Polyfill ResizeObserver for jsdom (used by Radix UI)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
