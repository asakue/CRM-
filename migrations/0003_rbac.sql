-- =============================================================================
-- Hospital CRM — Migration 0003: RBAC matrix + reference data (idempotent)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO roles (id, code, name, description, priority) VALUES
  (1, 'patient', 'Пациент',          'Доступ только к собственным данным', 10),
  (2, 'doctor',  'Врач',             'Работа с пациентами своего отделения', 20),
  (3, 'head',    'Зав. отделением',  'Управление и статистика отделения', 30),
  (4, 'chief',   'Главный врач',     'Полный доступ ко всей клинике', 40),
  (5, 'admin',   'Администратор',    'Управление системой, пользователями, аудит', 50);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO permissions (code, description) VALUES
  -- Patients
  ('patients.view.self',        'Просмотр собственной карты'),
  ('patients.edit.self',        'Редактирование собственного профиля'),
  ('patients.view.department',  'Просмотр пациентов отделения'),
  ('patients.view.all',         'Просмотр всех пациентов'),
  ('patients.create',           'Создание карты пациента'),
  ('patients.edit.department',  'Редактирование пациентов отделения'),
  ('patients.edit.all',         'Редактирование всех пациентов'),
  -- Doctors
  ('doctors.view.all',          'Просмотр справочника врачей'),
  ('doctors.manage',            'Управление профилями врачей'),
  -- Appointments
  ('appointments.view.self',       'Просмотр собственных записей'),
  ('appointments.view.department', 'Просмотр записей отделения'),
  ('appointments.view.all',        'Просмотр всех записей'),
  ('appointments.create.self',     'Самостоятельная запись на приём'),
  ('appointments.create',          'Создание записей для пациентов'),
  ('appointments.manage',          'Изменение/отмена записей'),
  -- Medical records
  ('records.view.self',        'Просмотр собственных приёмов'),
  ('records.view.department',  'Просмотр приёмов отделения'),
  ('records.view.all',         'Просмотр всех приёмов'),
  ('records.create',           'Ведение медкарты / приёмов'),
  -- Analyses
  ('analyses.view.self',        'Просмотр собственных анализов'),
  ('analyses.view.department',  'Просмотр анализов отделения'),
  ('analyses.view.all',         'Просмотр всех анализов'),
  ('analyses.order',            'Назначение анализов'),
  ('analyses.enter',            'Ввод результатов анализов'),
  -- Prescriptions
  ('prescriptions.view.self',        'Просмотр собственных назначений'),
  ('prescriptions.view.department',  'Просмотр назначений отделения'),
  ('prescriptions.view.all',         'Просмотр всех назначений'),
  ('prescriptions.create',           'Выписка назначений'),
  -- Statistics
  ('stats.patients.self',        'Личная статистика пациента'),
  ('stats.patients.department',  'Статистика пациентов отделения'),
  ('stats.patients.all',         'Статистика по всем пациентам'),
  ('stats.doctors.department',   'Статистика врачей отделения'),
  ('stats.doctors.all',          'Статистика по всем врачам'),
  -- Departments
  ('departments.view',    'Просмотр отделений'),
  ('departments.manage',  'Управление отделениями'),
  -- Administration
  ('admin.users',     'Управление пользователями'),
  ('admin.roles',     'Управление ролями и правами'),
  ('admin.settings',  'Системные настройки'),
  ('admin.audit',     'Просмотр журнала аудита');

-- ---------------------------------------------------------------------------
-- Role → Permission mapping
-- ---------------------------------------------------------------------------
-- Patient
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions WHERE code IN (
  'patients.view.self','patients.edit.self','appointments.view.self',
  'appointments.create.self','records.view.self','analyses.view.self',
  'prescriptions.view.self','stats.patients.self','departments.view','doctors.view.all');

