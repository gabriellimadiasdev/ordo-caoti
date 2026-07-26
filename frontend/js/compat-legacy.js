(() => {
  'use strict';

  if (!window.CSS || typeof window.CSS.supports !== 'function') {
    window.CSS = window.CSS || {};
    window.CSS.supports = () => false;
  }

  if (!('requestIdleCallback' in window)) {
    window.requestIdleCallback = (callback) => window.setTimeout(() => callback({
      didTimeout: false,
      timeRemaining: () => 0,
    }), 1);
  }

  if (!('cancelIdleCallback' in window)) {
    window.cancelIdleCallback = (id) => window.clearTimeout(id);
  }
})();
