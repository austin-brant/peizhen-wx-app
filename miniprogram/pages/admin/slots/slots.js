const api = require('../../../utils/api.js');
const util = require('../../../utils/util.js');

Page({
  data: {
    dates: [],
    selected: '',
    scrollInto: '',
    daySlots: [],
    availableCount: 0,
    fullyBlocked: false,
    pendingToggle: '',
    // 订单状态过滤
    statusFilter: 'all',
    statusFilters: [
      { key: 'all', label: '全部' },
      { key: 'pending', label: '待确认' },
      { key: 'confirmed', label: '已确认' },
      { key: 'completed', label: '已完成' },
      { key: 'cancelled', label: '已取消' }
    ]
  },

  onLoad() {
    // 30 天日期条（横向滑动查看更多）
    const dates = util.dateList(30);
    this.setData({ dates, selected: dates[0].date });
    this.loadSlots();
  },

  onShow() {
    this.loadSlots();
  },

  go(e) {
    const url = e.currentTarget.dataset.url;
    if (url === '/pages/admin/home/home') {
      wx.switchTab({ url });
    } else {
      wx.redirectTo({ url });
    }
  },

  /** 选中某天：日历选到日期条之外时，围绕该日期重建 30 天条并滚动定位 */
  applyDate(date) {
    let dates = this.data.dates;
    if (!dates.some(d => d.date === date)) {
      dates = util.dateList(30, new Date(date + 'T00:00:00'));
    }
    this.setData({ dates, selected: date, scrollInto: 'd-' + date });
    this.loadSlots();
  },

  selectDate(e) {
    const date = e.currentTarget.dataset.date;
    if (date === this.data.selected) return;
    this.setData({ selected: date, scrollInto: 'd-' + date });
    this.loadSlots();
  },

  /** 日历任选任意一天（含过去日期，用于查看历史占用） */
  changePickDate(e) {
    const d = e.detail.value;
    if (!d || d === this.data.selected) return;
    this.applyDate(d);
  },

  /** 按订单状态过滤（只影响已约时段的强调显示，不改变可约/不可约） */
  changeStatusFilter(e) {
    this.setData({ statusFilter: e.currentTarget.dataset.key });
    this.renderSlots();
  },

  async loadSlots() {
    util.loading('加载中');
    try {
      const res = await api.get('/api/admin/slots?date=' + this.data.selected + '&days=1', { admin: true });
      const day = (res.days && res.days[0]) || { slots: [], fullyBlocked: false };
      this._rawSlots = day.slots || [];
      this.setData({
        availableCount: day.availableCount || 0,
        fullyBlocked: day.fullyBlocked
      });
      this.renderSlots();
    } catch (e) {
      util.toast(e.message || '加载失败');
    } finally {
      util.hideLoading();
    }
  },

  /** 根据当前状态过滤，生成展示用时段（含状态文案 + 是否弱化） */
  renderSlots() {
    const filter = this.data.statusFilter;
    const slots = (this._rawSlots || []).map(s => {
      let label = s.status === 'available' ? '可约' : (s.status === 'unavailable' ? '不可约' : '已约');
      let dim = false;
      if (s.status === 'booked') {
        label = util.orderStatusLabel({ status: s.orderStatus }) + '·点看详情';
        dim = filter !== 'all' && s.orderStatus !== filter;
      }
      return Object.assign({}, s, { label, dim });
    });
    this.setData({ daySlots: slots });
  },

  /** 已约时段点击 → 进入该订单详情；其余时段 → 切换可约状态 */
  slotTap(e) {
    const item = e.currentTarget.dataset.item;
    if (item.status === 'booked' && item.orderId) {
      wx.navigateTo({ url: '/pages/admin/order-detail/order-detail?id=' + item.orderId });
      return;
    }
    this.toggleSlot(e);
  },

  async toggleSlot(e) {
    const item = e.currentTarget.dataset.item;
    if (item.status === 'booked') {
      util.toast('该时段已被预约，不可手动修改');
      return;
    }
    this.setData({ pendingToggle: item.start });
    try {
      if (item.status === 'available') {
        await api.post('/api/admin/slots/block', {
          date: this.data.selected,
          start: item.start,
          end: item.end
        }, { admin: true });
        util.toast('已设为不可约');
      } else {
        await api.post('/api/admin/slots/unblock', {
          date: this.data.selected,
          start: item.start,
          end: item.end
        }, { admin: true });
        util.toast('已恢复可约');
      }
      this.loadSlots();
    } catch (e) {
      util.toast(e.message || '操作失败');
    } finally {
      this.setData({ pendingToggle: '' });
    }
  },

  async blockAll() {
    const ok = await util.confirm('将当天所有时段设为不可约，已有预约的时段除外。确定吗？', '整日不可约');
    if (!ok) return;
    util.loading('处理中');
    try {
      await api.post('/api/admin/slots/block', { date: this.data.selected, allDay: true }, { admin: true });
      util.hideLoading();
      this.loadSlots();
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '操作失败');
    }
  },

  async unblockAll() {
    const ok = await util.confirm('确定将当天所有时段恢复为可约吗？', '整日可约');
    if (!ok) return;
    util.loading('处理中');
    try {
      await api.post('/api/admin/slots/unblock', { date: this.data.selected, allDay: true }, { admin: true });
      util.hideLoading();
      this.loadSlots();
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '操作失败');
    }
  }
});
