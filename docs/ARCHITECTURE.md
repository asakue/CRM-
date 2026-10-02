# Архитектура

## Обзор

```
Браузер (SPA: HTML + Tailwind CDN + vanilla JS)
        │  fetch /api/*  (JSON, cookie-сессия, X-CSRF-Token)
        ▼
Cloudflare Worker (Hono)  ── src/index.tsx
        │  middleware: securityHeaders → loadUser → csrfProtection → authGate
        ▼
   Маршруты /api/*  (src/routes/*)
        │  RBAC (requirePermission) + scope-фильтры в SQL
        ▼
   Cloudflare D1 (SQLite)  ── binding DB
        │  чувствительные поля: AES-256-GCM (src/lib/crypto.ts)
```

## Слои

| Слой | Файлы | Ответственность |
|---|---|---|
| Точка входа | `src/index.tsx` | middleware, монтирование маршрутов, SPA-оболочка, обработчик ошибок |
| Безопасность | `src/lib/crypto.ts`, `auth.ts`, `middleware.ts`, `rbac.ts` | шифрование, хеш пароля, сессии, CSRF, заголовки, права |
| Доступ к данным | `src/lib/db.ts`, `patient-service.ts`, `enc-fields.ts` | parameterized-запросы, шифрование/дешифрование, аудит |
| API | `src/routes/*.ts` | REST по доменам, проверка прав и области видимости |
| Фронтенд | `public/static/*.js`, `style.css` | SPA-роутер, представления по ролям, графики |

## Поток запроса

1. `securityHeaders` — CSP, HSTS, X-Frame-Options и др.
2. `loadUser` — читает cookie `hosp_session`, валидирует токен (хранится только
   его SHA-256), подгружает роль, права и привязки (doctor_id/patient_id/department_id).
3. `csrfProtection` — для POST/PUT/PATCH/DELETE сверяет `X-CSRF-Token` с токеном сессии.
4. `authGate` — все `/api/*` (кроме login/register/logout/health) требуют сессию → 401.
5. Маршрут: `requirePermission(...)` + scope-фильтр (пациент — свои, врач — отделение, chief — всё).
6. Любое чтение/изменение медданных пишется в `audit_log`.

## Шифрование полей

- Секрет `APP_SECRET` (Cloudflare secret) → HKDF-SHA256 → ключ AES-256-GCM.
- Каждое значение: `base64(iv[12] || ciphertext+tag)`, свежий IV на запись.
- Blind index: HMAC-SHA256 для поиска (`full_name_hash`, `name_tokens`).

## Ленивая периодика (вместо cron)

Платформа не поддерживает cron. Вместо фоновых задач применяется «ленивый»
подход: переиндексация токенов пациентов (`backfillNameTokens`) выполняется при
первом поиске, а не по расписанию.
