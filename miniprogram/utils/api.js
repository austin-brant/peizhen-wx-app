// utils/api.js - 请求封装（自动携带管理员 token 与微信 openid）
const app = () => getApp();

function request(method, url, data, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const header = { 'content-type': 'application/json' };
    // 管理端身份：优先 token，其次管理员 openid
    if (opts.admin) {
      const token = wx.getStorageSync('admin_token');
      if (token) header['x-admin-token'] = token;
    }
    // 微信身份：所有请求都带上（后端用于识别用户/管理员）
    const openid = wx.getStorageSync('openid');
    if (openid) header['x-openid'] = openid;
    wx.request({
      url: app().globalData.baseUrl + url,
      method,
      data: data || {},
      header,
      success(res) {
        const body = res.data || {};
        if (body.code === 0) {
          resolve(body.data);
        } else if (res.statusCode === 401 || body.code === 401) {
          wx.removeStorageSync('admin_token');
          if (opts.admin) {
            wx.showToast({ title: '登录已过期', icon: 'none' });
            setTimeout(() => {
              wx.reLaunch({ url: '/pages/admin/login/login' });
            }, 600);
          }
          reject(new Error(body.msg || '未授权'));
        } else {
          reject(new Error(body.msg || '请求失败'));
        }
      },
      fail() {
        reject(new Error('无法连接服务，请确认后端已启动'));
      }
    });
  });
}

const get = (url, opts) => request('GET', url, null, opts);
const post = (url, data, opts) => request('POST', url, data, opts);
const put = (url, data, opts) => request('PUT', url, data, opts);
const del = (url, opts) => request('DELETE', url, null, opts);

module.exports = { get, post, put, del, request };
