const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

Page({
  data: {
    type: '',
    amount: 0,
    orderId: '',
    title: '',
    tip: '',
    order: null
  },

  onLoad(options) {
    const type = options.type || 'deposit';
    const amount = options.amount || 0;
    const orderId = options.orderId || '';
    const title = type === 'tail' ? '尾款支付成功' : '定金支付成功';
    const tip = type === 'tail'
      ? '全部费用已结清，感谢您的信任。'
      : '预约已成功，请按时就诊。陪诊师会与您联系。';
    this.setData({ type, amount, orderId, title, tip });
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
