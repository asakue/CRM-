import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import type { AppEnv } from './types'
import { securityHeaders, loadUser, csrfProtection } from './lib/middleware'

import authRoutes from './routes/auth'
import patientsRoutes from './routes/patients'
import doctorsRoutes from './routes/doctors'
import departmentsRoutes from './routes/departments'
import appointmentsRoutes from './routes/appointments'
import recordsRoutes from './routes/records'
import analysesRoutes from './routes/analyses'
import prescriptionsRoutes from './routes/prescriptions'
import statsRoutes from './routes/stats'
import adminRoutes from './routes/admin'

const app = new Hono<AppEnv>()

// --- Global middleware ----------------------------------------------------
app.use('*', securityHeaders)
app.use('*', loadUser)
app.use('*', csrfProtection)

// Authentication gate: every /api/* route needs a session, except the public
// ones. This guarantees unauthenticated requests get a clean 401 instead of
// reaching a handler that dereferences a null user.
const PUBLIC_API = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/health',
])
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (PUBLIC_API.has(path)) return next()
  if (!c.get('user')) {
    return c.json({ success: false, error: 'unauthorized', message: 'Требуется авторизация' }, 401)
  }
  await next()
})

// --- Static assets --------------------------------------------------------
// public/static/* → /static/*
app.use('/static/*', serveStatic({ root: './public' }))
app.get('/favicon.ico', serveStatic({ path: './public/favicon.svg' }))

// --- API routes -----------------------------------------------------------
app.route('/api/auth', authRoutes)
app.route('/api/patients', patientsRoutes)
app.route('/api/doctors', doctorsRoutes)
app.route('/api/departments', departmentsRoutes)
app.route('/api/appointments', appointmentsRoutes)
app.route('/api/records', recordsRoutes)
app.route('/api/analyses', analysesRoutes)
app.route('/api/prescriptions', prescriptionsRoutes)
app.route('/api/stats', statsRoutes)
app.route('/api/admin', adminRoutes)

// --- Health check ---------------------------------------------------------
app.get('/api/health', (c) => c.json({ status: 'ok', app: 'hospital-crm' }))

// --- Central error handler ------------------------------------------------
// Any uncaught error in an API route returns a clean JSON 500 instead of a
// raw stack; non-API routes fall through to the SPA shell.
app.onError((err, c) => {
  console.error('unhandled error:', err)
  const path = new URL(c.req.url).pathname
  if (path.startsWith('/api/')) {
    return c.json(
      { success: false, error: 'internal', message: 'Внутренняя ошибка сервера' },
      500
    )
  }
  return c.text('Internal Server Error', 500)
})

app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) {
    return c.json({ success: false, error: 'not_found', message: 'Маршрут не найден' }, 404)
  }
  return c.html(renderShell())
})

// --- SPA shell (all non-API GET routes) -----------------------------------
app.get('*', (c) => {
  return c.html(renderShell())
})

function renderShell(): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Медицинская CRM — Больница</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link href="/static/style.css" rel="stylesheet" />
</head>
<body class="bg-slate-100 text-slate-800">
  <div id="app"></div>
  <div id="toast-container" class="fixed top-4 right-4 z-50 space-y-2"></div>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script src="/static/helpers.js"></script>
  <script src="/static/views.js"></script>
  <script src="/static/views2.js"></script>
  <script src="/static/app.js"></script>
</body>
</html>`
}

export default app
