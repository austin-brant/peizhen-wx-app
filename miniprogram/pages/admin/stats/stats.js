const api = require('../../../utils/api.js');
const util = require('../../../utils/util.js');

Page({
  data: {
    period: 'week',
    periods: [
      { key: 'day', label: '今日' },
      { key: 'week', label: '本周' },
      { key: 'month', label: '本月' },
      { key: 'year', label: '本年' },
      { key: 'custom', label: '自定义' }
    ],
    customStart: '',  // 自定义起始日 YYYY-MM-DD
    customEnd: '',    // 自定义结束日 YYYY-MM-DD
    metric: 'count',
    // 订单状态过滤
    statusFilter: 'all',
    statusFilters: [
      { key: 'all', label: '全部' },
      { key: 'pending', label: '待确认' },
      { key: 'confirmed', label: '已确认' },
      { key: 'completed', label: '已完成' },
      { key: 'cancelled', label: '已取消' }
    ],
    stats: {
      orderCount: 0,
      totalHours: 0,
      totalAmount: 0,
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
    const url = e.currentTarget.dataset.url;
    if (url === '/pages/admin/home/home') {
      wx.switchTab({ url });
    } else {
      wx.redirectTo({ url });
    }
  },

  changePeriod(e) {
    const key = e.currentTarget.dataset.key;
    const patch = { period: key, metric: 'count' };
    // 切到自定义时给默认区间：本月 1 号 至 今天
    if (key === 'custom' && !this.data.customStart) {
      const now = new Date();
      patch.customStart = util.fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
      patch.customEnd = util.fmtDate(now);
    }
    this.setData(patch);
    this.loadStats();
  },

  changeCustomStart(e) {
    this.setData({ customStart: e.detail.value });
  },

  changeCustomEnd(e) {
    this.setData({ customEnd: e.detail.value });
  },

  changeMetric(e) {
    this.setData({ metric: e.currentTarget.dataset.m });
    this.buildSeries();
  },

  changeStatusFilter(e) {
    this.setData({ statusFilter: e.currentTarget.dataset.key });
    this.loadStats();
  },

  async loadStats() {
    if (this.data.period === 'custom') {
      if (!this.data.customStart || !this.data.customEnd) {
        return util.toast('请选择起止日期');
      }
      if (this.data.customStart > this.data.customEnd) {
        return util.toast('开始日期不能晚于结束日期');
      }
    }
    util.loading('加载中');
    try {
      let url = '/api/admin/stats?period=' + this.data.period + '&date=' + util.fmtDate(new Date());
      if (this.data.period === 'custom') {
        url += '&start=' + this.data.customStart + '&end=' + this.data.customEnd;
      }
      if (this.data.statusFilter !== 'all') {
        url += '&status=' + this.data.statusFilter;
      }
      const stats = await api.get(url, { admin: true });
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
      let list = (res.list || []).filter(o => o.date >= start && o.date <= end);
      const sf = this.data.statusFilter;
      if (sf === 'cancelled') {
        list = list.filter(o => o.status === 'cancelled');
      } else if (sf !== 'all') {
        list = list.filter(o => o.status === sf);
      } else {
        list = list.filter(o => o.status !== 'cancelled');
      }
      list = list.map(o => Object.assign({}, o, { statusText: util.orderStatusText(o).text }));
      this.setData({ orders: list });
    } catch (e) {
      // 明细非关键
    }
  }
});
