(function () {
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
      return;
    }
    fn();
  }

  function setupRevealAnimations() {
    const targets = Array.from(document.querySelectorAll('.oc-reveal, .card, .panel, main section, article'));
    if (!targets.length || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    targets.forEach((el, index) => {
      if (!el.classList.contains('oc-reveal')) {
        el.classList.add('oc-reveal');
      }
      el.style.transitionDelay = Math.min(index * 26, 260) + 'ms';
      observer.observe(el);
    });
  }

  function ensureGlobalStyles() {
    if (document.querySelector('link[data-oc-global-style]')) return;
    const script = document.querySelector('script[src*="app-shell.js"]');
    if (!script?.src) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.ocGlobalStyle = 'true';
    link.href = new URL('../css/site-global.css', script.src).href;
    document.head.appendChild(link);
  }



  onReady(function () {
    ensureGlobalStyles();
    document.body.classList.add('oc-fade-in');
    setupRevealAnimations();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
})();
