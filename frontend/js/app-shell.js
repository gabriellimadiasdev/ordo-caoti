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
    toolbar.setAttribute('role', 'region');
    toolbar.setAttribute('aria-label', 'Ferramentas de acessibilidade');
    toolbar.innerHTML = [
      '<div class="a11y-toolbar__top">',
      '<button type="button" class="a11y-toolbar__drag" aria-label="Arrastar acessibilidade" title="Arraste para mover">Mover</button>',
      '<button type="button" class="a11y-toolbar__tab" aria-label="Abrir ferramentas de acessibilidade">Acessibilidade</button>',
      '<button type="button" class="a11y-toolbar__close" aria-label="Ocultar acessibilidade" title="Ocultar">×</button>',
      '</div>',
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

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'a11y-restore';
    restore.textContent = 'Acessibilidade';
    restore.setAttribute('aria-label', 'Mostrar acessibilidade');
    document.body.append(restore, toolbar);

    const tab = toolbar.querySelector('.a11y-toolbar__tab');
    const drag = toolbar.querySelector('.a11y-toolbar__drag');
    const close = toolbar.querySelector('.a11y-toolbar__close');
    const contrastInput = toolbar.querySelector('[data-a11y="contrast"]');
    const motionInput = toolbar.querySelector('[data-a11y="motion"]');
    const largeTextInput = toolbar.querySelector('[data-a11y="large-text"]');
    const readableFontInput = toolbar.querySelector('[data-a11y="readable-font"]');
    const vlibrasInput = toolbar.querySelector('[data-a11y="vlibras"]');
    const resetBtn = toolbar.querySelector('[data-a11y="reset"]');
    const setExpanded = (value) => toolbar.setAttribute('aria-expanded', value ? 'true' : 'false');
    const savedPosition = JSON.parse(localStorage.getItem('oc_a11y_position') || 'null');

    function clampPosition(left, top) {
      return {
        left: Math.max(0, Math.min(left, Math.max(0, window.innerWidth - toolbar.offsetWidth))),
        top: Math.max(0, Math.min(top, Math.max(0, window.innerHeight - toolbar.offsetHeight)))
      };
    }
    function place(position) {
      if (!position) return;
      const next = clampPosition(position.left, position.top);
      toolbar.style.left = `${next.left}px`;
      toolbar.style.top = `${next.top}px`;
      toolbar.style.right = 'auto';
      toolbar.style.bottom = 'auto';
      toolbar.dataset.dragged = 'true';
    }
    if (savedPosition) requestAnimationFrame(() => place(savedPosition));

    tab.addEventListener('click', () => setExpanded(toolbar.getAttribute('aria-expanded') !== 'true'));
    close.addEventListener('click', () => {
      toolbar.hidden = true;
      restore.hidden = false;
      localStorage.setItem('oc_a11y_hidden', 'true');
    });
    restore.addEventListener('click', () => {
      toolbar.hidden = false;
      restore.hidden = true;
      setExpanded(true);
      localStorage.removeItem('oc_a11y_hidden');
    });
    if (localStorage.getItem('oc_a11y_hidden') === 'true') {
      toolbar.hidden = true;
      restore.hidden = false;
    }

    let pointer = null;
    drag.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const rect = toolbar.getBoundingClientRect();
      pointer = { id: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      drag.setPointerCapture(event.pointerId);
      toolbar.classList.add('is-dragging');
    });
    drag.addEventListener('pointermove', (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      place({ left: event.clientX - pointer.offsetX, top: event.clientY - pointer.offsetY });
    });
    const finishDrag = (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const rect = toolbar.getBoundingClientRect();
      localStorage.setItem('oc_a11y_position', JSON.stringify({ left: rect.left, top: rect.top }));
      pointer = null;
      toolbar.classList.remove('is-dragging');
    };
    drag.addEventListener('pointerup', finishDrag);
    drag.addEventListener('pointercancel', finishDrag);
    window.addEventListener('resize', () => {
      if (toolbar.dataset.dragged === 'true') {
        const rect = toolbar.getBoundingClientRect();
        place({ left: rect.left, top: rect.top });
      }
    });

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
    resetBtn.addEventListener('click', () => {
      contrastInput.checked = false; motionInput.checked = false; largeTextInput.checked = false; readableFontInput.checked = false; vlibrasInput.checked = false;
      localStorage.removeItem('oc_a11y_position');
      toolbar.style.left = ''; toolbar.style.top = ''; toolbar.style.right = ''; toolbar.style.bottom = ''; delete toolbar.dataset.dragged;
      apply();
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
