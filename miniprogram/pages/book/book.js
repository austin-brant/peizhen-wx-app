const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const login = require('../../utils/login.js');
const pay = require('../../utils/pay.js').pay;

Page({
  data: {
    date: '',
    start: '',
    end: '',
    price: 0,
    deposit: 0,
    durationText: '',
    slotCount: 0,
    notice: '',
    // 医院候选
    hospitals: [],
    hospitalNames: [],   // picker 展示用（末尾追加"其他（手动输入）"）
    hospitalIndex: -1,   // 等于 hospitals.length 表示手动输入
    showCustomHospital: false,
    // 备注快捷选项
    noteOptions: [],
    form: {
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
  },

  async loadConfig() {
    try {
      const cfg = await api.get('/api/config');
      const startMin = this.timeToMin(this.data.start);
      const endMin = this.timeToMin(this.data.end);
      const hours = ((endMin - startMin) / 60).toFixed(1);
      const slotCount = Math.round((endMin - startMin) / (Number(cfg.slotMinutes) || 60));

      const hospitals = cfg.hospitals || [];
      const hospitalNames = hospitals.concat(['其他（手动输入）']);

      this.setData({
        price: cfg.servicePrice,
        deposit: cfg.deposit,
        durationText: hours + ' 小时',
        slotCount,
        notice: cfg.notice,
        hospitals,
        hospitalNames,
        noteOptions: cfg.noteOptions || []
      });
    } catch (e) {
      util.toast(e.message || '加载失败');
    }
  },

  timeToMin(t) {
    const [h, m] = t.split(':');
    return Number(h) * 60 + Number(m);
  },

  inputChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ ['form.' + field]: value });
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
  },

  /* ============ 提交 ============ */

  toggleAgree() {
    this.setData({ agree: !this.data.agree });
  },

  showNotice() {
    this.setData({ showNotice: !this.data.showNotice });
  },

  async submit() {
    const { form, date, start, end, price, deposit, agree } = this.data;
    if (!form.clientName.trim()) return util.toast('请填写就诊人姓名');
    if (!/^1\d{10}$/.test(form.clientPhone)) return util.toast('请填写正确的手机号');
    if (!form.hospital.trim()) return util.toast('请填写就诊医院');
    if (!agree) return util.toast('请先同意预约须知');

    // 下单前确保已微信登录（后端用 openid 绑定订单）
    try {
      await login.ensureLogin();
    } catch (e) {
      return util.toast('请先授权微信登录');
    }

    this.setData({ loading: true });
    util.loading('正在创建订单');

    try {
      const order = await api.post('/api/orders', {
        date, start, end,
        clientName: form.clientName.trim(),
        clientPhone: form.clientPhone.trim(),
        hospital: form.hospital.trim(),
        department: form.department.trim(),
        notes: form.notes.trim()
      });

      // 记住手机号，方便快捷填写
      wx.setStorageSync('client_phone', form.clientPhone.trim());

      util.hideLoading();
      const confirmed = await pay({ amount: deposit, desc: '预约定金', orderId: order.id });

      if (confirmed) {
        util.loading('确认支付中');
        try {
          await api.post('/api/orders/' + order.id + '/pay-deposit');
          util.hideLoading();
          wx.redirectTo({
            url: '/pages/result/result?type=deposit&amount=' + deposit + '&orderId=' + order.id
          });
        } catch (e) {
          util.hideLoading();
          util.toast('支付确认失败：' + e.message);
          this.goOrderDetail(order.id);
        }
      } else {
        util.toast('订单已创建，可在"我的"中继续支付定金');
        wx.redirectTo({ url: '/pages/orders/orders' });
      }
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
