module.exports = {
  apps: [{
    name: 'celebskin',
    script: 'npm',
    args: 'start',
    cwd: '/opt/celebskin/site',
    max_memory_restart: '400M',
    cron_restart: '0 */6 * * *',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/opt/celebskin/logs/error.log',
    out_file: '/opt/celebskin/logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
