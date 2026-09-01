# 陪诊预约小程序 · 上线部署清单

> 按顺序执行，每完成一项打勾。全文分为 7 个阶段：准备 → 后端部署 → HTTPS 与域名 → 微信登录 → 小程序发布 → 上线初始化 → 日常运维。
>
> 预计整体耗时：服务器部署半天 + 微信平台配置半天 + 审核等待 1~7 天（可与部署并行）。

---

## 阶段一：准备工作

### 1.1 账号与资质

- [ ] 注册微信小程序账号（[mp.weixin.qq.com](https://mp.weixin.qq.com/)），主体建议为**个体工商户/企业**（个人主体无法开通微信支付）
- [ ] 完成**小程序认证**（300元/年，未认证无法使用支付与部分接口）
- [ ] 记录 **AppID**（开发 → 开发管理 → 开发设置）
- [ ] 重置并记录 **AppSecret**（同一页面，只显示一次，妥善保管）
- [ ] （需收款）申请**微信支付商户号**，并与该小程序关联绑定

### 1.2 服务器与域名

- [ ] 购买云服务器（1核2G 起步即可，如腾讯云/阿里云轻量服务器）
- [ ] 购买域名并完成 **ICP 备案**（国内服务器必须；审核约 1~2 周，建议最先启动）
- [ ] 域名解析一条 A 记录指向服务器公网 IP（如 `api.yourdomain.com`）
- [ ] 准备 SSL 证书（可用云厂商免费证书，每年续期；或 Let's Encrypt 自动续期）

### 1.3 本地代码检查

- [ ] `node --check server/server.js` 语法通过
- [ ] 微信开发者工具中编译 0 报错 0 警告（API 版本基础库 ≥ 2.10.1）

---

## 阶段二：后端部署

### 2.1 安装环境

- [ ] 服务器安装 **Node.js ≥ 16**（推荐 20 LTS，`node -v` 验证）
- [ ] 不需要安装任何 npm 依赖（纯 Node 零依赖）

### 2.2 上传代码

- [ ] 上传 `server/` 目录（仅 `server.js`、`db.js`、`seed-demo.js` 三个文件即可）
  ```bash
  scp server/server.js server/db.js root@你的服务器IP:/opt/peizhen/
  ```
- [ ] **不要**上传本地 `server/data/`（演示数据与本地管理员绑定）
- [ ] 确认数据目录可写：后端会自动在 `server/data/` 下创建 JSON 文件

### 2.3 配置环境变量

- [ ] 生产环境只监听本机回环（Nginx 反代），编辑 `server.js` 最后一行改为：
  ```js
  server.listen(PORT, '127.0.0.1', () => {
  ```
- [ ] 配置微信登录凭据（二选一，环境变量优先级更高时为：
  `cfg.wxaAppid || process.env.WX_APPID`，即**页面配置优先**）：
  ```bash
  # 方式一：环境变量（推荐，避免 Secret 落盘到 data/config.json）
  export WX_APPID="你的AppID"
  export WX_SECRET="你的AppSecret"
  # 方式二：启动后在管理端「设置」页填写并保存
  ```
- [ ] 如需修改端口：`export PORT=8300`

### 2.4 进程守护（PM2）

- [ ] 安装 PM2：`npm install -g pm2`
- [ ] 启动：`pm2 start server.js --name peizhen`
- [ ] 设置开机自启：`pm2 startup && pm2 save`
- [ ] 验证：`curl http://127.0.0.1:8300/api/config` 返回 JSON 即成功

---

## 阶段三：HTTPS 与域名（Nginx）

- [ ] 安装 Nginx
- [ ] 配置 SSL 证书 + 反向代理（参考）：
  ```nginx
  server {
      listen 443 ssl;
      server_name api.yourdomain.com;

      ssl_certificate     /etc/nginx/ssl/api.yourdomain.com.pem;
      ssl_certificate_key /etc/nginx/ssl/api.yourdomain.com.key;

      location / {
          proxy_pass http://127.0.0.1:8300;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          client_max_body_size 10m;
      }
  }
  ```
- [ ] HTTP 自动跳转 HTTPS（301）
- [ ] 云厂商**安全组**只放行 80/443，**封掉 8300 外网直连**
- [ ] 验证：`curl https://api.yourdomain.com/api/config` 返回 JSON

---

## 阶段四：微信登录配置

- [ ] （若用环境变量方式）已配置 `WX_APPID` / `WX_SECRET` 并重启后端
- [ ] （若用页面方式）小程序登录一次管理端后，在「设置」页填入 AppID/AppSecret 保存
- [ ] 验证模拟模式已关闭：`server/data/config.json` 中能看到 wxaAppid，且前端 wx.login 后拿到的 openid 不是 `dev_` 开头

> 说明：登录模式判定逻辑为 `cfg.wxaAppid || WX_APPID` 与 `cfg.wxaSecret || WX_SECRET` **均非空**才走真实 `jscode2session`；页面配置优先于环境变量。填写前为模拟模式（openid 以 `dev_` 派生，仅本地联调用）。

---

## 阶段五：小程序发布

### 5.1 代码配置

- [ ] `miniprogram/app.js` 中 `baseUrl` 改为 `https://api.yourdomain.com`
- [ ] 全局搜索确认没有残留 `127.0.0.1` 引用
- [ ] **微信支付**：当前为模拟支付（弹窗确认）。正式收款必须完成：
  - [ ] 后端新增统一下单接口（JSAPI v2/v3，用 openid + 商户号调 `pay/unifiedorder`）
  - [ ] 回调地址配置为 `https://api.yourdomain.com/api/orders/notify`（需自实现签名验签后调用现有 `payDeposit`/`payTail` 逻辑）
  - [ ] `miniprogram/utils/pay.js` 的 `wx.showModal` 替换为 `wx.requestPayment`（README「支付说明」有完整代码）
  - [ ] 支付回调验签通过后再落账，防伪造通知
- [ ] （可选）首页「微信联系」按钮：管理端设置页填 `kfUrl`（企业微信客服链接），或仅填微信号复制加好友

### 5.2 平台配置

- [ ] 小程序后台「开发设置 → 服务器域名 → request 合法域名」添加 `https://api.yourdomain.com`
- [ ] （用了支付）「微信支付」关联商户号生效
- [ ] AppSecret、商户 API 密钥**不要**写进任何前端代码

### 5.3 测试与提审

- [ ] 开发者工具用真实 AppID 编译，真机预览走 https 全流程：登录 → 选时段 → 下单 → （模拟）支付 → 我的订单
- [ ] 上传体验版，用另一台手机完整走一遍
- [ ] 管理端在真机验证：密码登录 → 绑定微信 → 一键登录 → 首页出现管理入口
- [ ] 提交审核（类目建议：**生活服务 → 家政/陪护服务**；审核备注写明"陪诊预约服务"）

### 5.4 发布

- [ ] 审核通过后点击「发布」
- [ ] 发布后线上版本再走一遍冒烟测试（重点：登录、下单、支付回调）

---

## 阶段六：上线初始化（正式数据）

按顺序在小程序里完成：

- [ ] 首页连点服务名称 5 次 → 管理登录 → **立即修改默认密码 `123456`**（设置页最下方「新管理密码」）
- [ ] 用你的微信完成密码登录绑定（此后一键登录 + 首页管理入口）
- [ ] 设置页填写：服务名称、陪诊师名、价格、定金方式与金额、联系电话、微信号、公告、预约须知
- [ ] 设置页录入**就诊医院候选**和**备注快捷选项**
- [ ] 设置页配置工作时间段与每段时长，确认时段预览正确
- [ ] 时间管理页把已知休假日期设为不可约
- [ ] 下一个测试单验证：下单 → 付定金 → 标记完成 → 付尾款 → 统计页数字正确

---

## 阶段七：日常运维

### 备份（重要）

- [ ] **每天备份 `server/data/`**（全部业务数据都在这几个 JSON 里），建议 crontab：
  ```bash
  0 3 * * * tar -czf /backup/peizhen-$(date +\%F).tar.gz /opt/peizhen/data/
  ```
- [ ] 备份文件同步到异地（对象存储/另一台服务器）
- [ ] 每月做一次恢复演练（换目录解压启动验证）

### 监控与日志

- [ ] PM2 日志轮转：`pm2 install pm2-logrotate`
- [ ] 监控进程存活（PM2 已自带崩溃重启）与 443 端口可用性（可用云厂商拨测）
- [ ] SSL 证书到期提醒（免费证书 90 天有效，配置自动续期）

### 安全检查

- [ ] 管理密码非默认值
- [ ] 8300 端口不对公网开放（`curl http://服务器IP:8300` 应超时/拒绝）
- [ ] AppSecret / 商户密钥只存在于服务器环境变量，未进 git 仓库
- [ ] 定期核对统计页金额与微信商户平台实际流水

### 数据增长后

- [ ] 订单超过数千单后，把 `server/db.js`（JSON 存储）迁移到 SQLite/MySQL/云数据库，API 层无需改动
- [ ] 考虑加微信订阅消息：管理端标记完成时通知客户付尾款

---

## 快速回滚预案

| 场景 | 处置 |
|------|------|
| 新版本小程序有 bug | 小程序后台「版本管理 → 回退版本」（发布 60 分钟内可回退） |
| 后端新代码有问题 | `pm2 stop peizhen` → 还原 `server.js` 旧文件 → `pm2 start peizhen` |
| 数据损坏 | 停 PM2 → 删除 `server/data/` → 解压最近备份 → 重启 → 核对统计数字 |
| 服务器故障 | 新机装 Node + PM2 → 拉起最新代码与数据备份 → 改域名解析指向新 IP |

---

## 上线检查总表（一页速查）

- [ ] 域名备案 + HTTPS 生效
- [ ] 后端 PM2 常驻 + 开机自启
- [ ] 8300 不暴露公网
- [ ] 微信登录真实模式生效（openid 非 dev_ 开头）
- [ ] baseUrl 已改 https 域名
- [ ] request 合法域名已配置
- [ ] （收款）微信支付已接入并验证回调
- [ ] 默认管理密码已修改
- [ ] 管理员微信已绑定
- [ ] 医院/备注/价格/公告等正式配置已录入
- [ ] 每日备份 crontab 已生效
- [ ] 体验版全流程真机验证通过
- [ ] 审核通过并正式发布
