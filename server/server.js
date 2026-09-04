'use strict';
/**
 * 陪诊预约小程序 · 后端服务
 * - 纯 Node.js http 实现，零 npm 依赖，Node >= 16 即可运行
 * - 启动：node server.js   （默认端口 8300，可用 PORT 环境变量覆盖）
 * - 数据存储：./data/ 下的 JSON 文件（config / orders / blocked / users）
 *
 * 微信登录说明：
 * - 本地联调（未配置 appid/secret）：返回固定 openid（dev_openid），保证流程可跑通
 * - 真实上线：在管理端【设置】填写小程序 appid / secret（或设置环境变量
 *   WX_APPID / WX_SECRET），本服务会调用 code2session 换取真实 openid
 *
 * 管理端登录说明：
 * - 微信白名单 + 密码双校验：当前微信 openid 必须在 adminOpenids 白名单内，
 *   且密码正确，才能登录管理端；白名单内微信登录一次后即可「一键登录」。
 * - 管理员白名单由管理端【设置】维护（把当前微信加入/移出白名单），
 *   首个管理员需由服务器直改 config.json 的 adminOpenids 引导开通。
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DB } = require('./db.js');
const { start: startBackup } = require('./backup.js');

const PORT = process.env.PORT || 8300;
const DATA_DIR = path.join(__dirname, 'data');
const db = new DB(DATA_DIR);

/* ============================== 图片上传 ============================== */

// 陪诊师介绍等处的图片存储目录（与数据同目录，重启不丢失）
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { console.error('[server] 创建上传目录失败', e.message); }

// 允许的图片类型（后缀 -> Content-Type）
const IMG_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
};
const IMG_MAX_BYTES = 500 * 1024; // 单张图片上限 500KB

/* ============================== 数据集合 ============================== */

const DEFAULT_CONFIG = {
  serviceName: '专业陪诊服务',
  escortName: '陪诊师小护',
  servicePrice: 200,        // 每小时单价（元）：订单总价 = 单价 × 时长 × 折扣
  phone: '',                // 展示给预约者的联系电话
  workStart: '09:00',       // 每日可预约开始时间
  workEnd: '18:00',         // 每日可预约结束时间
  slotMinutes: 60,          // 每段时长（分钟）
  notice: '预约成功后请按时到达医院门口，如需改期请提前联系。',
  wechatId: '',             // 陪诊师微信号（首页"微信联系"按钮使用）
  kfUrl: '',                // 企业微信客服链接（配置后微信联系按钮优先跳转客服）
  wxCorpId: '',             // 企业微信ID（与 kfUrl 配合：二者都配置后微信联系可直接跳转客服聊天窗口）
  about: '',                // 陪诊师介绍（Markdown：# 标题 / **加粗** / - 列表 / ![图片](链接)，首页点击陪诊师名称查看）
  escortAvatar: '',         // 陪诊师头像（相对 URL /api/uploads/xx 或 http(s) 链接，管理端设置）
  hospitals: [],            // 候选医院列表（预约填单下拉选择）
  departments: [],          // 候选科室列表（预约填单下拉选择，无匹配项可手动输入）
  discounts: [],            // 多级折扣规则 [{ hours: 4, rate: 0.9 }]：时长 >= hours 时按 rate 计费，取最大可匹配档
  noteOptions: [],          // 备注快捷选项（预约填单点选填入）
  adminPassword: '123456',  // 管理端密码（上线前请修改）
  adminPhones: [],          // 【已废弃】旧版手机号白名单（v2 起改用 adminOpenids + 密码登录，字段仅兼容保留）
  adminOpenids: [],         // 管理端微信白名单：白名单内的 openid + 正确密码可登录管理端
  adminLabels: {},          // 管理员备注名 { openid: '备注' }：仅用于展示辨认，不参与任何鉴权
  webAdmin: {               // Web 管理页（/manage）登录凭据：只存 pbkdf2 哈希 + 盐，绝不存明文密码
    username: '',           // 登录账号
    passHash: '',           // pbkdf2(password, salt) 十六进制
    salt: ''                // 随机盐（十六进制）
  },
  wxaAppid: '',             // 微信小程序 appid（真实登录用；可留空走模拟模式）
  wxaSecret: '',            // 微信小程序 secret（真实登录用；建议用环境变量 WX_SECRET）
  createdAt: '',
  updatedAt: ''
};

function getConfig() {
  const cfg = db.read('config', null);
  if (!cfg) {
    db.save('config', Object.assign({}, DEFAULT_CONFIG, { createdAt: nowIso() }));
    return db.cache.config;
  }
  return Object.assign({}, DEFAULT_CONFIG, cfg);
}

function saveConfig(patch) {
  const cfg = getConfig();
  const next = Object.assign({}, cfg, patch, { updatedAt: nowIso() });
  db.save('config', next);
  return next;
}

function getOrders() {
  return db.read('orders', { list: [] }).list;
}
function saveOrders(list) {
  db.save('orders', { list });
}

function getBlocked() {
  return db.read('blocked', { list: [] }).list;
}
function saveBlocked(list) {
  db.save('blocked', { list });
}

function getUsers() {
  return db.read('users', { list: [] }).list;
}
function saveUsers(list) {
  db.save('users', { list });
}

function findUser(openid) {
  return getUsers().find(u => u.openid === openid) || null;
}

function upsertUser(openid, patch) {
  const list = getUsers();
  let u = list.find(x => x.openid === openid);
  if (!u) {
    u = { openid, nickname: '', avatarUrl: '', name: '', phone: '', createdAt: nowIso(), lastLoginAt: nowIso() };
    list.push(u);
  }
  Object.assign(u, patch, { lastLoginAt: nowIso() });
  saveUsers(list);
  return u;
}

/* ============================== 工具函数 ============================== */

const nowIso = () => new Date().toISOString();

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) ? dt : null;
}

