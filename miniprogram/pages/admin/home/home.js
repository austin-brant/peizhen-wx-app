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
    // 订单状态过滤
    statusFilter: 'all',
    statusFilters: [
      { key: 'all', label: '全部状态' },
      { key: 'pending', label: '待确认' },
      { key: 'confirmed', label: '已确认' },
      { key: 'completed', label: '已完成' },
      { key: 'cancelled', label: '已取消' }
    ],
    pickedDate: '',   // 日历选中的日期 YYYY-MM-DD
    pickedShort: '',  // 日历项短显示（如 9月1日）
    today: '',
    orders: [],
    summary: { count: 0, pending: 0, hours: 0, amount: 0 }
  },

  onLoad() {
    this.setData({ today: util.fmtDate(new Date()) });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.loadOrders();
  },

  go(e) {
    wx.redirectTo({ url: e.currentTarget.dataset.url });
  },

  changeFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.key });
    this.loadOrders();
  },

  changeStatusFilter(e) {
    this.setData({ statusFilter: e.currentTarget.dataset.key });
    this.loadOrders();
  },

  /** 日历任选一天 */
  changePickDate(e) {
    const d = e.detail.value;
    if (!d) return;
    const parts = d.split('-');
    this.setData({ filter: 'pick', pickedDate: d, pickedShort: Number(parts[1]) + '月' + Number(parts[2]) + '日' });
    this.loadOrders();
  },

  dateForFilter(filter) {
    const today = new Date();
    if (filter === 'today') return util.fmtDate(today);
    if (filter === 'tomorrow') return util.fmtDate(util.addDays(today, 1));
    return '';
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/admin/order-detail/order-detail?id=' + e.currentTarget.dataset.id });
  },

  async loadOrders() {
    util.loading('加载中');
    try {
      const params = [];
      if (this.data.filter === 'pick') {
        params.push('date=' + this.data.pickedDate);
      } else if (this.data.filter === 'week') {
        params.push('dateStart=' + util.fmtDate(new Date()));
        params.push('dateEnd=' + util.fmtDate(util.addDays(new Date(), 6)));
      } else if (this.data.filter !== 'all') {
        params.push('date=' + this.dateForFilter(this.data.filter));
      }
      if (this.data.statusFilter !== 'all') {
        params.push('status=' + this.data.statusFilter);
      }
      const url = '/api/admin/orders' + (params.length ? '?' + params.join('&') : '');
      const res = await api.get(url, { admin: true });
      let list = res.list || [];

      list = list.map(o => Object.assign({}, o, { statusText: util.orderStatusText(o) }));
      const summary = list.reduce((acc, o) => {
        if (o.status !== 'cancelled') {
          acc.count += 1;
          acc.hours += o.durationHours || 0;
          acc.amount += o.price || 0;
          if (o.status === 'pending') acc.pending += 1;
        }
        return acc;
      }, { count: 0, pending: 0, hours: 0, amount: 0 });
      summary.hours = Math.round(summary.hours * 10) / 10;
      summary.amount = Math.round(summary.amount * 100) / 100;
      this.setData({ orders: list, summary });
    } catch (e) {
      util.toast(e.message || '加载失败');
    } finally {
      util.hideLoading();
    }
  },

  async confirmOrder(e) {
    const id = e.currentTarget.dataset.id;
    const ok = await util.confirm('确认该预约后即为生效订单。确定确认吗？', '确认预约');
    if (!ok) return;
    util.loading('处理中');
    try {
      await api.post('/api/admin/orders/' + id + '/confirm', {}, { admin: true });
      util.hideLoading();
      util.toast('已确认');
      this.loadOrders();
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '操作失败');
    }
  },

  async completeOrder(e) {
    const id = e.currentTarget.dataset.id;
    const ok = await util.confirm('标记该订单服务已完成吗？', '确认');
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
    const ok = await util.confirm('取消后时段将释放，请与客户协商。确定取消吗？', '取消订单');
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
  },

  async deleteOrder(e) {
    const id = e.currentTarget.dataset.id;
    const ok = await util.confirm('删除后该订单记录将永久消失且不可恢复。确定删除吗？', '删除记录');
    if (!ok) return;
    util.loading('处理中');
    try {
      await api.del('/api/admin/orders/' + id, { admin: true });
      util.hideLoading();
      util.toast('已删除');
      this.loadOrders();
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '操作失败');
    }
  }
});
