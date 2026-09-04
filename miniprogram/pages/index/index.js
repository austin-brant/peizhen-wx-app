const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const login = require('../../utils/login.js');

Page({
  data: {
    dates: [],
    selected: { date: '', start: '', end: '' },
    slots: [],
    config: {},
    availableCount: 0,
    slotCount: 0,
    currentMonth: '',
    loading: false,
    isAdmin: false,
    // 月历弹窗
    showCalendar: false,
    calYear: 0,
    calMonth: 0,          // 1-12
    calTitle: '',
    calGrid: [],           // 42 格（含前置空白）
    calLoading: false,
    titleTapCount: 0,
    titleTapTimer: null
  },

  onLoad() {
    const dates = util.dateList(14);
    this.setData({
      dates,
      currentMonth: dates[0].monthDay.split('月')[0] + '月',
      'selected.date': dates[0].date
    });
    this.loadConfigAndSlots();
  },

  async onShow() {
    // 同步自定义 tabBar 选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    // 管理员身份：本地 token 或微信已绑定管理员
    let isAdmin = !!wx.getStorageSync('admin_token');
    if (!isAdmin && login.isLoggedIn()) {
      try {
        const res = await api.get('/api/admin/me?openid=' + login.getOpenid());
        isAdmin = !!(res && res.isAdmin);
      } catch (e) { isAdmin = false; }
    }
    this.setData({ isAdmin });
    // 从管理页/支付页返回时刷新，避免状态过期
    this.loadConfigAndSlots();
  },

  onShareAppMessage() {
    const c = this.data.config || {};
    return {
      title: (c.escortName || '陪诊师') + '的陪诊预约',
      path: '/pages/index/index'
    };
  },

  async loadConfigAndSlots() {
    const date = this.data.selected.date;
    if (!date) return;
    this.setData({ loading: true });
    try {
      const res = await api.get('/api/slots?date=' + date + '&days=1');
      const cfg = res.config || {};
      // 陪诊师头像（相对地址转绝对，供 <image> 显示）
      if (cfg.escortAvatar) cfg.escortAvatarUrl = this.absUrl(cfg.escortAvatar);
      const slots = (res.days && res.days[0] && res.days[0].slots) || [];

      // 如果当前选中的时段状态不再是可选，则清除选中
      let selected = this.data.selected;
      if (selected.start) {
        const stillOk = this.rangeStillAvailable(selected, slots);
        if (!stillOk) {
          selected = { date: selected.date, start: '', end: '' };
        }
      }

      this.setData({
        config: cfg,
        slots,
        availableCount: res.availableCount || 0,
        selected
      });
      this.refreshSlotCount(selected);
    } catch (e) {
      util.toast(e.message || '加载失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 校验已选区间内每个整段仍可约 */
  rangeStillAvailable(sel, slots) {
    if (!sel.start || !sel.end) return false;
    let inside = false;
    for (const s of slots) {
      if (s.start === sel.start) inside = true;
      if (inside) {
        if (s.status !== 'available') return false;
        if (s.end === sel.end) return true;
      }
    }
    return false;
  },

  /** 应用某个日期（日期条点击 / 日历选择共用） */
  applyDate(date) {
    let dates = this.data.dates;
    if (!dates.some(d => d.date === date)) {
      // 选中的日期不在当前 14 天条内（如日历中选了更远的日子），围绕它重建日期条
      dates = util.dateList(14, new Date(date + 'T00:00:00'));
    }
    const first = dates[0];
    this.setData({
      dates,
      currentMonth: first.monthDay.split('月')[0] + '月',
      'selected.date': date,
      'selected.start': '',
      'selected.end': '',
      slotCount: 0
    });
    this.loadConfigAndSlots();
  },

  selectDate(e) {
    const date = e.currentTarget.dataset.date;
    this.applyDate(date);
  },

  /** 时段选择：支持连续多选，合并为一个区间 [start, end]；管理员点已约时段可跳详情 */
  selectSlot(e) {
    const item = e.currentTarget.dataset.item;
    if (item.status !== 'available') {
      if (item.status === 'booked') {
        if (this.data.isAdmin && item.orderId) {
          // 管理员快捷入口：已约时段 → 该订单详情
          wx.navigateTo({ url: '/pages/admin/order-detail/order-detail?id=' + item.orderId });
        } else {
          util.toast('该时段已被预约');
        }
      }
      return;
    }

    const slots = this.data.slots;
    const idx = slots.findIndex(s => s.start === item.start);
    if (idx < 0) return;

    const sel = this.data.selected;
    let startIdx = -1, endIdx = -1;
    if (sel.start && sel.end) {
      startIdx = slots.findIndex(s => s.start === sel.start);
      endIdx = slots.findIndex(s => s.end === sel.end);
    }

    let ns, ne;
    if (startIdx < 0) {
      ns = idx; ne = idx;                                   // 尚无选中 → 单选
    } else if (idx === startIdx - 1) {
      ns = idx; ne = endIdx;                                // 左侧相邻 → 向左扩展
    } else if (idx === endIdx + 1) {
      ns = startIdx; ne = idx;                              // 右侧相邻 → 向右扩展
    } else if (idx === startIdx) {
      ns = startIdx + 1; ne = endIdx;                       // 点击左端点 → 收缩
    } else if (idx === endIdx) {
      ns = startIdx; ne = endIdx - 1;                       // 点击右端点 → 收缩
    } else {
      ns = idx; ne = idx;                                   // 区间内/不连续 → 重置为单选
    }

    if (ns < 0 || ne < 0) {
      this.setData({ 'selected.start': '', 'selected.end': '', slotCount: 0 });
      return;
    }
    if (ns > ne) { ns = ne; }

    const start = slots[ns].start;
    const end = slots[ne].end;
    this.setData({
      'selected.start': start,
      'selected.end': end
    });
    this.refreshSlotCount({ start, end });
  },

  /** 计算已选段数并更新底部栏 */
  refreshSlotCount(sel) {
    if (!sel || !sel.start || !sel.end) {
      this.setData({ slotCount: 0 });
      return;
    }
    const cfg = this.data.config || {};
    const step = Number(cfg.slotMinutes) || 60;
    const toMin = (t) => { const p = t.split(':').map(Number); return p[0] * 60 + p[1]; };
    const count = Math.round((toMin(sel.end) - toMin(sel.start)) / step);
    this.setData({ slotCount: count });
  },

  /** 相对头像地址转绝对地址（/api/uploads/xx → baseUrl + 路径） */
  absUrl(u) {
    if (!u) return '';
    return /^https?:/.test(u) ? u : getApp().globalData.baseUrl + u;
  },

  goBook() {
    const s = this.data.selected;
    if (!s.start) {
      util.toast('请先选择可预约时段');
      return;
    }
    // 预约至少选择两个小时（连续两个及以上时段）
    const toMin = (t) => { const p = t.split(':').map(Number); return p[0] * 60 + p[1]; };
    const minutes = toMin(s.end) - toMin(s.start);
    if (minutes < 120) {
      util.toast('预约时长至少为 2 小时，请连选两个及以上时段');
      return;
    }
    wx.navigateTo({
      url: '/pages/book/book?date=' + s.date + '&start=' + s.start + '&end=' + s.end
    });
  },

  /* ===================== 微信联系 ===================== */

  /**
   * 微信联系：配置了企业微信客服（wxCorpId + kfUrl）→ 直接跳转客服聊天窗口；
   * 否则弹「加微信」提示，一键复制陪诊师微信号。
   */
  contactWechat() {
    const cfg = this.data.config || {};
    const corpId = (cfg.wxCorpId || '').trim();
    const kfUrl = (cfg.kfUrl || '').trim();
    if (corpId && kfUrl && wx.openCustomerServiceChat) {
      wx.openCustomerServiceChat({
        corpId,
        extInfo: { url: kfUrl },
        fail: () => this.promptAddWechat(cfg)
      });
      return;
    }
    this.promptAddWechat(cfg);
  },

  /** 未配置/打不开客服：提示加微信，确认后一键复制微信号 */
  promptAddWechat(cfg) {
    const wid = (cfg.wechatId || '').trim();
    if (!wid) {
      util.toast('暂未配置微信号，可电话联系');
      return;
    }
    wx.showModal({
      title: '微信联系',
      content: '微信号：' + wid + '\n\n· 已添加微信：打开微信直接发消息\n· 未添加：点「复制微信号」，去微信搜索添加',
      confirmText: '复制微信号',
      cancelText: '暂不',
      confirmColor: '#00b8a9',
      success: (r) => {
        if (!r.confirm) return;
        wx.setClipboardData({
          data: wid,
          success() {
            util.toast('已复制，去微信添加好友');
          }
        });
      }
    });
  },

  callPhone() {
    const phone = (this.data.config.phone || '').trim();
    if (!phone) return util.toast('暂未配置联系电话');
    wx.makePhoneCall({ phoneNumber: phone });
  },

  /* ===================== 月历弹窗 ===================== */

  openCalendar() {
    const sel = this.data.selected.date || util.fmtDate(new Date());
    const [y, m] = sel.split('-').map(Number);
    this.setData({ showCalendar: true });
    this.loadCalendar(y, m);
  },

  closeCalendar() {
    this.setData({ showCalendar: false });
  },

  stopPropagation() {},

  prevMonth() {
    let { calYear, calMonth } = this.data;
    calMonth -= 1;
    if (calMonth < 1) { calMonth = 12; calYear -= 1; }
    this.loadCalendar(calYear, calMonth);
  },

  nextMonth() {
    let { calYear, calMonth } = this.data;
    calMonth += 1;
    if (calMonth > 12) { calMonth = 1; calYear += 1; }
    this.loadCalendar(calYear, calMonth);
  },

  goToday() {
    const now = new Date();
    this.loadCalendar(now.getFullYear(), now.getMonth() + 1);
  },

  async loadCalendar(year, month) {
    this.setData({ calLoading: true, calYear: year, calMonth: month, calTitle: year + ' 年 ' + month + ' 月' });
    try {
      const mm = util.pad(month);
      const res = await api.get('/api/calendar?month=' + year + '-' + mm);
      const days = res.days || [];
      const grid = [];
      for (let i = 0; i < (res.firstWeekday || 0); i++) grid.push({ key: 'blank-' + i, blank: true });
      days.forEach(d => {
        grid.push(Object.assign({ key: d.date }, d, {
          cls: d.past ? 'past' : (d.availableCount > 0 ? 'free' : 'full')
        }));
      });
      let tail = 0;
      while (grid.length % 7 !== 0) { grid.push({ key: 'blank-t' + (tail++), blank: true }); }
      this.setData({ calGrid: grid });
    } catch (e) {
      util.toast(e.message || '日历加载失败');
    } finally {
      this.setData({ calLoading: false });
    }
  },

  pickCalendarDay(e) {
    const item = e.currentTarget.dataset.item;
    if (!item || item.blank) return;
    if (item.past) return util.toast('不能选择过去的日期');
    this.setData({ showCalendar: false });
    this.applyDate(item.date);
  },

  /* ===================== 管理入口 ===================== */

  /** 连点服务名称 5 次：管理员直接进管理端，否则进管理登录页 */
  tapTitle() {
    const t = this;
    t.data.titleTapCount += 1;
    clearTimeout(t.data.titleTapTimer);
    t.data.titleTapTimer = setTimeout(() => { t.data.titleTapCount = 0; }, 2000);
    if (t.data.titleTapCount >= 5) {
      t.data.titleTapCount = 0;
      if (t.data.isAdmin) {
        wx.switchTab({ url: '/pages/admin/home/home' });
      } else {
        wx.navigateTo({ url: '/pages/admin/login/login' });
      }
    }
  },

  goAdmin() {
    if (!this.data.isAdmin) return;
    wx.switchTab({ url: '/pages/admin/home/home' });
  },

  /** 陪诊师介绍页 */
  goAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  }
});