function parseTime(s) {
  if (!/^\d{2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function fmtMinutes(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }

function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * 保存 base64 图片到上传目录（后缀白名单 + 500KB 服务端强制上限）
 * @returns {{url, size}} 成功；{err} 失败
 */
function saveImageBase64(b64, mime, filename) {
  b64 = String(b64 || '').replace(/^data:image\/[\w.+-]+;base64,/, '');
  if (!b64) return { err: '图片内容为空' };
  // 后缀：优先按 mime，其次按文件名，均不合法则拒绝
  let ext = '';
  const m = String(mime || '').split('/')[1];
  if (m && IMG_TYPES[m.toLowerCase()]) ext = m.toLowerCase();
  if (!ext) {
    const nameExt = String(filename || '').split('.').pop().toLowerCase();
    if (IMG_TYPES[nameExt]) ext = nameExt;
  }
  if (!ext) return { err: '仅支持 png / jpg / jpeg / gif / webp 图片' };
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { err: '图片内容为空' };
  if (buf.length > IMG_MAX_BYTES) {
    return { err: '图片大小超过 500KB（当前 ' + Math.round(buf.length / 1024) + 'KB），请压缩后再上传' };
  }
  const fname = genId('IMG') + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
  return { url: '/api/uploads/' + fname, size: buf.length };
}

function sanitizeList(arr, max) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  (arr || []).forEach(x => {
    const v = String(x == null ? '' : x).trim();
    if (v && !seen.has(v) && out.length < (max || 50)) { seen.add(v); out.push(v); }
  });
  return out;
}

/** 折扣规则清洗：[{hours, rate}]，hours>0、0<rate<=1，去重并按 hours 升序，最多 10 条 */
function sanitizeDiscounts(arr) {
  if (!Array.isArray(arr)) return [];
  // 每个"满 X 小时"档位唯一：同 hours 后写覆盖（避免多档同小时导致计价不确定）
  const map = new Map();
  arr.forEach(x => {
    const hours = Math.round((Number(x && x.hours) || 0) * 10) / 10;
    const rate = Math.round((Number(x && x.rate) || 0) * 1000) / 1000;
    if (hours > 0 && rate > 0 && rate <= 1) {
      map.set(hours, { hours, rate });
    }
  });
  const out = Array.from(map.values());
  out.sort((a, b) => a.hours - b.hours);
  return out.slice(0, 10);
}

/**
 * 订单计价：总价 = 单价 × 时长 × 折扣
 * 折扣取所有 hours <= 时长 的档位中 hours 最大的一个（例：满4小时9折、满8小时8折，时长6小时 → 9折）
 */
function calcPrice(cfg, durationHours) {
  const unit = Number(cfg.servicePrice) || 0;
  const hours = Math.round((Number(durationHours) || 0) * 10) / 10;
  let rate = 1, matched = null;
  (cfg.discounts || []).forEach(d => {
    const h = Number(d.hours) || 0, r = Number(d.rate) || 1;
    if (h > 0 && r > 0 && r <= 1 && h <= hours && (!matched || h > matched.hours)) {
      matched = { hours: h, rate: r };
    }
  });
  if (matched) rate = matched.rate;
  const total = Math.round(unit * hours * rate * 100) / 100;
  return {
    unitPrice: unit,
    durationHours: hours,
    discountRate: rate,
    discountHours: matched ? matched.hours : 0,
    discountDesc: matched ? ('满' + matched.hours + '小时打' + (Math.round(matched.rate * 10)) + '折') : '',
    total
  };
}

/* ============================== 微信登录 ============================== */

/**
 * code -> openid
 * - 配置了 wxaAppid/wxaSecret（或环境变量）时走真实 code2session
 * - 否则按 code 派生稳定 dev_openid，保证本地联调流程可完整跑通
 */
function codeToOpenid(code, cfg) {
  const appid = cfg.wxaAppid || process.env.WX_APPID || '';
  const secret = cfg.wxaSecret || process.env.WX_SECRET || '';
  if (appid && secret) {
    return new Promise((resolve, reject) => {
      const url = 'https://api.weixin.qq.com/sns/jscode2session?appid=' +
        encodeURIComponent(appid) + '&secret=' + encodeURIComponent(secret) +
        '&js_code=' + encodeURIComponent(code) + '&grant_type=authorization_code';
      https.get(url, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.openid) resolve(j.openid);
            else reject(new Error('微信登录失败: ' + (j.errmsg || '未知错误')));
          } catch (e) { reject(new Error('微信登录返回异常')); }
        });
      }).on('error', reject);
    });
  }
  // 模拟模式：按 code 派生稳定 openid（同 code 同 openid，不同 code 不同账号）
  return Promise.resolve('dev_' + crypto.createHash('sha1').update('peizhen:' + code).digest('hex').slice(0, 16));
}

function isAdminOpenid(openid) {
  return !!openid && (getConfig().adminOpenids || []).indexOf(openid) >= 0;
}

/**
 * 解析管理登录的身份 openid
 * - 配置了真实 appid/secret：以 code2session 结果为准（忽略前端传入的 openid，防止伪造）
 * - 模拟模式（未配置）：优先使用前端缓存的 openid（与 /api/login 一致；开发者工具 wx.login 的 code 每次变化，
 *   若每次重新派生 openid 会漂移，导致「复制 openid 加入白名单后仍登录失败」），否则按 code 派生
 */
function resolveLoginOpenid(body, cfg) {
  const appid = cfg.wxaAppid || process.env.WX_APPID || '';
  const secret = cfg.wxaSecret || process.env.WX_SECRET || '';
  if (appid && secret) return codeToOpenid(String(body.code || ''), cfg);
  if (body.openid) return Promise.resolve(String(body.openid));
  return codeToOpenid(String(body.code || ''), cfg);
}

/* ============================== 微信手机号 ============================== */

// access_token 缓存（约 2 小时有效，提前 60 秒刷新）
let _wxToken = { token: '', expiresAt: 0 };

function getWxAccessToken(appid, secret) {
  const now = Date.now();
  if (_wxToken.token && _wxToken.expiresAt > now + 60000) return Promise.resolve(_wxToken.token);
  const url = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' +
    encodeURIComponent(appid) + '&secret=' + encodeURIComponent(secret);
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.access_token) {
            _wxToken = { token: j.access_token, expiresAt: now + (Number(j.expires_in) || 7200) * 1000 };
            resolve(j.access_token);
          } else {
            reject(new Error('获取微信 access_token 失败: ' + (j.errmsg || '未知错误')));
          }
        } catch (e) { reject(new Error('微信接口返回异常')); }
      });
    }).on('error', reject);
  });
}

/**
 * 用 getPhoneNumber 返回的 code 换取手机号（新版接口 getuserphonenumber）
 * 需配置小程序 appid/secret，且手机号归属当前微信登录用户
 */
function getPhoneByCode(code, cfg) {
  const appid = cfg.wxaAppid || process.env.WX_APPID || '';
  const secret = cfg.wxaSecret || process.env.WX_SECRET || '';
  if (!appid || !secret) {
    return Promise.reject(new Error('获取手机号需先配置小程序 AppID 与 Secret（当前为模拟模式）'));
  }
  return getWxAccessToken(appid, secret).then(token => new Promise((resolve, reject) => {
    const url = 'https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=' + encodeURIComponent(token);
    const body = JSON.stringify({ code });
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.errcode === 0 && j.phone_info && j.phone_info.phoneNumber) {
            resolve(j.phone_info.phoneNumber);
          } else {
            reject(new Error('获取手机号失败: ' + (j.errmsg || '未知错误')));
          }
        } catch (e) { reject(new Error('微信接口返回异常')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  }));
}

/* ============================== 时段逻辑 ============================== */

/** 按配置生成某一天的原始时段 */
function generateSlots(dateStr, cfg) {
  const slots = [];
  const startMin = parseTime(cfg.workStart);
  const endMin = parseTime(cfg.workEnd);
  const step = Number(cfg.slotMinutes) || 60;
  if (startMin === null || endMin === null || endMin <= startMin) return slots;
  for (let m = startMin; m + step <= endMin; m += step) {
    slots.push({ date: dateStr, start: fmtMinutes(m), end: fmtMinutes(m + step) });
  }
  return slots;
}

/** 某时段是否被未取消的订单占用（按区间重叠判断，多段订单会命中其占用的每个时段） */
function activeOrderFor(dateStr, start, end) {
  return getOrders().find(o => o.date === dateStr && o.status !== 'cancelled' && overlap(start, end, o.start, o.end)) || null;
}

function isBlocked(dateStr, start) {
  return getBlocked().some(e => e.date === dateStr && (e.allDay || (start >= e.start && start < e.end)));
}

function overlap(a, b, c, d) { return a < d && c < b; }

function hasActiveOrderOverlap(dateStr, start, end) {
  return getOrders().some(o =>
    o.date === dateStr && o.status !== 'cancelled' && overlap(start, end, o.start, o.end)
  );
}

/** 装饰状态：available | unavailable | booked */
function decorateSlots(rawSlots) {
  return rawSlots.map(s => {
    const order = activeOrderFor(s.date, s.start, s.end);
    // orderStatus 供管理端/用户端区分该已约时段对应订单的状态（待确认/已确认/已完成等）
    if (order) return Object.assign({}, s, { status: 'booked', orderId: order.id, orderStatus: order.status });
    if (isBlocked(s.date, s.start)) return Object.assign({}, s, { status: 'unavailable', orderId: null });
    return Object.assign({}, s, { status: 'available', orderId: null });
  });
}

