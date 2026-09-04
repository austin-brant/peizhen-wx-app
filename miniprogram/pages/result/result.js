const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

Page({
  data: {
    orderId: '',
    order: null
  },

  onLoad(options) {
    const orderId = options.orderId || '';
    this.setData({ orderId });
    if (orderId) this.loadOrder(orderId);
  },

  async loadOrder(orderId) {
    try {
      const order = await api.get('/api/orders/' + orderId);
      this.setData({ order });
    } catch (e) {
      // 非关键错误，忽略
    }
  },

  goOrder() {
    const id = this.data.orderId;
    if (!id) { this.goHome(); return; }
    wx.redirectTo({ url: '/pages/order-detail/order-detail?id=' + id });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
