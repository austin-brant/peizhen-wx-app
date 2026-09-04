// 陪诊师介绍页：内容为管理端设置的 Markdown（支持标题/加粗/列表/图片）
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const md = require('../../utils/md.js');

Page({
  data: {
    escortName: '陪诊师',
    avatarText: '陪',
    escortAvatarUrl: '',
    nodes: [],
    hasContent: false
  },

  onLoad() {
    this.load();
  },

  async load() {
    util.loading('加载中');
    try {
      const cfg = await api.get('/api/config');
      const about = (cfg.about || '').trim();
      const name = cfg.escortName || '陪诊师';
      const avatar = cfg.escortAvatar || '';
      this.setData({
        escortName: name,
        avatarText: name.slice(0, 1),
        escortAvatarUrl: /^https?:/.test(avatar) ? avatar : (avatar ? getApp().globalData.baseUrl + avatar : ''),
        nodes: about ? md.parse(about) : [],
        hasContent: !!about
      });
      wx.setNavigationBarTitle({ title: name + ' · 介绍' });
    } catch (e) {
      util.toast(e.message || '加载失败');
    } finally {
      util.hideLoading();
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.escortName + '的陪诊服务介绍',
      path: '/pages/about/about'
    };
  }
});
