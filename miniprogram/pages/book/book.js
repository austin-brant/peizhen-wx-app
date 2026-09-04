const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const login = require('../../utils/login.js');

Page({
  data: {
    date: '',
    start: '',
    end: '',
    price: 0,            // 总价（单价×时长×折扣）
    unitPrice: 0,        // 每小时单价
    durationText: '',
    slotCount: 0,
    discountText: '',    // 折扣说明（如「满4小时 9折」），无折扣为空
    originalText: '',    // 原价说明（如「100 元/小时 × 5 小时」）
    notice: '',
    // 医院候选
    hospitals: [],
    hospitalNames: [],   // picker 展示用（末尾追加"其他（手动输入）"）
    hospitalIndex: -1,   // 等于 hospitals.length 表示手动输入
    showCustomHospital: false,
    // 备注快捷选项
    noteOptions: [],
    // 备注快捷选项的高亮状态映射（WXML 不支持 .indexOf()，在 JS 侧预计算）
    noteActive: {},
    // 为他人预约：勾选后填写就诊人；不勾选时预约人 = 就诊人
    forOthers: false,
    form: {
      bookerName: '',
      bookerPhone: '',
      clientName: '',
      clientPhone: '',
      hospital: '',
      department: '',
      notes: ''
    },
    agree: false,
    showNotice: false,
    loading: false
  },

  onLoad(options) {
    const { date, start, end } = options;
    if (!date || !start || !end) {
      util.toast('缺少预约时段信息');
      wx.navigateBack();
      return;
    }
    this.setData({ date, start, end });
    this.loadConfig();
    // 自动带入预约人信息：本地记忆 → 历史订单
    this.prefillBooker();
  },

  /**
   * 自动带入预约人信息（姓名/手机号）
   * 通过两级自动带入尽量免填：
   * 1) 本地记忆（上次预约成功后保存）；2) 该微信历史订单中的预约人信息。
   */
  prefillBooker() {
    const saved = {
      bookerName: wx.getStorageSync('booker_name') || '',
      bookerPhone: wx.getStorageSync('booker_phone') || ''
    };
    if (saved.bookerName || saved.bookerPhone) {
      this.setData({
        'form.bookerName': saved.bookerName,
        'form.bookerPhone': saved.bookerPhone
      });
    }
    // 从该微信的历史订单补充缺失字段（如换设备后本地记忆为空）
    const openid = login.getOpenid();
    if (!openid) return;
    api.get('/api/orders?openid=' + openid).then(res => {
      const list = res && res.list;
      if (!list || !list.length) return;
      const prev = list.find(o => o.bookerPhone || o.bookerName) || list[0];
      const patch = {};
      if (!this.data.form.bookerName && prev.bookerName) patch['form.bookerName'] = prev.bookerName;
      if (!this.data.form.bookerPhone && prev.bookerPhone) patch['form.bookerPhone'] = prev.bookerPhone;
      if (Object.keys(patch).length) this.setData(patch);
    }).catch(() => {});
  },

  async loadConfig() {
    try {
      const cfg = await api.get('/api/config');
      const startMin = this.timeToMin(this.data.start);
      const endMin = this.timeToMin(this.data.end);
      const hours = Math.round((endMin - startMin) / 60 * 10) / 10;
      const slotCount = Math.round((endMin - startMin) / (Number(cfg.slotMinutes) || 60));

      const hospitals = cfg.hospitals || [];
      const hospitalNames = hospitals.concat(['其他（手动输入）']);

      // 阶梯计价：总价 = 单价 × 时长 × 折扣（取最大可匹配档）
      const unit = Number(cfg.servicePrice) || 0;
      let matched = null;
      (cfg.discounts || []).forEach(d => {
        const h = Number(d.hours) || 0, r = Number(d.rate) || 1;
        if (h > 0 && r > 0 && r <= 1 && h <= hours && (!matched || h > Number(matched.hours))) matched = { hours: h, rate: r };
      });
      const rate = matched ? Number(matched.rate) : 1;
      const total = Math.round(unit * hours * rate * 100) / 100;

      this.setData({
        price: total,
        unitPrice: unit,
        durationText: hours + ' 小时',
        slotCount,
        discountText: matched ? ('满 ' + matched.hours + ' 小时打 ' + Math.round(matched.rate * 10) + ' 折') : '',
        originalText: (rate < 1) ? (unit + ' 元/小时 × ' + hours + ' 小时') : '',
        notice: cfg.notice,
        hospitals,
        hospitalNames,
        noteOptions: cfg.noteOptions || []
      });
      this.refreshNoteActive();
    } catch (e) {
      util.toast(e.message || '加载失败');
    }
  },

  /** 预计算备注快捷选项高亮状态（WXML 不支持 .indexOf() 方法调用） */
  refreshNoteActive() {
    const notes = (this.data.form.notes || '').trim();
    const parts = notes.split(/[、\n]/).map(s => s.trim()).filter(Boolean);
    const noteActive = {};
    (this.data.noteOptions || []).forEach(o => { noteActive[o] = parts.includes(o); });
    this.setData({ noteActive });
  },

  timeToMin(t) {
    const [h, m] = t.split(':');
    return Number(h) * 60 + Number(m);
  },

  inputChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ ['form.' + field]: value });
    if (field === 'notes') this.refreshNoteActive();
  },

  /* ============ 微信授权一键获取手机号 ============ */

  /**
   * getPhoneNumber 按钮回调：新版返回 e.detail.code，交由后端换取手机号。
   * 需已配置小程序 AppID/Secret（模拟模式下无法真正获取，会提示手动填写）。
   */
  onGetPhoneNumber(e) {
    const field = e.currentTarget.dataset.field;
    const detail = e.detail || {};
    if (detail.errMsg && detail.errMsg.indexOf(':ok') < 0) {
      util.toast(detail.errMsg.indexOf('deny') >= 0 ? '已取消授权，可手动填写' : '获取失败，请手动填写');
      return;
    }
    const code = detail.code;
    if (!code) {
      util.toast('未获取到手机号，请手动填写');
      return;
    }
    util.loading('获取手机号');
    api.post('/api/wechat/phone', { code })
      .then((res) => {
        util.hideLoading();
        if (res && res.phoneNumber) {
          this.setData({ ['form.' + field]: res.phoneNumber });
          util.toast('已获取');
        } else {
          util.toast('未获取到手机号，请手动填写');
        }
      })
      .catch((err) => {
        util.hideLoading();
        util.toast(err.message || '获取失败，请手动填写');
      });
  },

  /* ============ 医院候选 ============ */

  changeHospital(e) {
    const idx = Number(e.detail.value);
    const hospitals = this.data.hospitals;
    if (idx < hospitals.length) {
      // 选择了候选医院
      this.setData({
        hospitalIndex: idx,
        showCustomHospital: false,
        'form.hospital': hospitals[idx]
      });
    } else {
      // 手动输入
      this.setData({
        hospitalIndex: idx,
        showCustomHospital: true,
        'form.hospital': ''
      });
    }
  },

  /* ============ 备注快捷选项 ============ */

  tapNoteOption(e) {
    const opt = e.currentTarget.dataset.opt;
    const current = this.data.form.notes.trim();
    let next;
    const parts = current.split(/[、\n]/).map(s => s.trim()).filter(Boolean);
    if (parts.includes(opt)) {
      // 已存在 → 移除
      next = parts.filter(p => p !== opt).join('、');
    } else {
      // 追加
      parts.push(opt);
      next = parts.join('、');
    }
    this.setData({ 'form.notes': next });
    this.refreshNoteActive();
  },

  /* ============ 提交 ============ */

  /** 「为他人预约」勾选切换 */
  toggleForOthers() {
    this.setData({ forOthers: !this.data.forOthers });
  },

  toggleAgree() {
    this.setData({ agree: !this.data.agree });
  },

  showNotice() {
    this.setData({ showNotice: !this.data.showNotice });
  },

  /** 取消预约，返回首页 */
  cancelBook() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  async submit() {
    const { form, date, start, end, agree, forOthers } = this.data;
    if (!form.bookerName.trim()) return util.toast('请填写预约人姓名');
    if (!/^1\d{10}$/.test(form.bookerPhone)) return util.toast('请填写正确的预约人手机号');
    if (forOthers) {
      if (!form.clientName.trim()) return util.toast('请填写就诊人姓名');
      if (!/^1\d{10}$/.test(form.clientPhone)) return util.toast('请填写正确的就诊人手机号');
    }
    if (!form.hospital.trim()) return util.toast('请填写就诊医院');
    if (!agree) return util.toast('请先同意预约须知');

    // 下单前必须已微信登录（失败自动弹窗引导重试，后端用 openid 绑定订单）
    try {
      await login.ensureLoginWithRetry();
    } catch (e) {
      return util.toast('需要微信登录后才能预约');
    }

    this.setData({ loading: true });
    util.loading('正在提交预约');

    try {
      // 不勾选「为他人预约」时，就诊人默认即预约人本人
      const clientName = forOthers ? form.clientName.trim() : form.bookerName.trim();
      const clientPhone = forOthers ? form.clientPhone.trim() : form.bookerPhone.trim();

      const order = await api.post('/api/orders', {
        date, start, end, forOthers,
        bookerName: form.bookerName.trim(),
        bookerPhone: form.bookerPhone.trim(),
        clientName,
        clientPhone,
        hospital: form.hospital.trim(),
        department: form.department.trim(),
        notes: form.notes.trim()
      });

      // 记住预约人信息，下次自动带入
      wx.setStorageSync('booker_name', form.bookerName.trim());
      wx.setStorageSync('booker_phone', form.bookerPhone.trim());
      wx.setStorageSync('client_phone', clientPhone);

      util.hideLoading();
      // 预约即成功，无需支付
      wx.redirectTo({
        url: '/pages/result/result?orderId=' + order.id
      });
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '预约失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  goOrderDetail(orderId) {
    wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + orderId });
  }
});
