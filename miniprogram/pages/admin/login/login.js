const api = require('../../../utils/api.js');
const util = require('../../../utils/util.js');
const login = require('../../../utils/login.js');

Page({
  data: {
    password: '',
    openid: '',
    // 当前微信是否已绑定管理权限（决定是否显示"微信一键进入"）
    bound: false,
    checking: true
  },

  async onLoad() {
    // 静默登录拿到 openid，用于判断是否已绑定管理员
    try {
      const openid = await login.ensureLogin();
      this.setData({ openid });
      const res = await api.get('/api/admin/me?openid=' + openid);
      this.setData({ bound: !!(res && res.isAdmin) });
    } catch (e) {
      // 登录失败不阻塞密码登录
    } finally {
      this.setData({ checking: false });
    }
  },

  inputPwd(e) {
    this.setData({ password: e.detail.value });
  },

  /** 密码登录：校验通过后自动把当前微信绑定为管理员 */
  async login() {
    if (!this.data.password) return util.toast('请输入密码');
    util.loading('登录中');
    try {
      let openid = this.data.openid;
      if (!openid) {
        try { openid = await login.ensureLogin(); } catch (e) { openid = ''; }
      }
      const res = await api.post('/api/admin/login', { password: this.data.password, openid });
      wx.setStorageSync('admin_token', res.token);
      util.hideLoading();
      wx.redirectTo({ url: '/pages/admin/home/home' });
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '登录失败');
    }
  },

  /** 微信一键登录：仅已绑定管理权限的微信可用 */
  async wechatLogin() {
    util.loading('微信登录中');
    try {
      const code = await new Promise((resolve, reject) => {
        wx.login({
          success(r) { resolve(r.code); },
          fail() { reject(new Error('微信登录失败')); }
        });
      });
      const res = await api.post('/api/admin/wechat-login', { code });
      wx.setStorageSync('admin_token', res.token);
      util.hideLoading();
      wx.redirectTo({ url: '/pages/admin/home/home' });
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '登录失败');
    }
  }
});