function slotsFor(dateStr, cfg) {
  return decorateSlots(generateSlots(dateStr, cfg));
}

/** 某天工作时间内的小时块（整点粒度），供管理端"按小时"开关 */
function hourBlocksFor(dateStr, cfg) {
  const workStart = parseTime(cfg.workStart);
  const workEnd = parseTime(cfg.workEnd);
  if (workStart === null || workEnd === null || workEnd <= workStart) return [];
  const step = Number(cfg.slotMinutes) || 60;
  const hStart = Math.ceil(workStart / 60);
  const hEnd = Math.floor(workEnd / 60);
  const blocks = [];
  for (let h = hStart; h < hEnd; h++) {
    const hs = h * 60, he = (h + 1) * 60;
    const inSlots = [];
    for (let m = workStart; m + step <= workEnd; m += step) {
      if (overlap(hs, he, m, m + step)) inSlots.push({ start: fmtMinutes(m), end: fmtMinutes(m + step) });
    }
    if (!inSlots.length) continue;
    const booked = inSlots.filter(s => !!activeOrderFor(dateStr, s.start, s.end));
    const blocked = inSlots.filter(s => !activeOrderFor(dateStr, s.start, s.end) && isBlocked(dateStr, s.start));
    let status;
    if (booked.length) status = booked.length === inSlots.length ? 'booked' : 'partial';
    else if (blocked.length) status = blocked.length === inSlots.length ? 'unavailable' : 'partial';
    else status = 'available';
    blocks.push({ start: fmtMinutes(hs), end: fmtMinutes(he), status });
  }
  return blocks;
}

/* ============================== 防刷（限流） ============================== */

// 内存级限流，防止脚本/恶意高频刷单（预约即成功、无支付门槛，恶意刷单会占满时段影响真实患者）。
// 生产为单进程常驻，计数稳定；服务重启后计数清零（可接受）。维度：微信 openid + 手机号。
const rateState = new Map(); // key -> { lastAt, dayKey, dayCount }

/** 检查是否触发限流（只读判断，不计数；成功下单后才调用 rateLimitRecord 计数，避免用户填错重试被误限） */
function rateLimitCheck(key, opts) {
  const st = rateState.get(key);
  const today = fmtDate(new Date());
  if (!st || st.dayKey !== today) return null; // 无记录或跨天，不限制
  if (Date.now() - st.lastAt < opts.windowMs) return { err: opts.windowMsg };
  if (st.dayCount >= opts.dayMax) return { err: opts.dayMsg };
  return null;
}

/** 记录一次成功下单（用于频率窗口与单日上限） */
function rateLimitRecord(key) {
  const now = Date.now();
  const today = fmtDate(new Date());
  let st = rateState.get(key);
  if (!st || st.dayKey !== today) st = { lastAt: now, dayKey: today, dayCount: 0 };
  st.lastAt = now;
  st.dayCount += 1;
  rateState.set(key, st);
}

/* ============================== 订单逻辑 ============================== */

function findOrder(id) {
  return getOrders().find(o => o.id === id) || null;
}

/** 校验 date 的 [start, end) 区间是否完全可约（逐段检查，支持多段连续预约） */
function validateRange(date, start, end, cfg) {
  const startMin = parseTime(start), endMin = parseTime(end);
  const workStart = parseTime(cfg.workStart);
  const step = Number(cfg.slotMinutes) || 60;
  if (startMin === null || endMin === null || endMin <= startMin) return { err: '时间段不正确' };
  if ((startMin - workStart) % step !== 0 || (endMin - workStart) % step !== 0) {
    return { err: '所选时段需为完整的时间段' };
  }
  if (startMin + step > endMin) return { err: '至少选择一个完整时段' };
  for (let m = startMin; m < endMin; m += step) {
    const s = fmtMinutes(m);
    if (isBlocked(date, s)) return { err: '所选时段中包含不可约时段，请重新选择' };
    if (activeOrderFor(date, s, fmtMinutes(m + step))) return { err: '部分时段刚被预约，请重新选择' };
  }
  return null;
}

function createOrder(body, cfg) {
  const { date, start, end, hospital, department, notes, openid, forOthers } = body;
  if (!date || !start || !end) return { err: '请选择预约时段' };

  // 预约人信息（兼容旧版仅传 clientName/clientPhone 的提交）
  const bookerName = String(body.bookerName || body.clientName || '').trim();
  const bookerPhone = String(body.bookerPhone || body.clientPhone || '').trim();
  // 就诊人：为他人预约时是就诊人本人；否则默认与预约人相同
  const clientName = String(body.clientName || bookerName).trim();
  const clientPhone = String(body.clientPhone || bookerPhone).trim();

  if (!bookerName) return { err: '请填写预约人姓名' };
  if (!/^1\d{10}$/.test(bookerPhone)) return { err: '请填写正确的预约人手机号' };
  if (forOthers) {
    // 为他人预约：就诊人信息必须由前端显式提供（不可回退为预约人）
    if (!String(body.clientName || '').trim()) return { err: '请填写就诊人姓名' };
    if (!/^1\d{10}$/.test(String(body.clientPhone || ''))) return { err: '请填写正确的就诊人手机号' };
  }
  if (!clientName) return { err: '请填写就诊人姓名' };
  if (!hospital || !String(hospital).trim()) return { err: '请填写医院名称' };

  const rangeErr = validateRange(date, start, end, cfg);
  if (rangeErr) return rangeErr;

  const durationHours = Math.round((parseTime(end) - parseTime(start)) / 60 * 10) / 10;
  // 预约至少选择两个小时（由管理员确认后才生效）
  if (durationHours < 2) return { err: '预约时长至少为 2 小时，请选择连续两个及以上时段' };
  const slotCount = Math.round((parseTime(end) - parseTime(start)) / (Number(cfg.slotMinutes) || 60));
  const pricing = calcPrice(cfg, durationHours);

  const order = {
    id: genId('O'),
    date, start, end,
    durationHours,
    slotCount,
    openid: openid || '',
    // 预约人（下单人，管理员通过手机号联系；微信号不再收集，用户身份基于 openid 关联用户表）
    bookerName,
    bookerPhone,
    forOthers: !!forOthers,        // true = 为他人预约（就诊人另有其人）
    // 就诊人（患者）
    clientName,
    clientPhone,
    hospital: String(hospital).trim(),
    department: String(department || '').trim(),
    notes: String(notes || '').trim(),
    unitPrice: pricing.unitPrice,
    discountRate: pricing.discountRate,
    discountHours: pricing.discountHours,
    discountDesc: pricing.discountDesc,
    price: pricing.total,
    status: 'pending',      // pending(待确认) | confirmed(已确认) | completed | cancelled（预约后需管理员确认才生效）
    createdAt: nowIso(),
    confirmedAt: '',
    completedAt: '',
    cancelledAt: ''
  };
  const list = getOrders();
  list.push(order);
  saveOrders(list);
  // 基于 openid 关联用户资料：下单时把最新预约人姓名/手机号同步进用户表（供管理端展示用户信息）
  if (openid) {
    try { upsertUser(openid, { name: bookerName, phone: bookerPhone }); } catch (e) { /* 不影响下单 */ }
  }
  return { order };
}

function cancelOrder(orderId) {
  const order = findOrder(orderId);
  if (!order) return { err: '订单不存在' };
  if (order.status === 'completed') return { err: '服务已完成，无法取消' };
  if (order.status === 'cancelled') return { order };
  order.status = 'cancelled';
  order.cancelledAt = nowIso();
  saveOrders(getOrders());
  return { order };
}

