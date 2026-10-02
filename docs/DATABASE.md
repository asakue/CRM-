# Схема базы данных

База: **Cloudflare D1 (SQLite)**, имя `hospital-crm-db`. Миграции — `migrations/*.sql`.

## Таблицы безопасности

| Таблица | Назначение | Ключевые поля |
|---|---|---|
| `roles` | роли | `code`, `name`, `priority` |
| `permissions` | атомарные права | `code` |
| `role_permissions` | связь ролей и прав | `role_id`, `permission_id` |
| `users` | пользователи | `username`, `password_hash`, `password_salt`, `password_iterations`, `role_id`, `status`, `failed_attempts`, `locked_until` |
| `sessions` | активные сессии | `token_hash` (SHA-256), `csrf_token`, `expires_at`, `revoked` |
| `login_attempts` | попытки входа | `username`, `ip`, `success` |
| `audit_log` | журнал аудита | `action`, `entity_type`, `entity_id`, `ip` |
| `settings` | key-value настройки | `key`, `value` |

## Медицинские таблицы

| Таблица | Назначение | Шифруемые поля |
|---|---|---|
| `departments` | отделения | — |
| `patients` | пациенты | `full_name`, `birth_date`, `phone`, `email`, `address`, `allergies`, `chronic_conditions`, `insurance_no`, `snils`, `notes` |
| `doctors` | профили врачей | — |
| `appointments` | записи на приём | `reason` |
| `medical_records` | приёмы | `complaints`, `diagnosis`, `treatment`, `recommendation`, `vitals` |
| `analysis_types` | справочник анализов | — |
| `analyses` | направления | — |
| `analysis_results` | результаты | `value_text`, `comment` |
| `prescriptions` | назначения | `medication`, `dosage`, `instructions` |

## Поисковые поля (blind index)

- `patients.full_name_hash` — HMAC-SHA256 полного нормализованного ФИО.
- `patients.name_tokens` — список HMAC по отдельным словам ФИО (поиск «иванов сергей»).
- `patients.birth_year` — нешифрованный год рождения для возрастных агрегатов.
- `medical_records.icd_code` — код МКБ (не шифруется, используется в статистике).

## Связи

```
users ──< patients (user_id)
users ──1 doctors (user_id)
departments ──< doctors
patients ──< appointments >── doctors
patients ──< medical_records >── doctors
patients ──< analyses >── doctors ──< analysis_types
analyses ──< analysis_results
patients ──< prescriptions
```

## Единицы измерения статистики

Все агрегаты считаются по **незашифрованным** колонкам (даты, статусы, МКБ-код,
пол, `birth_year`, флаги результатов) — расшифровка строк для статистики не нужна.

## Миграции

- `0001_core.sql` — роли, права, пользователи, сессии, аудит, настройки
- `0002_medical.sql` — отделения, пациенты, врачи, записи, приёмы, анализы, назначения
- `0003_rbac.sql` — наполнение матрицы прав и справочника анализов
- `0004_patient_tokens.sql` — token blind-index для поиска по ФИО
