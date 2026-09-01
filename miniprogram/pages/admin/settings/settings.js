const api = require('../../../utils/api.js');
const util = require('../../../utils/util.js');

Page({
  data: {
    form: {
      serviceName: '',
      escortName: '',
      phone: '',
      wechatId: '',
      kfUrl: '',
      servicePrice: '',
      depositType: 'fixed',
      depositValue: '',
      workStart: '09:00',
      workEnd: '18:00',
      slotMinutes: 60,
      notice: '',
      adminPassword: ''
    },
    depositTypes: [
      { label: '固定金额', value: 'fixed' },
      { label: '按比例(%)', value: 'percent' }
    ],
    depositTypeIndex: 0,
    slotOptions: [30, 45, 60, 90, 120],
    slotIndex: 2,
    slotPreview: '',
    // 医院候选
    hospitals: [],
    newHospital: '',
    // 备注快捷选项
    noteOptions: [],
    newNote: '',
    // 已绑定管理员微信
    adminOpenids: []
  },

  onShow() {
    this.loadConfig();
  },

  go(e) {
    wx.redirectTo({ url: e.currentTarget.dataset.url });
  },

  async loadConfig() {
    util.loading('加载中');
    try {
      const cfg = await api.get('/api/admin/config', { admin: true });
      const depositTypeIndex = cfg.depositType === 'percent' ? 1 : 0;
      const slotIndex = this.data.slotOptions.indexOf(cfg.slotMinutes) >= 0 ? this.data.slotOptions.indexOf(cfg.slotMinutes) : 2;
      this.setData({
        form: {
          serviceName: cfg.serviceName,
          escortName: cfg.escortName,
          phone: cfg.phone || '',
          wechatId: cfg.wechatId || '',
          kfUrl: cfg.kfUrl || '',
          servicePrice: cfg.servicePrice,
          depositType: cfg.depositType,
          depositValue: cfg.depositValue,
          workStart: cfg.workStart,
          workEnd: cfg.workEnd,
          slotMinutes: cfg.slotMinutes,
          notice: cfg.notice,
          adminPassword: ''
        },
        depositTypeIndex,
        slotIndex,
        hospitals: cfg.hospitals || [],
        noteOptions: cfg.noteOptions || [],
        adminOpenids: cfg.adminOpenids || []
      });
      this.refreshPreview();
    } catch (e) {
      util.toast(e.message || '加载失败');
    } finally {
      util.hideLoading();
    }
  },

  inputChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  changeDepositType(e) {
    const idx = Number(e.detail.value);
    this.setData({
      depositTypeIndex: idx,
      'form.depositType': this.data.depositTypes[idx].value
    });
  },

  changeTime(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
    this.refreshPreview();
  },

  changeSlot(e) {
    const idx = Number(e.detail.value);
    this.setData({
      slotIndex: idx,
      'form.slotMinutes': this.data.slotOptions[idx]
    });
    this.refreshPreview();
  },

  /** 根据当前工作时间/时长设置生成预览 */
  refreshPreview() {
    const f = this.data.form;
    const toMin = (s) => { const p = String(s).split(':').map(Number); return p[0] * 60 + p[1]; };
    const fmt = (m) => util.pad(Math.floor(m / 60)) + ':' + util.pad(m % 60);
    const step = Number(f.slotMinutes) || 60;
    let s, e;
    try { s = toMin(f.workStart); e = toMin(f.workEnd); } catch (err) { return; }
    if (isNaN(s) || isNaN(e)) return;
    if (e <= s) { this.setData({ slotPreview: '时间设置有误：结束时间需晚于开始时间' }); return; }
    const count = Math.floor((e - s) / step);
    if (count <= 0) { this.setData({ slotPreview: '当前设置无法生成时段，请调整时长' }); return; }
    this.setData({
      slotPreview: '每天 ' + count + ' 个可选时段：' + f.workStart + ' - ' + fmt(s + count * step) + '，每段 ' + step + ' 分钟'
    });
  },

  /* ============ 医院候选 ============ */

  inputHospital(e) {
    this.setData({ newHospital: e.detail.value });
  },

  addHospital() {
    const v = this.data.newHospital.trim();
    if (!v) return util.toast('请输入医院名称');
    if (this.data.hospitals.indexOf(v) >= 0) return util.toast('该医院已存在');
    this.setData({ hospitals: this.data.hospitals.concat([v]), newHospital: '' });
  },

  removeHospital(e) {
    const name = e.currentTarget.dataset.name;
    this.setData({ hospitals: this.data.hospitals.filter(h => h !== name) });
  },

  /* ============ 备注快捷选项 ============ */

  inputNote(e) {
    this.setData({ newNote: e.detail.value });
  },

  addNote() {
    const v = this.data.newNote.trim();
    if (!v) return util.toast('请输入备注选项');
    if (this.data.noteOptions.indexOf(v) >= 0) return util.toast('该选项已存在');
    this.setData({ noteOptions: this.data.noteOptions.concat([v]), newNote: '' });
  },

  removeNote(e) {
    const name = e.currentTarget.dataset.name;
    this.setData({ noteOptions: this.data.noteOptions.filter(n => n !== name) });
  },

  async save() {
    const f = this.data.form;
    if (!f.serviceName.trim()) return util.toast('请填写服务名称');
    if (!f.escortName.trim()) return util.toast('请填写陪诊师名称');
    if (!f.servicePrice || Number(f.servicePrice) <= 0) return util.toast('请填写服务价格');
    if (f.phone && !/^1\d{10}$/.test(f.phone)) return util.toast('联系电话格式不正确');
    if (f.adminPassword && f.adminPassword.length < 4) return util.toast('密码至少 4 位');

    const body = {
      serviceName: f.serviceName,
      escortName: f.escortName,
      phone: f.phone,
      wechatId: f.wechatId,
      kfUrl: f.kfUrl,
      servicePrice: f.servicePrice,
      depositType: f.depositType,
      depositValue: f.depositValue,
      workStart: f.workStart,
      workEnd: f.workEnd,
      slotMinutes: f.slotMinutes,
      notice: f.notice,
      hospitals: this.data.hospitals,
      noteOptions: this.data.noteOptions
    };
    if (f.adminPassword) body.adminPassword = f.adminPassword;

    util.loading('保存中');
    try {
      await api.put('/api/admin/config', body, { admin: true });
      util.hideLoading();
      util.toast('已保存');
      this.setData({ 'form.adminPassword': '' });
    } catch (e) {
      util.hideLoading();
      util.toast(e.message || '保存失败');
    }
  },

  logout() {
    wx.removeStorageSync('admin_token');
    wx.redirectTo({ url: '/pages/admin/login/login' });
  }
});
