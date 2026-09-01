// utils/pay.js - 支付封装
/**
 * 支付说明：
 * 1. 当前为【模拟支付】：弹窗确认即视为支付成功，方便本地联调演示完整流程。
 * 2. 真实上线接入微信支付（JSAPI）步骤：
 *    a. 小程序需绑定已认证的账号，并在微信商户平台开通"微信支付"
 *    b. 后端新增统一下单接口：调用微信支付 API 获取 wx.requestPayment 所需的
 *       timeStamp / nonceStr / package / signType / paySign 参数
 *    c. 将下方 pay() 中的 wx.showModal 替换为 wx.requestPayment({...payParams})，
 *       支付成功后微信服务器会回调商户后台，在回调中调用服务端"确认支付"逻辑
 *    d. 后端对应逻辑已就绪：POST /api/orders/:id/pay-deposit 与 pay-tail，
 *       只需把"确认支付"动作从模拟弹窗触发改为微信支付回调触发
 */

function pay(options) {
  const { amount, desc } = options;
  return new Promise((resolve) => {
    wx.showModal({
      title: '模拟支付',
      content: '确认支付 ¥' + amount + '（' + desc + '）\n\n当前为演示环境，点击确认即模拟支付成功。真实上线后将拉起微信支付。',
      confirmText: '确认支付',
      cancelText: '暂不支付',
      confirmColor: '#00b8a9',
      success(res) { resolve(res.confirm); },
      fail() { resolve(false); }
    });
  });
}

module.exports = { pay };
