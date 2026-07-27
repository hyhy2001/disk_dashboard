// pm2 process definition.
//
// One process serves both the API and the built web assets, on the port nginx
// proxies to. The previous setup ran `npm run dev` (Vite + tsx watch) behind
// nginx, which dies on any crash and has no restart policy — fine for a laptop,
// not for something a vhost points at.
//
// Usage:
//   npm run build
//   pm2 start ecosystem.config.cjs && pm2 save

const { resolve } = require('node:path')

const root = __dirname

module.exports = {
  apps: [
    {
      name: 'disk-dashboard',
      script: resolve(root, 'server/dist/server/src/index.js'),
      cwd: root,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      // A restart loop from a bad config should not spin the CPU.
      restart_delay: 2000,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        // nginx (dashboard.hydev.me) proxies to this port.
        DASHBOARD_PORT: '5311',
        // Loopback only: nginx terminates TLS and is the sole entry point.
        DASHBOARD_HOST: '127.0.0.1',
        DASHBOARD_REPORTS_DIR: resolve(root, '..', 'disk_scanner', 'reports'),
        DASHBOARD_WEB_DIR: resolve(root, 'web/dist'),
        DASHBOARD_LOG_LEVEL: 'info',
      },
      out_file: resolve(root, 'logs/out.log'),
      error_file: resolve(root, 'logs/error.log'),
      merge_logs: true,
      time: true,
    },
  ],
}
