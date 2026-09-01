// app.js
const login = require('./utils/login.js');

// 自动区分运行环境：
// - 开发者工具：直接访问本机 127.0.0.1（需勾选"详情-本地设置-不校验合法域名"）
// - 真机调试/预览：访问电脑的局域网 IP（手机须与电脑同一 Wi-Fi）
// - 正式上线：手动改为 https 域名，如 https://api.your-domain.com
const LAN_BASE_URL = 'http://10.76.119.26:8300'; // 换网络后需更新为电脑新 IP（查看：ipconfig getifaddr en0）

let baseUrl = 'http://127.0.0.1:8300';
try {
  if (wx.getSystemInfoSync().platform !== 'devtools') baseUrl = LAN_BASE_URL;
} catch (e) { /* 保持默认 */ }

App({
  globalData: {
    baseUrl
  },

  onLaunch() {
    // 开启分享，方便把预约页分享给朋友/家人
    wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage'] });
    // 静默微信登录（失败不打扰，需要时页面会再次调用）
    login.ensureLogin().catch(() => {});
  }
});
