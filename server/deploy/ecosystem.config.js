// PM2 进程配置：陪诊预约后端生产环境
// 用法：pm2 start ecosystem.config.js && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'peizhen-api',
      script: 'server.js',
      cwd: '/opt/peizhen/server',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 8300,
        HOST: '127.0.0.1'   // 只监听本机，由 Nginx 反代对外
        // 正式接入微信登录时取消注释并填写：
        // WX_APPID: '',
        // WX_SECRET: ''
      },
      max_memory_restart: '200M',
      error_file: '/var/log/peizhen/error.log',
      out_file: '/var/log/peizhen/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
