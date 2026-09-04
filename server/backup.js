'use strict';
/**
 * 数据自动快照备份模块（零依赖）
 * - 启动时立即快照 + 每 N 小时定时快照，把 data 目录完整复制到备份目录
 * - 滚动保留最近 KEEP 份，超出自动删除最旧的，控制磁盘占用
 * - 备份目录默认在 server 上一级（生产 = /opt/peizhen/backups，与 server 代码隔离，
 *   升级覆盖 server.js / 误删 server 目录都不影响备份）
 *
 * 环境变量（可选）：
 *   BACKUP_DIR            备份根目录，默认 path.join(__dirname, '..', 'backups')
 *   BACKUP_KEEP           保留份数，默认 30
 *   BACKUP_INTERVAL_HOURS 定时间隔（小时），默认 6
 */
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 30);
const INTERVAL_MS = Math.max(60 * 1000, (Number(process.env.BACKUP_INTERVAL_HOURS) || 6) * 60 * 60 * 1000);

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 复制一份快照（排除写入中的 .tmp 残留），返回快照目录路径 */
function snapshot(dataDir) {
  if (!fs.existsSync(dataDir)) return null;
  try {
    const dest = path.join(BACKUP_DIR, 'snapshot-' + stamp());
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(dataDir, dest, {
      recursive: true,
      filter: (src) => !src.endsWith('.tmp')
    });
    prune();
    return dest;
  } catch (e) {
    console.error('[backup] 快照失败', e.message);
    return null;
  }
}

/** 滚动清理：只保留最近 KEEP 份快照 */
function prune() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const entries = fs.readdirSync(BACKUP_DIR)
      .filter(n => /^snapshot-\d{8}-\d{6}$/.test(n))
      .sort(); // 时间戳字典序即时间序
    while (entries.length > KEEP) {
      const oldest = entries.shift();
      fs.rmSync(path.join(BACKUP_DIR, oldest), { recursive: true, force: true });
    }
  } catch (e) {
    console.error('[backup] 清理旧快照失败', e.message);
  }
}

/** 启动备份：立即快照一次 + 定时快照 */
function start(dataDir) {
  const first = snapshot(dataDir);
  if (first) console.log('[backup] 已生成启动快照: ' + first);
  const timer = setInterval(() => snapshot(dataDir), INTERVAL_MS);
  if (timer.unref) timer.unref(); // 不阻止进程退出
  return timer;
}

module.exports = { snapshot, start, BACKUP_DIR, KEEP };
