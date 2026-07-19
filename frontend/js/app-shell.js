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

  function ensureA11yToolbar() {
    if (document.querySelector('.a11y-toolbar')) return;

    const toolbar = document.createElement('aside');
    toolbar.className = 'a11y-toolbar';
    toolbar.setAttribute('aria-expanded', 'false');
    toolbar.innerHTML = [
      '<div class="a11y-toolbar__header">',
      '<strong>Acessibilidade</strong>',
      '<button type="button" class="a11y-toolbar__toggle" aria-label="Abrir acessibilidade">Abrir</button>',
      '</div>',
      '<div class="a11y-toolbar__body">',
      '<label><input type="checkbox" data-a11y="contrast"> Alto contraste</label>',
      '<label><input type="checkbox" data-a11y="motion"> Reduzir animações</label>',
      '<div class="a11y-toolbar__actions"><button type="button" data-a11y="reset">Resetar</button></div>',
      '</div>'
    ].join('');

    document.body.appendChild(toolbar);

    const toggleBtn = toolbar.querySelector('.a11y-toolbar__toggle');
    const contrastInput = toolbar.querySelector('[data-a11y="contrast"]');
    const motionInput = toolbar.querySelector('[data-a11y="motion"]');
    const resetBtn = toolbar.querySelector('[data-a11y="reset"]');

    toggleBtn.addEventListener('click', function () {
      const expanded = toolbar.getAttribute('aria-expanded') === 'true';
      toolbar.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      toggleBtn.textContent = expanded ? 'Abrir' : 'Fechar';
    });

    function persist() {
      localStorage.setItem('oc_a11y_contrast', String(contrastInput.checked));
      localStorage.setItem('oc_a11y_motion', String(motionInput.checked));
    }

    function apply() {
      document.body.classList.toggle('a11y-high-contrast', contrastInput.checked);
      document.body.classList.toggle('a11y-reduce-motion', motionInput.checked);
      persist();
    }

    contrastInput.checked = localStorage.getItem('oc_a11y_contrast') === 'true';
    motionInput.checked = localStorage.getItem('oc_a11y_motion') === 'true';
    apply();

    contrastInput.addEventListener('change', apply);
    motionInput.addEventListener('change', apply);

    resetBtn.addEventListener('click', function () {
      contrastInput.checked = false;
      motionInput.checked = false;
      apply();
    });
  }

  onReady(function () {
    ensureGlobalStyles();
    document.body.classList.add('oc-fade-in');
    setupRevealAnimations();
    ensureA11yToolbar();
  });
})();
