const api = require('../../../utils/api.js');
const util = require('../../../utils/util.js');

Page({
  data: {
    filter: 'today',
    filters: [
      { key: 'today', label: '今天' },
      { key: 'tomorrow', label: '明天' },
      { key: 'week', label: '近7天' },
      { key: 'all', label: '全部' }
    ],
    orders: [],
    summary: { count: 0, hours: 0, amount: 0 }
  },

  onShow() {
    this.loadOrders();
  },

  go(e) {
    wx.redirectTo({ url: e.currentTarget.dataset.url });
  },

  changeFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.key });
    this.loadOrders();
  },

  dateForFilter(filter) {
    const today = new Date();
    if (filter === 'today') return util.fmtDate(today);
    if (filter === 'tomorrow') return util.fmtDate(util.addDays(today, 1));
    return '';
  },

  async loadOrders() {
    util.loading('加载中');
    try {
      const params = [];
      if (this.data.filter === 'week') {
        const start = util.fmtDate(new Date());
        const end = util.fmtDate(util.addDays(new Date(), 6));
        params.push('dateStart=' + start);
        params.push('dateEnd=' + end);
      } else if (this.data.filter !== 'all') {
        params.push('date=' + this.dateForFilter(this.data.filter));
      }
      // 后端当前只支持单 date 查询；week 暂用 all，在前端过滤
      const url = '/api/admin/orders' + (params.length && this.data.filter !== 'week' ? '?' + params.join('&') : '');
      const res = await api.get(url, { admin: true });
      let list = res.list || [];

      if (this.data.filter === 'week') {
        const start = util.fmtDate(new Date());
        const end = util.fmtDate(util.addDays(new Date(), 6));
        list = list.filter(o => o.date >= start && o.date <= end);
      }

      list = list.map(o => Object.assign({}, o, { statusText: util.orderStatusText(o) }));
      const summary = list.reduce((acc, o) => {
        if (o.status !== 'cancelled') {
          acc.count += 1;
          acc.hours += o.durationHours || 0;
          acc.amount += o.price || 0;
        }
        return acc;
      }, { count: 0, hours: 0, amount: 0 });
      summary.hours = Math.round(summary.hours * 10) / 10;
      summary.amount = Math.round(summary.amount * 100) / 100;
      this.setData({ orders: list, summary });
    } catch (e) {
      util.toast(e.message || '加载失败');
    } finally {
      util.hideLoading();
    }
  },

  async completeOrder(e) {
    const id = e.currentTarget.dataset.id;
    const ok = await util.confirm('标记服务完成后，客户即可支付尾款。确定吗？', '确认');
    if (!ok) return;
    util.loading('处理中');
    try {
      await api.post('/api/admin/orders/' + id + '/complete', {}, { admin: true });
      util.hideLoading();
      util.toast('已标记完成');
      this.loadOrders();
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '操作失败');
    }
  },

  async cancelOrder(e) {
    const id = e.currentTarget.dataset.id;
    const ok = await util.confirm('取消后时段将释放，定金退还请线下处理。确定取消吗？', '取消订单');
    if (!ok) return;
    util.loading('处理中');
    try {
      await api.post('/api/admin/orders/' + id + '/cancel', {}, { admin: true });
      util.hideLoading();
      util.toast('已取消');
      this.loadOrders();
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '操作失败');
    }
  }
});
