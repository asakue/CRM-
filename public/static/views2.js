/* ==========================================================================
   Hospital CRM — views part 2: prescriptions, doctors, departments,
   statistics, administration, profile.
   ========================================================================== */
(function () {
  'use strict';
  const CRM = window.CRM;
  const views = CRM.views;
  const esc = CRM.esc;

  // =========================================================================
  // Prescriptions
  // =========================================================================
  views.prescriptions = function () {
    return `<div id="rx-content">${CRM.loading()}</div>`;
  };

  views.bindPrescriptions = async function () {
    const el = document.getElementById('rx-content');
    const canCreate = CRM.can('prescriptions.create');
    el.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Назначения</h2>
        ${canCreate ? `<button class="btn btn-primary" id="rx-add"><i class="fas fa-plus"></i> Выписать</button>` : ''}
      </div>
      <div class="stat-card !p-0 overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>Препарат</th><th>Дозировка</th><th>Пациент</th><th>Врач</th><th>Выписано</th><th>Статус</th></tr></thead>
          <tbody id="rx-rows"><tr><td colspan="6">${CRM.loading()}</td></tr></tbody>
        </table>
      </div>`;

    const load = async () => {
      try {
        const d = await CRM.api.get('/api/prescriptions?per_page=50');
        const rows = document.getElementById('rx-rows');
        if (!d.items.length) { rows.innerHTML = `<tr><td colspan="6">${CRM.emptyState('Назначений нет')}</td></tr>`; return; }
        rows.innerHTML = d.items
          .map(
            (r) => `<tr>
              <td class="font-medium">${esc(r.medication)}<span class="enc-badge">AES-256</span></td>
              <td>${esc(r.dosage) || '—'}</td>
              <td>${esc(r.patient_name)}</td>
              <td>${esc(r.doctor_name)}</td>
              <td>${CRM.fmtDate(r.issued_at)}</td>
              <td>${CRM.statusBadge(r.status)}</td>
            </tr>`
          )
          .join('');
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
    const addBtn = document.getElementById('rx-add');
    if (addBtn) addBtn.onclick = prescriptionForm;
    load();
  };

  async function prescriptionForm() {
    let patientsOpts = [];
    try {
      if (CRM.state.user.role === 'patient') patientsOpts = [{ value: CRM.state.user.patient_id, label: 'Себя' }];
      else {
        const pd = await CRM.api.get('/api/patients?per_page=100');
        patientsOpts = pd.items.map((p) => ({ value: p.id, label: `${p.full_name} (${p.patient_no})` }));
      }
    } catch (e) { CRM.toast(e.message, 'error'); }
    const body = `<form id="rx-form">
      ${CRM.field('patient_id', 'Пациент', { type: 'select', required: true, options: [{ value: '', label: '— выберите —' }].concat(patientsOpts) })}
      ${CRM.field('medication', 'Препарат', { required: true })}
      ${CRM.field('dosage', 'Дозировка', { placeholder: 'напр. 5 мг 1 раз в сутки' })}
      ${CRM.field('instructions', 'Инструкции', { type: 'textarea', rows: 2 })}
      ${CRM.field('expires_at', 'Действует до', { type: 'date' })}
    </form>`;
    const footer = `<button class="btn btn-secondary" id="rx-cancel">Отмена</button>
      <button class="btn btn-primary" id="rx-save"><i class="fas fa-save"></i> Выписать</button>`;
    CRM.modal.open({ title: 'Назначение', body, footer, wide: true });
    document.getElementById('rx-cancel').onclick = CRM.modal.close;
    document.getElementById('rx-save').onclick = async () => {
      const data = CRM.form(document.getElementById('rx-form'));
      try {
        await CRM.api.post('/api/prescriptions', data);
        CRM.toast('Назначение выписано', 'success');
        CRM.modal.close();
        CRM.rerender();
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
  }

  // =========================================================================
  // Doctors
  // =========================================================================
  views.doctors = function () {
    return `<div id="doc-content">${CRM.loading()}</div>`;
  };

  views.bindDoctors = async function () {
    const el = document.getElementById('doc-content');
    try {
      const d = await CRM.api.get('/api/doctors?per_page=100');
      el.innerHTML = `
        <h2 class="text-lg font-semibold mb-4">Врачи клиники</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${d.items.map((doc) => `
            <div class="stat-card">
              <div class="flex items-center gap-3">
                <div class="w-11 h-11 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-lg"><i class="fas fa-user-doctor"></i></div>
                <div>
                  <div class="font-semibold">${esc(doc.full_name)}</div>
                  <div class="text-xs text-slate-500">${esc(doc.specialty) || '—'}</div>
                </div>
              </div>
              <div class="mt-3 text-sm text-slate-600 space-y-1">
                <div><i class="fas fa-building text-slate-400 w-4"></i> ${esc(doc.department_name) || '—'}</div>
                <div><i class="fas fa-door-open text-slate-400 w-4"></i> Каб. ${esc(doc.room) || '—'}</div>
                <div><i class="fas fa-phone text-slate-400 w-4"></i> ${esc(doc.cabinet_phone) || '—'}</div>
                ${doc.category ? `<div><i class="fas fa-award text-slate-400 w-4"></i> ${esc(doc.category)} категория</div>` : ''}
              </div>
            </div>`).join('')}
        </div>`;
    } catch (e) {
      el.innerHTML = `<div class="stat-card text-red-600">${esc(e.message)}</div>`;
    }
  };

  // =========================================================================
  // Departments
  // =========================================================================
  views.departments = function () {
    return `<div id="dep-content">${CRM.loading()}</div>`;
  };

  views.bindDepartments = async function () {
    const el = document.getElementById('dep-content');
    try {
      const d = await CRM.api.get('/api/departments');
      el.innerHTML = `
        <h2 class="text-lg font-semibold mb-4">Отделения</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${d.items.map((dep) => `
            <div class="stat-card">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="font-semibold text-slate-800">${esc(dep.name)}</h3>
                  <p class="text-xs text-slate-400 font-mono">${esc(dep.code)}</p>
                </div>
                <span class="badge bg-blue-100 text-blue-700">${dep.doctors_count} врач.</span>
              </div>
              <p class="text-sm text-slate-500 mt-2">${esc(dep.description) || ''}</p>
              <div class="mt-3 text-sm text-slate-600 space-y-1">
                <div><i class="fas fa-user-tie text-slate-400 w-4"></i> Зав.: ${esc(dep.head_name) || '—'}</div>
                <div><i class="fas fa-location-dot text-slate-400 w-4"></i> ${esc(dep.location) || '—'}</div>
                <div><i class="fas fa-phone text-slate-400 w-4"></i> ${esc(dep.phone) || '—'}</div>
                <div><i class="fas fa-calendar-check text-slate-400 w-4"></i> Записей всего: ${dep.appointments_count}</div>
              </div>
            </div>`).join('')}
        </div>`;
    } catch (e) {
      el.innerHTML = `<div class="stat-card text-red-600">${esc(e.message)}</div>`;
    }
  };

  // =========================================================================
  // Statistics
  // =========================================================================
  views.stats = function () {
    const canDoc = CRM.can('stats.doctors.all', 'stats.doctors.department');
    const canPat = CRM.can('stats.patients.all', 'stats.patients.department');
    return `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 class="text-lg font-semibold">Статистика</h2>
        <select id="stats-range" class="field-input !w-40">
          <option value="7d">7 дней</option>
          <option value="30d" selected>30 дней</option>
          <option value="90d">90 дней</option>
          <option value="365d">Год</option>
        </select>
      </div>
      ${canPat ? `<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="stat-card"><h3 class="font-semibold mb-3">Визиты по дням</h3><canvas id="chart-visits" height="160"></canvas></div>
        <div class="stat-card"><h3 class="font-semibold mb-3">Топ диагнозов (МКБ)</h3><canvas id="chart-diagnoses" height="160"></canvas></div>
        <div class="stat-card"><h3 class="font-semibold mb-3">Пол пациентов</h3><canvas id="chart-gender" height="160"></canvas></div>
        <div class="stat-card"><h3 class="font-semibold mb-3">Возрастные группы</h3><canvas id="chart-age" height="160"></canvas></div>
        <div class="stat-card"><h3 class="font-semibold mb-3">Результаты анализов</h3><canvas id="chart-flags" height="160"></canvas></div>
        <div class="stat-card"><h3 class="font-semibold mb-3">Активность системы</h3><canvas id="chart-activity" height="160"></canvas></div>
      </div>` : `<div class="stat-card">${CRM.emptyState('Недостаточно прав для просмотра статистики')}</div>`}
      ${canDoc ? `<div class="stat-card !p-0 overflow-x-auto mt-4">
        <div class="px-4 py-3 border-b border-slate-200"><h3 class="font-semibold">Нагрузка врачей</h3></div>
        <table class="data-table">
          <thead><tr><th>Врач</th><th>Отделение</th><th>Всего</th><th>Завершено</th><th>Неявки</th><th>Отмены</th><th>Загрузка</th></tr></thead>
          <tbody id="doc-stats-rows"><tr><td colspan="7">${CRM.loading()}</td></tr></tbody>
        </table>
      </div>` : ''}`;
  };

  views.bindStats = async function () {
    const range = () => document.getElementById('stats-range').value;
    let charts = [];

    const destroy = () => charts.forEach((ch) => ch.destroy());
    const mk = (id, cfg) => {
      const c = document.getElementById(id);
      if (c) charts.push(new Chart(c, cfg));
    };

    const load = async () => {
      destroy();
      charts = [];
      const r = range();
      if (CRM.can('stats.patients.all', 'stats.patients.department')) {
        try {
          const s = await CRM.api.get(`/api/stats/patients?range=${r}`);
          mk('chart-visits', {
            type: 'line',
            data: {
              labels: s.visitsSeries.map((x) => CRM.fmtDateShort(x.day)),
              datasets: [{ label: 'Визиты', data: s.visitsSeries.map((x) => x.n), borderColor: '#0d6efd', backgroundColor: 'rgba(13,110,253,.1)', fill: true, tension: 0.3 }],
            },
            options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
          });
          mk('chart-diagnoses', {
            type: 'bar',
            data: { labels: s.diagnoses.map((x) => x.icd_code), datasets: [{ label: 'Случаев', data: s.diagnoses.map((x) => x.n), backgroundColor: '#6366f1' }] },
            options: { indexAxis: 'y', plugins: { legend: { display: false } } },
          });
          mk('chart-gender', {
            type: 'doughnut',
            data: { labels: s.gender.map((x) => ({ male: 'Мужчины', female: 'Женщины', unknown: 'Не указан' }[x.gender] || x.gender)), datasets: [{ data: s.gender.map((x) => x.n), backgroundColor: ['#3b82f6', '#ec4899', '#cbd5e1'] }] },
          });
          mk('chart-age', {
            type: 'bar',
            data: { labels: s.ageBuckets.map((x) => x.bucket), datasets: [{ label: 'Пациентов', data: s.ageBuckets.map((x) => x.n), backgroundColor: '#10b981' }] },
            options: { plugins: { legend: { display: false } } },
          });
          mk('chart-flags', {
            type: 'pie',
            data: { labels: s.flags.map((x) => ({ normal: 'Норма', low: 'Понижен', high: 'Повышен', abnormal: 'Отклонение', unknown: 'Не оценено' }[x.flag] || x.flag)), datasets: [{ data: s.flags.map((x) => x.n), backgroundColor: ['#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#cbd5e1'] }] },
          });
        } catch (e) { CRM.toast(e.message, 'error'); }
        try {
          const a = await CRM.api.get(`/api/stats/activity?range=${r}`);
          mk('chart-activity', {
            type: 'line',
            data: { labels: a.series.map((x) => CRM.fmtDateShort(x.day)), datasets: [{ label: 'Событий', data: a.series.map((x) => x.n), borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,.1)', fill: true, tension: 0.3 }] },
            options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
          });
        } catch (e) { /* activity optional */ }
      }
      if (CRM.can('stats.doctors.all', 'stats.doctors.department')) {
        try {
          const d = await CRM.api.get(`/api/stats/doctors?range=${r}`);
          const rows = document.getElementById('doc-stats-rows');
          if (rows) {
            const max = Math.max(1, ...d.workload.map((w) => w.total || 0));
            rows.innerHTML = d.workload.length
              ? d.workload.map((w) => `<tr>
                  <td class="font-medium">${esc(w.doctor_name)}</td>
                  <td>${esc(w.department_name) || '—'}</td>
                  <td>${w.total}</td>
                  <td>${w.completed || 0}</td>
                  <td>${w.no_show || 0}</td>
                  <td>${w.cancelled || 0}</td>
                  <td>
                    <div class="w-32 bg-slate-200 rounded-full h-2">
                      <div class="bg-blue-600 h-2 rounded-full" style="width:${Math.round(((w.total || 0) / max) * 100)}%"></div>
                    </div>
                  </td>
                </tr>`).join('')
              : `<tr><td colspan="7">${CRM.emptyState()}</td></tr>`;
          }
        } catch (e) { CRM.toast(e.message, 'error'); }
      }
    };

    const sel = document.getElementById('stats-range');
    if (sel) sel.onchange = load;
    load();
  };

  // =========================================================================
  // Administration
  // =========================================================================
  views.admin = function (params) {
    const tabs = [
      { id: 'users', label: 'Пользователи', perm: 'admin.users', icon: 'fa-users' },
      { id: 'roles', label: 'Роли и права', perm: 'admin.roles', icon: 'fa-user-shield' },
      { id: 'audit', label: 'Журнал аудита', perm: 'admin.audit', icon: 'fa-clipboard-list' },
      { id: 'settings', label: 'Настройки', perm: 'admin.settings', icon: 'fa-gear' },
    ].filter((t) => CRM.can(t.perm));
    const active = params.tab && tabs.find((t) => t.id === params.tab) ? params.tab : tabs[0]?.id;
    return `
      <div class="flex gap-2 mb-4 border-b border-slate-200 flex-wrap">
        ${tabs.map((t) => `<button class="px-4 py-2 text-sm font-medium ${t.id === active ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}" data-atab="${t.id}">
          <i class="fas ${t.icon}"></i> ${t.label}</button>`).join('')}
      </div>
      <div id="admin-content">${CRM.loading()}</div>`;
  };

  views.bindAdmin = async function (params) {
    const tabs = document.querySelectorAll('[data-atab]');
    tabs.forEach((t) => (t.onclick = () => CRM.go('admin', { tab: t.dataset.atab })));
    const active = params.tab || (tabs[0] && tabs[0].dataset.atab);
    const content = document.getElementById('admin-content');
    if (!content || !active) { content.innerHTML = CRM.emptyState('Нет доступных разделов'); return; }

    if (active === 'users') return loadUsers(content);
    if (active === 'roles') return loadRoles(content);
    if (active === 'audit') return loadAudit(content);
    if (active === 'settings') return loadSettings(content);
  };

  async function loadUsers(content) {
    content.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <input id="user-search" class="field-input !w-64" placeholder="Поиск пользователей..." />
        <button class="btn btn-primary" id="user-add"><i class="fas fa-plus"></i> Добавить</button>
      </div>
      <div class="stat-card !p-0 overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>Логин</th><th>ФИО</th><th>Роль</th><th>Статус</th><th>Последний вход</th><th></th></tr></thead>
          <tbody id="user-rows"><tr><td colspan="6">${CRM.loading()}</td></tr></tbody>
        </table>
      </div>`;

    const load = async () => {
      const q = document.getElementById('user-search').value.trim();
      try {
        const d = await CRM.api.get(`/api/admin/users?per_page=100&q=${encodeURIComponent(q)}`);
        const rows = document.getElementById('user-rows');
        if (!d.items.length) { rows.innerHTML = `<tr><td colspan="6">${CRM.emptyState('Пользователей нет')}</td></tr>`; return; }
        rows.innerHTML = d.items
          .map(
            (u) => `<tr>
              <td class="font-mono text-xs">${esc(u.username)}</td>
              <td class="font-medium">${esc(u.full_name) || '—'}</td>
              <td>${CRM.esc(CRM.roleLabels[u.role] || u.role_name)}</td>
              <td>${CRM.statusBadge(u.status)}</td>
              <td>${u.last_login_at ? CRM.fmtDate(u.last_login_at, true) : '—'}</td>
              <td class="text-right"><button class="text-blue-600" data-user="${u.id}"><i class="fas fa-pen"></i></button></td>
            </tr>`
          )
          .join('');
        rows.querySelectorAll('[data-user]').forEach((b) => {
          b.onclick = () => userEdit(d.items.find((u) => String(u.id) === b.dataset.user));
        });
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
    document.getElementById('user-search').oninput = debounce(load, 300);
    document.getElementById('user-add').onclick = userCreate;
    load();
  }

  function userCreate() {
    const roleOptions = Object.entries(CRM.roleLabels).map(([v, l]) => ({ value: v, label: l }));
    const body = `<form id="user-form">
      ${CRM.field('username', 'Логин', { required: true })}
      ${CRM.field('full_name', 'ФИО')}
      ${CRM.field('email', 'Email', { type: 'email' })}
      ${CRM.field('role', 'Роль', { type: 'select', required: true, options: roleOptions })}
      ${CRM.field('password', 'Пароль (мин. 8 символов)', { type: 'password', required: true })}
    </form>`;
    const footer = `<button class="btn btn-secondary" id="uf-cancel">Отмена</button>
      <button class="btn btn-primary" id="uf-save">Создать</button>`;
    CRM.modal.open({ title: 'Новый пользователь', body, footer });
    document.getElementById('uf-cancel').onclick = CRM.modal.close;
    document.getElementById('uf-save').onclick = async () => {
      try {
        await CRM.api.post('/api/admin/users', CRM.form(document.getElementById('user-form')));
        CRM.toast('Пользователь создан', 'success');
        CRM.modal.close();
        CRM.rerender();
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
  }

  function userEdit(u) {
    const roleOptions = Object.entries(CRM.roleLabels).map(([v, l]) => ({ value: v, label: l }));
    const body = `<form id="user-edit-form">
      <div class="mb-3 text-sm text-slate-500">Логин: <b>${esc(u.username)}</b></div>
      ${CRM.field('role', 'Роль', { type: 'select', value: u.role, options: roleOptions })}
      ${CRM.field('status', 'Статус', { type: 'select', value: u.status, options: [ { value: 'active', label: 'Активен' }, { value: 'disabled', label: 'Отключён' }, { value: 'locked', label: 'Заблокирован' } ] })}
      ${CRM.field('new_password', 'Новый пароль (оставьте пустым, чтобы не менять)', { type: 'password' })}
    </form>`;
    const footer = `<button class="btn btn-secondary" id="ue-cancel">Отмена</button>
      <button class="btn btn-primary" id="ue-save">Сохранить</button>`;
    CRM.modal.open({ title: 'Редактирование пользователя', body, footer });
    document.getElementById('ue-cancel').onclick = CRM.modal.close;
    document.getElementById('ue-save').onclick = async () => {
      const data = CRM.form(document.getElementById('user-edit-form'));
      if (!data.new_password) delete data.new_password;
      try {
        await CRM.api.patch(`/api/admin/users/${u.id}`, data);
        CRM.toast('Пользователь обновлён', 'success');
        CRM.modal.close();
        CRM.rerender();
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
  }

  async function loadRoles(content) {
    try {
      const d = await CRM.api.get('/api/admin/roles');
      content.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${d.roles.map((r) => `
            <div class="stat-card">
              <h3 class="font-semibold text-slate-800">${esc(r.name)}</h3>
              <p class="text-xs text-slate-400 font-mono mb-2">${esc(r.code)} · приоритет ${r.priority}</p>
              <p class="text-sm text-slate-500 mb-3">${esc(r.description) || ''}</p>
              <div class="text-xs space-y-1 max-h-48 overflow-y-auto">
                ${(d.matrix[r.id] || []).map((p) => `<div class="text-slate-600"><i class="fas fa-check text-green-500 mr-1"></i><span class="font-mono">${esc(p)}</span></div>`).join('')}
              </div>
            </div>`).join('')}
        </div>`;
    } catch (e) { content.innerHTML = `<div class="stat-card text-red-600">${esc(e.message)}</div>`; }
  }

  async function loadAudit(content) {
    content.innerHTML = `
      <div class="flex items-center gap-2 mb-3">
        <input id="audit-search" class="field-input !w-64" placeholder="Фильтр по действию (напр. auth.login)..." />
      </div>
      <div class="stat-card !p-0 overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Объект</th><th>IP</th><th>Детали</th></tr></thead>
          <tbody id="audit-rows"><tr><td colspan="6">${CRM.loading()}</td></tr></tbody>
        </table>
      </div>`;
    const load = async () => {
      const action = document.getElementById('audit-search').value.trim();
      try {
        const d = await CRM.api.get(`/api/admin/audit?per_page=100&action=${encodeURIComponent(action)}`);
        const rows = document.getElementById('audit-rows');
        if (!d.items.length) { rows.innerHTML = `<tr><td colspan="6">${CRM.emptyState('Записей нет')}</td></tr>`; return; }
        rows.innerHTML = d.items
          .map(
            (a) => `<tr>
              <td class="whitespace-nowrap text-xs">${CRM.fmtDate(a.created_at, true)}</td>
              <td>${esc(a.username) || '—'}</td>
              <td><span class="font-mono text-xs">${esc(a.action)}</span></td>
              <td>${esc(a.entity_type) || ''}${a.entity_id ? ' #' + esc(a.entity_id) : ''}</td>
              <td class="text-xs">${esc(a.ip) || '—'}</td>
              <td class="text-xs text-slate-500 max-w-xs truncate">${esc(a.details) || ''}</td>
            </tr>`
          )
          .join('');
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
    document.getElementById('audit-search').oninput = debounce(load, 300);
    load();
  }

  async function loadSettings(content) {
    try {
      const d = await CRM.api.get('/api/admin/settings');
      const reg = (d.items.find((s) => s.key === 'registration_open') || {}).value || 'false';
      content.innerHTML = `
        <div class="stat-card max-w-xl">
          <h3 class="font-semibold mb-3">Системные настройки</h3>
          <form id="settings-form">
            <div class="mb-4">
              <label class="field-label">Открытая регистрация пациентов</label>
              <select name="registration_open" class="field-input">
                <option value="false" ${reg !== 'true' ? 'selected' : ''}>Закрыта</option>
                <option value="true" ${reg === 'true' ? 'selected' : ''}>Открыта</option>
              </select>
            </div>
            <button type="button" class="btn btn-primary" id="settings-save"><i class="fas fa-save"></i> Сохранить</button>
          </form>
        </div>`;
      document.getElementById('settings-save').onclick = async () => {
        const data = CRM.form(document.getElementById('settings-form'));
        try {
          await CRM.api.put('/api/admin/settings', { key: 'registration_open', value: data.registration_open });
          CRM.toast('Настройки сохранены', 'success');
        } catch (e) { CRM.toast(e.message, 'error'); }
      };
    } catch (e) { content.innerHTML = `<div class="stat-card text-red-600">${esc(e.message)}</div>`; }
  }

  // =========================================================================
  // Profile
  // =========================================================================
  views.profile = function () {
    const u = CRM.state.user;
    return `
      <h2 class="text-lg font-semibold mb-4">Профиль</h2>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="stat-card">
          <h3 class="font-semibold mb-3">Учётная запись</h3>
          <div class="text-sm space-y-2">
            <div><span class="text-slate-400">Логин:</span> <b>${esc(u.username)}</b></div>
            <div><span class="text-slate-400">ФИО:</span> ${esc(u.full_name) || '—'}</div>
            <div><span class="text-slate-400">Роль:</span> ${esc(CRM.roleLabels[u.role] || u.role)}</div>
            <div><span class="text-slate-400">Права:</span> ${u.permissions.length}</div>
          </div>
        </div>
        <div class="stat-card">
          <h3 class="font-semibold mb-3">Смена пароля</h3>
          <form id="pw-form">
            ${CRM.field('current_password', 'Текущий пароль', { type: 'password', required: true })}
            ${CRM.field('new_password', 'Новый пароль (мин. 8)', { type: 'password', required: true })}
            <button type="button" class="btn btn-primary" id="pw-save"><i class="fas fa-key"></i> Сменить пароль</button>
          </form>
        </div>
      </div>`;
  };

  views.bindProfile = function () {
    const btn = document.getElementById('pw-save');
    if (!btn) return;
    btn.onclick = async () => {
      const data = CRM.form(document.getElementById('pw-form'));
      if ((data.new_password || '').length < 8) { CRM.toast('Новый пароль слишком короткий', 'error'); return; }
      try {
        await CRM.api.post('/api/auth/change-password', data);
        CRM.toast('Пароль изменён. Войдите заново.', 'success');
        setTimeout(() => (window.location.href = '/'), 1500);
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
  };

  // --- helpers ------------------------------------------------------------
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // --- Role-based navigation ---------------------------------------------
  CRM.navFor = function (role) {
    const all = [
      { id: 'dashboard', label: 'Панель', icon: 'fa-gauge-high', roles: ['patient', 'doctor', 'head', 'chief', 'admin'] },
      { id: 'patients', label: 'Пациенты', icon: 'fa-users', roles: ['doctor', 'head', 'chief', 'admin'], selfLabel: 'Моя карта' },
      { id: 'appointments', label: 'Записи', icon: 'fa-calendar-check', roles: ['patient', 'doctor', 'head', 'chief', 'admin'] },
      { id: 'records', label: 'Приёмы', icon: 'fa-notes-medical', roles: ['patient', 'doctor', 'head', 'chief'] },
      { id: 'analyses', label: 'Анализы', icon: 'fa-flask', roles: ['patient', 'doctor', 'head', 'chief'] },
      { id: 'prescriptions', label: 'Назначения', icon: 'fa-prescription', roles: ['patient', 'doctor', 'head', 'chief'] },
      { id: 'doctors', label: 'Врачи', icon: 'fa-user-doctor', roles: ['patient', 'doctor', 'head', 'chief', 'admin'] },
      { id: 'departments', label: 'Отделения', icon: 'fa-building', roles: ['doctor', 'head', 'chief', 'admin'] },
      { id: 'stats', label: 'Статистика', icon: 'fa-chart-line', roles: ['patient', 'head', 'chief', 'admin'] },
      { id: 'admin', label: 'Администрирование', icon: 'fa-shield-halved', roles: ['admin'] },
      { id: 'profile', label: 'Профиль', icon: 'fa-user', roles: ['patient', 'doctor', 'head', 'chief', 'admin'] },
    ];
    return all.filter((n) => n.roles.includes(role));
  };

  window.CRM.views = views;
})();
