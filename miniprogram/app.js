// app.js
const login = require('./utils/login.js');

// 自动区分运行环境：
// - 开发者工具（本地开发调试）：访问本机 127.0.0.1（需勾选"详情-本地设置-不校验合法域名"）
// - 真机预览/体验版/正式版：访问服务端（生产服务器，Nginx 80 → 后端 8300 反代）
const PROD_BASE_URL = 'http://120.53.4.14'; // 生产服务端地址（腾讯云，尚未配置域名/HTTPS）
const LOCAL_BASE_URL = 'http://127.0.0.1:8300'; // 本地后端

let baseUrl = PROD_BASE_URL; // 默认连服务端
try {
  // 仅开发者工具默认连本地后端，方便本地改代码调试；其余环境一律连服务端
  if (wx.getSystemInfoSync().platform === 'devtools') baseUrl = LOCAL_BASE_URL;
} catch (e) { /* 保持默认连服务端 */ }

App({
  globalData: {
    baseUrl
  },

  onLaunch() {
    // 开启分享，方便把预约页分享给朋友/家人
    wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage'] });
    // 进入小程序必须微信登录：失败时弹窗引导重试（用户拒绝则继续浏览，下单等关键操作会再次强制）
    login.ensureLoginWithRetry().catch(() => {});
  }
});
