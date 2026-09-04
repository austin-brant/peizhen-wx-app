const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const login = require('../../utils/login.js');

Page({
  data: {
    loggedIn: false,
    loading: false,
    orders: [],
    loaded: false,
    // 个人信息卡：头像（chooseAvatar 组件选图）+ 昵称（type=nickname 输入），存后端用户表
    profile: { nickname: '', name: '', phone: '', avatar: '' },
    savingProfile: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.refresh();
  },

  async refresh() {
    const loggedIn = login.isLoggedIn();
    this.setData({ loggedIn });
    if (loggedIn) {
      this.loadOrders();
      this.loadProfile();
    } else {
      this.setData({ orders: [], loaded: false, profile: { nickname: '', name: '', phone: '', avatar: '' } });
    }
  },

  /** 微信授权登录（失败时弹窗引导重试） */
  async doLogin() {
    util.loading('微信登录中');
    try {
      await login.ensureLoginWithRetry();
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
  },

  /* ============ 个人信息卡（头像昵称填写能力） ============ */

  /** 相对头像地址转绝对地址（/api/uploads/xx → baseUrl + 路径） */
  absUrl(u) {
    if (!u) return '';
    return /^https?:/.test(u) ? u : getApp().globalData.baseUrl + u;
  },

  /** 拉取当前用户资料（头像/昵称/最近下单的姓名手机号） */
  async loadProfile() {
    try {
      const res = await api.get('/api/user/profile');
      const u = res.user || {};
      this._savedNickname = u.nickname || '';
      this.setData({
        profile: {
          nickname: u.nickname || '',
          name: u.name || '',
          phone: u.phone || '',
          avatar: this.absUrl(u.avatarUrl)
        }
      });
    } catch (e) { /* 静默失败，不打扰用户 */ }
  },

  /** 昵称输入（type=nickname，键盘上方可一键填入微信昵称） */
  onNicknameInput(e) {
    this.setData({ 'profile.nickname': e.detail.value });
  },

  /** 昵称失焦自动保存 */
  onNicknameBlur(e) {
    const nickname = (e.detail.value || '').trim();
    if (nickname === (this._savedNickname || '')) return; // 无变化不重复保存
    this.saveProfile({ nickname });
  },

  /** 保存昵称到用户表 */
  async saveProfile(patch) {
    if (this.data.savingProfile) return;
    this.setData({ savingProfile: true });
    try {
      const res = await api.post('/api/user/profile', patch);
      const u = res.user || {};
      this._savedNickname = u.nickname || '';
      this.setData({
        'profile.nickname': u.nickname || '',
        'profile.name': u.name || '',
        'profile.phone': u.phone || '',
        'profile.avatar': this.absUrl(u.avatarUrl)
      });
      util.toast('已保存');
    } catch (e) {
      util.toast(e.message || '保存失败');
    } finally {
      this.setData({ savingProfile: false });
    }
  },

  /** 选择微信头像（open-type=chooseAvatar）：临时文件读 base64 上传服务端 */
  onChooseAvatar(e) {
    const tempPath = e.detail.avatarUrl;
    if (!tempPath) return;
    // 先本地预览，再上传
    this.setData({ 'profile.avatar': tempPath });
    util.loading('保存头像中');
    this.uploadAvatar(tempPath, 0);
  },

  /** 上传头像：base64 → 超 500KB 或缺合法后缀时自动压缩重试（最多 3 次） */
  uploadAvatar(filePath, attempt) {
    const MAX = 500 * 1024;
    const IMG_EXT = /\.(png|jpg|jpeg|gif|webp)$/i;
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (r) => {
        const base64 = r.data || '';
        const size = Math.floor(base64.length * 3 / 4);
        const filename = (filePath.split('/').pop() || '').split('?')[0];
        const needCompress = (size > MAX + 2048) || !IMG_EXT.test(filename);
        if (needCompress && attempt < 3) {
          wx.compressImage({
            src: filePath,
            quality: attempt === 0 ? 60 : (attempt === 1 ? 30 : 20),
            success: (cr) => this.uploadAvatar(cr.tempFilePath, attempt + 1),
            fail: () => { util.hideLoading(); util.toast('头像压缩失败，请换一张图片'); }
          });
          return;
        }
        api.post('/api/user/profile', {
          avatarBase64: base64,
          avatarFilename: filename || 'avatar.jpg'
        }).then((res) => {
          util.hideLoading();
          const u = res.user || {};
          this.setData({ 'profile.avatar': this.absUrl(u.avatarUrl) || filePath });
          util.toast('头像已保存');
        }).catch((err) => {
          util.hideLoading();
          util.toast(err.message || '头像保存失败');
        });
      },
      fail: () => {
        util.hideLoading();
        util.toast('读取头像失败');
      }
    });
  }
});
