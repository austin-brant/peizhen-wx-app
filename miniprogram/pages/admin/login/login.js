const api = require('../../../utils/api.js');
const util = require('../../../utils/util.js');
const login = require('../../../utils/login.js');

Page({
  data: {
    password: '',
    openid: '',
    shortOpenid: '',
    // 当前微信是否已在管理白名单（决定是否显示"一键进入"与未授权提示）
    bound: false,
    checking: true
  },

  async onLoad() {
    // 静默登录拿到 openid，用于判断当前微信是否在管理白名单
    try {
      const openid = await login.ensureLogin();
      this.setData({ openid, shortOpenid: this.short(openid) });
      const res = await api.get('/api/admin/me?openid=' + openid);
      this.setData({ bound: !!(res && res.isAdmin) });
    } catch (e) {
      // 登录失败不阻塞密码登录
    } finally {
      this.setData({ checking: false });
    }
  },

  /** openid 缩略显示：前 8 位 + 后 4 位 */
  short(id) {
    if (!id) return '';
    return id.length > 12 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
  },

  inputPwd(e) {
    this.setData({ password: e.detail.value });
  },

  /** 复制当前微信 openid（未授权时便于联系管理员添加白名单） */
  copyOpenid() {
    const openid = this.data.openid;
    if (!openid) return util.toast('暂未获取到 openid');
    wx.setClipboardData({
      data: openid,
      success() {
        wx.showModal({
          title: 'openid 已复制',
          content: '请把它发给管理员，加入管理白名单后即可登录',
          showCancel: false,
          confirmColor: '#00b8a9'
        });
      }
    });
  },

  /** 管理登录：白名单微信 + 密码；白名单内微信登录后即可一键进入 */
  async login() {
    const password = this.data.password;
    if (!password) return util.toast('请输入密码');
    util.loading('登录中');
    try {
      const code = await new Promise((resolve, reject) => {
        wx.login({
          success(r) { resolve(r.code); },
          fail() { reject(new Error('微信登录失败')); }
        });
      });
      // 模拟模式下 wx.login 的 code 每次变化会导致 openid 漂移，
      // 传页面显示的 openid 保持身份一致（真实模式后端以 code2session 为准，忽略该字段）
      const res = await api.post('/api/admin/login', { code, openid: this.data.openid || '', password });
      wx.setStorageSync('admin_token', res.token);
      if (res.openid) wx.setStorageSync('openid', res.openid);
      util.hideLoading();
      wx.switchTab({ url: '/pages/admin/home/home' });
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '登录失败');
    }
  },

  /** 微信一键登录：仅白名单内微信可用 */
  async wechatLogin() {
    util.loading('微信登录中');
    try {
      const code = await new Promise((resolve, reject) => {
        wx.login({
          success(r) { resolve(r.code); },
          fail() { reject(new Error('微信登录失败')); }
        });
      });
      const res = await api.post('/api/admin/wechat-login', { code, openid: this.data.openid || '' });
      wx.setStorageSync('admin_token', res.token);
      util.hideLoading();
      wx.switchTab({ url: '/pages/admin/home/home' });
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '登录失败');
    }
  }
});
