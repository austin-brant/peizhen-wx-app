const api = require('../../../utils/api.js');
const util = require('../../../utils/util.js');

Page({
  data: {
    period: 'week',
    periods: [
      { key: 'day', label: '今日' },
      { key: 'week', label: '本周' },
      { key: 'month', label: '本月' },
      { key: 'year', label: '本年' }
    ],
    metric: 'count',
    stats: {
      orderCount: 0,
      totalHours: 0,
      totalAmount: 0,
      depositReceived: 0,
      tailReceived: 0,
      pendingTail: 0,
      range: { start: '', end: '' },
      series: []
    },
    rangeText: '',
    series: [],
    orders: []
  },

  onShow() {
    this.loadStats();
  },

  go(e) {
    wx.redirectTo({ url: e.currentTarget.dataset.url });
  },

  changePeriod(e) {
    this.setData({ period: e.currentTarget.dataset.key, metric: 'count' });
    this.loadStats();
  },

  changeMetric(e) {
    this.setData({ metric: e.currentTarget.dataset.m });
    this.buildSeries();
  },

  async loadStats() {
    util.loading('加载中');
    try {
      const date = util.fmtDate(new Date());
      const stats = await api.get('/api/admin/stats?period=' + this.data.period + '&date=' + date, { admin: true });
      const rangeText = stats.range.start + ' 至 ' + stats.range.end;
      this.setData({ stats, rangeText });
      this.buildSeries();
      this.loadOrders(stats.range.start, stats.range.end);
    } catch (e) {
      util.toast(e.message || '加载失败');
    } finally {
      util.hideLoading();
    }
  },

  buildSeries() {
    const { stats, metric } = this.data;
    const raw = stats.series || [];
    const max = raw.reduce((m, s) => Math.max(m, s[metric] || 0), 0) || 1;
    const series = raw.map(s => ({
      key: s.key,
      label: s.label,
      value: s[metric] || 0,
      percent: Math.max(4, Math.round(((s[metric] || 0) / max) * 100))
    }));
    this.setData({ series });
  },

  async loadOrders(start, end) {
    try {
      const res = await api.get('/api/admin/orders', { admin: true });
      const list = (res.list || []).filter(o => o.status !== 'cancelled' && o.date >= start && o.date <= end);
      this.setData({ orders: list });
    } catch (e) {
      // 明细非关键
    }
  }
});
