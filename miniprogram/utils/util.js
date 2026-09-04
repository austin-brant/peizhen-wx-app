// utils/util.js - 通用工具函数
function pad(n) { return n < 10 ? '0' + n : '' + n; }

function fmtDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function weekText(d) { return WEEK[d.getDay()]; }

function monthDayText(d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }

/** 生成未来 n 天的日期条数据 */
function dateList(n, startDate) {
  const start = startDate || new Date();
  const today = fmtDate(new Date());
  const list = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(start, i);
    const ds = fmtDate(d);
    list.push({
      date: ds,
      week: weekText(d),
      day: d.getDate(),
      monthDay: monthDayText(d),
      isToday: ds === today
    });
  }
  return list;
}

function money(n) {
  n = Number(n) || 0;
  return (Math.round(n * 100) / 100).toFixed(2);
}

function toast(title) {
  wx.showToast({ title, icon: 'none' });
}

function confirm(content, title) {
  return new Promise((resolve) => {
    wx.showModal({
      title: title || '提示',
      content,
      confirmColor: '#00b8a9',
      success(res) { resolve(res.confirm); },
      fail() { resolve(false); }
    });
  });
}

function loading(title) {
  wx.showLoading({ title: title || '加载中', mask: true });
}

function hideLoading() {
  wx.hideLoading();
}

/** 订单状态展示（pending 待确认 / confirmed 已确认 / completed 已完成 / cancelled 已取消） */
function orderStatusText(o) {
  const s = o.status;
  if (s === 'cancelled') return { text: '已取消', cls: 'tag-cancel' };
  if (s === 'completed' || s === 'finished') return { text: '已完成', cls: 'tag-done' };
  if (s === 'pending') return { text: '待确认', cls: 'tag-pending' };
  if (s === 'confirmed' || s === 'deposit_paid') return { text: '已确认', cls: 'tag-confirmed' };
  return { text: '已预约', cls: 'tag-confirmed' };
}

/** 订单状态的短文案（用于时段格子等紧凑场景） */
function orderStatusLabel(o) {
  const s = o.status;
  if (s === 'cancelled') return '已取消';
  if (s === 'completed' || s === 'finished') return '已完成';
  if (s === 'pending') return '待确认';
  return '已确认';
}

module.exports = {
  pad, fmtDate, addDays, weekText, monthDayText, dateList, money, toast, confirm, loading, hideLoading, orderStatusText, orderStatusLabel
};
