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
 * 支付说明：
 * - 本服务提供 pay-deposit / pay-tail 接口，由前端"模拟支付"后调用，方便本地联调
 * - 真实上线：请在前端接入 wx.requestPayment（微信支付 JSAPI），
 *   并在微信支付回调中调用本服务的"确认支付"逻辑（参考 server.js 中的 payDeposit 实现）
 */
const http = require('http');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const { DB } = require('./db.js');

const PORT = process.env.PORT || 8300;
const db = new DB(path.join(__dirname, 'data'));

/* ============================== 数据集合 ============================== */

const DEFAULT_CONFIG = {
  serviceName: '专业陪诊服务',
  escortName: '陪诊师小护',
  servicePrice: 200,        // 单次服务费（元）
  depositType: 'fixed',     // 定金方式：fixed 固定金额 | percent 按比例
  depositValue: 50,         // fixed 时表示固定金额（元）；percent 时表示百分比（如 20 = 20%）
  phone: '',                // 展示给预约者的联系电话
  workStart: '09:00',       // 每日可预约开始时间
  workEnd: '18:00',         // 每日可预约结束时间
  slotMinutes: 60,          // 每段时长（分钟）
  notice: '预约成功后请按时到达医院门口，如需改期请提前联系。',
  wechatId: '',             // 陪诊师微信号（首页"微信联系"按钮使用）
  kfUrl: '',                // 企业微信客服链接（配置后微信联系按钮优先跳转客服）
  hospitals: [],            // 候选医院列表（预约填单下拉选择）
  noteOptions: [],          // 备注快捷选项（预约填单点选填入）
  adminPassword: '123456',  // 管理端密码（上线前请修改）
  adminOpenids: [],         // 已绑定管理权限的微信 openid 列表（密码登录时自动绑定）
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
    u = { openid, nickname: '', avatarUrl: '', createdAt: nowIso(), lastLoginAt: nowIso() };
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

function calcDeposit(cfg, price) {
  if (cfg.depositType === 'percent') {
    const pct = Number(cfg.depositValue) || 20;
    return Math.round(price * pct / 100);
  }
  return Number(cfg.depositValue) || 0;
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

/** 某时段是否有未取消的订单占用 */
function activeOrderFor(dateStr, start) {
  return getOrders().find(o => o.date === dateStr && o.start === start && o.status !== 'cancelled') || null;
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
    const order = activeOrderFor(s.date, s.start);
    if (order) return Object.assign({}, s, { status: 'booked', orderId: order.id });
    if (isBlocked(s.date, s.start)) return Object.assign({}, s, { status: 'unavailable', orderId: null });
    return Object.assign({}, s, { status: 'available', orderId: null });
  });
}

function slotsFor(dateStr, cfg) {
  return decorateSlots(generateSlots(dateStr, cfg));
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
    if (activeOrderFor(date, s)) return { err: '部分时段刚被预约，请重新选择' };
  }
  return null;
}

function createOrder(body, cfg) {
  const { date, start, end, clientName, clientPhone, hospital, department, notes, openid } = body;
  if (!date || !start || !end) return { err: '请选择预约时段' };
  if (!clientName || !String(clientName).trim()) return { err: '请填写就诊人姓名' };
  if (!/^1\d{10}$/.test(clientPhone || '')) return { err: '请填写正确的手机号' };
  if (!hospital || !String(hospital).trim()) return { err: '请填写医院名称' };

  const rangeErr = validateRange(date, start, end, cfg);
  if (rangeErr) return rangeErr;

  const price = Number(cfg.servicePrice) || 0;
  const deposit = calcDeposit(cfg, price);
  const durationHours = Math.round((parseTime(end) - parseTime(start)) / 60 * 10) / 10;
  const slotCount = Math.round((parseTime(end) - parseTime(start)) / (Number(cfg.slotMinutes) || 60));

  const order = {
    id: genId('O'),
    date, start, end,
    durationHours,
    slotCount,
    openid: openid || '',
    clientName: String(clientName).trim(),
    clientPhone: String(clientPhone).trim(),
    hospital: String(hospital).trim(),
    department: String(department || '').trim(),
    notes: String(notes || '').trim(),
    price,
    deposit,
    status: 'pending',        // pending | deposit_paid | completed | finished | cancelled
    depositPaid: false,
    tailPaid: false,
    createdAt: nowIso(),
    depositPaidAt: '',
    completedAt: '',
    tailPaidAt: '',
    cancelledAt: ''
  };
  const list = getOrders();
  list.push(order);
  saveOrders(list);
  return { order };
}

