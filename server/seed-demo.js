'use strict';
/**
 * 演示数据生成脚本（可选）
 * 用法：node seed-demo.js
 * 生成最近几天的示例预约 + 未来两个"不可约"时段，方便预览统计页与管理端效果。
 * 运行前请确认 server.js 未运行，或运行后重启 server.js。
 */
const path = require('path');
const { DB } = require('./db.js');

const db = new DB(path.join(__dirname, 'data'));
const orders = db.read('orders', { list: [] }).list;
const blocked = db.read('blocked', { list: [] }).list;

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fmtMinutes(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const PRICE = 200, DEPOSIT = 50;
const PEOPLE = [
  ['张伟', '协和医院', '内科', '家属陪同'],
  ['李娜', '人民医院', '骨科', ''],
  ['王强', '中心医院', '心内科', '老人行动不便'],
  ['赵敏', '儿童医院', '儿科', '带娃看诊'],
  ['刘洋', '中医院', '中医科', '复诊'],
  ['陈静', '省医院', '消化科', '']
];

if (orders.length === 0) {
  const today = new Date();
  const samples = [
    { dayOffset: -5, start: 9, status: 'finished', tail: true },
    { dayOffset: -5, start: 14, status: 'finished', tail: true },
    { dayOffset: -4, start: 10, status: 'completed', tail: false },
    { dayOffset: -3, start: 15, status: 'finished', tail: true },
    { dayOffset: -2, start: 9, status: 'deposit_paid', tail: false },
    { dayOffset: -2, start: 11, status: 'completed', tail: false },
    { dayOffset: -1, start: 14, status: 'deposit_paid', tail: false },
    { dayOffset: 0, start: 9, status: 'deposit_paid', tail: false },
    { dayOffset: 0, start: 10, status: 'deposit_paid', tail: false },
    { dayOffset: 1, start: 15, status: 'deposit_paid', tail: false }
  ];
  samples.forEach((s, i) => {
    const date = fmtDate(addDays(today, s.dayOffset));
    const start = s.start, end = s.start + 1;
    const [clientName, hospital, department, notes] = PEOPLE[i % PEOPLE.length];
    const order = {
      id: 'Odemo' + pad(i + 1),
      date,
      start: fmtMinutes(start * 60),
      end: fmtMinutes(end * 60),
      durationHours: 1,
      clientName,
      clientPhone: '1380000' + pad(1000 + i).slice(-4),
      hospital,
      department,
      notes,
      price: PRICE,
      deposit: DEPOSIT,
      status: 'pending',
      depositPaid: false,
      tailPaid: false,
      createdAt: new Date(addDays(today, s.dayOffset - 1)).toISOString(),
      depositPaidAt: '', completedAt: '', tailPaidAt: '', cancelledAt: ''
    };
    if (s.status === 'finished') {
      order.status = 'finished'; order.depositPaid = true; order.tailPaid = true;
      order.depositPaidAt = order.createdAt;
      order.completedAt = new Date(date + 'T' + order.start + ':00').toISOString();
      order.tailPaidAt = order.completedAt;
    } else if (s.status === 'completed') {
      order.status = 'completed'; order.depositPaid = true; order.tailPaid = false;
      order.depositPaidAt = order.createdAt;
      order.completedAt = new Date(date + 'T' + order.start + ':00').toISOString();
    } else {
      order.status = 'deposit_paid'; order.depositPaid = true;
      order.depositPaidAt = order.createdAt;
    }
    orders.push(order);
  });

  // 未来两天各屏蔽一个时段作为演示
  blocked.push(
    { id: 'Bdemo1', date: fmtDate(addDays(today, 2)), start: '09:00', end: '11:00' },
    { id: 'Bdemo2', date: fmtDate(addDays(today, 3)), allDay: true }
  );
  db.save('orders', { list: orders });
  db.save('blocked', { list: blocked });
  console.log('演示数据已生成：10 条预约 + 2 个屏蔽时段');
} else {
  console.log('已存在订单数据，跳过生成（如需重置请删除 server/data/orders.json）');
}
