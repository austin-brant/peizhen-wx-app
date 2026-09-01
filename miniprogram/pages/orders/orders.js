const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const login = require('../../utils/login.js');

Page({
  data: {
    loggedIn: false,
    loading: false,
    orders: [],
    loaded: false
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    const loggedIn = login.isLoggedIn();
    this.setData({ loggedIn });
    if (loggedIn) {
      this.loadOrders();
    } else {
      this.setData({ orders: [], loaded: false });
    }
  },

  /** 微信授权登录（静默，无弹窗） */
  async doLogin() {
    util.loading('微信登录中');
    try {
      await login.ensureLogin(true);
      util.hideLoading();
      this.setData({ loggedIn: true });
      this.loadOrders();
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '登录失败');
    }
  },

  async loadOrders() {
    this.setData({ loading: true });
    try {
      const openid = login.getOpenid();
      const res = await api.get('/api/orders?openid=' + openid);
      const list = (res.list || []).map(o => Object.assign({}, o, { statusText: util.orderStatusText(o) }));
      this.setData({ orders: list, loaded: true });
    } catch (e) {
      util.toast(e.message || '查询失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + id });
  }
});
