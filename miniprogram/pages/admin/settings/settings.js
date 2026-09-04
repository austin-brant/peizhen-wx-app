const api = require('../../../utils/api.js');
const util = require('../../../utils/util.js');
const login = require('../../../utils/login.js');

Page({
  data: {
    form: {
      serviceName: '',
      escortName: '',
      phone: '',
      wechatId: '',
      kfUrl: '',
      wxCorpId: '',
      about: '',
      escortAvatar: '',
      servicePrice: '',
      workStart: '09:00',
      workEnd: '18:00',
      slotMinutes: 60,
      notice: '',
      adminPassword: ''
    },
    // 陪诊师头像预览（绝对地址，相对 URL 转 baseUrl）
    escortAvatarPreview: '',
    slotOptions: [30, 45, 60, 90, 120],
    slotIndex: 2,
    slotPreview: '',
    // 医院候选
    hospitals: [],
    newHospital: '',
    // 多级折扣规则 [{hours, rate}]
    discounts: [],
    newDiscountHours: '',
    newDiscountRate: '',
    // 备注快捷选项
    noteOptions: [],
    newNote: '',
    // 管理员微信白名单（登录/一键登录/首页入口均以此为准）
    adminOpenids: [],
    // 白名单展示项（{ full, short }，因 WXML 不支持 .slice() 方法调用，缩略显示需在 JS 侧预处理）
    adminOpenidItems: [],
    newOpenid: '',
    // 当前微信
    myOpenid: '',
    myShort: '',
    myInList: false
  },

  onShow() {
    this.loadConfig();
  },

  /** openid 缩略显示：前 8 位 + 后 4 位 */
  short(id) {
    if (!id) return '';
    return id.length > 12 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
  },

  /** 生成白名单展示项（WXML 无法调用 .slice()，缩略在此预处理） */
  buildAdminItems(list) {
    return (list || []).map(o => ({ full: o, short: this.short(o) }));
  },

  go(e) {
    const url = e.currentTarget.dataset.url;
    if (url === '/pages/admin/home/home') {
      wx.switchTab({ url });
    } else {
      wx.redirectTo({ url });
    }
  },

  async loadConfig() {
    util.loading('加载中');
    try {
      const cfg = await api.get('/api/admin/config', { admin: true });
      const slotIndex = this.data.slotOptions.indexOf(cfg.slotMinutes) >= 0 ? this.data.slotOptions.indexOf(cfg.slotMinutes) : 2;
      let myOpenid = login.getOpenid();
      if (!myOpenid) { try { myOpenid = await login.ensureLogin(); } catch (e) { myOpenid = ''; } }
      const list = cfg.adminOpenids || [];
      this.setData({
        form: {
          serviceName: cfg.serviceName,
          escortName: cfg.escortName,
          phone: cfg.phone || '',
          wechatId: cfg.wechatId || '',
          kfUrl: cfg.kfUrl || '',
          wxCorpId: cfg.wxCorpId || '',
          about: cfg.about || '',
          escortAvatar: cfg.escortAvatar || '',
          servicePrice: cfg.servicePrice,
          workStart: cfg.workStart,
          workEnd: cfg.workEnd,
          slotMinutes: cfg.slotMinutes,
          notice: cfg.notice,
          adminPassword: ''
        },
        slotIndex,
        escortAvatarPreview: this.absUrl(cfg.escortAvatar),
        hospitals: cfg.hospitals || [],
        discounts: cfg.discounts || [],
        noteOptions: cfg.noteOptions || [],
        adminOpenids: list,
        adminOpenidItems: this.buildAdminItems(list),
        myOpenid,
        myShort: this.short(myOpenid),
        myInList: list.indexOf(myOpenid) >= 0
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

  /* ============ 多级折扣 ============ */

  inputDiscountHours(e) {
    this.setData({ newDiscountHours: e.detail.value });
  },

  inputDiscountRate(e) {
    this.setData({ newDiscountRate: e.detail.value });
  },

  /** 折扣文案：0.9 → 9折 */
  discountText(hours, rate) {
    const zhe = Math.round(Number(rate) * 10);
    return '满 ' + hours + ' 小时 ' + (zhe >= 10 ? '原价' : zhe + ' 折');
  },

  addDiscount() {
    const hours = Math.round(Number(this.data.newDiscountHours) * 10) / 10;
    const rate = Math.round(Number(this.data.newDiscountRate) * 1000) / 1000;
    if (!(hours > 0)) return util.toast('请输入正确的小时数（如 4）');
    if (!(rate > 0 && rate <= 1)) return util.toast('折扣需在 0.1 ~ 1 之间（如 0.9 = 9折）');
    const list = this.data.discounts;
    const idx = list.findIndex(d => Number(d.hours) === hours);
    if (idx >= 0) {
      // 同档位（满 X 小时）已存在：覆盖更新折扣率
      if (Number(list[idx].rate) === rate) return util.toast('该折扣已存在');
      list[idx] = { hours, rate };
      list.sort((a, b) => Number(a.hours) - Number(b.hours));
      this.setData({ discounts: list, newDiscountHours: '', newDiscountRate: '' });
      return util.toast('已更新：' + this.discountText(hours, rate));
    }
    list.push({ hours, rate });
    list.sort((a, b) => Number(a.hours) - Number(b.hours));
    this.setData({ discounts: list, newDiscountHours: '', newDiscountRate: '' });
    util.toast('已添加：' + this.discountText(hours, rate));
  },

  removeDiscount(e) {
    const key = e.currentTarget.dataset.key; // "hours:rate"
    const [h, r] = key.split(':').map(Number);
    this.setData({ discounts: this.data.discounts.filter(d => !(Number(d.hours) === h && Number(d.rate) === r)) });
  },

  /** 折扣列表展示文案（供 WXML 遍历） */
  discountLabel(item) {
    return this.discountText(item.hours, item.rate);
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

  /* ============ 陪诊师头像 ============ */

  /** 相对头像地址转绝对地址（/api/uploads/xx → baseUrl + 路径） */
  absUrl(u) {
    if (!u) return '';
    return /^https?:/.test(u) ? u : getApp().globalData.baseUrl + u;
  },

  /** 使用微信头像（chooseAvatar，选中后上传到服务器） */
  onChooseEscortAvatar(e) {
    const tempPath = e.detail.avatarUrl;
    if (!tempPath) return;
    this.setData({ escortAvatarPreview: tempPath });
    util.loading('上传头像中');
    this.uploadEscortAvatar(tempPath, 0);
  },

  /** 从相册上传图片作为陪诊师头像 */
  chooseEscortImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f || !f.tempFilePath) return;
        this.setData({ escortAvatarPreview: f.tempFilePath });
        util.loading('上传头像中');
        this.uploadEscortAvatar(f.tempFilePath, 0);
      },
      fail: () => {}
    });
  },

  /** 上传陪诊师头像：base64 → 超 500KB 或缺合法后缀自动压缩重试（最多 2 次） */
  uploadEscortAvatar(filePath, attempt) {
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
        if (needCompress && attempt < 2) {
          wx.compressImage({
            src: filePath,
            quality: attempt === 0 ? 60 : 30,
            success: (cr) => this.uploadEscortAvatar(cr.tempFilePath, attempt + 1),
            fail: () => { util.hideLoading(); util.toast('头像压缩失败，请换一张图片'); }
          });
          return;
        }
        api.post('/api/admin/upload', {
          filename: filename || 'avatar.jpg',
          base64
        }, { admin: true }).then((res) => {
          util.hideLoading();
          this.setData({
            'form.escortAvatar': res.url,
            escortAvatarPreview: this.absUrl(res.url)
          });
          util.toast('头像已设置，点「保存设置」生效');
        }).catch((err) => {
          util.hideLoading();
          util.toast(err.message || '头像上传失败');
        });
      },
      fail: () => {
        util.hideLoading();
        util.toast('读取头像失败');
      }
    });
  },

  /** 清除头像 */
  clearEscortAvatar() {
    this.setData({ 'form.escortAvatar': '', escortAvatarPreview: '' });
  },

  /* ============ 陪诊师介绍：插入图片 ============ */

  /** 从相册选一张图片，上传后以 Markdown 图片语法插入介绍末尾 */
  insertImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f || !f.tempFilePath) return;
        this.tryUploadImage(f.tempFilePath, 0);
      },
      fail: () => {}
    });
  },

  /**
   * 读取图片并上传；超过 500KB 时自动压缩重试（最多 2 次），仍超限则提示换图
   * @param filePath 本地临时文件路径
   * @param attempt 压缩重试次数（0 = 未压缩原图）
   */
  tryUploadImage(filePath, attempt) {
    const MAX = 500 * 1024;
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (r) => {
        const base64 = r.data || '';
        // base64 解码后大小 ≈ len * 3/4（允许少量误差）
        const size = Math.floor(base64.length * 3 / 4);
        if (size > MAX + 2048) {
          if (attempt < 2) {
            wx.compressImage({
              src: filePath,
              quality: attempt === 0 ? 60 : 30,
              success: (cr) => this.tryUploadImage(cr.tempFilePath, attempt + 1),
              fail: () => util.toast('图片超过 500KB 且压缩失败，请换一张')
            });
          } else {
            util.toast('压缩后仍超过 500KB，请换一张更小的图片');
          }
          return;
        }
        util.loading('上传图片中');
        api.post('/api/admin/upload', {
          filename: filePath.split('/').pop() || 'image.png',
          base64
        }, { admin: true }).then((res) => {
          util.hideLoading();
          const mdImg = '\n![图片](' + res.url + ')\n';
          this.setData({ 'form.about': (this.data.form.about || '') + mdImg });
          util.toast('图片已插入，保存设置后生效');
        }).catch((e) => {
          util.hideLoading();
          util.toast(e.message || '上传失败');
        });
      },
      fail: () => util.toast('读取图片失败')
    });
  },

  /* ============ 管理员微信白名单 ============ */

  /** 把当前微信加入白名单（保存设置后生效） */
  addMeToWhitelist() {
    const { myOpenid, adminOpenids } = this.data;
    if (!myOpenid) return util.toast('暂未获取到当前微信，请重试');
    if (adminOpenids.indexOf(myOpenid) >= 0) return util.toast('当前微信已在白名单中');
    const next = adminOpenids.concat([myOpenid]);
    this.setData({ adminOpenids: next, adminOpenidItems: this.buildAdminItems(next), myInList: true });
    util.toast('已加入白名单，点下方「保存设置」生效');
  },

  /** 手动输入 openid 添加管理员（对方从登录页复制 openid 发来） */
  inputNewOpenid(e) {
    this.setData({ newOpenid: e.detail.value });
  },

  addOpenidByInput() {
    const v = this.data.newOpenid.trim();
    if (!v) return util.toast('请输入 openid');
    if (this.data.adminOpenids.indexOf(v) >= 0) return util.toast('该 openid 已在白名单中');
    const next = this.data.adminOpenids.concat([v]);
    this.setData({
      adminOpenids: next,
      adminOpenidItems: this.buildAdminItems(next),
      newOpenid: '',
      myInList: this.data.myInList || v === this.data.myOpenid
    });
    util.toast('已加入白名单，点下方「保存设置」生效');
  },

  removeOpenid(e) {
    const openid = e.currentTarget.dataset.openid;
    const next = this.data.adminOpenids.filter(o => o !== openid);
    this.setData({
      adminOpenids: next,
      adminOpenidItems: this.buildAdminItems(next),
      myInList: this.data.myInList && this.data.myOpenid !== openid
    });
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
      wxCorpId: f.wxCorpId,
      about: f.about,
      escortAvatar: f.escortAvatar,
      servicePrice: f.servicePrice,
      workStart: f.workStart,
      workEnd: f.workEnd,
      slotMinutes: f.slotMinutes,
      notice: f.notice,
      hospitals: this.data.hospitals,
      discounts: this.data.discounts,
      noteOptions: this.data.noteOptions,
      adminOpenids: this.data.adminOpenids
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
