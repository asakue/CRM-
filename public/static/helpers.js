/* ==========================================================================
   Hospital CRM — client core: API client, UI helpers, formatters, state.
   Exposed on window.CRM so views.js / app.js can share it.
   ========================================================================== */
(function () {
  'use strict';

  const CRM = (window.CRM = {});

  // --- State --------------------------------------------------------------
  CRM.state = {
    user: null,
    csrfToken: '',
    roleLabel: '',
    route: 'dashboard',
    params: {},
    departments: [],
  };

  CRM.roleLabels = {
    patient: 'Пациент',
    doctor: 'Врач',
    head: 'Зав. отделением',
    chief: 'Главный врач',
    admin: 'Администратор',
  };

  // --- API client ---------------------------------------------------------
  function csrfFromCookie() {
    const m = document.cookie.match(/(?:^|;\s*)hosp_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  CRM.api = {
    async request(method, url, body) {
      const headers = { 'Content-Type': 'application/json' };
      const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
      if (mutating) {
        headers['X-CSRF-Token'] = CRM.state.csrfToken || csrfFromCookie();
      }
      const res = await fetch(url, {
        method,
        headers,
        credentials: 'same-origin',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      let json = null;
      try {
        json = await res.json();
      } catch (e) {
        json = { success: false, error: 'parse', message: 'Некорректный ответ сервера' };
      }
      if (!res.ok || json.success === false) {
        const err = new Error(json.message || 'Ошибка запроса');
        err.status = res.status;
        err.code = json.error;
        throw err;
      }
      return json.data;
    },
    get(url) {
      return this.request('GET', url);
    },
    post(url, body) {
      return this.request('POST', url, body);
    },
    put(url, body) {
      return this.request('PUT', url, body);
    },
    patch(url, body) {
      return this.request('PATCH', url, body);
    },
    del(url) {
      return this.request('DELETE', url);
    },
  };

  // --- Permissions --------------------------------------------------------
  CRM.can = function (perm) {
    const u = CRM.state.user;
    if (!u) return false;
    if (Array.isArray(perm)) return perm.some((p) => u.permissions.includes(p));
    return u.permissions.includes(perm);
  };

  CRM.isRole = function (...roles) {
    return CRM.state.user && roles.includes(CRM.state.user.role);
  };

  // --- Formatting ---------------------------------------------------------
  CRM.esc = function (s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  CRM.fmtDate = function (v, withTime) {
    if (!v) return '—';
    const d = new Date(v.includes && v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return CRM.esc(v);
    const opts = withTime
      ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: '2-digit', year: 'numeric' };
    return d.toLocaleString('ru-RU', opts);
  };

  CRM.fmtDateShort = function (v) {
    if (!v) return '—';
    const d = new Date(v.includes && v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return CRM.esc(v);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
  };

  CRM.statusBadge = function (status) {
    const map = {
      scheduled: ['Запланирован', 'bg-blue-100 text-blue-700'],
      confirmed: ['Подтверждён', 'bg-indigo-100 text-indigo-700'],
      completed: ['Завершён', 'bg-green-100 text-green-700'],
      cancelled: ['Отменён', 'bg-slate-200 text-slate-600'],
      no_show: ['Неявка', 'bg-red-100 text-red-700'],
      active: ['Активен', 'bg-green-100 text-green-700'],
      archived: ['В архиве', 'bg-slate-200 text-slate-600'],
      disabled: ['Отключён', 'bg-red-100 text-red-700'],
      locked: ['Заблокирован', 'bg-amber-100 text-amber-700'],
      ordered: ['Назначен', 'bg-blue-100 text-blue-700'],
      in_progress: ['В работе', 'bg-amber-100 text-amber-700'],
      normal: ['Норма', 'bg-green-100 text-green-700'],
      low: ['Понижен', 'bg-amber-100 text-amber-700'],
      high: ['Повышен', 'bg-red-100 text-red-700'],
      abnormal: ['Отклонение', 'bg-red-100 text-red-700'],
    };
    const [label, cls] = map[status] || [status || '—', 'bg-slate-200 text-slate-600'];
    return `<span class="badge ${cls}">${CRM.esc(label)}</span>`;
  };

  CRM.flagBadge = function (flag) {
    return CRM.statusBadge(flag || 'unknown');
  };

  // --- Toast --------------------------------------------------------------
  CRM.toast = function (message, type) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  };

  // --- Modal --------------------------------------------------------------
  CRM.modal = {
    open({ title, body, footer, wide }) {
      CRM.modal.close();
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.id = 'crm-modal';
      backdrop.innerHTML = `
        <div class="modal-panel ${wide ? 'max-w-4xl' : ''}">
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200">
            <h3 class="text-lg font-semibold text-slate-800">${CRM.esc(title || '')}</h3>
            <button class="text-slate-400 hover:text-slate-700" id="crm-modal-close">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="p-5" id="crm-modal-body">${body || ''}</div>
          ${footer ? `<div class="px-5 py-4 border-t border-slate-200 flex justify-end gap-2">${footer}</div>` : ''}
        </div>`;
      document.body.appendChild(backdrop);
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) CRM.modal.close();
      });
      backdrop.querySelector('#crm-modal-close').addEventListener('click', CRM.modal.close);
      return backdrop;
    },
    close() {
      const el = document.getElementById('crm-modal');
      if (el) el.remove();
    },
  };

  // --- Form helper --------------------------------------------------------
  CRM.form = function (formEl) {
    const data = {};
    new FormData(formEl).forEach((v, k) => {
      data[k] = v;
    });
    return data;
  };

  CRM.field = function (name, label, opts) {
    opts = opts || {};
    const type = opts.type || 'text';
    const req = opts.required ? 'required' : '';
    const val = opts.value != null ? `value="${CRM.esc(opts.value)}"` : '';
    if (type === 'textarea') {
      return `<div class="mb-3">
        <label class="field-label">${CRM.esc(label)}${opts.required ? ' *' : ''}</label>
        <textarea name="${name}" rows="${opts.rows || 3}" class="field-input" ${req}>${CRM.esc(opts.value || '')}</textarea>
      </div>`;
    }
    if (type === 'select') {
      const options = (opts.options || [])
        .map((o) => {
          const sel = String(o.value) === String(opts.value) ? 'selected' : '';
          return `<option value="${CRM.esc(o.value)}" ${sel}>${CRM.esc(o.label)}</option>`;
        })
        .join('');
      return `<div class="mb-3">
        <label class="field-label">${CRM.esc(label)}${opts.required ? ' *' : ''}</label>
        <select name="${name}" class="field-input" ${req}>${options}</select>
      </div>`;
    }
    return `<div class="mb-3">
      <label class="field-label">${CRM.esc(label)}${opts.required ? ' *' : ''}</label>
      <input type="${type}" name="${name}" class="field-input" ${val} ${req} ${opts.step ? `step="${opts.step}"` : ''} ${opts.placeholder ? `placeholder="${CRM.esc(opts.placeholder)}"` : ''} />
    </div>`;
  };

  CRM.emptyState = function (text) {
    return `<div class="text-center py-12 text-slate-400">
      <i class="fas fa-inbox text-4xl mb-3"></i>
      <p>${CRM.esc(text || 'Нет данных')}</p>
    </div>`;
  };

  CRM.loading = function () {
    return `<div class="spinner"></div>`;
  };
})();