function payDeposit(orderId) {
  const order = findOrder(orderId);
  if (!order) return { err: '订单不存在' };
  if (order.status === 'cancelled') return { err: '订单已取消' };
  if (order.depositPaid) return { order };
  order.depositPaid = true;
  order.status = 'deposit_paid';
  order.depositPaidAt = nowIso();
  saveOrders(getOrders());
  return { order };
}

function payTail(orderId) {
  const order = findOrder(orderId);
  if (!order) return { err: '订单不存在' };
  if (order.status !== 'completed') return { err: '服务尚未完成，暂不能支付尾款' };
  if (order.tailPaid) return { order };
  order.tailPaid = true;
  order.status = 'finished';
  order.tailPaidAt = nowIso();
  saveOrders(getOrders());
  return { order };
}

function cancelOrder(orderId) {
  const order = findOrder(orderId);
  if (!order) return { err: '订单不存在' };
  if (order.status === 'completed' || order.status === 'finished') return { err: '服务已开始/结束，无法取消' };
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
  if (order.status === 'completed' || order.status === 'finished') return { order };
  if (!order.depositPaid) return { err: '客户尚未支付定金' };
  order.status = 'completed';
  order.completedAt = nowIso();
  saveOrders(getOrders());
  return { order };
}

/* ============================== 统计逻辑 ============================== */

function periodRange(period, refStr) {
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
  } else { // year
    for (let m = 0; m < 12; m++) {
      const b = bucket(String(s.getFullYear()) + '-' + pad(m + 1));
      b.label = (m + 1) + '月';
    }
  }

  orders.forEach(o => {
    if (period === 'year') {
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

function computeStats(period, refStr) {
  const range = periodRange(period, refStr);
  if (!range) return null;
  const valid = getOrders().filter(o => o.status !== 'cancelled' && o.date >= range.start && o.date <= range.end);

  let totalHours = 0, totalAmount = 0, depositReceived = 0, tailReceived = 0, pendingTail = 0;
  valid.forEach(o => {
    totalHours += o.durationHours || 0;
    totalAmount += o.price || 0;
    if (o.depositPaid) depositReceived += o.deposit || 0;
    if (o.tailPaid) tailReceived += ((o.price || 0) - (o.deposit || 0));
    else if (o.status === 'completed') pendingTail += ((o.price || 0) - (o.deposit || 0));
  });

  return {
    period,
    range,
    orderCount: valid.length,
    totalHours: Math.round(totalHours * 10) / 10,
    totalAmount: Math.round(totalAmount * 100) / 100,
    depositReceived: Math.round(depositReceived * 100) / 100,
    tailReceived: Math.round(tailReceived * 100) / 100,
    pendingTail: Math.round(pendingTail * 100) / 100,
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
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-token, x-openid',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'
  });
  res.end(body);
}

function ok(res, data) { send(res, 0, data === undefined ? {} : data); }
function fail(res, msg, httpCode) { send(res, 1, { msg: msg || '请求失败' }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('body too large')); } });
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
    depositType: cfg.depositType,
    depositValue: cfg.depositValue,
    deposit: calcDeposit(cfg, cfg.servicePrice),
    phone: cfg.phone,
    workStart: cfg.workStart,
    workEnd: cfg.workEnd,
    slotMinutes: cfg.slotMinutes,
    notice: cfg.notice,
    wechatId: cfg.wechatId,
    kfUrl: cfg.kfUrl,
    hospitals: cfg.hospitals || [],
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
      deposit: calcDeposit(cfg, cfg.servicePrice),
      depositType: cfg.depositType,
      depositValue: cfg.depositValue,
      workStart: cfg.workStart,
      workEnd: cfg.workEnd,
      slotMinutes: cfg.slotMinutes,
      notice: cfg.notice,
      phone: cfg.phone,
      wechatId: cfg.wechatId,
      kfUrl: cfg.kfUrl
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
    const r = createOrder(Object.assign({}, body, { openid }), cfg);
    if (r.err) return fail(res, r.err);
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

route('POST', '/api/orders/:id/pay-deposit', (req, res, q) => {
  const r = payDeposit(q.id);
  if (r.err) return fail(res, r.err);
  ok(res, r.order);
});

route('POST', '/api/orders/:id/pay-tail', (req, res, q) => {
  const r = payTail(q.id);
  if (r.err) return fail(res, r.err);
  ok(res, r.order);
});

route('POST', '/api/orders/:id/cancel', (req, res, q) => {
  const r = cancelOrder(q.id);
  if (r.err) return fail(res, r.err);
  ok(res, r.order);
});