-- Doctor
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions WHERE code IN (
  'patients.view.department','patients.edit.department','patients.create',
  'doctors.view.all','appointments.view.department','appointments.create','appointments.manage',
  'records.view.department','records.create','analyses.view.department','analyses.order',
  'analyses.enter','prescriptions.view.department','prescriptions.create',
  'stats.patients.department','departments.view');

-- Head of department (+ doctor)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 3, id FROM permissions WHERE code IN (
  'patients.view.department','patients.view.all','patients.edit.department','patients.edit.all','patients.create',
  'doctors.view.all','appointments.view.department','appointments.view.all','appointments.create','appointments.manage',
  'records.view.department','records.view.all','records.create',
  'analyses.view.department','analyses.view.all','analyses.order','analyses.enter',
  'prescriptions.view.department','prescriptions.view.all','prescriptions.create',
  'stats.patients.department','stats.doctors.department','departments.view','departments.manage');

-- Chief physician (all clinical)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 4, id FROM permissions WHERE code IN (
  'patients.view.self','patients.edit.self','patients.view.department','patients.view.all','patients.edit.department','patients.edit.all','patients.create',
  'doctors.view.all','doctors.manage',
  'appointments.view.self','appointments.view.department','appointments.view.all','appointments.create.self','appointments.create','appointments.manage',
  'records.view.self','records.view.department','records.view.all','records.create',
  'analyses.view.self','analyses.view.department','analyses.view.all','analyses.order','analyses.enter',
  'prescriptions.view.self','prescriptions.view.department','prescriptions.view.all','prescriptions.create',
  'stats.patients.self','stats.patients.department','stats.patients.all','stats.doctors.department','stats.doctors.all',
  'departments.view','departments.manage');

-- Administrator (system, no clinical record content — separation of duties)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 5, id FROM permissions WHERE code IN (
  'patients.view.all','doctors.view.all','doctors.manage',
  'appointments.view.all','appointments.manage',
  'stats.patients.all','stats.doctors.all',
  'departments.view','departments.manage',
  'admin.users','admin.roles','admin.settings','admin.audit');

-- ---------------------------------------------------------------------------
-- Analysis types catalog
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO analysis_types (code, name, category, unit, ref_min, ref_max, description) VALUES
  ('CBC_HGB',   'Гемоглобин',              'blood',   'г/л',      120,  160, 'Общий анализ крови'),
  ('CBC_WBC',   'Лейкоциты',               'blood',   '10^9/л',   4.0,  9.0, 'Общий анализ крови'),
  ('CBC_PLT',   'Тромбоциты',              'blood',   '10^9/л',   150,  400, 'Общий анализ крови'),
  ('CBC_ESR',   'СОЭ',                     'blood',   'мм/ч',     2,    20,  'Скорость оседания эритроцитов'),
  ('BIO_GLU',   'Глюкоза',                 'blood',   'ммоль/л',  3.9,  5.5, 'Биохимия крови'),
  ('BIO_CREA',  'Креатинин',               'blood',   'мкмоль/л', 62,   106, 'Биохимия крови'),
  ('BIO_ALT',   'АЛТ',                     'blood',   'Ед/л',     0,    41,  'Биохимия крови'),
  ('BIO_AST',   'АСТ',                     'blood',   'Ед/л',     0,    40,  'Биохимия крови'),
  ('BIO_CHOL',  'Холестерин общий',        'blood',   'ммоль/л',  3.0,  5.2, 'Липидный профиль'),
  ('UR_GENERAL','Общий анализ мочи',       'urine',   'балл',     0,    1,   'Качественная оценка'),
  ('TSH',       'ТТГ',                     'blood',   'мЕд/л',    0.4,  4.0, 'Гормоны щитовидной железы'),
  ('CXR',       'Рентгенография ОГК',      'imaging', 'описание', 0,    1,   'Лучевая диагностика'),
  ('ECG',       'ЭКГ',                     'other',   'описание', 0,    1,   'Функциональная диагностика'),
  ('US_ABD',    'УЗИ органов брюшной полости','imaging','описание',0,   1,   'Ультразвуковая диагностика');
