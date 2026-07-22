(() => {
  'use strict';

  const profileLabels = {
    cliente: 'Cliente',
    neofito: 'Neófito',
    mago_n1: 'Mago Iniciado',
    mago_n2: 'Mago Elevado',
    mago_n3: 'Mago Soberano',
    mestre_fundador: 'Mestre',
    lojista: 'Lojista',
    professor: 'Professor',
    admin: 'Admin',
    ti: 'T.I.',
    mentor: 'Mentor',
  };

  function apiUrl(path) {
    if (!path) return '/';
    if (/^https?:\/\//i.test(path)) return path;
    return path.startsWith('/') ? path : `/${path}`;
  }

  function appRoute(route, file) {
    if (route && route.startsWith('/')) return route;
    return file ? `/frontend/html/${file}` : '/';
  }

  function bindAppRoutes(root = document) {
    root.querySelectorAll('[data-app-route]').forEach((node) => {
      const route = node.getAttribute('data-app-route');
      if (route) node.setAttribute('href', route);
    });
  }

  function getToken() {
    const expiresAt = Number(localStorage.getItem('oc_session_expires_at') || 0);
    if (expiresAt && Date.now() >= expiresAt) {
      clearSession();
      return '';
    }
    return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  }

  function saveSession(token, user, expiresAt, persistent = true) {
    if (persistent) {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user || {}));
      if (expiresAt) localStorage.setItem('oc_session_expires_at', new Date(expiresAt).getTime().toString());
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
    } else {
      sessionStorage.setItem('token', token);
      sessionStorage.setItem('user', JSON.stringify(user || {}));
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('oc_session_expires_at');
    }
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }

  function setUser(user) {
    if (localStorage.getItem('token')) localStorage.setItem('user', JSON.stringify(user));
    if (sessionStorage.getItem('token')) sessionStorage.setItem('user', JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('oc_session_expires_at');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    document.cookie = 'oc_session=; Max-Age=0; path=/';
  }

  async function apiFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = getToken();
    if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(apiUrl(path), { ...options, headers });
    return response;
  }

  function profilesFromUser(user) {
    const list = Array.isArray(user?.perfis_disponiveis) ? user.perfis_disponiveis : [];
    if (list.length) {
      const seen = new Set();
      return list.filter((profile) => profile?.id && profileLabels[profile.id] && !seen.has(profile.id) && seen.add(profile.id));
    }
    const ids = Array.isArray(user?.roles) ? user.roles : [user?.perfil_login, user?.tipo, user?.tipo_usuario, user?.nivel_codigo];
    return [...new Set(ids.filter((id) => profileLabels[id]))].map((id) => ({ id, label: profileLabels[id], home_route: user?.home_route || '/dashboard' }));
  }

  async function switchProfile(profileId) {
    const response = await apiFetch('/perfil/trocar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ perfil_login: profileId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.erro || 'Falha ao trocar perfil.');
    setUser(data.user);
    return data.user;
  }

  function enforcePasswordChange() {
    const token = getToken();
    const user = getUser();
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    const allowed = ['/alterar-senha', '/primeiro-acesso', '/dados-primeiro-acesso', '/login', '/login-ti', '/login/ti'];
    if (token && user?.must_change_password && !allowed.includes(path)) {
      window.location.href = '/alterar-senha';
      return;
    }
    if (token && user?.must_complete_profile && !allowed.includes(path)) {
      window.location.href = '/dados-primeiro-acesso';
    }
  }

  async function auditPageView() {
    try {
      if (!getToken()) return;
      await apiFetch('/api/auditoria/movimento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: window.location.pathname, title: document.title })
      });
    } catch (_) {}
  }

  async function renderDashboardAgenda() {
    try {
      const token = getToken();
      if (!token || !/dashboard/i.test(window.location.pathname) || document.getElementById('oc-dashboard-agenda')) return;
      const response = await apiFetch('/agenda/eventos');
      const data = await response.json().catch(() => ({}));
      const events = Array.isArray(data.eventos) ? data.eventos.slice(0, 3) : [];
      const box = document.createElement('section');
      box.id = 'oc-dashboard-agenda';
      box.className = 'oc-dashboard-agenda';
      box.innerHTML = `<h2>Agenda Ordo Caoti</h2>${events.map((event) => `<article><strong>${event.titulo || 'Evento'}</strong><br><span>${event.inicio_em ? new Date(event.inicio_em).toLocaleString('pt-BR') : '-'}</span><br>${event.localizacao ? `<a href="${event.localizacao}">Abrir link/local</a>` : ''}</article>`).join('') || '<p>Sem eventos próximos.</p>'}<a href="/agenda">Ver agenda completa</a>`;
      document.body.prepend(box);
    } catch (_) {}
  }

  function renderGlobalQuickLinks() {
    const token = getToken();
    if (!token || document.getElementById('oc-quick-links')) return;
    const nav = document.createElement('nav');
    nav.id = 'oc-quick-links';
    nav.className = 'oc-quick-links';
    nav.innerHTML = [
      '<a href="/agenda">Agenda</a>',
      '<a href="/cadernos">Cadernos</a>',
      '<a href="/assistente-aulas">Criar aula</a>',
      '<a href="/gestao-academica">Gestão acadêmica</a>',
      '<a href="/aulas">Aulas</a>',
      '<a href="/chat-alunos">Chat alunos</a>',
      '<a href="/chat-loja">Chat loja</a>',
      '<a href="/grimorio-publico">Grimório público</a>',
      '<a href="/arquivos">Arquivos</a>',
      '<a href="/dados-primeiro-acesso">Meus dados</a>',
      '<a href="/cliente/resolucao">Pós-venda</a>',
      '<a href="/login/loja/cliente">Login cliente</a>',
      '<a href="/login/loja/lojista">Login lojista</a>'
    ].join('');
    document.body.appendChild(nav);
  }

  async function logout() {
    try { await apiFetch('/logout', { method: 'POST' }); } catch (_) {}
    clearSession();
    window.location.href = '/login';
  }

  function renderProfileSwitcher() {
    const token = getToken();
    const user = getUser();
    const profiles = profilesFromUser(user);
    if (!token || document.getElementById('oc-session-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'oc-session-bar';
    bar.className = 'oc-session-bar';
    const name = document.createElement('span');
    name.className = 'oc-session-bar__name';
    name.textContent = user?.nome || 'Minha conta';
    bar.appendChild(name);

    if (profiles.length > 1) {
      const select = document.createElement('select');
      select.id = 'oc-profile-select';
      select.setAttribute('aria-label', 'Trocar perfil');
      const active = user?.perfil_login || user?.perfil_ativo?.id || user?.tipo || user?.tipo_usuario;
      for (const profile of profiles) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.label || profileLabels[profile.id];
        option.selected = profile.id === active;
        select.appendChild(option);
      }
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          const nextUser = await switchProfile(select.value);
          window.location.href = nextUser.home_route || window.location.pathname;
        } catch (error) {
          alert(error.message);
          select.disabled = false;
        }
      });
      bar.appendChild(select);
    }

    const exit = document.createElement('button');
    exit.type = 'button';
    exit.className = 'oc-session-bar__logout';
    exit.textContent = 'Sair';
    exit.addEventListener('click', logout);
    bar.appendChild(exit);
    document.body.appendChild(bar);
  }


  async function checkSiteVersion() {
    try {
      const response = await fetch('/api/site-version', { cache: 'no-store' });
      const data = await response.json();
      if (!data?.version) return;
      const key = 'oc_site_version';
      const previous = sessionStorage.getItem(key);
      sessionStorage.setItem(key, data.version);
      if (previous && previous !== data.version) {
        window.location.reload();
      }
    } catch (_) {}
  }

  window.ordoRuntime = {
    apiUrl,
    appRoute,
    bindAppRoutes,
    getToken,
    getUser,
    setUser,
    clearSession,
    saveSession,
    logout,
    apiFetch,
    switchProfile,
    renderProfileSwitcher,
    renderGlobalQuickLinks,
    renderDashboardAgenda,
    enforcePasswordChange,
    auditPageView,
    checkSiteVersion,
    isBackendRouteMode: () => true,
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindAppRoutes();
    enforcePasswordChange();
    renderGlobalQuickLinks();
    renderDashboardAgenda();
    renderProfileSwitcher();
    auditPageView();
    checkSiteVersion();
    setInterval(checkSiteVersion, 60000);
  });
})();