function completeOrder(orderId) {
  const order = findOrder(orderId);
  if (!order) return { err: '订单不存在' };
  if (order.status === 'cancelled') return { err: '订单已取消' };
  if (order.status === 'completed') return { order };
  order.status = 'completed';
  order.completedAt = nowIso();
  saveOrders(getOrders());
  return { order };
}

/** 管理员确认预约：pending → confirmed（预约生效） */
function confirmOrder(orderId) {
  const order = findOrder(orderId);
  if (!order) return { err: '订单不存在' };
  if (order.status === 'cancelled') return { err: '订单已取消，无法确认' };
  if (order.status === 'completed' || order.status === 'finished') return { err: '订单已完成' };
  if (order.status === 'confirmed') return { order };
  order.status = 'confirmed';
  order.confirmedAt = nowIso();
  saveOrders(getOrders());
  return { order };
}

/** 管理员删除订单记录（永久删除，不可恢复） */
function deleteOrder(orderId) {
  const list = getOrders();
  const idx = list.findIndex(o => o.id === orderId);
  if (idx < 0) return { err: '订单不存在' };
  list.splice(idx, 1);
  saveOrders(list);
  return { ok: true };
}

/* ============================== 统计逻辑 ============================== */

function periodRange(period, refStr, startStr, endStr) {
  // 自定义时间段：start/end 均为 YYYY-MM-DD，跨度上限 366 天
  if (period === 'custom') {
    const s = parseDate(startStr), e = parseDate(endStr);
    if (!s || !e || s > e) return null;
    if ((e - s) / 86400000 > 366) return null;
    return { start: fmtDate(s), end: fmtDate(e) };
  }
  const ref = parseDate(refStr || fmtDate(new Date()));
  if (!ref) return null;
  let start, end;
  if (period === 'day') { start = new Date(ref); end = new Date(ref); }
  else if (period === 'week') {
    const offset = (ref.getDay() + 6) % 7; // 周一为一周开始
    start = new Date(ref); start.setDate(ref.getDate() - offset);
    end = new Date(start); end.setDate(start.getDate() + 6);
  } else if (period === 'month') {
    start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  } else if (period === 'year') {
    start = new Date(ref.getFullYear(), 0, 1);
    end = new Date(ref.getFullYear(), 11, 31);
  } else return null;
  return { start: fmtDate(start), end: fmtDate(end) };
}

function buildSeries(period, startStr, endStr, orders) {
  const s = parseDate(startStr), e = parseDate(endStr);
  const series = [];
  let byMonth = false; // 按月分桶（year / 长跨度 custom）
  const bucket = (key) => series.find(x => x.key === key) || (series.push({ key, label: key, count: 0, hours: 0, amount: 0 }), series[series.length - 1]);

  if (period === 'day') {
    bucket(startStr);
  } else if (period === 'week') {
    const W = ['一', '二', '三', '四', '五', '六', '日'];
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const key = fmtDate(d);
      const b = bucket(key);
      b.label = '周' + W[(d.getDay() + 6) % 7];
    }
  } else if (period === 'month') {
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const key = fmtDate(d);
      const b = bucket(key);
      b.label = (d.getMonth() + 1) + '/' + d.getDate();
    }
  } else if (period === 'year') {
    byMonth = true;
    for (let m = 0; m < 12; m++) {
      const b = bucket(String(s.getFullYear()) + '-' + pad(m + 1));
      b.label = (m + 1) + '月';
    }
  } else if (period === 'custom') {
    // 自定义时间段：≤62 天按日分桶，更长按月分桶
    const days = Math.round((e - s) / 86400000) + 1;
    byMonth = days > 62;
    if (byMonth) {
      const crossYear = s.getFullYear() !== e.getFullYear();
      for (let m = new Date(s.getFullYear(), s.getMonth(), 1); m <= e; m.setMonth(m.getMonth() + 1)) {
        const key = m.getFullYear() + '-' + pad(m.getMonth() + 1);
        const b = bucket(key);
        b.label = (crossYear ? m.getFullYear() + '/' : '') + (m.getMonth() + 1) + '月';
      }
    } else {
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const key = fmtDate(d);
        const b = bucket(key);
        b.label = (d.getMonth() + 1) + '/' + d.getDate();
      }
    }
  }

  orders.forEach(o => {
    if (byMonth) {
      const key = o.date.slice(0, 7);
      const b = bucket(key);
      b.count += 1; b.hours += o.durationHours || 0; b.amount += o.price || 0;
    } else {
      const b = bucket(o.date);
      if (b) { b.count += 1; b.hours += o.durationHours || 0; b.amount += o.price || 0; }
    }
  });

  series.forEach(b => { b.hours = Math.round(b.hours * 10) / 10; b.amount = Math.round(b.amount * 100) / 100; });
  return series;
}

function computeStats(period, refStr, startStr, endStr, statusFilter) {
  const range = periodRange(period, refStr, startStr, endStr);
  if (!range) return null;
  let valid = getOrders().filter(o => o.date >= range.start && o.date <= range.end);
  // 按订单状态过滤：'all'/缺省 = 有效订单（不含已取消）；其余按具体状态过滤
  if (statusFilter && statusFilter !== 'all') {
    valid = valid.filter(o => o.status === statusFilter);
  } else {
    valid = valid.filter(o => o.status !== 'cancelled');
  }

  let totalHours = 0, totalAmount = 0;
  valid.forEach(o => {
    totalHours += o.durationHours || 0;
    totalAmount += o.price || 0;
  });

  return {
    period,
    range,
    orderCount: valid.length,
    totalHours: Math.round(totalHours * 10) / 10,
    totalAmount: Math.round(totalAmount * 100) / 100,
    series: buildSeries(period, range.start, range.end, valid)
  };
}

/* ============================== 管理端鉴权 ============================== */

const tokens = new Map(); // token -> expiry

function issueToken() {
  const token = crypto.randomBytes(16).toString('hex');
  tokens.set(token, Date.now() + 24 * 3600 * 1000);
  return token;
}

function checkToken(req) {
  const t = req.headers['x-admin-token'];
  if (!t || !tokens.has(t)) return false;
  if (tokens.get(t) < Date.now()) { tokens.delete(t); return false; }
  return true;
}

/** 管理接口鉴权：token 有效，或请求头携带的管理员 openid 已绑定 */
function checkAdmin(req) {
  if (checkToken(req)) return true;
  const openid = req.headers['x-openid'];
  return isAdminOpenid(openid);
}

/* ============================== Web 管理页（/manage） ============================== */

/**
 * Web 管理页 = 超管入口，用于增删小程序管理端的微信白名单（adminOpenids）。
 * 与小程序管理端刻意隔离：
 * - 凭据只存 pbkdf2 哈希 + 随机盐，任何时候都不落盘明文密码
 * - token 独立于上面的 tokens（不复用 checkAdmin），避免 Web 凭据横向打通全部 /api/admin/* 接口
 * - 登录失败按 IP 限流，防暴力破解
 */

const WEB_TOKEN_TTL = 8 * 3600 * 1000;    // Web 登录有效期 8 小时（比小程序管理端 24h 更短）
const WEB_LOGIN_MAX_FAIL = 5;             // 同一 IP 连续失败上限
const WEB_LOGIN_LOCK_MS = 15 * 60 * 1000; // 触发上限后的锁定时长

const webTokens = new Map();  // webToken -> expiry
const loginFails = new Map(); // ip -> { count, until }

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 100000, 64, 'sha512').toString('hex');
}

/** 校验 Web 管理密码（timingSafeEqual 防时序攻击） */
function verifyWebPassword(input) {
  const wa = getConfig().webAdmin || {};
  if (!wa.passHash || !wa.salt) return false;
  let h;
  try {
    h = crypto.pbkdf2Sync(String(input), wa.salt, 100000, 64, 'sha512');
  } catch (e) { return false; }
  const expected = Buffer.from(String(wa.passHash), 'hex');
  if (!expected.length || h.length !== expected.length) return false;
  return crypto.timingSafeEqual(h, expected);
}

