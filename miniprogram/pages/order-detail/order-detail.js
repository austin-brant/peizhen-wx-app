const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const pay = require('../../utils/pay.js').pay;

Page({
  data: {
    order: null,
    tail: 0,
    statusText: {},
    statusDesc: '',
    step: {},
    escortPhone: ''
  },

  onLoad(options) {
    if (!options.id) {
      util.toast('缺少订单信息');
      wx.navigateBack();
      return;
    }
    this.orderId = options.id;
    this.loadData();
  },

  onShow() {
    if (this.orderId) this.loadData();
  },

  async loadData() {
    util.loading('加载中');
    try {
      const order = await api.get('/api/orders/' + this.orderId);
      const cfg = await api.get('/api/config');
      const tail = (order.price || 0) - (order.deposit || 0);
      this.setData({
        order,
        tail,
        escortPhone: cfg.phone || '',
        statusText: util.orderStatusText(order),
        statusDesc: this.statusDesc(order, tail),
        step: {
          submit: true,
          deposit: order.depositPaid,
          service: order.status === 'completed' || order.status === 'finished',
          tail: order.tailPaid
        }
      });
    } catch (e) {
      util.toast(e.message || '加载失败');
    } finally {
      util.hideLoading();
    }
  },

  statusDesc(order, tail) {
    if (order.status === 'cancelled') return '该预约已取消，如有需要请重新预约。';
    if (order.status === 'finished') return '全部费用已结清，期待下次为您服务。';
    if (order.status === 'completed') return '服务已完成，请支付尾款 ¥' + tail + '。';
    if (order.status === 'deposit_paid') return '定金已支付，请按时前往医院就诊。';
    return '预约已创建，请在有效期内支付定金以锁定时段。';
  },

  async payDeposit() {
    const { order } = this.data;
    if (!order) return;
    const confirmed = await pay({ amount: order.deposit, desc: '预约定金', orderId: order.id });
    if (!confirmed) return;
    util.loading('确认中');
    try {
      await api.post('/api/orders/' + order.id + '/pay-deposit');
      util.hideLoading();
      wx.redirectTo({
        url: '/pages/result/result?type=deposit&amount=' + order.deposit + '&orderId=' + order.id
      });
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '支付确认失败');
    }
  },

  async payTail() {
    const { order, tail } = this.data;
    if (!order || order.status !== 'completed') return;
    const confirmed = await pay({ amount: tail, desc: '服务尾款', orderId: order.id });
    if (!confirmed) return;
    util.loading('确认中');
    try {
      await api.post('/api/orders/' + order.id + '/pay-tail');
      util.hideLoading();
      wx.redirectTo({
        url: '/pages/result/result?type=tail&amount=' + tail + '&orderId=' + order.id
      });
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '支付确认失败');
    }
  },

  async cancelOrder() {
    const { order } = this.data;
    if (!order) return;
    const ok = await util.confirm('取消后该时段将释放，已付定金请与陪诊师协商线下退还。确定取消吗？', '取消预约');
    if (!ok) return;
    util.loading('处理中');
    try {
      await api.post('/api/orders/' + order.id + '/cancel');
      util.hideLoading();
      util.toast('已取消');
      this.loadData();
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '取消失败');
    }
  },

  callEscort() {
    const phone = this.data.escortPhone;
    if (!phone) return util.toast('暂无联系电话');
    wx.makePhoneCall({ phoneNumber: phone });
  }
});
