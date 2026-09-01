# AGENT-CONTEXT.md — 项目交接上下文

> **给未来 Agent 的说明**：本文件是本项目的完整上下文快照，记录了从立项到 2026-08-31 的全部交互内容与决策结论。无论在哪个环境打开本目录，请先通读本文件，再按需查阅 README.md（功能/接口文档）和 DEPLOYMENT.md（上线部署清单）。每次大的迭代后请更新本文件。

---

## 1. 项目一句话

**陪诊预约微信小程序**：用户按时间段预约陪诊师（支持多连续时段合并计费），定金/尾款两段支付，管理端可编辑全部文案/价格/时段/医院候选/备注选项，并按日/周/月/年统计订单。

- **用户角色**：陪诊师本人（既是产品所有者也是唯一管理员），服务的患者群体通过分享使用小程序。
- **当前阶段**：功能开发全部完成，本地联调通过，**尚未上线**（未购服务器/域名/未提审）。

## 2. 当前状态快照（2026-08-31 20:45）

| 事项 | 状态 |
|------|------|
| 后端服务 | ✅ 本地运行中 `http://127.0.0.1:8300`（后台任务启动；**换环境后需重启**，见 §6） |
| 数据 | `server/data/` 含演示数据（seed-demo.js 生成 + 手工测试订单） |
| 小程序 | ✅ 微信开发者工具可直接导入本目录联调（需勾选「不校验合法域名」） |
| 功能迭代 | ✅ 初版 + 4 项 + 10 项需求全部完成并 curl 验证（见 §5） |
| 真机调试 | ✅ 已配置（app.js 按平台自动切 baseUrl，见 §7） |
| 上线部署 | ⏳ 未开始。方案与成本已敲定（见 §8），清单在 DEPLOYMENT.md |
| 支付 | ⚠️ 目前为模拟弹窗，微信支付正式接入尚未开发（后端统一下单接口待写） |
| 微信登录 | ⚠️ 目前为模拟模式（按 code 派生 dev_openid），上线需填 appid/secret |

## 3. 目录结构与关键文件

```
wx-app/
├── AGENT-CONTEXT.md          # 本文件（交接上下文）
├── README.md                 # 功能说明、接口文档、微信登录/支付接入方式
├── DEPLOYMENT.md             # 上线部署清单（7 阶段 checklist + 回滚预案 + 速查表）
├── project.config.json       # 微信开发者工具项目配置
├── miniprogram/              # 小程序前端（原生框架，teal 简洁风格）
│   ├── app.js                # baseUrl 自动切换：devtools→127.0.0.1，真机→LAN_BASE_URL
│   ├── utils/
│   │   ├── api.js            # 请求封装，自动附加 x-openid 头
│   │   ├── login.js          # ensureLogin()：wx.login→/api/login→缓存 openid
│   │   ├── pay.js            # 支付（当前为模拟弹窗）
│   │   └── util.js
│   └── pages/
│       ├── index/            # 首页：日期条、时段格子（多选）、月历弹窗、微信联系/电话按钮
│       ├── book/             # 填单页：医院下拉候选+手写、备注快捷 chips、多段合计
│       ├── result/           # 提交结果页
│       ├── orders/           # 「我的」：微信授权后按 openid 查本人订单
│       ├── order-detail/     # 订单详情：含服务时长（X 小时（N个时段））、定金/尾款支付
│       └── admin/            # 管理端：login(密码/微信一键)、orders、time(时段开关)、stats、settings
├── server/
│   ├── server.js             # 纯 Node 零依赖后端（手写路由，JSON 文件存储）
│   ├── db.js                 # DB 类：读写 server/data/*.json
│   ├── seed-demo.js          # 演示数据生成脚本
│   └── data/                 # config.json / orders.json / users.json（不打包交付）
├── scripts/gen-icons.js      # tabBar 扁平图标生成（纯 Node 手写 PNG 编码，改样式需重跑）
└── outputs/peizhen-yuyue.zip # 交付包（不含 server/data）
```

## 4. 核心架构约定（改动前必读）

- **用户身份**：微信 openid。`POST /api/login` 用 code 换 openid（真实模式调 jscode2session；模拟模式 `'dev_'+sha1('peizhen:'+code).slice(0,16)`，**不同 code = 不同用户**）。所有请求带 `x-openid` 头。
- **管理员双通道**：`x-admin-token` 头（密码登录 token，24h 有效）**或** `x-openid` ∈ `config.adminOpenids`。
- **管理员绑定机制**：密码登录时若请求带 openid，自动将该微信加入 adminOpenids → 之后该微信可「一键登录」且首页显示管理入口。默认密码 `123456`。
- **管理入口（隐藏式）**：首页连点服务名称 5 次进入管理登录页；仅已绑定管理员的微信可见首页管理入口。
- **多段预约**：订单存 `[start, end)` 区间 + `slotCount`；时长 = (end-start)/60 小时；`validateRange` 逐段校验 blocked/已约冲突/步长对齐；计价 = 单价 × 时长。
- **全部可配置项**（走 `GET /api/config` 公开读、`PUT /api/admin/config` 管理写）：服务名、陪诊师名、价格、定金、公告、须知、时段定义、屏蔽时段、医院候选列表、备注快捷选项、微信号、客服链接 kfUrl、adminOpenids、wxaAppid/wxaSecret。
- **支付**：订单状态机 `pending_deposit → deposit_paid(pending_final) → completed / cancelled`；当前前端是模拟支付弹窗，正式接入方案见 README。

## 5. 历史迭代记录（全部已交付）

**初版**：预约/订单/支付/统计/管理端全链路 + tabBar 图标 + 演示数据。

