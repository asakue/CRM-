/* ==========================================================================
   Hospital CRM — application shell: auth bootstrap, router, sidebar.
   ========================================================================== */
(function () {
  'use strict';
  const CRM = window.CRM;
  const views = CRM.views;
  const esc = CRM.esc;

  const root = document.getElementById('app');

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------
  CRM.go = function (route, params) {
    CRM.state.route = route;
    CRM.state.params = params || {};
    if (location.hash.slice(1) !== route) {
      history.pushState({ route, params: CRM.state.params }, '', '#' + route);
    }
    renderRoute();
  };

  window.addEventListener('popstate', () => {
    const route = location.hash.slice(1) || 'dashboard';
    CRM.state.route = route;
    CRM.state.params = {};
    renderRoute();
  });

  CRM.rerender = function () {
    renderRoute();
  };

  // Keep URL params simple: #route (params only in memory, except patient/analysis ids)
  function parseHash() {
    const raw = location.hash.slice(1);
    if (!raw) return { route: 'dashboard', params: {} };
    const [route, query] = raw.split('?');
    const params = {};
    if (query) {
      query.split('&').forEach((kv) => {
        const [k, v] = kv.split('=');
        if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }
    return { route, params };
  }

  // -------------------------------------------------------------------------
  // Auth bootstrap
  // -------------------------------------------------------------------------
  async function bootstrap() {
    if (!CRM.state.user) {
      try {
        const me = await CRM.api.get('/api/auth/me');
        CRM.state.user = me.user;
        CRM.state.csrfToken = me.csrfToken;
        CRM.state.roleLabel = me.roleLabel;
      } catch (e) {
        CRM.state.user = null;
      }
    }
    if (!CRM.state.user) {
      renderLogin();
      return;
    }
    const { route, params } = parseHash();
    CRM.state.route = route || 'dashboard';
    CRM.state.params = params;
    renderRoute();
  }

  // -------------------------------------------------------------------------
  // Login screen
  // -------------------------------------------------------------------------
  function renderLogin() {
    root.innerHTML = views.login();
    const form = document.getElementById('login-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('login-btn');
      const errBox = document.getElementById('login-error');
      errBox.classList.add('hidden');
      btn.disabled = true;
      try {
        const data = await CRM.api.post('/api/auth/login', {
          username: document.getElementById('login-username').value,
          password: document.getElementById('login-password').value,
        });
        CRM.state.user = data.user;
        CRM.state.csrfToken = data.csrfToken;
        CRM.state.roleLabel = data.roleLabel;
        CRM.toast('Добро пожаловать, ' + (data.user.full_name || data.user.username), 'success');
        CRM.go('dashboard');
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
      } finally {
        btn.disabled = false;
      }
    });
    document.querySelectorAll('.demo-login').forEach((b) => {
      b.addEventListener('click', () => {
        document.getElementById('login-username').value = b.dataset.u;
        document.getElementById('login-password').value = b.dataset.p;
        form.dispatchEvent(new Event('submit'));
      });
    });
  }

  // -------------------------------------------------------------------------
  // Main layout
  // -------------------------------------------------------------------------
  function renderRoute() {
    const route = CRM.state.route;
    renderLayout(route);
    const content = document.getElementById('page-content');
    const fn = views[route];
    if (!fn) {
      content.innerHTML = `<div class="stat-card">${CRM.emptyState('Раздел не найден')}</div>`;
      return;
    }
    content.innerHTML = fn(CRM.state.params) || '';
    const binder = views['bind' + route.charAt(0).toUpperCase() + route.slice(1)];
    if (binder) binder(CRM.state.params);
  }

  function renderLayout(activeRoute) {
    const u = CRM.state.user;
    const nav = CRM.navFor(u.role);
    const items = nav
      .map((n) => {
        let label = n.label;
        if (n.id === 'patients' && u.role === 'patient') label = n.selfLabel || 'Моя карта';
        return `<button class="sidebar-link ${activeRoute === n.id ? 'active' : ''}" data-nav="${n.id}">
          <i class="fas ${n.icon}"></i> <span>${esc(label)}</span></button>`;
      })
      .join('');

    root.innerHTML = `
      <div class="flex min-h-screen">
        <aside id="sidebar" class="w-64 bg-slate-900 flex-shrink-0 hidden md:flex flex-col">
          <div class="px-4 py-5 flex items-center gap-3 border-b border-slate-800">
            <div class="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white text-lg"><i class="fas fa-hospital"></i></div>
            <div>
              <div class="text-white font-semibold leading-tight">МедCRM</div>
              <div class="text-xs text-slate-400">Больница</div>
            </div>
          </div>
          <nav class="flex-1 p-3 space-y-1 overflow-y-auto">${items}</nav>
          <div class="p-3 border-t border-slate-800">
            <div class="px-3 py-2 text-xs text-slate-400">
              <div class="text-slate-200 font-medium truncate">${esc(u.full_name || u.username)}</div>
              <div>${esc(CRM.roleLabels[u.role] || u.role)}</div>
            </div>
            <button class="sidebar-link" id="btn-logout"><i class="fas fa-right-from-bracket"></i> <span>Выйти</span></button>
          </div>
        </aside>

        <div class="flex-1 flex flex-col min-w-0">
          <header class="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
            <div class="flex items-center gap-3">
              <button id="menu-toggle" class="md:hidden text-slate-600 text-xl"><i class="fas fa-bars"></i></button>
              <h1 class="text-base font-semibold text-slate-700">${esc(CRM.roleLabels[u.role] || '')}</h1>
            </div>
            <div class="flex items-center gap-3">
              <span class="hidden sm:inline text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full"><i class="fas fa-lock"></i> Защищённое соединение</span>
              <div class="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold">
                ${esc((u.full_name || u.username || '?').charAt(0).toUpperCase())}
              </div>
            </div>
          </header>
          <main id="page-content" class="flex-1 p-4 sm:p-6 overflow-y-auto"></main>
          <footer class="px-6 py-3 text-center text-xs text-slate-400 border-t border-slate-200">
            Медицинская CRM · AES-256-GCM · PBKDF2 · журнал аудита
          </footer>
        </div>
      </div>`;

    document.querySelectorAll('[data-nav]').forEach((b) => {
      b.addEventListener('click', () => {
        CRM.go(b.dataset.nav);
        const sb = document.getElementById('sidebar');
        if (sb) sb.classList.add('hidden');
      });
    });
    document.getElementById('btn-logout').addEventListener('click', async () => {
      try { await CRM.api.post('/api/auth/logout'); } catch (e) { /* ignore */ }
      location.href = '/';
    });
    const mt = document.getElementById('menu-toggle');
    if (mt) {
      mt.addEventListener('click', () => {
        const sb = document.getElementById('sidebar');
        sb.classList.toggle('hidden');
        sb.classList.toggle('flex');
      });
    }
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