/* ---------- 管理端接口 ---------- */

/** 管理登录：密码校验；携带 openid 时自动把当前微信绑定为管理员 */
route('POST', '/api/admin/login', async (req, res) => {
  try {
    const body = await readBody(req);
    if (String(body.password || '') !== String(getConfig().adminPassword)) return fail(res, '密码错误');
    const openid = body.openid || req.headers['x-openid'] || '';
    const cfg = getConfig();
    if (openid && !isAdminOpenid(openid)) {
      saveConfig({ adminOpenids: (cfg.adminOpenids || []).concat([openid]) });
    }
    ok(res, { token: issueToken(), escortName: getConfig().escortName, isAdmin: true, openid });
  } catch (e) { fail(res, '请求参数错误'); }
});

/** 微信一键登录（仅已绑定管理权限的微信可用） */
route('POST', '/api/admin/wechat-login', async (req, res) => {
  try {
    const body = await readBody(req);
    const code = String(body.code || '');
    if (!code) return fail(res, '缺少登录凭证');
    const openid = await codeToOpenid(code, getConfig());
    if (!isAdminOpenid(openid)) return fail(res, '该微信未绑定管理权限，请先用密码登录绑定');
    ok(res, { token: issueToken(), openid, isAdmin: true, escortName: getConfig().escortName });
  } catch (e) { fail(res, e.message || '登录失败'); }
});

/** 查询当前微信是否为管理员（首页管理入口显隐判断） */
route('GET', '/api/admin/me', (req, res, q) => {
  const openid = q.openid || req.headers['x-openid'] || '';
  ok(res, { openid, isAdmin: isAdminOpenid(openid) });
});

route('GET', '/api/admin/orders', (req, res, q) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  let list = getOrders().slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  if (q.date) list = list.filter(o => o.date === q.date);
  if (q.status && q.status !== 'all') list = list.filter(o => o.status === q.status);
  if (q.phone) list = list.filter(o => o.clientPhone === q.phone);
  ok(res, { list });
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
    result.push({ date: ds, slots, fullyBlocked, availableCount: slots.filter(s => s.status === 'available').length });
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
    } else {
      list = list.filter(e => !(e.date === body.date && !e.allDay && e.start === body.start && e.end === body.end));
    }
    saveBlocked(list);
    ok(res, { blocked: list });
  } catch (e) { fail(res, '请求参数错误'); }
});

route('GET', '/api/admin/stats', (req, res, q) => {
  if (!checkAdmin(req)) return send(res, 401, { msg: '未登录或登录已过期' });
  const stats = computeStats(q.period || 'day', q.date);
  if (!stats) return fail(res, '统计周期不正确');
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
    ['serviceName', 'escortName', 'phone', 'notice', 'wechatId', 'kfUrl', 'wxaAppid', 'wxaSecret'].forEach(k => {
      if (body[k] !== undefined) patch[k] = String(body[k]).trim();
    });
    ['servicePrice', 'depositValue', 'slotMinutes'].forEach(k => {
      if (body[k] !== undefined && body[k] !== '') {
        const n = Number(body[k]);
        if (!isNaN(n) && n >= 0) patch[k] = n;
      }
    });
    if (body.depositType === 'fixed' || body.depositType === 'percent') patch.depositType = body.depositType;
    if (parseTime(body.workStart) !== null) patch.workStart = body.workStart;
    if (parseTime(body.workEnd) !== null) patch.workEnd = body.workEnd;
    if (body.adminPassword && String(body.adminPassword).length >= 4) patch.adminPassword = String(body.adminPassword);
    if (body.hospitals !== undefined) patch.hospitals = sanitizeList(body.hospitals, 50);
    if (body.noteOptions !== undefined) patch.noteOptions = sanitizeList(body.noteOptions, 20);

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

/* ============================== 服务器 ============================== */

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-token, x-openid',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'
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

server.listen(PORT, () => {
  const cfg = getConfig();
  console.log('==============================================');
  console.log('  陪诊预约后端已启动');
  console.log('  服务地址: http://127.0.0.1:' + PORT);
  console.log('  服务名称: ' + cfg.serviceName + '（' + cfg.escortName + '）');
  console.log('  微信登录: ' + (cfg.wxaAppid ? '真实模式' : '本地模拟模式（固定 openid）'));
  console.log('  管理端初始密码: ' + cfg.adminPassword + '（请尽快在设置中修改）');
  console.log('==============================================');
});