/**
 * 用环境变量初始化 Web 管理账号（仅在尚未初始化时执行，避免每次启动覆盖已改过的密码）。
 * 一次性用法：WEB_ADMIN_USERNAME=Austin WEB_ADMIN_PASSWORD=xxx node server.js
 * 初始化后哈希落盘 config.json，之后可去掉环境变量；改密请用页面上的「修改密码」。
 */
function ensureWebAdmin() {
  const wa = getConfig().webAdmin || {};
  if (wa.passHash && wa.salt) return;
  const pw = process.env.WEB_ADMIN_PASSWORD;
  if (!pw) return; // 未通过环境变量启用，保持未初始化（登录接口会明确提示）
  const salt = crypto.randomBytes(16).toString('hex');
  const username = process.env.WEB_ADMIN_USERNAME || wa.username || 'admin';
  saveConfig({ webAdmin: { username, salt, passHash: hashPassword(pw, salt) } });
  console.log('  Web 管理页账号已初始化: ' + username);
}

function issueWebToken() {
  const t = crypto.randomBytes(24).toString('hex');
  webTokens.set(t, Date.now() + WEB_TOKEN_TTL);
  return t;
}

function checkWebToken(req) {
  const t = req.headers['x-web-token'];
  if (!t || !webTokens.has(t)) return false;
  if (webTokens.get(t) < Date.now()) { webTokens.delete(t); return false; }
  return true;
}

/** 取客户端真实 IP（Nginx 反代下优先取 X-Forwarded-For / X-Real-IP） */
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || String(req.headers['x-real-ip'] || '').trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function loginLocked(ip) {
  const r = loginFails.get(ip);
  if (!r) return false;
  if (Date.now() > r.until) { loginFails.delete(ip); return false; }
  return r.count >= WEB_LOGIN_MAX_FAIL;
}

/** 记录一次登录失败，返回剩余可尝试次数 */
function recordLoginFail(ip) {
  const r = loginFails.get(ip) || { count: 0, until: 0 };
  r.count += 1;
  r.until = Date.now() + WEB_LOGIN_LOCK_MS;
  loginFails.set(ip, r);
  return Math.max(0, WEB_LOGIN_MAX_FAIL - r.count);
}

/** 返回 HTML 响应（与 send() 的 JSON 响应区分开） */
function sendHtml(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(html);
}

/** 管理员列表：openid + 备注名（备注仅展示用，不参与鉴权） */
function listAdmins() {
  const cfg = getConfig();
  const labels = cfg.adminLabels || {};
  return (cfg.adminOpenids || []).map(id => ({ openid: id, label: labels[id] || '' }));
}

/* ============================== 路由 ============================== */

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
}

function send(res, code, data) {
  const body = JSON.stringify({ code, data });
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-token, x-openid, x-web-token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  });
  res.end(body);
}

function ok(res, data) { send(res, 0, data === undefined ? {} : data); }
function fail(res, msg, httpCode) { send(res, 1, { msg: msg || '请求失败' }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) { reject(new Error('body too large')); } });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

/* ---------- 公开接口 ---------- */

route('GET', '/api/config', (req, res) => {
  const cfg = getConfig();
  ok(res, {
    serviceName: cfg.serviceName,
    escortName: cfg.escortName,
    servicePrice: cfg.servicePrice,
    phone: cfg.phone,
    workStart: cfg.workStart,
    workEnd: cfg.workEnd,
    slotMinutes: cfg.slotMinutes,
    notice: cfg.notice,
    wechatId: cfg.wechatId,
    kfUrl: cfg.kfUrl,
    wxCorpId: cfg.wxCorpId,
    about: cfg.about,
    escortAvatar: cfg.escortAvatar || '',
    hospitals: cfg.hospitals || [],
    departments: cfg.departments || [],
    discounts: cfg.discounts || [],
    noteOptions: cfg.noteOptions || []
  });
});

/** 微信登录：wx.login 的 code 换取 openid，并记录/更新用户 */
route('POST', '/api/login', async (req, res) => {
  try {
    const body = await readBody(req);
    const code = String(body.code || '');
    if (!code) return fail(res, '缺少登录凭证');
    const cfg = getConfig();
    const openid = await codeToOpenid(code, cfg);
    const patch = {};
    if (body.nickname) patch.nickname = String(body.nickname).slice(0, 40);
    if (body.avatarUrl) patch.avatarUrl = String(body.avatarUrl).slice(0, 500);
    const user = upsertUser(openid, patch);
    ok(res, { openid, user, isAdmin: isAdminOpenid(openid) });
  } catch (e) {
    fail(res, e.message || '登录失败');
  }
});

/** 微信授权获取手机号（getPhoneNumber 按钮）：用 code 换手机号，需已配置 appid/secret */
route('POST', '/api/wechat/phone', async (req, res) => {
  try {
    const body = await readBody(req);
    const code = String(body.code || '');
    if (!code) return fail(res, '缺少手机号授权凭证');
    const phoneNumber = await getPhoneByCode(code, getConfig());
    ok(res, { phoneNumber });
  } catch (e) {
    fail(res, e.message || '获取手机号失败');
  }
});

/** 查询当前用户资料（头像/昵称，我的页个人信息卡） */
route('GET', '/api/user/profile', (req, res) => {
  const openid = req.headers['x-openid'] || '';
  if (!openid) return fail(res, '请先微信登录');
  const u = findUser(openid);
  ok(res, { user: u || { openid, nickname: '', avatarUrl: '', name: '', phone: '' } });
});

/**
 * 更新当前用户资料（我的页个人信息卡）
 * body: { nickname?: string, avatarBase64?: string(可带 data:image/xx;base64 前缀), avatarMime?, avatarFilename? }
 * 头像复用图片上传管线（白名单后缀 + 500KB 强制上限），存到 uploads 目录后把相对 URL 记入用户表
 */
route('POST', '/api/user/profile', async (req, res) => {
  const openid = req.headers['x-openid'] || '';
  if (!openid) return fail(res, '请先微信登录');
  try {
    const body = await readBody(req);
    const patch = {};
    if (body.nickname !== undefined) patch.nickname = String(body.nickname).trim().slice(0, 40);
    if (body.avatarBase64) {
      const r = saveImageBase64(body.avatarBase64, body.avatarMime, body.avatarFilename);
      if (r.err) return fail(res, r.err);
      patch.avatarUrl = r.url;
    }
    if (!Object.keys(patch).length) return fail(res, '没有需要保存的内容');
    const user = upsertUser(openid, patch);
    ok(res, { user });
  } catch (e) {
    fail(res, e.message === 'body too large' ? '头像图片超过 500KB，请更换头像' : '保存失败');
  }
});

route('GET', '/api/slots', (req, res, q) => {
  const cfg = getConfig();
  const date = parseDate(q.date || fmtDate(new Date()));
  if (!date) return fail(res, '日期格式不正确');
  const days = Math.min(Math.max(parseInt(q.days, 10) || 1, 1), 31);
  const result = [];
  let availableCount = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(date); d.setDate(date.getDate() + i);
    const ds = fmtDate(d);
    const slots = slotsFor(ds, cfg);
    availableCount += slots.filter(s => s.status === 'available').length;
    result.push({ date: ds, slots });
  }
  ok(res, {
    days: result,
    availableCount,
    config: {
      serviceName: cfg.serviceName,
      escortName: cfg.escortName,
      servicePrice: cfg.servicePrice,
      discounts: cfg.discounts || [],
      workStart: cfg.workStart,
      workEnd: cfg.workEnd,
      slotMinutes: cfg.slotMinutes,
      notice: cfg.notice,
      phone: cfg.phone,
      wechatId: cfg.wechatId,
      kfUrl: cfg.kfUrl,
      wxCorpId: cfg.wxCorpId,
      escortAvatar: cfg.escortAvatar || ''
    }
  });
});

