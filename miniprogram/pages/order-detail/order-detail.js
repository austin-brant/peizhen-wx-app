const api = require('../../utils/api.js');
const util = require('../../utils/util.js');

Page({
  data: {
    order: null,
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
      this.setData({
        order,
        escortPhone: cfg.phone || '',
        statusText: util.orderStatusText(order),
        statusDesc: this.statusDesc(order),
        step: {
          submit: true,
          service: order.status === 'completed' || order.status === 'finished'
        }
      });
    } catch (e) {
      util.toast(e.message || '加载失败');
    } finally {
      util.hideLoading();
    }
  },

  statusDesc(order) {
    if (order.status === 'cancelled') return '该预约已取消，如有需要请重新预约。';
    if (order.status === 'completed' || order.status === 'finished') return '服务已完成，感谢您的信任，期待下次为您服务。';
    if (order.status === 'pending') return '预约已提交，等待陪诊师确认。确认后即生效。';
    return '预约已确认，请按时前往医院就诊，陪诊师会提前与您联系。';
  },

  async cancelOrder() {
    const { order } = this.data;
    if (!order) return;
    const ok = await util.confirm('取消后该时段将释放，请提前与陪诊师协商。确定取消吗？', '取消预约');
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
