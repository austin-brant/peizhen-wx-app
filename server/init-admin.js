'use strict';
/**
 * 管理端白名单初始化工具
 * 首次部署/本地联调时，用于把手机号加入管理员白名单（直改 config.json）。
 * 因为"白名单为空时无法通过登录获取验证码"，首次配置必须用本工具或直接编辑 config.json。
 *
 * 用法：
 *   node init-admin.js 13800138000            # 添加一个白名单手机号
 *   node init-admin.js 13800138000 13900139000 # 添加多个
 *   node init-admin.js --password newpwd123    # 顺带修改管理密码
 *   node init-admin.js --list                  # 查看当前白名单
 */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const configPath = path.join(dataDir, 'config.json');

const args = process.argv.slice(2);
const phones = args.filter(a => !a.startsWith('--'));
const passwordArg = args.find(a => a.startsWith('--password='));
const wantList = args.includes('--list');

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

let cfg = {};
if (fs.existsSync(configPath)) {
  try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch (e) { fail('config.json 解析失败：' + e.message); }
}

if (wantList) {
  console.log('当前白名单手机号：' + ((cfg.adminPhones || []).join(', ') || '（空）'));
  process.exit(0);
}

let changed = false;

if (passwordArg) {
  const pwd = passwordArg.split('=')[1];
  if (pwd.length < 4) fail('密码至少 4 位');
  cfg.adminPassword = pwd;
  changed = true;
  console.log('✓ 管理密码已更新');
}

if (phones.length) {
  const list = Array.isArray(cfg.adminPhones) ? cfg.adminPhones.slice() : [];
  phones.forEach(p => {
    const phone = String(p).trim();
    if (!/^1\d{10}$/.test(phone)) { console.warn('  ⚠ 跳过非法手机号：' + p); return; }
    if (list.indexOf(phone) >= 0) { console.log('  - 已存在：' + phone); return; }
    list.push(phone);
    changed = true;
    console.log('✓ 已加入白名单：' + phone);
  });
  cfg.adminPhones = list;
}

if (!changed) fail('未做任何修改。用法：node init-admin.js <手机号> [--password=新密码] [--list]');

fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
console.log('✓ 已写入 ' + configPath);