/** 月度日历：返回某月每天的时段概况（供日历弹窗展示） */
route('GET', '/api/calendar', (req, res, q) => {
  const cfg = getConfig();
  const m = /^(\d{4})-(\d{2})$/.exec(q.month || '');
  const now = new Date();
  const ref = m ? new Date(Number(m[1]), Number(m[2]) - 1, 1)
                : new Date(now.getFullYear(), now.getMonth(), 1);
  const y = ref.getFullYear();
  const mo = ref.getMonth();
  const todayStr = fmtDate(now);
  const days = [];
  const total = new Date(y, mo + 1, 0).getDate();
  for (let i = 1; i <= total; i++) {
    const ds = fmtDate(new Date(y, mo, i));
    const slots = slotsFor(ds, cfg);
    days.push({
      date: ds,
      day: i,
      weekday: (new Date(y, mo, i).getDay() + 6) % 7, // 0=周一
      availableCount: slots.filter(s => s.status === 'available').length,
      totalSlots: slots.length,
      past: ds < todayStr,
      isToday: ds === todayStr
    });
  }
  ok(res, {
    month: y + '-' + pad(mo + 1),
    year: y,
    monthNumber: mo + 1,
    firstWeekday: days.length ? days[0].weekday : 0, // 该月 1 号是周几(0=周一)
    days
  });
});

/** 创建订单：支持一次选择多个连续时段（start ~ end），合并为一个订单计费 */
route('POST', '/api/orders', async (req, res) => {
  try {
    const body = await readBody(req);
    const cfg = getConfig();
    const openid = req.headers['x-openid'] || body.openid || '';
    // 防刷维度：预约人手机号（下单人）+ 就诊人手机号（为他人预约时）
    const bookerPhone = String(body.bookerPhone || body.clientPhone || '').trim();
    const clientPhone = String(body.clientPhone || '').trim();

    // 防刷：先只读校验，成功创建订单后再计数（避免用户填错重试被误限）
    if (openid) {
      const limit = rateLimitCheck('openid:' + openid, { windowMs: 10000, windowMsg: '操作过于频繁，请稍后再试', dayMax: 10, dayMsg: '今日预约次数已达上限，请明天再试' });
      if (limit) return fail(res, limit.err);
    }
    if (bookerPhone) {
      const limit = rateLimitCheck('phone:' + bookerPhone, { windowMs: 10000, windowMsg: '操作过于频繁，请稍后再试', dayMax: 10, dayMsg: '该手机号今日预约次数已达上限' });
      if (limit) return fail(res, limit.err);
    }
    if (clientPhone && clientPhone !== bookerPhone) {
      const limit = rateLimitCheck('phone:' + clientPhone, { windowMs: 10000, windowMsg: '操作过于频繁，请稍后再试', dayMax: 5, dayMsg: '该就诊人手机号今日预约次数已达上限' });
      if (limit) return fail(res, limit.err);
    }

    const r = createOrder(Object.assign({}, body, { openid }), cfg);
    if (r.err) return fail(res, r.err);

    if (openid) rateLimitRecord('openid:' + openid);
    if (bookerPhone) rateLimitRecord('phone:' + bookerPhone);
    if (clientPhone && clientPhone !== bookerPhone) rateLimitRecord('phone:' + clientPhone);
    ok(res, r.order);
  } catch (e) { fail(res, '请求参数错误'); }
});

/** 查询订单：优先按 openid（微信账号），兼容按手机号 */
route('GET', '/api/orders', (req, res, q) => {
  const hOpenid = req.headers['x-openid'] || '';
  if (q.openid) {
    if (hOpenid && hOpenid !== q.openid) return fail(res, '无权查看他人订单');
    const list = getOrders()
      .filter(o => o.openid === q.openid)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return ok(res, { list });
  }
  if (!q.phone || !/^1\d{10}$/.test(q.phone)) return fail(res, '请填写正确的手机号');
  const list = getOrders()
    .filter(o => o.clientPhone === q.phone)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  ok(res, { list });
});

route('GET', '/api/orders/:id', (req, res, q) => {
  const order = findOrder(q.id);
  if (!order) return fail(res, '订单不存在');
  ok(res, order);
});

route('POST', '/api/orders/:id/cancel', (req, res, q) => {
  const r = cancelOrder(q.id);
  if (r.err) return fail(res, r.err);
  ok(res, r.order);
});

/* ---------- 图片（陪诊师介绍等） ---------- */

/** 访问已上传的图片（公开只读，rich-text <img> 直接引用） */
route('GET', '/api/uploads/:file', (req, res, q) => {
  // 仅允许服务端生成的文件名（字母数字下划线连字符 + 白名单后缀），防路径穿越
  const m = /^([\w-]+\.(png|jpg|jpeg|gif|webp))$/.exec(String(q.file || ''));
  if (!m) return fail(res, '文件不存在');
  fs.readFile(path.join(UPLOAD_DIR, m[1]), (err, data) => {
    if (err) return fail(res, '文件不存在');
    res.writeHead(200, {
      'Content-Type': IMG_TYPES[m[2]],
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=31536000',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  });
});

/* ---------- 管理端接口 ---------- */

/** 管理登录：微信白名单（openid ∈ adminOpenids）+ 密码校验 */
route('POST', '/api/admin/login', async (req, res) => {
  try {
    const body = await readBody(req);
    const code = String(body.code || '');
    const password = String(body.password || '');
    if (!code && !body.openid) return fail(res, '缺少登录凭证');
    if (!password) return fail(res, '请输入密码');
    const openid = await resolveLoginOpenid(body, getConfig());
    if (!isAdminOpenid(openid)) return fail(res, '该微信不在管理白名单内，请联系管理员添加');
    if (password !== String(getConfig().adminPassword)) return fail(res, '密码错误');
    ok(res, { token: issueToken(), escortName: getConfig().escortName, isAdmin: true, openid });
  } catch (e) { fail(res, e.message || '登录失败'); }
});

/** 微信一键登录（仅白名单内微信可用） */
route('POST', '/api/admin/wechat-login', async (req, res) => {
  try {
    const body = await readBody(req);
    const code = String(body.code || '');
    if (!code && !body.openid) return fail(res, '缺少登录凭证');
    const openid = await resolveLoginOpenid(body, getConfig());
    if (!isAdminOpenid(openid)) return fail(res, '该微信不在管理白名单内');
    ok(res, { token: issueToken(), openid, isAdmin: true, escortName: getConfig().escortName });
  } catch (e) { fail(res, e.message || '登录失败'); }
});

/** 查询当前微信是否为管理员（首页管理入口显隐判断） */
route('GET', '/api/admin/me', (req, res, q) => {
  const openid = q.openid || req.headers['x-openid'] || '';
  ok(res, { openid, isAdmin: isAdminOpenid(openid) });
});

/**
 * 上传图片（base64 JSON 提交），用于陪诊师介绍等富文本内容
 * body: { filename: 'xx.png', base64: '...(可带 data:image/xx;base64, 前缀)' }
 * 限制：仅 png/jpg/jpeg/gif/webp，单张不超过 500KB（服务端强制校验）
 */
route('POST', '/api/admin/upload', async (req, res) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  try {
    const body = await readBody(req);
    const r = saveImageBase64(body.base64, body.mime, body.filename);
    if (r.err) return fail(res, r.err);
    ok(res, { url: r.url, size: r.size });
  } catch (e) {
    fail(res, e.message === 'body too large' ? '图片超过 500KB，请压缩后再上传' : '上传失败');
  }
});

route('GET', '/api/admin/orders', (req, res, q) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  let list = getOrders().slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  if (q.date) list = list.filter(o => o.date === q.date);
  if (q.dateStart) list = list.filter(o => o.date >= q.dateStart);
  if (q.dateEnd) list = list.filter(o => o.date <= q.dateEnd);
  if (q.start) list = list.filter(o => o.start === q.start);
  if (q.status && q.status !== 'all') list = list.filter(o => o.status === q.status);
  if (q.phone) list = list.filter(o => o.clientPhone === q.phone);
  ok(res, { list });
});

/** 管理端订单详情：附带下单微信用户资料（头像/昵称，基于 openid 关联用户表） */
route('GET', '/api/admin/orders/:id', (req, res, q) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  const order = findOrder(q.id);
  if (!order) return fail(res, '订单不存在');
  const out = Object.assign({}, order);
  if (order.openid) {
    const u = findUser(order.openid);
    if (u) out.user = { nickname: u.nickname || '', avatarUrl: u.avatarUrl || '', name: u.name || '', phone: u.phone || '' };
  }
  ok(res, out);
});

route('POST', '/api/admin/orders/:id/complete', (req, res, q) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  const r = completeOrder(q.id);
  if (r.err) return fail(res, r.err);
  ok(res, r.order);
});

