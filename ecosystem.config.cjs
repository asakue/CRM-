module.exports = {
  apps: [
    {
      name: 'hospital-crm',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=hospital-crm-db --local --ip 0.0.0.0 --port 3000',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        // Dev-only secret for field encryption. Production uses a Cloudflare
        // secret binding (wrangler pages secret put APP_SECRET).
        APP_SECRET: 'dev-only-secret-change-me-in-production-0123456789',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    },
  ],
}
