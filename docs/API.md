# Справочник API

Все ответы: `{ "success": true, "data": ... }` или
`{ "success": false, "error": "...", "message": "..." }`.

Авторизация — cookie `hosp_session`. Для POST/PUT/PATCH/DELETE обязателен
заголовок `X-CSRF-Token` (значение из cookie `hosp_csrf`).

## Аутентификация — `/api/auth`

| Метод | Путь | Права | Описание |
|---|---|---|---|
| POST | `/login` | публично | вход; ставит cookie-сессию |
| POST | `/logout` | сессия | выход |
| GET | `/me` | сессия | текущий пользователь + права + CSRF |
| POST | `/change-password` | сессия | смена пароля (отзывает сессии) |
| POST | `/register` | публично¹ | самозапись пациента ¹если открыто админом |
| GET | `/csrf` | сессия | обновить CSRF-токен |

## Пациенты — `/api/patients`

| Метод | Путь | Права | Описание |
|---|---|---|---|
| GET | `/` | view.self/department/all | список; `q` (поиск), `status`, `page`, `per_page` |
| GET | `/me/chart` | пациент | своя карта |
| GET | `/:id` | по scope | карта пациента |
| POST | `/` | `patients.create` | создать |
| PUT | `/:id` | edit.* | обновить (пациент — только контакты) |

## Врачи / Отделения

| Метод | Путь | Права |
|---|---|---|
| GET | `/api/doctors` | `doctors.view.all` |
| POST | `/api/doctors` | `doctors.manage` |
| PUT | `/api/doctors/:id` | `doctors.manage` |
| GET | `/api/departments` | `departments.view` |
| POST/PUT | `/api/departments[/:id]` | `departments.manage` |

## Записи — `/api/appointments`

| Метод | Путь | Права | Описание |
|---|---|---|---|
| GET | `/` | view.self/department/all | фильтры `status`, `from`, `to` |
| GET | `/:id` | по scope | одна запись |
| POST | `/` | `appointments.create`/`create.self` | создать |
| PATCH | `/:id` | manage / владелец | смена статуса |

## Приёмы — `/api/records`

| Метод | Путь | Права |
|---|---|---|
| GET | `/` | view.self/department/all |
| GET | `/:id` | по scope |
| POST | `/` | `records.create` (только врач) |

## Анализы — `/api/analyses`

| Метод | Путь | Права |
|---|---|---|
| GET | `/types` | сессия |
| GET | `/` | view.self/department/all |
| GET | `/:id` | по scope |
| POST | `/` | `analyses.order` |
| POST | `/:id/results` | `analyses.enter` |
| PATCH | `/:id` | order/enter |

## Назначения — `/api/prescriptions`

| Метод | Путь | Права |
|---|---|---|
| GET | `/` | view.self/department/all |
| POST | `/` | `prescriptions.create` |
| PATCH | `/:id` | `prescriptions.create` |

## Статистика — `/api/stats`

| Метод | Путь | Права | Данные |
|---|---|---|---|
| GET | `/summary` | сессия | сводка по роли |
| GET | `/patients` | `stats.patients.*` | пол, возраст, визиты, МКБ, флаги |
| GET | `/doctors` | `stats.doctors.*` | нагрузка врачей |
| GET | `/activity` | `stats.patients.*` | активность из аудита |

Параметр `range`: `7d` | `30d` | `90d` | `365d`.

## Администрирование — `/api/admin`

| Метод | Путь | Права |
|---|---|---|
| GET | `/users` | `admin.users` |
| POST | `/users` | `admin.users` |
| PATCH | `/users/:id` | `admin.users` |
| GET | `/roles` | `admin.roles` |
| GET | `/permissions` | `admin.roles` |
| GET | `/audit` | `admin.audit` |
| GET/PUT | `/settings` | `admin.settings` |

## Служебные

- `GET /api/health` — статус (публично).
