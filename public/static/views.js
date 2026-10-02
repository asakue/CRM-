/* ==========================================================================
   Hospital CRM — views: each function returns an HTML string and (optionally)
   binds events after insertion. Exposed on window.CRM.views.
   ========================================================================== */
(function () {
  'use strict';
  const CRM = window.CRM;
  const views = (CRM.views = {});
  const esc = CRM.esc;

  // =========================================================================
  // Login
  // =========================================================================
  views.login = function () {
    return `
    <div class="login-bg">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div class="text-center mb-6">
          <div class="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-blue-600 text-white text-2xl mb-3">
            <i class="fas fa-hospital"></i>
          </div>
          <h1 class="text-2xl font-bold text-slate-800">Медицинская CRM</h1>
          <p class="text-sm text-slate-500 mt-1">Единая система управления клиникой</p>
        </div>
        <form id="login-form">
          <div class="mb-4">
            <label class="field-label">Логин</label>
            <input type="text" name="username" id="login-username" class="field-input" autocomplete="username" required autofocus />
          </div>
          <div class="mb-5">
            <label class="field-label">Пароль</label>
            <input type="password" name="password" id="login-password" class="field-input" autocomplete="current-password" required />
          </div>
          <div id="login-error" class="hidden mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"></div>
          <button type="submit" class="btn btn-primary w-full justify-center" id="login-btn">
            <i class="fas fa-right-to-bracket"></i> Войти
          </button>
        </form>
        <div class="mt-6 pt-5 border-t border-slate-200">
          <p class="text-xs text-slate-500 mb-2 font-semibold">Демо-доступы:</p>
          <div class="grid grid-cols-1 gap-1 text-xs text-slate-600">
            <button class="text-left hover:text-blue-600 demo-login" data-u="admin" data-p="Admin#2024"><b>admin</b> / Admin#2024 — Администратор</button>
            <button class="text-left hover:text-blue-600 demo-login" data-u="chief" data-p="Chief#2024"><b>chief</b> / Chief#2024 — Главный врач</button>
            <button class="text-left hover:text-blue-600 demo-login" data-u="head_card" data-p="Head#2024"><b>head_card</b> / Head#2024 — Зав. кардиоотделением</button>
            <button class="text-left hover:text-blue-600 demo-login" data-u="doctor1" data-p="Doctor#2024"><b>doctor1</b> / Doctor#2024 — Врач</button>
            <button class="text-left hover:text-blue-600 demo-login" data-u="patient1" data-p="Patient#2024"><b>patient1</b> / Patient#2024 — Пациент</button>
          </div>
        </div>
        <p class="text-center text-xs text-slate-400 mt-5">
          <i class="fas fa-lock"></i> Данные защищены шифрованием AES-256-GCM
        </p>
      </div>
    </div>`;
  };

  // =========================================================================
  // Dashboard
  // =========================================================================
  views.dashboard = function () {
    return `<div id="dash-content">${CRM.loading()}</div>`;
  };

  views.bindDashboard = async function () {
    const el = document.getElementById('dash-content');
    if (!el) return;
    try {
      const s = await CRM.api.get('/api/stats/summary');
      el.innerHTML = renderSummary(s);
    } catch (e) {
      el.innerHTML = `<div class="stat-card text-red-600">${esc(e.message)}</div>`;
    }
  };

  function statTile(icon, label, value, color) {
    return `<div class="stat-card flex items-center gap-4">
      <div class="w-12 h-12 rounded-lg ${color} flex items-center justify-center text-white text-lg">
        <i class="fas ${icon}"></i>
      </div>
      <div>
        <div class="text-2xl font-bold text-slate-800">${esc(value)}</div>
        <div class="text-xs text-slate-500 uppercase tracking-wide">${esc(label)}</div>
      </div>
    </div>`;
  }

  function renderSummary(s) {
    if (s.scope === 'self') {
      return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        ${statTile('fa-calendar-check', 'Предстоящие приёмы', s.upcoming, 'bg-blue-600')}
        ${statTile('fa-notes-medical', 'Визиты', s.visits, 'bg-green-600')}
        ${statTile('fa-flask', 'Анализы', s.analyses, 'bg-indigo-600')}
        ${statTile('fa-triangle-exclamation', 'Отклонения', s.abnormalResults, 'bg-amber-500')}
      </div>
      <div class="mt-6 stat-card">
        <h3 class="font-semibold text-slate-700 mb-2"><i class="fas fa-user-shield text-blue-600"></i> Личный кабинет</h3>
        <p class="text-sm text-slate-500">Здесь отображаются только ваши данные. Перейдите в разделы «Мои записи», «Мои анализы» и «Мои назначения» в меню слева.</p>
      </div>`;
    }
    return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      ${statTile('fa-users', 'Пациенты', s.patients, 'bg-blue-600')}
      ${statTile('fa-user-doctor', 'Врачи', s.doctors, 'bg-indigo-600')}
      ${statTile('fa-calendar-check', `Приёмы (${s.rangeDays} дн.)`, s.appointments, 'bg-green-600')}
      ${statTile('fa-percent', 'Выполнено', s.completionRate + '%', 'bg-emerald-600')}
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
      ${statTile('fa-circle-check', 'Завершено', s.completed, 'bg-teal-600')}
      ${statTile('fa-user-xmark', 'Неявки', s.noShow, 'bg-red-500')}
      ${statTile('fa-hourglass-half', 'Анализы в работе', s.analysesPending, 'bg-amber-500')}
      ${statTile('fa-building', 'Область', s.scope === 'all' ? 'Вся клиника' : 'Отделение', 'bg-slate-600')}
    </div>`;
  }

  // =========================================================================
  // Patients
  // =========================================================================
  views.patients = function () {
    return `<div id="patients-content">${CRM.loading()}</div>`;
  };

  views.bindPatients = async function () {
    const el = document.getElementById('patients-content');
    if (!el) return;
    const canCreate = CRM.can('patients.create');
    el.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-2">
          <input type="text" id="pat-search" class="field-input !w-64" placeholder="Поиск по ФИО или № карты..." />
          <button class="btn btn-secondary" id="pat-search-btn"><i class="fas fa-search"></i></button>
        </div>
        ${canCreate ? `<button class="btn btn-primary" id="pat-add"><i class="fas fa-plus"></i> Новый пациент</button>` : ''}
      </div>
      <div class="stat-card !p-0 overflow-x-auto">
        <table class="data-table">
          <thead><tr>
            <th>№ карты</th><th>ФИО</th><th>Возраст</th><th>Пол</th><th>Телефон</th><th>Группа крови</th><th>Статус</th><th></th>
          </tr></thead>
          <tbody id="pat-rows"><tr><td colspan="8">${CRM.loading()}</td></tr></tbody>
        </table>
      </div>
      <div id="pat-pager" class="mt-4 flex justify-between items-center text-sm text-slate-500"></div>`;

    let page = 1;
    const load = async () => {
      const q = document.getElementById('pat-search').value.trim();
      try {
        const data = await CRM.api.get(`/api/patients?page=${page}&per_page=20&q=${encodeURIComponent(q)}`);
        const rows = document.getElementById('pat-rows');
        if (!data.items.length) {
          rows.innerHTML = `<tr><td colspan="8">${CRM.emptyState('Пациенты не найдены')}</td></tr>`;
        } else {
          rows.innerHTML = data.items
            .map(
              (p) => `<tr>
                <td class="font-mono text-xs">${esc(p.patient_no)}</td>
                <td class="font-medium">${esc(p.full_name)}</td>
                <td>${p.age != null ? p.age : '—'}</td>
                <td>${p.gender === 'male' ? 'М' : p.gender === 'female' ? 'Ж' : '—'}</td>
                <td>${esc(p.phone) || '—'}</td>
                <td>${esc(p.blood_type) || '—'}</td>
                <td>${CRM.statusBadge(p.status)}</td>
                <td class="text-right whitespace-nowrap">
                  <button class="text-blue-600 hover:text-blue-800" data-view="${p.id}" title="Открыть"><i class="fas fa-eye"></i></button>
                </td>
              </tr>`
            )
            .join('');
        }
        const totalPages = Math.max(1, Math.ceil(data.total / data.perPage));
        document.getElementById('pat-pager').innerHTML = `
          <span>Всего: ${data.total}</span>
          <div class="flex gap-2">
            <button class="btn btn-secondary !py-1 !px-3" id="pat-prev" ${page <= 1 ? 'disabled' : ''}>Назад</button>
            <span class="px-2 py-1">${page} / ${totalPages}</span>
            <button class="btn btn-secondary !py-1 !px-3" id="pat-next" ${page >= totalPages ? 'disabled' : ''}>Вперёд</button>
          </div>`;
        document.getElementById('pat-prev').onclick = () => { if (page > 1) { page--; load(); } };
        document.getElementById('pat-next').onclick = () => { if (page < totalPages) { page++; load(); } };
        rows.querySelectorAll('[data-view]').forEach((b) => {
          b.onclick = () => CRM.go('patient', { id: b.dataset.view });
        });
      } catch (e) {
        CRM.toast(e.message, 'error');
      }
    };
    document.getElementById('pat-search-btn').onclick = () => { page = 1; load(); };
    document.getElementById('pat-search').onkeydown = (e) => { if (e.key === 'Enter') { page = 1; load(); } };
    const addBtn = document.getElementById('pat-add');
    if (addBtn) addBtn.onclick = patientForm;
    load();
  };

  function patientForm() {
    const body = `<form id="pat-form">
      ${CRM.field('full_name', 'ФИО', { required: true })}
      <div class="grid grid-cols-2 gap-3">
        ${CRM.field('birth_date', 'Дата рождения', { type: 'date' })}
        ${CRM.field('gender', 'Пол', { type: 'select', options: [ { value: '', label: '—' }, { value: 'male', label: 'Мужской' }, { value: 'female', label: 'Женский' } ] })}
      </div>
      <div class="grid grid-cols-2 gap-3">
        ${CRM.field('phone', 'Телефон')}
        ${CRM.field('blood_type', 'Группа крови', { type: 'select', options: ['', 'O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map(v => ({ value: v, label: v || '—' })) })}
      </div>
      ${CRM.field('email', 'Email', { type: 'email' })}
      ${CRM.field('allergies', 'Аллергии')}
      ${CRM.field('chronic_conditions', 'Хронические заболевания', { type: 'textarea', rows: 2 })}
      ${CRM.field('notes', 'Заметки', { type: 'textarea', rows: 2 })}
    </form>`;
    const footer = `<button class="btn btn-secondary" id="pat-cancel">Отмена</button>
      <button class="btn btn-primary" id="pat-save"><i class="fas fa-save"></i> Сохранить</button>`;
    CRM.modal.open({ title: 'Новый пациент', body, footer, wide: true });
    document.getElementById('pat-cancel').onclick = CRM.modal.close;
    document.getElementById('pat-save').onclick = async () => {
      const data = CRM.form(document.getElementById('pat-form'));
      try {
        await CRM.api.post('/api/patients', data);
        CRM.toast('Пациент добавлен', 'success');
        CRM.modal.close();
        CRM.rerender();
      } catch (e) {
        CRM.toast(e.message, 'error');
      }
    };
  }

  views.patientDetail = function (params) {
    return `<div id="patient-detail">${CRM.loading()}</div>`;
  };

  views.bindPatientDetail = async function (params) {
    const el = document.getElementById('patient-detail');
    try {
      const p = await CRM.api.get(`/api/patients/${params.id}`);
      el.innerHTML = `
        <button class="text-sm text-blue-600 mb-3" onclick="CRM.go('patients')"><i class="fas fa-arrow-left"></i> К списку</button>
        <div class="stat-card mb-4">
          <div class="flex items-start justify-between">
            <div>
              <h2 class="text-xl font-bold text-slate-800 flex items-center">${esc(p.full_name)}<span class="enc-badge">AES-256</span></h2>
              <p class="text-sm text-slate-500 mt-1">Карта ${esc(p.patient_no)} · ${p.age != null ? p.age + ' лет' : 'возраст н/д'} · ${p.gender === 'male' ? 'мужской' : p.gender === 'female' ? 'женский' : '—'}</p>
            </div>
            ${CRM.statusBadge(p.status)}
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 text-sm">
            <div><span class="text-slate-400">Телефон:</span> ${esc(p.phone) || '—'}</div>
            <div><span class="text-slate-400">Группа крови:</span> ${esc(p.blood_type) || '—'}</div>
            <div><span class="text-slate-400">Email:</span> ${esc(p.email) || '—'}</div>
            <div><span class="text-slate-400">Аллергии:</span> ${esc(p.allergies) || '—'}</div>
            <div><span class="text-slate-400">Хронич. заболевания:</span> ${esc(p.chronic_conditions) || '—'}</div>
            <div><span class="text-slate-400">Дата рождения:</span> ${CRM.fmtDate(p.birth_date)}</div>
          </div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="stat-card">
            <h3 class="font-semibold mb-3"><i class="fas fa-calendar-check text-blue-600"></i> Приёмы</h3>
            <div id="pd-appointments">${CRM.loading()}</div>
          </div>
          <div class="stat-card">
            <h3 class="font-semibold mb-3"><i class="fas fa-flask text-indigo-600"></i> Анализы</h3>
            <div id="pd-analyses">${CRM.loading()}</div>
          </div>
        </div>`;

      loadPatientAppointments(params.id);
      loadPatientAnalyses(params.id);
    } catch (e) {
      el.innerHTML = `<div class="stat-card text-red-600">${esc(e.message)}</div>`;
    }
  };

  async function loadPatientAppointments(pid) {
    const box = document.getElementById('pd-appointments');
    try {
      const d = await CRM.api.get(`/api/appointments?patient_id=${pid}&per_page=10`);
      if (!d.items.length) { box.innerHTML = CRM.emptyState('Нет приёмов'); return; }
      box.innerHTML = `<table class="data-table"><tbody>${d.items
        .map(
          (a) => `<tr>
            <td>${CRM.fmtDate(a.scheduled_at, true)}</td>
            <td>${esc(a.doctor_name)}</td>
            <td>${CRM.statusBadge(a.status)}</td>
          </tr>`
        )
        .join('')}</tbody></table>`;
    } catch (e) { box.innerHTML = CRM.emptyState(e.message); }
  }

  async function loadPatientAnalyses(pid) {
    const box = document.getElementById('pd-analyses');
    try {
      const d = await CRM.api.get(`/api/analyses?patient_id=${pid}&per_page=10`);
      if (!d.items.length) { box.innerHTML = CRM.emptyState('Нет анализов'); return; }
      box.innerHTML = `<table class="data-table"><tbody>${d.items
        .map(
          (a) => `<tr>
            <td>${esc(a.type_name)}</td>
            <td>${CRM.fmtDate(a.ordered_at)}</td>
            <td>${CRM.statusBadge(a.status)}</td>
            <td class="text-right"><button class="text-blue-600" data-an="${a.id}"><i class="fas fa-eye"></i></button></td>
          </tr>`
        )
        .join('')}</tbody></table>`;
      box.querySelectorAll('[data-an]').forEach((b) => {
        b.onclick = () => CRM.go('analysis', { id: b.dataset.an });
      });
    } catch (e) { box.innerHTML = CRM.emptyState(e.message); }
  }

  // =========================================================================
  // Appointments
  // =========================================================================
  views.appointments = function () {
    return `<div id="appt-content">${CRM.loading()}</div>`;
  };

  views.bindAppointments = async function () {
    const el = document.getElementById('appt-content');
    const canCreate = CRM.can('appointments.create', 'appointments.create.self');
    el.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-2">
          <select id="appt-status" class="field-input !w-44">
            <option value="">Все статусы</option>
            <option value="scheduled">Запланирован</option>
            <option value="confirmed">Подтверждён</option>
            <option value="completed">Завершён</option>
            <option value="cancelled">Отменён</option>
            <option value="no_show">Неявка</option>
          </select>
        </div>
        ${canCreate ? `<button class="btn btn-primary" id="appt-add"><i class="fas fa-plus"></i> Записать</button>` : ''}
      </div>
      <div class="stat-card !p-0 overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>Дата и время</th><th>Пациент</th><th>Врач</th><th>Отделение</th><th>Тип</th><th>Статус</th><th></th></tr></thead>
          <tbody id="appt-rows"><tr><td colspan="7">${CRM.loading()}</td></tr></tbody>
        </table>
      </div>`;

    const load = async () => {
      const status = document.getElementById('appt-status').value;
      try {
        const d = await CRM.api.get(`/api/appointments?per_page=50${status ? '&status=' + status : ''}`);
        const rows = document.getElementById('appt-rows');
        if (!d.items.length) { rows.innerHTML = `<tr><td colspan="7">${CRM.emptyState('Записей нет')}</td></tr>`; return; }
        rows.innerHTML = d.items
          .map(
            (a) => `<tr>
              <td>${CRM.fmtDate(a.scheduled_at, true)}</td>
              <td class="font-medium">${esc(a.patient_name)}</td>
              <td>${esc(a.doctor_name)}</td>
              <td>${esc(a.department_name) || '—'}</td>
              <td>${esc(a.type)}</td>
              <td>${CRM.statusBadge(a.status)}</td>
              <td class="text-right whitespace-nowrap">
                <button class="text-blue-600 hover:text-blue-800" data-appt="${a.id}" title="Открыть"><i class="fas fa-eye"></i></button>
              </td>
            </tr>`
          )
          .join('');
        rows.querySelectorAll('[data-appt]').forEach((b) => {
          b.onclick = () => appointmentDetail(b.dataset.appt);
        });
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
    document.getElementById('appt-status').onchange = load;
    const addBtn = document.getElementById('appt-add');
    if (addBtn) addBtn.onclick = appointmentForm;
    load();
  };

  async function appointmentForm() {
    let patientsOpts = [];
    let doctors = [];
    try {
      if (CRM.state.user.role === 'patient') {
        patientsOpts = [{ value: CRM.state.user.patient_id, label: 'Себя' }];
      } else {
        const pd = await CRM.api.get('/api/patients?per_page=100');
        patientsOpts = pd.items.map((p) => ({ value: p.id, label: `${p.full_name} (${p.patient_no})` }));
      }
      const dd = await CRM.api.get('/api/doctors?per_page=100');
      doctors = dd.items;
    } catch (e) { CRM.toast(e.message, 'error'); }

    const body = `<form id="appt-form">
      ${CRM.field('patient_id', 'Пациент', { type: 'select', required: true, options: [{ value: '', label: '— выберите —' }].concat(patientsOpts) })}
      ${CRM.field('doctor_id', 'Врач', { type: 'select', required: true, options: [{ value: '', label: '— выберите —' }].concat(doctors.map((d) => ({ value: d.id, label: `${d.full_name} — ${d.specialty || ''} (${d.department_name || ''})` }))) })}
      ${CRM.field('scheduled_at', 'Дата и время', { type: 'datetime-local', required: true })}
      ${CRM.field('type', 'Тип', { type: 'select', options: [ { value: 'consultation', label: 'Консультация' }, { value: 'followup', label: 'Повторный приём' }, { value: 'procedure', label: 'Процедура' }, { value: 'analysis', label: 'Анализ' } ] })}
      ${CRM.field('reason', 'Причина / жалобы', { type: 'textarea', rows: 2 })}
    </form>`;
    const footer = `<button class="btn btn-secondary" id="appt-cancel">Отмена</button>
      <button class="btn btn-primary" id="appt-save"><i class="fas fa-save"></i> Записать</button>`;
    CRM.modal.open({ title: 'Запись на приём', body, footer, wide: true });
    document.getElementById('appt-cancel').onclick = CRM.modal.close;
    document.getElementById('appt-save').onclick = async () => {
      const data = CRM.form(document.getElementById('appt-form'));
      try {
        await CRM.api.post('/api/appointments', data);
        CRM.toast('Запись создана', 'success');
        CRM.modal.close();
        CRM.rerender();
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
  }

  async function appointmentDetail(id) {
    try {
      const a = await CRM.api.get(`/api/appointments/${id}`);
      const canManage = CRM.can('appointments.manage');
      const statuses = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'];
      const body = `
        <div class="space-y-2 text-sm">
          <div><span class="text-slate-400">Пациент:</span> <b>${esc(a.patient_name)}</b></div>
          <div><span class="text-slate-400">Врач:</span> ${esc(a.doctor_name)} (${esc(a.specialty) || '—'})</div>
          <div><span class="text-slate-400">Отделение:</span> ${esc(a.department_name) || '—'}</div>
          <div><span class="text-slate-400">Дата и время:</span> ${CRM.fmtDate(a.scheduled_at, true)}</div>
          <div><span class="text-slate-400">Тип:</span> ${esc(a.type)}</div>
          <div><span class="text-slate-400">Статус:</span> ${CRM.statusBadge(a.status)}</div>
          <div><span class="text-slate-400">Причина:</span> ${esc(a.reason) || '—'}<span class="enc-badge">AES-256</span></div>
        </div>`;
      const footer = `${canManage || CRM.state.user.role === 'patient' ? `<select id="appt-newstatus" class="field-input !w-48">${statuses.map((s) => `<option value="${s}" ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn btn-primary" id="appt-update">Обновить статус</button>` : ''}`;
      CRM.modal.open({ title: 'Запись на приём', body, footer });
      const btn = document.getElementById('appt-update');
      if (btn) {
        btn.onclick = async () => {
          try {
            await CRM.api.patch(`/api/appointments/${id}`, { status: document.getElementById('appt-newstatus').value });
            CRM.toast('Статус обновлён', 'success');
            CRM.modal.close();
            CRM.rerender();
          } catch (e) { CRM.toast(e.message, 'error'); }
        };
      }
    } catch (e) { CRM.toast(e.message, 'error'); }
  }

  // =========================================================================
  // Records (medical)
  // =========================================================================
  views.records = function () {
    return `<div id="rec-content">${CRM.loading()}</div>`;
  };

  views.bindRecords = async function () {
    const el = document.getElementById('rec-content');
    const canCreate = CRM.can('records.create');
    el.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Медицинские приёмы</h2>
        ${canCreate ? `<button class="btn btn-primary" id="rec-add"><i class="fas fa-plus"></i> Новый приём</button>` : ''}
      </div>
      <div class="stat-card !p-0 overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>Дата</th><th>Пациент</th><th>Врач</th><th>МКБ</th><th>Диагноз</th><th></th></tr></thead>
          <tbody id="rec-rows"><tr><td colspan="6">${CRM.loading()}</td></tr></tbody>
        </table>
      </div>`;

    const load = async () => {
      try {
        const d = await CRM.api.get('/api/records?per_page=50');
        const rows = document.getElementById('rec-rows');
        if (!d.items.length) { rows.innerHTML = `<tr><td colspan="6">${CRM.emptyState('Приёмов нет')}</td></tr>`; return; }
        rows.innerHTML = d.items
          .map(
            (r) => `<tr>
              <td>${CRM.fmtDate(r.visit_date, true)}</td>
              <td class="font-medium">${esc(r.patient_name)}</td>
              <td>${esc(r.doctor_name)}</td>
              <td class="font-mono text-xs">${esc(r.icd_code) || '—'}</td>
              <td class="max-w-xs truncate">${esc(r.diagnosis) || '—'}</td>
              <td class="text-right"><button class="text-blue-600" data-rec="${r.id}"><i class="fas fa-eye"></i></button></td>
            </tr>`
          )
          .join('');
        rows.querySelectorAll('[data-rec]').forEach((b) => {
          b.onclick = () => recordDetail(b.dataset.rec);
        });
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
    const addBtn = document.getElementById('rec-add');
    if (addBtn) addBtn.onclick = recordForm;
    load();
  };

  async function recordForm(prePatientId) {
    let patientsOpts = [];
    try {
      if (CRM.state.user.role === 'patient') patientsOpts = [{ value: CRM.state.user.patient_id, label: 'Себя' }];
      else {
        const pd = await CRM.api.get('/api/patients?per_page=100');
        patientsOpts = pd.items.map((p) => ({ value: p.id, label: `${p.full_name} (${p.patient_no})` }));
      }
    } catch (e) { CRM.toast(e.message, 'error'); }
    const body = `<form id="rec-form">
      ${CRM.field('patient_id', 'Пациент', { type: 'select', required: true, value: prePatientId, options: [{ value: '', label: '— выберите —' }].concat(patientsOpts) })}
      ${CRM.field('complaints', 'Жалобы', { type: 'textarea', rows: 2 })}
      <div class="grid grid-cols-3 gap-3">
        ${CRM.field('diagnosis', 'Диагноз', { required: true })}
        ${CRM.field('icd_code', 'Код МКБ-10', { placeholder: 'напр. I20.8' })}
      </div>
      ${CRM.field('treatment', 'Лечение', { type: 'textarea', rows: 2 })}
      ${CRM.field('recommendation', 'Рекомендации', { type: 'textarea', rows: 2 })}
      ${CRM.field('vitals', 'Показатели (АД, пульс, t°)', { placeholder: 'АД 120/80, пульс 72' })}
    </form>`;
    const footer = `<button class="btn btn-secondary" id="rec-cancel">Отмена</button>
      <button class="btn btn-primary" id="rec-save"><i class="fas fa-save"></i> Сохранить</button>`;
    CRM.modal.open({ title: 'Новый приём', body, footer, wide: true });
    document.getElementById('rec-cancel').onclick = CRM.modal.close;
    document.getElementById('rec-save').onclick = async () => {
      const data = CRM.form(document.getElementById('rec-form'));
      try {
        await CRM.api.post('/api/records', data);
        CRM.toast('Приём сохранён', 'success');
        CRM.modal.close();
        CRM.rerender();
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
  }

  async function recordDetail(id) {
    try {
      const r = await CRM.api.get(`/api/records/${id}`);
      const body = `
        <div class="space-y-3 text-sm">
          <div class="flex justify-between"><span class="text-slate-400">Пациент:</span><b>${esc(r.patient_name)}</b></div>
          <div class="flex justify-between"><span class="text-slate-400">Врач:</span><span>${esc(r.doctor_name)}</span></div>
          <div class="flex justify-between"><span class="text-slate-400">Дата:</span><span>${CRM.fmtDate(r.visit_date, true)}</span></div>
          <hr />
          <div><div class="text-slate-400 mb-1">Жалобы <span class="enc-badge">AES-256</span></div><div>${esc(r.complaints) || '—'}</div></div>
          <div><div class="text-slate-400 mb-1">Диагноз ${esc(r.icd_code) ? '(' + esc(r.icd_code) + ')' : ''} <span class="enc-badge">AES-256</span></div><div class="font-medium">${esc(r.diagnosis) || '—'}</div></div>
          <div><div class="text-slate-400 mb-1">Лечение <span class="enc-badge">AES-256</span></div><div>${esc(r.treatment) || '—'}</div></div>
          <div><div class="text-slate-400 mb-1">Рекомендации <span class="enc-badge">AES-256</span></div><div>${esc(r.recommendation) || '—'}</div></div>
          <div><div class="text-slate-400 mb-1">Показатели <span class="enc-badge">AES-256</span></div><div>${esc(r.vitals) || '—'}</div></div>
        </div>`;
      CRM.modal.open({ title: 'Медицинский приём', body, wide: true });
    } catch (e) { CRM.toast(e.message, 'error'); }
  }

  // =========================================================================
  // Analyses
  // =========================================================================
  views.analyses = function () {
    return `<div id="an-content">${CRM.loading()}</div>`;
  };

  views.bindAnalyses = async function () {
    const el = document.getElementById('an-content');
    const canOrder = CRM.can('analyses.order');
    el.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Анализы</h2>
        ${canOrder ? `<button class="btn btn-primary" id="an-add"><i class="fas fa-plus"></i> Назначить</button>` : ''}
      </div>
      <div class="stat-card !p-0 overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>Анализ</th><th>Пациент</th><th>Врач</th><th>Назначен</th><th>Статус</th><th></th></tr></thead>
          <tbody id="an-rows"><tr><td colspan="6">${CRM.loading()}</td></tr></tbody>
        </table>
      </div>`;

    const load = async () => {
      try {
        const d = await CRM.api.get('/api/analyses?per_page=50');
        const rows = document.getElementById('an-rows');
        if (!d.items.length) { rows.innerHTML = `<tr><td colspan="6">${CRM.emptyState('Анализов нет')}</td></tr>`; return; }
        rows.innerHTML = d.items
          .map(
            (a) => `<tr>
              <td class="font-medium">${esc(a.type_name)}</td>
              <td>${esc(a.patient_name)}</td>
              <td>${esc(a.doctor_name)}</td>
              <td>${CRM.fmtDate(a.ordered_at)}</td>
              <td>${CRM.statusBadge(a.status)}</td>
              <td class="text-right"><button class="text-blue-600" data-anr="${a.id}"><i class="fas fa-eye"></i></button></td>
            </tr>`
          )
          .join('');
        rows.querySelectorAll('[data-anr]').forEach((b) => {
          b.onclick = () => CRM.go('analysis', { id: b.dataset.anr });
        });
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
    const addBtn = document.getElementById('an-add');
    if (addBtn) addBtn.onclick = analysisForm;
    load();
  };

  async function analysisForm() {
    let patientsOpts = [];
    let types = [];
    try {
      if (CRM.state.user.role === 'patient') patientsOpts = [{ value: CRM.state.user.patient_id, label: 'Себя' }];
      else {
        const pd = await CRM.api.get('/api/patients?per_page=100');
        patientsOpts = pd.items.map((p) => ({ value: p.id, label: `${p.full_name} (${p.patient_no})` }));
      }
      const td = await CRM.api.get('/api/analyses/types');
      types = td.items;
    } catch (e) { CRM.toast(e.message, 'error'); }
    const body = `<form id="an-form">
      ${CRM.field('patient_id', 'Пациент', { type: 'select', required: true, options: [{ value: '', label: '— выберите —' }].concat(patientsOpts) })}
      ${CRM.field('type_id', 'Анализ', { type: 'select', required: true, options: [{ value: '', label: '— выберите —' }].concat(types.map((t) => ({ value: t.id, label: `${t.name} (${t.category})` }))) })}
    </form>`;
    const footer = `<button class="btn btn-secondary" id="an-cancel">Отмена</button>
      <button class="btn btn-primary" id="an-save"><i class="fas fa-save"></i> Назначить</button>`;
    CRM.modal.open({ title: 'Назначить анализ', body, footer });
    document.getElementById('an-cancel').onclick = CRM.modal.close;
    document.getElementById('an-save').onclick = async () => {
      const data = CRM.form(document.getElementById('an-form'));
      try {
        await CRM.api.post('/api/analyses', data);
        CRM.toast('Анализ назначен', 'success');
        CRM.modal.close();
        CRM.rerender();
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
  }

  views.analysisDetail = function () {
    return `<div id="analysis-detail">${CRM.loading()}</div>`;
  };

  views.bindAnalysisDetail = async function (params) {
    const el = document.getElementById('analysis-detail');
    try {
      const a = await CRM.api.get(`/api/analyses/${params.id}`);
      const canEnter = CRM.can('analyses.enter');
      el.innerHTML = `
        <button class="text-sm text-blue-600 mb-3" onclick="CRM.go('analyses')"><i class="fas fa-arrow-left"></i> К списку</button>
        <div class="stat-card mb-4">
          <div class="flex justify-between items-start">
            <div>
              <h2 class="text-xl font-bold">${esc(a.type_name)}</h2>
              <p class="text-sm text-slate-500">${esc(a.patient_name)} · ${esc(a.doctor_name)} · ${CRM.fmtDate(a.ordered_at)}</p>
              ${a.ref_min != null ? `<p class="text-xs text-slate-400 mt-1">Референс: ${a.ref_min} – ${a.ref_max} ${esc(a.unit) || ''}</p>` : ''}
            </div>
            <div class="flex items-center gap-2">
              ${CRM.statusBadge(a.status)}
              ${canEnter ? `<button class="btn btn-primary !py-1 !px-3" id="an-result-add"><i class="fas fa-plus"></i> Результат</button>` : ''}
            </div>
          </div>
        </div>
        <div class="stat-card !p-0 overflow-x-auto">
          <table class="data-table">
            <thead><tr><th>Значение</th><th>Оценка</th><th>Комментарий</th><th>Дата</th></tr></thead>
            <tbody>
              ${a.results.length ? a.results.map((r) => `<tr>
                <td class="font-medium">${r.value_numeric != null ? r.value_numeric : ''} ${esc(r.value_text) || ''}</td>
                <td>${CRM.flagBadge(r.flag)}</td>
                <td>${esc(r.comment) || '—'}</td>
                <td>${CRM.fmtDate(r.created_at, true)}</td>
              </tr>`).join('') : `<tr><td colspan="4">${CRM.emptyState('Результатов пока нет')}</td></tr>`}
            </tbody>
          </table>
        </div>`;
      const addBtn = document.getElementById('an-result-add');
      if (addBtn) addBtn.onclick = () => analysisResultForm(a);
    } catch (e) {
      el.innerHTML = `<div class="stat-card text-red-600">${esc(e.message)}</div>`;
    }
  };

  function analysisResultForm(a) {
    const isNumeric = a.ref_min != null && a.ref_max != null;
    const body = `<form id="an-res-form">
      ${isNumeric ? CRM.field('value_numeric', `Числовое значение (${esc(a.unit) || ''})`, { type: 'number', step: 'any', required: true }) : ''}
      ${CRM.field('value_text', 'Текстовое значение / описание', { type: 'textarea', rows: 2, required: !isNumeric })}
      ${CRM.field('flag', 'Оценка', { type: 'select', options: [ { value: '', label: 'Авто' }, { value: 'normal', label: 'Норма' }, { value: 'low', label: 'Понижен' }, { value: 'high', label: 'Повышен' }, { value: 'abnormal', label: 'Отклонение' } ] })}
      ${CRM.field('comment', 'Комментарий', { type: 'textarea', rows: 2 })}
    </form>`;
    const footer = `<button class="btn btn-secondary" id="anr-cancel">Отмена</button>
      <button class="btn btn-primary" id="anr-save">Сохранить</button>`;
    CRM.modal.open({ title: 'Результат анализа', body, footer });
    document.getElementById('anr-cancel').onclick = CRM.modal.close;
    document.getElementById('anr-save').onclick = async () => {
      const data = CRM.form(document.getElementById('an-res-form'));
      try {
        await CRM.api.post(`/api/analyses/${a.id}/results`, data);
        CRM.toast('Результат сохранён', 'success');
        CRM.modal.close();
        CRM.rerender();
      } catch (e) { CRM.toast(e.message, 'error'); }
    };
  }

  window.CRM.views = views;
})();
