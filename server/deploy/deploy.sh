#!/usr/bin/env bash
# 陪诊预约后端一键部署脚本（Ubuntu 22.04/24.04，腾讯云轻量服务器）
# 在服务器上以 root 运行：bash deploy.sh
# 前置条件：项目文件已放到 /opt/peizhen/server/（含 server.js db.js deploy/）
set -euo pipefail

echo "==> [1/6] 更新系统并安装 Nginx"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx curl

echo "==> [2/6] 安装 Node.js 20 (NodeSource)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "    Node 版本: $(node -v)"

echo "==> [3/6] 安装 PM2 并开机自启"
npm install -g pm2 --registry=https://registry.npmmirror.com
mkdir -p /var/log/peizhen

echo "==> [4/6] 启动后端（仅监听 127.0.0.1:8300）"
cd /opt/peizhen/server
mkdir -p data
pm2 start deploy/ecosystem.config.js || pm2 reload deploy/ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "==> [5/6] 配置 Nginx 反代（80 → 127.0.0.1:8300）"
rm -f /etc/nginx/sites-enabled/default
cp deploy/nginx-peizhen.conf /etc/nginx/sites-available/peizhen
ln -sf /etc/nginx/sites-available/peizhen /etc/nginx/sites-enabled/peizhen
nginx -t
systemctl reload nginx
systemctl enable nginx >/dev/null 2>&1 || true

echo "==> [6/6] 防火墙：封掉 8300 直连（轻量防火墙在控制台配，这里是双保险）"
if command -v ufw >/dev/null 2>&1; then
  ufw deny 8300/tcp >/dev/null 2>&1 || true
fi

echo ""
echo "=============================================="
echo "  部署完成！"
echo "  健康检查: curl http://127.0.0.1:8300/api/config"
echo "  公网访问: http://120.53.4.14/api/config"
echo "  日志:     pm2 logs peizhen-api"
echo "  重启:     pm2 reload peizhen-api"
echo "=============================================="