**二轮（4 项）**：
1. 月历弹窗（整月可约状态、点击快速切换日期，`/api/calendar`）
2. 管理入口仅管理员可见（隐藏入口 = 连点标题 5 次）
3. 价格/定金/时段后台可设
4. 设置页时段实时预览

**三轮（10 项）**：
1. 首页顶部内容（服务名/陪诊师名/价格/定金/公告/须知）全部后台可编辑
2. 管理端逐时段开关不可约状态
3. 微信账号体系打通（模拟/真实双模式）
4. 个人页按 openid 直接查本人订单（免输手机号）
5. 管理员微信绑定后首页才显示管理入口
6. 首页微信联系按钮（配置 kfUrl 拉起企业微信客服，否则复制微信号）
7. tabBar「预约」「我的」图标重绘为扁平风格（gen-icons.js）
8. 多连续时段合并计费（slotCount/validateRange）
9. 医院候选后台录入 + 用户下拉选择/手写其他
10. 备注快捷选项 chips 点选填入

**收尾修复**：settings.wxml placeholder 属性内双引号嵌套导致编译报错 → 改单引号；全量 wxml 扫描无同类问题。

## 6. 本地运行方式

```bash
# 启动后端（必须用后台任务方式启动；nohup 会随会话被回收）
cd server && node server.js    # 监听 *:8300，PORT 环境变量可改

# 验证（必须 --noproxy，见 §9 坑1）
curl --noproxy '*' http://127.0.0.1:8300/api/config

# 生成演示数据（可选，会覆盖 orders）
cd server && node seed-demo.js

# 重新生成 tabBar 图标
node scripts/gen-icons.js

# 打包交付
zip -r outputs/peizhen-yuyue.zip miniprogram server scripts README.md DEPLOYMENT.md project.config.json -x "server/data/*" "*.DS_Store"
```

微信开发者工具：导入项目根目录，详情→本地设置→勾选**不校验合法域名**。

## 7. 真机调试（已配置好）

- `app.js` 按 `wx.getSystemInfoSync().platform` 自动切换：devtools → `http://127.0.0.1:8300`；真机 → `LAN_BASE_URL`（当前写死 `http://10.76.119.26:8300`，即开发机局域网 IP）。
- **换电脑/换 Wi-Fi 后**：`ipconfig getifaddr en0` 取新 IP，更新 `app.js` 的 `LAN_BASE_URL`。
- 手机须与电脑同 Wi-Fi，且用「真机调试」或预览后打开调试模式（跳过域名校验）。公司网络 AP 隔离时用手机热点兜底。

## 8. 上线方案与成本结论（已与用户讨论敲定）

**最小成本路线（首年约 ¥101）**：
- 服务器：腾讯云轻量 2核2G/3M/40G 产品首单 **68元/年**；若抢到秒杀 4核4G **38元/年** 更划算（个人专享+限量，每日 10:00/15:00 场次）。购买入口：
  - 轻量特惠专场（常驻）：https://cloud.tencent.com/act/pro/lighthouse2021
  - 限时秒杀大促页：https://cloud.tencent.com/act/pro/double11-2025
  - 免费试用（0 元 1 个月）：https://cloud.tencent.com/free
  - 直接购买页：https://buy.cloud.tencent.com/lighthouse
- 域名：`.cn`（33 元首年/38 元续费）即可，无需 `.com`
- SSL：腾讯云免费 DV 证书或 Let's Encrypt，¥0
- 备案：与服务器厂商绑定（免费代办）；时长 ≥3 个月才有备案服务码
- **腾讯域名 × 阿里云服务器可以搭配**（备案跟服务器走、在阿里云提交，域名注册商无关；需域名实名主体与备案主体一致）
- 省不掉的大头：在线收款需企业/个体户主体 + 微信认证 ¥300/年 + 微信支付商户号；前期可线下转账，个人主体免费发布
- 不推荐微信云托管（容器文件系统重启即清空，JSON 存储需换 MySQL，约 246 元/月，反而贵）

**部署步骤**：见 DEPLOYMENT.md（含 PM2、Nginx 反代模板、生产建议监听 127.0.0.1、备份 crontab、回滚预案）。

## 9. 已知坑（踩过的，勿重复）

1. **macOS http_proxy 代理**：curl 访问 127.0.0.1 会走代理返回 502 → 一律 `curl --noproxy '*'`。
2. **后台进程**：nohup 启动的 server 随会话结束被回收 → 必须用 Bash 后台任务方式启动；换会话后先 curl 检查、停了就重启。
3. **模拟登录演示**：模拟模式按 code 派生 openid 才能演示「未绑定拒绝→密码绑定→一键登录」完整链路；固定 openid 演示不了。
4. **WXML 属性引号**：属性值内嵌套双引号会导致编译报错，用单引号替代。
5. **演示数据的 blocked 时段**：测试创建订单遇到「包含不可约时段」属预期（演示数据屏蔽了部分时段），换个日期即可。

## 10. 用户偏好与沟通约定

- 用户为陪诊师（非技术背景），沟通用**简体中文**，讲结论和操作步骤，少讲原理。
- 每次反馈以编号清单提需求（已习惯这种往返方式），完成后逐项对账。
- 关心成本，倾向最小可行方案；上线意愿明确但节奏从容（先真机体验，暂未购服务器）。

## 11. 下一步待办（按优先级）

1. 微信支付正式接入（后端统一下单 + 回调验签 + 前端 wx.requestPayment，方案已写在 README）— 需先注册个体户/企业 + 微信认证
2. 购买服务器 + 域名 → 按 DEPLOYMENT.md 部署 → 备案（1~2 周，域名可最先买）
3. 上线初始化：立即改默认密码 123456 → 绑定管理员微信 → 录入正式配置
4. 可选优化：管理端订单导出、用户取消订单时限、消息通知（订阅消息）

---
*最后更新：2026-08-31 20:45*
