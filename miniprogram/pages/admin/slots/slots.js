const api = require('../../../utils/api.js');
const util = require('../../../utils/util.js');

Page({
  data: {
    dates: [],
    selected: '',
    daySlots: [],
    availableCount: 0,
    fullyBlocked: false,
    pendingToggle: ''
  },

  onLoad() {
    const dates = util.dateList(14);
    this.setData({ dates, selected: dates[0].date });
    this.loadSlots();
  },

  onShow() {
    this.loadSlots();
  },

  go(e) {
    wx.redirectTo({ url: e.currentTarget.dataset.url });
  },

  selectDate(e) {
    this.setData({ selected: e.currentTarget.dataset.date });
    this.loadSlots();
  },

  async loadSlots() {
    util.loading('加载中');
    try {
      const res = await api.get('/api/admin/slots?date=' + this.data.selected + '&days=1', { admin: true });
      const day = (res.days && res.days[0]) || { slots: [], fullyBlocked: false };
      this.setData({
        daySlots: day.slots || [],
        availableCount: day.availableCount || 0,
        fullyBlocked: day.fullyBlocked
      });
    } catch (e) {
      util.toast(e.message || '加载失败');
    } finally {
      util.hideLoading();
    }
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
