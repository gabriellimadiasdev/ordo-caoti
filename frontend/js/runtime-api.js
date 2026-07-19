(() => {
  'use strict';

  const profileLabels = {
    cliente: 'Cliente',
    neofito: 'Neófito',
    mago_n1: 'Mago Iniciado',
    mago_n2: 'Mago Elevado',
    sabio: 'Sábio / Soberano',
    mestre_fundador: 'Mestre',
    lojista: 'Lojista',
    professor: 'Professor',
    admin: 'Admin',
    ti: 'T.I.',
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
    return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
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
    if (list.length) return list;
    const ids = Array.isArray(user?.roles) ? user.roles : [user?.perfil_login, user?.tipo, user?.tipo_usuario, user?.nivel_codigo];
    return [...new Set(ids.filter(Boolean))].map((id) => ({ id, label: profileLabels[id] || id, home_route: user?.home_route || '/dashboard' }));
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

  function renderProfileSwitcher() {
    const token = getToken();
    const user = getUser();
    const profiles = profilesFromUser(user);
    if (!token || profiles.length < 2 || document.getElementById('oc-profile-switcher')) return;

    const wrap = document.createElement('div');
    wrap.id = 'oc-profile-switcher';
    wrap.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;background:#101827;color:#eef2ff;border:1px solid #334155;border-radius:12px;padding:10px;box-shadow:0 12px 30px rgba(0,0,0,.35);font:14px system-ui;max-width:260px';
    const label = document.createElement('label');
    label.textContent = 'Cargo ativo';
    label.style.cssText = 'display:block;margin-bottom:6px;color:#facc15;font-weight:700';
    const select = document.createElement('select');
    select.style.cssText = 'width:100%;background:#0f172a;color:#eef2ff;border:1px solid #475569;border-radius:8px;padding:7px';
    const active = user?.perfil_login || user?.perfil_ativo?.id || user?.tipo || user?.tipo_usuario;
    for (const profile of profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.label || profileLabels[profile.id] || profile.id;
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
    wrap.append(label, select);
    document.body.appendChild(wrap);
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
    apiFetch,
    switchProfile,
    renderProfileSwitcher,
    checkSiteVersion,
    isBackendRouteMode: () => true,
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindAppRoutes();
    renderProfileSwitcher();
    checkSiteVersion();
    setInterval(checkSiteVersion, 60000);
  });
})();