route('POST', '/api/admin/orders/:id/cancel', (req, res, q) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  const r = cancelOrder(q.id);
  if (r.err) return fail(res, r.err);
  ok(res, r.order);
});

/** 管理员确认预约（pending → confirmed，预约生效） */
route('POST', '/api/admin/orders/:id/confirm', (req, res, q) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  const r = confirmOrder(q.id);
  if (r.err) return fail(res, r.err);
  ok(res, r.order);
});

/** 管理员删除订单记录（永久删除，前端需二次确认） */
route('DELETE', '/api/admin/orders/:id', (req, res, q) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  const r = deleteOrder(q.id);
  if (r.err) return fail(res, r.err);
  ok(res, { id: q.id });
});

route('GET', '/api/admin/slots', (req, res, q) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  const cfg = getConfig();
  const date = parseDate(q.date || fmtDate(new Date()));
  if (!date) return fail(res, '日期格式不正确');
  const days = Math.min(Math.max(parseInt(q.days, 10) || 1, 1), 31);
  const result = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(date); d.setDate(date.getDate() + i);
    const ds = fmtDate(d);
    const slots = slotsFor(ds, cfg);
    const fullyBlocked = getBlocked().some(e => e.date === ds && e.allDay);
    result.push({
      date: ds, slots, fullyBlocked,
      hourBlocks: hourBlocksFor(ds, cfg),
      availableCount: slots.filter(s => s.status === 'available').length
    });
  }
  ok(res, { days: result });
});

route('POST', '/api/admin/slots/block', async (req, res) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  try {
    const body = await readBody(req);
    const cfg = getConfig();
    if (!parseDate(body.date)) return fail(res, '日期格式不正确');
    let entry;
    if (body.allDay || !body.start) {
      entry = { id: genId('B'), date: body.date, allDay: true };
    } else {
      const start = parseTime(body.start), end = parseTime(body.end || addMin(body.start, cfg.slotMinutes));
      if (start === null || end === null || end <= start) return fail(res, '时间段不正确');
      if (hasActiveOrderOverlap(body.date, start, end)) return fail(res, '该时段已有预约，不能设为不可约');
      entry = { id: genId('B'), date: body.date, start: fmtMinutes(start), end: fmtMinutes(end) };
    }
    const list = getBlocked();
    const dup = list.some(e =>
      e.date === entry.date &&
      (entry.allDay ? e.allDay : (!e.allDay && e.start === entry.start && e.end === entry.end))
    );
    if (!dup) { list.push(entry); saveBlocked(list); }
    ok(res, { blocked: list });
  } catch (e) { fail(res, '请求参数错误'); }
});

route('POST', '/api/admin/slots/unblock', async (req, res) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  try {
    const body = await readBody(req);
    if (!parseDate(body.date)) return fail(res, '日期格式不正确');
    let list = getBlocked();
    if (body.allDay || !body.start) {
      list = list.filter(e => e.date !== body.date);
    } else if (body.hourMode) {
      // 按小时解除：删除所有与该小时区间重叠的非 allDay 屏蔽
      const s = parseTime(body.start), e = parseTime(body.end);
      if (s === null || e === null || e <= s) return fail(res, '时间段不正确');
      list = list.filter(item => !(item.date === body.date && !item.allDay && !(item.end <= s || item.start >= e)));
    } else {
      list = list.filter(e => !(e.date === body.date && !e.allDay && e.start === body.start && e.end === body.end));
    }
    saveBlocked(list);
    ok(res, { blocked: list });
  } catch (e) { fail(res, '请求参数错误'); }
});

route('GET', '/api/admin/stats', (req, res, q) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  const stats = computeStats(q.period || 'day', q.date, q.start, q.end, q.status);
  if (!stats) return fail(res, q.period === 'custom' ? '时间段不正确（起止日期无效或跨度超过一年）' : '统计周期不正确');
  ok(res, stats);
});

route('GET', '/api/admin/config', (req, res) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  ok(res, getConfig());
});

route('PUT', '/api/admin/config', async (req, res) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  try {
    const body = await readBody(req);
    const patch = {};
    ['serviceName', 'escortName', 'phone', 'notice', 'wechatId', 'kfUrl', 'wxCorpId', 'wxaAppid', 'wxaSecret'].forEach(k => {
      if (body[k] !== undefined) patch[k] = String(body[k]).trim();
    });
    // 陪诊师介绍（Markdown，最长 2 万字符）
    if (body.about !== undefined) patch.about = String(body.about).slice(0, 20000);
    // 陪诊师头像（相对 URL /api/uploads/xx 或 http(s) 链接，最长 500 字符）
    if (body.escortAvatar !== undefined) patch.escortAvatar = String(body.escortAvatar).trim().slice(0, 500);
    ['servicePrice', 'slotMinutes'].forEach(k => {
      if (body[k] !== undefined && body[k] !== '') {
        const n = Number(body[k]);
        if (!isNaN(n) && n >= 0) patch[k] = n;
      }
    });
    if (parseTime(body.workStart) !== null) patch.workStart = body.workStart;
    if (parseTime(body.workEnd) !== null) patch.workEnd = body.workEnd;
    if (body.adminPassword && String(body.adminPassword).length >= 4) patch.adminPassword = String(body.adminPassword);
    if (body.hospitals !== undefined) patch.hospitals = sanitizeList(body.hospitals, 50);
    if (body.departments !== undefined) patch.departments = sanitizeList(body.departments, 50);
    if (body.discounts !== undefined) patch.discounts = sanitizeDiscounts(body.discounts);
    if (body.noteOptions !== undefined) patch.noteOptions = sanitizeList(body.noteOptions, 20);
    // 管理员手机号白名单（旧版字段，仅兼容保留，不再参与登录校验）
    if (body.adminPhones !== undefined) {
      patch.adminPhones = sanitizeList(body.adminPhones, 10).filter(p => /^1\d{10}$/.test(p));
    }
    // 管理员微信白名单：管理端登录/一键登录/首页入口均以 adminOpenids 为准
    if (body.adminOpenids !== undefined) {
      patch.adminOpenids = sanitizeList(body.adminOpenids, 20);
    }

    // 校验工作时间段
    const cfg = Object.assign({}, getConfig(), patch);
    if (parseTime(cfg.workEnd) <= parseTime(cfg.workStart)) return fail(res, '结束时间必须晚于开始时间');

    saveConfig(patch);
    ok(res, getConfig());
  } catch (e) { fail(res, '请求参数错误'); }
});

