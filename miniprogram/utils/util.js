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

/** 订单状态展示 */
function orderStatusText(o) {
  if (o.status === 'cancelled') return { text: '已取消', cls: 'tag-cancel' };
  if (o.status === 'finished') return { text: '已结清', cls: 'tag-done' };
  if (o.status === 'completed') return { text: '待付尾款', cls: 'tag-tail' };
  if (o.status === 'deposit_paid') return { text: '已付定金', cls: 'tag-deposit' };
  return { text: '待支付定金', cls: 'tag-pending' };
}

module.exports = {
  pad, fmtDate, addDays, weekText, monthDayText, dateList, money, toast, confirm, loading, hideLoading, orderStatusText
};
