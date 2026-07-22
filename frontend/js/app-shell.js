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

  function ensureVLibras() {
    if (document.querySelector('[vw].enabled')) return;
    const widget = document.createElement('div');
    widget.setAttribute('vw', '');
    widget.className = 'enabled';
    widget.innerHTML = '<div vw-access-button class="active"></div><div vw-plugin-wrapper><div class="vw-plugin-top-wrapper"></div></div>';
    document.body.appendChild(widget);
    if (!document.querySelector('script[src*="vlibras.gov.br/app/vlibras-plugin.js"]')) {
      const script = document.createElement('script');
      script.src = 'https://vlibras.gov.br/app/vlibras-plugin.js';
      script.onload = function () {
        if (window.VLibras && window.VLibras.Widget) new window.VLibras.Widget('https://vlibras.gov.br/app');
      };
      document.body.appendChild(script);
    }
  }

  function ensureA11yToolbar() {
    if (document.querySelector('.a11y-toolbar')) return;
    const toolbar = document.createElement('aside');
    toolbar.className = 'a11y-toolbar';
    toolbar.setAttribute('aria-expanded', 'false');
    toolbar.innerHTML = [
      '<button type="button" class="a11y-toolbar__tab" aria-label="Abrir ferramentas de acessibilidade">Acessibilidade</button>',
      '<div class="a11y-toolbar__body">',
      '<strong>Ferramentas de acessibilidade</strong>',
      '<label><input type="checkbox" data-a11y="contrast"> Alto contraste</label>',
      '<label><input type="checkbox" data-a11y="motion"> Reduzir animações</label>',
      '<label><input type="checkbox" data-a11y="large-text"> Texto maior</label>',
      '<label><input type="checkbox" data-a11y="readable-font"> Fonte legível</label>',
      '<label><input type="checkbox" data-a11y="vlibras"> Ativar VLibras</label>',
      '<div class="a11y-toolbar__actions"><button type="button" data-a11y="reset">Resetar</button></div>',
      '</div>'
    ].join('');
    document.body.appendChild(toolbar);
    const tab = toolbar.querySelector('.a11y-toolbar__tab');
    const contrastInput = toolbar.querySelector('[data-a11y="contrast"]');
    const motionInput = toolbar.querySelector('[data-a11y="motion"]');
    const largeTextInput = toolbar.querySelector('[data-a11y="large-text"]');
    const readableFontInput = toolbar.querySelector('[data-a11y="readable-font"]');
    const vlibrasInput = toolbar.querySelector('[data-a11y="vlibras"]');
    const resetBtn = toolbar.querySelector('[data-a11y="reset"]');
    const setExpanded = (value) => toolbar.setAttribute('aria-expanded', value ? 'true' : 'false');
    tab.addEventListener('click', () => setExpanded(toolbar.getAttribute('aria-expanded') !== 'true'));
    toolbar.addEventListener('mouseenter', () => setExpanded(true));
    toolbar.addEventListener('mouseleave', () => setExpanded(false));
    toolbar.addEventListener('focusin', () => setExpanded(true));
    function persist() {
      localStorage.setItem('oc_a11y_contrast', String(contrastInput.checked));
      localStorage.setItem('oc_a11y_motion', String(motionInput.checked));
      localStorage.setItem('oc_a11y_large_text', String(largeTextInput.checked));
      localStorage.setItem('oc_a11y_readable_font', String(readableFontInput.checked));
      localStorage.setItem('oc_a11y_vlibras', String(vlibrasInput.checked));
    }
    function apply() {
      document.body.classList.toggle('a11y-high-contrast', contrastInput.checked);
      document.body.classList.toggle('a11y-reduce-motion', motionInput.checked);
      document.body.classList.toggle('a11y-large-text', largeTextInput.checked);
      document.body.classList.toggle('a11y-readable-font', readableFontInput.checked);
      document.body.classList.toggle('a11y-vlibras-enabled', vlibrasInput.checked);
      if (vlibrasInput.checked) ensureVLibras();
      persist();
    }
    contrastInput.checked = localStorage.getItem('oc_a11y_contrast') === 'true';
    motionInput.checked = localStorage.getItem('oc_a11y_motion') === 'true';
    largeTextInput.checked = localStorage.getItem('oc_a11y_large_text') === 'true';
    readableFontInput.checked = localStorage.getItem('oc_a11y_readable_font') === 'true';
    vlibrasInput.checked = localStorage.getItem('oc_a11y_vlibras') === 'true';
    apply();
    [contrastInput, motionInput, largeTextInput, readableFontInput, vlibrasInput].forEach((input) => input.addEventListener('change', apply));
    resetBtn.addEventListener('click', function () {
      contrastInput.checked = false; motionInput.checked = false; largeTextInput.checked = false; readableFontInput.checked = false; vlibrasInput.checked = false; apply();
    });
  }

  onReady(function () {
    ensureGlobalStyles();
    document.body.classList.add('oc-fade-in');
    setupRevealAnimations();
    ensureA11yToolbar();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
})();