function addMin(timeStr, minutes) {
  const m = parseTime(timeStr);
  return fmtMinutes(m + (Number(minutes) || 60));
}

/* ---------- Web 管理页（/manage）：增删小程序管理端微信白名单 ---------- */

const WEBADMIN_HTML = path.join(__dirname, 'webadmin.html');

function serveWebAdmin(req, res) {
  try {
    sendHtml(res, fs.readFileSync(WEBADMIN_HTML, 'utf8'));
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('管理页面文件缺失：server/webadmin.html（部署时需与 server.js 一同上传）');
  }
}
route('GET', '/manage', serveWebAdmin);
route('GET', '/manage/', serveWebAdmin);

/** 登录：账号 + 密码，成功后下发 8 小时有效的 Web token */
route('POST', '/api/webadmin/login', async (req, res) => {
  let body;
  try { body = await readBody(req); } catch (e) { return fail(res, '请求参数错误'); }
  const ip = clientIp(req);
  if (loginLocked(ip)) return fail(res, '登录失败次数过多，请 15 分钟后再试');

  const wa = getConfig().webAdmin || {};
  if (!wa.passHash) {
    return fail(res, 'Web 管理页尚未启用：请用环境变量 WEB_ADMIN_PASSWORD 设置初始密码后重启服务');
  }
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (username !== wa.username || !verifyWebPassword(password)) {
    const left = recordLoginFail(ip);
    return fail(res, '账号或密码错误' + (left > 0 ? `，还可尝试 ${left} 次` : '，已临时锁定'));
  }
  loginFails.delete(ip);
  ok(res, { token: issueWebToken(), expiresIn: WEB_TOKEN_TTL, username: wa.username });
});

route('POST', '/api/webadmin/logout', (req, res) => {
  const t = req.headers['x-web-token'];
  if (t) webTokens.delete(t);
  ok(res, {});
});

/** 管理员列表 */
route('GET', '/api/webadmin/admins', (req, res) => {
  if (!checkWebToken(req)) return fail(res, '未登录或登录已过期，请重新登录');
  const wa = getConfig().webAdmin || {};
  ok(res, { list: listAdmins(), username: wa.username || '', max: 20 });
});

/** 添加管理员（openid + 可选备注） */
route('POST', '/api/webadmin/admins', async (req, res) => {
  if (!checkWebToken(req)) return fail(res, '未登录或登录已过期，请重新登录');
  let body;
  try { body = await readBody(req); } catch (e) { return fail(res, '请求参数错误'); }
  const openid = String(body.openid || '').trim();
  const label = String(body.label || '').trim().slice(0, 20);
  if (!openid) return fail(res, '请填写要添加的管理员 openid');
  if (!/^[A-Za-z0-9_-]{5,64}$/.test(openid)) {
    return fail(res, 'openid 格式不合法（仅允许字母、数字、下划线、短横线，长度 5~64）');
  }
  const cfg = getConfig();
  const ids = cfg.adminOpenids || [];
  if (ids.length >= 20) return fail(res, '管理员数量已达上限（20 个）');
  if (ids.indexOf(openid) >= 0) return fail(res, '该 openid 已在管理员列表中');

  const labels = Object.assign({}, cfg.adminLabels || {});
  if (label) labels[openid] = label;
  saveConfig({ adminOpenids: ids.concat([openid]), adminLabels: labels });
  ok(res, { list: listAdmins() });
});

/** 删除管理员（保留至少 1 个，避免无人能登录管理端） */
route('DELETE', '/api/webadmin/admins/:openid', (req, res, q) => {
  if (!checkWebToken(req)) return fail(res, '未登录或登录已过期，请重新登录');
  const openid = String(q.openid || '').trim();
  const cfg = getConfig();
  const ids = cfg.adminOpenids || [];
  if (ids.indexOf(openid) < 0) return fail(res, '该 openid 不在管理员列表中');
  if (ids.length <= 1) return fail(res, '至少需保留 1 个管理员，否则将无人能登录管理端');

  const labels = Object.assign({}, cfg.adminLabels || {});
  delete labels[openid];
  saveConfig({ adminOpenids: ids.filter(x => x !== openid), adminLabels: labels });
  ok(res, { list: listAdmins() });
});

/** 修改 Web 管理密码（改后作废当前 token，强制重新登录） */
route('POST', '/api/webadmin/password', async (req, res) => {
  if (!checkWebToken(req)) return fail(res, '未登录或登录已过期，请重新登录');
  let body;
  try { body = await readBody(req); } catch (e) { return fail(res, '请求参数错误'); }
  const oldPw = String(body.oldPassword || '');
  const newPw = String(body.newPassword || '');
  if (!verifyWebPassword(oldPw)) return fail(res, '原密码不正确');
  if (newPw.length < 8) return fail(res, '新密码至少 8 位');
  const cfg = getConfig();
  const salt = crypto.randomBytes(16).toString('hex');
  saveConfig({
    webAdmin: { username: (cfg.webAdmin || {}).username || 'admin', salt, passHash: hashPassword(newPw, salt) }
  });
  const t = req.headers['x-web-token'];
  if (t) webTokens.delete(t);
  ok(res, {});
});

/* ============================== 服务器 ============================== */

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-token, x-openid, x-web-token',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    });
    return res.end();
  }

  const url = req.url.split('?')[0];
  const queryStr = req.url.split('?')[1] || '';
  const q = {};
  queryStr.split('&').forEach(p => {
    const [k, v] = p.split('=');
    if (k) q[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.match(r.re);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    try {
      return await r.handler(req, res, Object.assign(q, params));
    } catch (e) {
      console.error('[server] 处理异常', req.method, url, e.message);
      return fail(res, '服务器内部错误');
    }
  }
  send(res, 1, { msg: '接口不存在: ' + req.method + ' ' + url });
});

// HOST 环境变量：生产环境建议设为 127.0.0.1（仅 Nginx 反代可访问）；不设则监听全部网卡（本地联调用）
const HOST = process.env.HOST;
server.listen(PORT, HOST, () => {
  const cfg = getConfig();
  // 数据自动快照：启动即备份一次（升级=覆盖 server.js + reload=重启，重启即自动快照），
  // 此后每 BACKUP_INTERVAL_HOURS 小时定时快照，滚动保留最近 BACKUP_KEEP 份。
  startBackup(DATA_DIR);
  ensureWebAdmin(); // 用环境变量 WEB_ADMIN_PASSWORD 首次初始化 Web 管理账号（已初始化则跳过）
  console.log('==============================================');
  console.log('  陪诊预约后端已启动');
  console.log('  监听: ' + (HOST || '0.0.0.0') + ':' + PORT);
  console.log('  服务名称: ' + cfg.serviceName + '（' + cfg.escortName + '）');
  console.log('  微信登录: ' + (cfg.wxaAppid ? '真实模式' : '本地模拟模式（按 code 派生 openid）'));
  console.log('  管理端白名单: ' + (cfg.adminOpenids && cfg.adminOpenids.length ? cfg.adminOpenids.length + ' 个微信' : '（未配置微信白名单，登录管理端需先添加 openid）'));
  console.log('  管理端密码: ' + (cfg.adminPassword ? '已设置（不在日志中打印明文）' : '未设置'));
  const wa0 = getConfig().webAdmin || {};
  console.log('  Web 管理页: ' + (wa0.passHash ? ('/manage  账号 ' + wa0.username) : '未启用（设置 WEB_ADMIN_PASSWORD 后重启以初始化）'));
  console.log('==============================================');
});
