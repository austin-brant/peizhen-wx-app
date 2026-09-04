// 管理端订单详情：查看当前时段预约详情、联系用户微信、完成/取消
const api = require('../../../utils/api.js');
const util = require('../../../utils/util.js');

Page({
  data: {
    order: null,
    statusText: {},
    statusDesc: '',
    userAvatar: '',
    createdText: '',
    discountText: ''
  },

  onLoad(options) {
    if (!options.id) {
      util.toast('缺少订单信息');
      wx.navigateBack();
      return;
    }
    this.orderId = options.id;
  },

  onShow() {
    if (this.orderId) this.loadData();
  },

  async loadData() {
    util.loading('加载中');
    try {
      const order = await api.get('/api/admin/orders/' + this.orderId, { admin: true });
      // 下单用户头像（相对路径转绝对地址，供 <image> 显示）
      const userAvatar = (order.user && order.user.avatarUrl) ? this.absUrl(order.user.avatarUrl) : '';
      // WXML 不支持方法调用（.slice/.replace/Math.round），展示字段在此预处理
      const createdText = order.createdAt ? order.createdAt.slice(0, 16).replace('T', ' ') : '';
      const discountText = order.discountDesc
        || (order.discountRate && order.discountRate < 1 ? '打' + Math.round(order.discountRate * 10) + '折' : '');
      this.setData({
        order,
        userAvatar,
        createdText,
        discountText,
        statusText: util.orderStatusText(order),
        statusDesc: this.statusDesc(order)
      });
    } catch (e) {
      util.toast(e.message || '加载失败');
    } finally {
      util.hideLoading();
    }
  },

  /** 相对头像地址转绝对地址（/api/uploads/xx → baseUrl + 路径） */
  absUrl(u) {
    if (!u) return '';
    return /^https?:/.test(u) ? u : getApp().globalData.baseUrl + u;
  },

  statusDesc(order) {
    if (order.status === 'cancelled') return '该预约已取消，时段已释放。';
    if (order.status === 'completed' || order.status === 'finished') return '服务已完成。';
    if (order.status === 'pending') return '用户已提交预约，等待确认。确认后预约即生效。';
    return '已确认预约，请按时提供服务，可提前通过电话联系用户。';
  },

  /* ============ 联系用户 ============ */

  callClient() {
    const phone = (this.data.order.clientPhone || '').trim();
    if (!/^1\d{10}$/.test(phone)) return util.toast('用户手机号无效');
    wx.makePhoneCall({ phoneNumber: phone });
  },

  /* ============ 订单操作 ============ */

  async confirmOrder() {
    const ok = await util.confirm('确认该预约后即为生效订单。确定确认吗？', '确认预约');
    if (!ok) return;
    util.loading('处理中');
    try {
      await api.post('/api/admin/orders/' + this.orderId + '/confirm', {}, { admin: true });
      util.hideLoading();
      util.toast('已确认');
      this.loadData();
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '操作失败');
    }
  },

  async completeOrder() {
    const ok = await util.confirm('标记该订单服务已完成吗？', '确认');
    if (!ok) return;
    util.loading('处理中');
    try {
      await api.post('/api/admin/orders/' + this.orderId + '/complete', {}, { admin: true });
      util.hideLoading();
      util.toast('已标记完成');
      this.loadData();
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '操作失败');
    }
  },

  async cancelOrder() {
    const ok = await util.confirm('取消后时段将释放，请与用户协商。确定取消吗？', '取消订单');
    if (!ok) return;
    util.loading('处理中');
    try {
      await api.post('/api/admin/orders/' + this.orderId + '/cancel', {}, { admin: true });
      util.hideLoading();
      util.toast('已取消');
      this.loadData();
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '操作失败');
    }
  },

  async deleteOrder() {
    const ok = await util.confirm('删除后该订单记录将永久消失且不可恢复。确定删除吗？', '删除记录');
    if (!ok) return;
    util.loading('处理中');
    try {
      await api.del('/api/admin/orders/' + this.orderId, { admin: true });
      util.hideLoading();
      util.toast('已删除');
      wx.switchTab({ url: '/pages/admin/home/home' });
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '操作失败');
    }
  },

  backToHome() {
    wx.switchTab({ url: '/pages/admin/home/home' });
  }
});
