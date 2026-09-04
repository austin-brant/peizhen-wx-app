// 自定义 tabBar：预约 / 我的 /（管理，仅管理员可见）
const api = require('../utils/api.js');

Component({
  data: {
    selected: 0,     // 0=预约 1=我的 2=管理
    isAdmin: false,
    list: [
      { pagePath: '/pages/index/index', text: '预约', icon: '/images/tab-book.png', iconOn: '/images/tab-book-on.png' },
      { pagePath: '/pages/orders/orders', text: '我的', icon: '/images/tab-me.png', iconOn: '/images/tab-me-on.png' },
      { pagePath: '/pages/admin/home/home', text: '管理', icon: '/images/tab-admin.png', iconOn: '/images/tab-admin-on.png' }
    ]
  },

  lifetimes: {
    attached() {
      this.refreshAdmin();
    }
  },

  pageLifetimes: {
    show() {
      this.refreshAdmin();
    }
  },

  methods: {
    switchTab(e) {
      const path = e.currentTarget.dataset.path;
      wx.switchTab({ url: path });
    },

    /** 判断当前微信是否为管理员（决定是否显示「管理」tab） */
    refreshAdmin() {
      if (wx.getStorageSync('admin_token')) {
        this.setData({ isAdmin: true });
        return;
      }
      const openid = wx.getStorageSync('openid');
      if (!openid) {
        this.setData({ isAdmin: false });
        return;
      }
      api.get('/api/admin/me?openid=' + openid)
        .then(res => this.setData({ isAdmin: !!(res && res.isAdmin) }))
        .catch(() => this.setData({ isAdmin: false }));
    }
  }
});
