// utils/login.js - 微信登录模块
// 职责：wx.login 获取 code → 后端换 openid → 缓存（openid / user_info）
// 所有页面通过 ensureLogin() 获取当前用户 openid
const api = require('./api.js');

/** 获取当前缓存的 openid（未登录返回空串） */
function getOpenid() {
  return wx.getStorageSync('openid') || '';
}

/** 是否已登录 */
function isLoggedIn() {
  return !!getOpenid();
}

/** 获取当前用户资料（可能为空对象） */
function getUserInfo() {
  return wx.getStorageSync('user_info') || {};
}

let pending = null;

/**
 * 确保已登录（微信静默登录，无弹窗）
 * @param {boolean} force 强制重新登录（默认 false：已有 openid 直接返回）
 * @returns {Promise<string>} openid
 */
function ensureLogin(force) {
  if (!force) {
    const cached = getOpenid();
    if (cached) return Promise.resolve(cached);
  }
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (!res.code) return reject(new Error('微信登录失败，请重试'));
        api.post('/api/login', { code: res.code })
          .then(data => {
            wx.setStorageSync('openid', data.openid);
            if (data.user) wx.setStorageSync('user_info', data.user);
            pending = null;
            resolve(data.openid);
          })
          .catch(err => { pending = null; reject(err); });
      },
      fail() {
        pending = null;
        reject(new Error('微信登录失败，请重试'));
      }
    });
  });
  return pending;
}

/** 登录并返回 isAdmin（供管理端/首页判断使用） */
async function ensureLoginWithAdmin() {
  const openid = await ensureLogin();
  let isAdmin = false;
  try {
    const res = await api.get('/api/admin/me?openid=' + openid);
    isAdmin = !!(res && res.isAdmin);
  } catch (e) { isAdmin = false; }
  return { openid, isAdmin };
}

let retryPending = null;

/**
 * 强制微信登录：登录失败时弹窗引导用户重试，直到成功或用户明确拒绝。
 * 用于「进入小程序必须授权微信登录」「下单前必须已登录」等场景。
 * @returns {Promise<string>} openid
 */
function ensureLoginWithRetry() {
  const cached = getOpenid();
  if (cached) return Promise.resolve(cached);
  if (retryPending) return retryPending;
  retryPending = ensureLogin()
    .catch(() => new Promise((resolve, reject) => {
      wx.showModal({
        title: '需要微信登录',
        content: '授权微信登录后才能使用预约服务，请点击「重新登录」继续',
        confirmText: '重新登录',
        cancelText: '暂不登录',
        confirmColor: '#00b8a9',
        success(res) {
          if (res.confirm) {
            retryPending = null; // 先释放，避免递归复用自身造成死锁
            resolve(ensureLoginWithRetry());
          } else {
            reject(new Error('未完成微信登录'));
          }
        },
        fail() {
          reject(new Error('未完成微信登录'));
        }
      });
    }))
    .finally(() => { retryPending = null; });
  return retryPending;
}

/** 退出登录（清除本地身份） */
function logout() {
  wx.removeStorageSync('openid');
  wx.removeStorageSync('user_info');
  wx.removeStorageSync('admin_token');
}

module.exports = { getOpenid, isLoggedIn, getUserInfo, ensureLogin, ensureLoginWithRetry, ensureLoginWithAdmin, logout };
