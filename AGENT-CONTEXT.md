# AGENT-CONTEXT.md — 项目交接上下文

> **给未来 Agent 的说明**：本文件是本项目的完整上下文快照，记录了从立项到 2026-09-01 的全部交互内容与决策结论。无论在哪个环境打开本目录，请先通读本文件，再按需查阅 README.md（功能/接口文档）和 DEPLOYMENT.md（上线部署清单）。每次大的迭代后请更新本文件。

---

## 1. 项目一句话

**陪诊预约微信小程序**：用户按时间段预约陪诊师（支持多连续时段合并计费，总价 = 每小时单价 × 时长 × 折扣），**只预约不付费**（支付功能已下掉），管理端可编辑全部文案/价格/折扣/时段/医院/科室候选/备注选项/微信号，并按日/周/月/年统计订单。

- **用户角色**：陪诊师本人（既是产品所有者也是唯一管理员），服务的患者群体通过分享使用小程序。
- **当前阶段**：功能开发全部完成，本地联调通过，**已上线公网**（未接域名/HTTPS/真实微信登录/微信支付）。

## 2. 当前状态快照（2026-09-04 12:00）

| 事项 | 状态 |
|------|------|
| 后端服务 | ✅ 本地运行中 `http://127.0.0.1:8300`（后台任务启动；**换环境后需重启**，见 §6） |
| **生产环境** | ✅ **已上线公网**：`http://120.53.4.14`（腾讯云轻量 Ubuntu 24.04，Nginx 80→127.0.0.1:8300，PM2 管理，见 §8.5） |
| 数据 | `server/data/` 含演示数据（seed-demo.js 生成 + 手工测试订单） |
| 小程序 | ✅ 微信开发者工具可直接导入本目录联调（需勾选「不校验合法域名」） |
| 功能迭代 | ✅ 初版 + 4 项 + 10 项 + 安全加固 + 登录改造 + 6 项升级 + 第六轮 5 项 + 第七轮日历查询 + 第八轮滚动/遮挡修复 + 第九轮防刷/介绍按钮/图标/管理tab + 第十轮首页遮挡/预约人就诊人/日期条横滑/图片上传 + 第十一轮去微信号/个人信息卡/openid 关联 + 第十二轮数据自动快照备份 + 第十三轮 WXML 方法调用修复 + 第十四轮状态机/删除/状态过滤/陪诊师头像/手机号一键获取 + 第十五轮 Web 管理页（/manage 增删管理员）+ 第十六轮 AppID 更换与体验版发布，全部完成（见 §5） |
| 小程序 AppID | ✅ 已换为 **`wx0175066b14b66cdd`**（2026-09-03，project.config.json；旧号 `wxebd20e511c1560ef` 已弃用，全项目零残留）。**⚠️ openid 是 AppID 维度**：切真实微信登录后所有 openid 都会变，届时 adminOpenids 需在新号下重新采集（见 §5 十六轮） |
| 体验版 | ✅ 已可发布：上传→后台「选为体验版」→真机扫码。**真机必须开「开发调试→调试 vConsole」绕过域名校验**（baseUrl 为 IP+HTTP，2026-09-04 排查确认服务器正常、拦截来自微信域名校验，详见 §5 十六轮） |
| 生产管理员 | ✅ adminOpenids 现有 **2 个**：`dev_7cdad62293dd49f2`、`dev_400830b1b93973b1`（后者经 Web 管理页添加），均可经 `/manage` 页增删 |
| 真机调试 | ✅ 已配置（app.js 按平台自动切 baseUrl，见 §7） |
| 上线部署 | ⏳ 服务器已部署；**待办**：域名+备案+HTTPS、真实微信登录、微信支付（见 §8/§11） |
| 支付 | ✅ **已下掉**：只预约不付费（预约提交即成功，无支付流程） |
| 微信登录 | ✅ 已改为**强制登录**（进入小程序即登录，失败弹窗引导重试；下单/查单前再次强制）；真实模式上线需填 appid/secret |
| 订单状态 | ✅ 已改为**状态机**：`pending(待确认) → confirmed(已确认/生效) → completed`，可 cancel；预约需管理员确认才生效，预约时长强制 ≥2 小时（第十四轮） |
| **Web 管理页** | ✅ **`http://120.53.4.14/manage`**：浏览器端增删小程序管理端微信白名单（adminOpenids）；账号 `Austin` + 密码（pbkdf2 哈希存储，**明文仅生成时一次性告知用户**，未落盘）；独立 token（8h）+ IP 登录限流（5 次锁 15 分钟）+ 至少保留 1 个管理员（第十五轮） |
| 生产配置 | ⚠️ 生产 config 未配置价格折扣/医院科室（单价仍 200、discounts/departments 为空），**待用户进设置页配置** |

## 3. 目录结构与关键文件

```
wx-app/
├── AGENT-CONTEXT.md          # 本文件（交接上下文）
├── README.md                 # 功能说明、接口文档、微信登录/支付接入方式
├── DEPLOYMENT.md             # 上线部署清单（7 阶段 checklist + 回滚预案 + 速查表）
├── project.config.json       # 微信开发者工具项目配置
├── miniprogram/              # 小程序前端（原生框架，teal 简洁风格）
│   ├── app.js                # baseUrl 自动切换：devtools→127.0.0.1，真机/体验版→生产 http://120.53.4.14
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
│   ├── webadmin.html         # Web 管理页（/manage）：增删管理员，零依赖单页（内联 CSS/JS，需与 server.js 一同部署）
│   ├── db.js                 # DB 类：读写 server/data/*.json（同步原子写）
│   ├── backup.js             # 数据自动快照：启动+定时复制 data 到 backups/，滚动保留
│   ├── seed-demo.js          # 演示数据生成脚本
│   └── data/                 # config.json / orders.json / users.json（不打包交付）
├── scripts/gen-icons.js      # tabBar 扁平图标生成（纯 Node 手写 PNG 编码，改样式需重跑）
└── outputs/peizhen-yuyue.zip # 交付包（不含 server/data）
```

## 4. 核心架构约定（改动前必读）

- **用户身份**：微信 openid。`POST /api/login` 用 code 换 openid（真实模式调 jscode2session；模拟模式 `'dev_'+sha1('peizhen:'+code).slice(0,16)`，**不同 code = 不同用户**）。所有请求带 `x-openid` 头。
- **管理员双通道**：`x-admin-token` 头（密码登录 token，24h 有效）**或** `x-openid` ∈ `config.adminOpenids`。
- **管理端登录（v2.1 微信白名单）**：`POST /api/admin/login` 收 `{ code, openid?, password }`；身份解析 `resolveLoginOpenid()`：**真实模式**（配了 appid/secret）强制 code2session 结果为准（忽略前端 openid 防伪造）；**模拟模式**优先用请求里的 openid（与页面显示一致，规避开发者工具 wx.login code 每次变化导致的 openid 漂移），否则按 code 派生。校验 openid ∈ `adminOpenids`（否则拒「该微信不在管理白名单内」）+ 密码正确 → 发 token。**验证码/手机号通道已移除**（send-code 接口已删除，adminPhones 字段仅兼容保留不再参与校验）。白名单由管理端【设置】维护（把当前微信加入/移出），**首个管理员需服务器直改 config.json 的 adminOpenids**。
- **管理入口（隐藏式）**：首页连点服务名称 5 次进入管理登录页；白名单内微信（/api/admin/me 返回 isAdmin）首页显示管理入口、登录页显示「一键进入」。
- **多段预约**：订单存 `[start, end)` 区间 + `slotCount`；时长 = (end-start)/60 小时；`validateRange` 逐段校验 blocked/已约冲突/步长对齐；**计价 = 每小时单价 × 时长 × 折扣率**（`calcPrice`：取所有 `hours ≤ 时长` 档位中 hours 最大的一档，如满4h9折/满8h8折，6 小时命中 4h 档；订单落库 unitPrice/discountRate/discountHours/discountDesc/price）。
- **折扣/科室配置**：`discounts: [{hours, rate}]`（`sanitizeDiscounts` 清洗：hours>0、0<rate≤1、**同 hours 后写覆盖**（唯一档位）、按 hours 升序、最多 10 条）、`departments: []` 科室候选；设置页可增删（前端同 hours 覆盖更新）；预约页科室为「下拉选择 + 无选项手动输入」。
- **时段占用判断（activeOrderFor 按区间重叠）**：某时段被占用 = 存在未取消订单与其 `[start,end)` 重叠 → 多段订单会命中其占用的**每一个**时段（管理端/用户端时段格子全部显示已约，且 booked 时段带 `orderId` 可点入详情）。勿改回精确 start 匹配（会导致多段订单其余时段误显可约、可被重复下单）。
- **全部可配置项**（走 `GET /api/config` 公开读、`PUT /api/admin/config` 管理写）：服务名、陪诊师名、价格（每小时单价）、公告、须知、时段定义、屏蔽时段、医院候选、科室候选、多级折扣、备注快捷选项、微信号、客服链接 kfUrl、adminOpenids、wxaAppid/wxaSecret。
- **强制微信登录**：`login.ensureLoginWithRetry()`（utils/login.js）——有缓存 openid 直接返回，否则登录失败弹窗「重新登录/暂不登录」引导重试；app.js onLaunch 调用、下单前/我的订单页也强制。模拟模式 `/api/login` 仍按 code 派生 openid（每次 code 变化身份漂移但前端缓存稳定），管理登录走 `resolveLoginOpenid`（优先 body.openid）。
- **管理端订单详情**：`GET /api/admin/orders/:id`（checkAdmin 保护）返回完整订单 + `order.user`（基于 openid 关联的用户表资料：昵称/头像/姓名/手机号）；`GET /api/admin/orders?date=&start=` 时段过滤；管理首页订单行点击进详情、时段页 booked 时段点击进详情；详情页「拨打电话」+ 标记完成/取消（**微信聊天按钮已移除**：小程序无跳转聊天窗口 API，且已不再收集用户微信号，改电话联系）。
- **支付**：**已下掉**，订单提交即成功（无定金/尾款状态机），只预约不付费。
- **订单状态机（第十四轮起）**：`pending(待确认) → confirmed(已确认/生效) → completed`，任一状态可 `cancelled`；下单后默认 pending，需管理员 `/api/admin/orders/:id/confirm` 确认才生效（`confirmedAt` 记录时间）。**时段占用判断仍只排除 cancelled**——pending 也占用时段防重复下单，勿把 pending 当空闲。预约时长强制 ≥2 小时（后端 `durationHours < 2` 拦截 + 前端 goBook 拦截）。
- **管理员删除订单**：`DELETE /api/admin/orders/:id`（checkAdmin）永久删除（splice，无回收站），前端需二次确认。
- **陪诊师头像**：config.`escortAvatar`（相对 `/api/uploads/xx` 或 http(s) 链接），设置页 chooseAvatar(微信头像)/chooseMedia(上传图片) 双方式走 `/api/admin/upload` 管线，超限自动压缩重试；首页服务卡 + 介绍页展示圆形头像。
- **微信手机号**：预约页 `button open-type="getPhoneNumber"` → `e.detail.code` → `POST /api/wechat/phone`（后端 code 调 `getuserphonenumber`，需配 appid/secret，`access_token` 缓存 60s 刷新；模拟模式返回提示、前端回落手动输入）。
- **Web 管理页（第十五轮）**：浏览器访问 `/manage`（页面 `server/webadmin.html`，零依赖单页，内联 CSS/JS），用于**增删小程序管理端的微信白名单 `adminOpenids`**（含可选备注名，存 `config.adminLabels`，不参与鉴权）。
  - **凭据**：`config.webAdmin = { username, passHash, salt }`，用 `crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512')` **只存哈希，绝不落盘明文**；校验走 `timingSafeEqual` 防时序攻击。
  - **初始化**：启动时 `ensureWebAdmin()`——仅当 `passHash` 为空才用环境变量 `WEB_ADMIN_USERNAME`/`WEB_ADMIN_PASSWORD` 初始化（一次性，避免重启覆盖已改过的密码）；也可直接把哈希写进 `config.json`（生产即用此法，**明文密码不落盘服务器任何文件**）。未初始化时登录接口明确提示「尚未启用」。
  - **鉴权隔离**：用**独立的 `webTokens`**（有效期 8h，比小程序管理端 24h 更短），请求头 `x-web-token`，**不复用 `checkAdmin`/`tokens`**——避免 Web 凭据横向打通全部 `/api/admin/*` 接口。
  - **安全**：登录按 IP 限流（5 次失败锁 15 分钟，`clientIp()` 优先取 `X-Forwarded-For`/`X-Real-IP`，适配 Nginx 反代）；**至少保留 1 个管理员**（删最后一个被拒，防无人能登管理端）；页面所有动态内容经 `esc()` HTML 转义防 XSS；改密后作废当前 token 强制重登。
  - **接口**：`POST /api/webadmin/login`、`POST /api/webadmin/logout`、`GET|POST /api/webadmin/admins`、`DELETE /api/webadmin/admins/:openid`、`POST /api/webadmin/password`。CORS 两处 `Access-Control-Allow-Headers` 已加 `x-web-token`。
  - **部署注意**：`webadmin.html` 必须与 `server.js` **一同上传**到 `/opt/peizhen/server/`，否则 `/manage` 会提示页面文件缺失。

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

**四轮（安全加固 + 管理登录改造，2026-09-01）**：
1. 安全加固：改默认管理密码（20 位强随机）、管理白名单、UFW/fail2ban/SSH 系统加固（详见 §8.5）
2. 管理入口校验改为「微信号白名单 + 密码」（白名单内微信号 + 正确密码才能进管理页；支持一键微信登录、首页显示管理入口；验证码/手机号通道移除）
3. 修复模拟模式 openid 漂移（resolveLoginOpenid 模拟模式优先 body.openid）

**五轮（6 项功能升级，2026-09-01 晚）**：
1. 管理界面支持增加管理员微信号（设置页可手动粘贴 openid 添加白名单）
2. 价格改为每小时单价，预约界面显示总价，首页顶部改 `xx 元/小时`
3. 管理界面支持多级折扣（满 X 小时打 X 折，自定义增删；同档位覆盖更新）
4. 预约科室支持下拉选择（管理员录入候选，无选项可手动输入）
5. 管理员可在预约界面（时段页/订单列表）点击进入查看订单详情（新增管理端订单详情页 + `/api/admin/orders/:id` + 时段过滤）
6. 强制微信登录（进入小程序必须授权，失败弹窗重试）+ 管理详情页跳转与用户微信聊天（复制微信号引导添加；小程序无开放跳转 API）
- **修复 Bug**：`activeOrderFor` 由精确 start 匹配改为区间重叠判断（多段订单占用时段全部显示已约）；`sanitizeDiscounts` 同 hours 去重改为后写覆盖（避免同档多 rate 计价不确定）；管理端订单详情接口 checkAdmin 保护确认。

**六轮（5 项体验升级，2026-09-01 深夜）**：
1. 预约页底部加「取消」按钮（返回首页）；**科室改为非必填纯手输**（去掉下拉候选，设置页「候选科室」卡片同步移除，后端 departments 字段保留兼容）
2. 首页「微信联系」：配置企业微信客服（`wxCorpId` + `kfUrl`，设置页可填）→ 直接跳转客服聊天窗口；否则弹「加微信」提示 + 一键复制微信号（修复了旧代码 openCustomerServiceChat 缺 corpId 参数的问题）
3. 新增**陪诊师介绍页** `pages/about/about`：首页点击陪诊师名称跳转；内容 = config.`about`（Markdown，设置页 textarea 编辑，2 万字上限）；自研零依赖轻量解析器 `utils/md.js` → rich-text nodes（支持 #/##/### 标题、**加粗**、- 和 1. 列表、> 引用、--- 分割线、![](url) 图片；样式全部走内联 style）
4. 管理员在**首页**点击已约时段 → 直接跳管理端订单详情（依赖 slots 接口 booked 时段的 orderId；管理员视角已约时段标签显示「查详情」）
5. 管理端订单详情「去微信聊天」一键复制用户微信号并弹窗引导（小程序无跳转普通用户聊天窗口的 API，此为最短路径；未填微信号时引导拨打电话）

**七轮（管理端日历查询，2026-09-01 晚）**：
1. **订单 tab**：筛选栏新增「选日期」日历项（picker mode=date），任选一天查订单（含过去日期）；「近7天」改用后端 `dateStart/dateEnd` 过滤（原来前端过滤）
2. **时间 tab**：日期条（未来 14 天）下方新增「日历任选日期」行，可选任意历史/未来日期查看时段占用（含 booked 订单跳详情）
3. **统计 tab**：周期栏新增「自定义」→ 起止日期双日历（互为边界约束）+ 查询按钮，默认区间为本月 1 号至今天
4. 后端：`/api/admin/stats` 支持 `period=custom&start=&end=`（跨度上限 366 天；≤62 天按日分桶、更长按月分桶，跨年月标签带年份）；`/api/admin/orders` 支持 `dateStart/dateEnd` 区间过滤
5. 验证：本地 9 项全过（date/区间过滤、custom 7 天日桶、custom 9 个月月桶、起>止拒绝、超一年拒绝、day/week/month/year 不回归、slots 历史日期、未授权 401）；生产 md5 `2deda1328cf0719ff657e27bd28a59fc` 同步重启后只读验证通过

**八轮（滚动/遮挡 Bug 修复，2026-09-01 夜，纯前端）**：
- **根因**：底部操作栏是 `position: fixed`，浮在内容之上；而页面底部只留了 160rpx 占位，远小于底栏实际高度 → 底栏**永久压住**页面底部内容，滚到底也点不到。
  - 首页：占位 200rpx vs 底栏 ~140rpx（1 个按钮）→ 正常（所以只有下面 3 个页面出 bug）
  - 预约表单页：占位 160rpx vs 底栏 ~240rpx（确认预约 + 取消）→ **「同意预约须知」勾选行被盖住，点不动**
  - 管理端订单详情：占位 160rpx vs 底栏 ~336rpx（标记完成 + 取消订单 + 返回列表）→ **「联系用户」整块被盖住，页面看起来拉不动**
  - 用户端订单详情：同结构，最多 2 个按钮（~232rpx）→ 同样遮挡（顺手一起修）
- **修法（3 个页面统一）**：底栏 `position: fixed` → `position: sticky; bottom: 0`（保留常驻显示，但**占据文档流高度，不再遮挡内容**）；页面骨架改为 `.page{min-height:100vh;display:flex;flex-direction:column}` + `.content{flex:1 0 auto}` + 底栏 `flex:none`（内容少时底栏自动贴屏幕底部，视觉不变）；160rpx 死占位换成 24rpx `.safe-gap`；`page{padding-bottom:0}`。
  - 即便 sticky 不被支持也会优雅降级为静态块（按钮在末尾），不会回到遮挡状态。
- **顺带**：预约页 textarea 去掉 `auto-height`（iOS 上 flex 容器内的自动高度原生层会异常撑高、吞掉下方点击），改为固定 160rpx `.form-textarea`；勾选行加大点击区（padding 12rpx、圆点 36rpx）。
- **未改动**：首页（占位充足、本身正常，避免动高频页面）；后端与生产环境无变更（纯小程序前端，需开发者工具重新上传体验版）。

**九轮（4 项，2026-09-02）**：
1. **预约防刷**：`POST /api/orders` 增加内存级限流——同一 openid 10 秒内最多 1 单、每天最多 10 单；同一手机号每天最多 5 单（关键防线，防换号刷）。先只读校验、成功下单后才计数（避免用户填错重试被误限）。维度：openid + 手机号；生产单进程常驻，服务重启计数清零（可接受）。
2. **陪诊师「查看介绍」按钮**：首页陪诊师名称后新增明显可点击的胶囊按钮（teal 描边）跳转 `/pages/about/about`（原来仅名称行整体可点，不够明显）。
3. **tabBar 图标重绘**：gen-icons.js 从 RGB（color type 2）改为 **RGBA（color type 6）透明背景**，修复 RGB 图标在真机 tabBar 上把圆角方块外区域渲染成黑底方块的问题；重绘优化日历/人形、新增「管理」齿轮图标；circle 加 1px 抗锯齿。
4. **自定义 tabBar + 管理入口**：app.json 开启 `custom: true` 并把 admin/home 加入 list；新增 `custom-tab-bar` 组件（预约/我的/管理三 tab，**管理仅 isAdmin 时显示**；用 `<block wx:for>` + 子元素 `wx:if`，避免微信 `wx:if` 优先级高于 `wx:for` 导致 index 取不到、全部 tab 不显示的坑）；index/orders/admin-home 页面 onShow 同步选中态；admin/home 变为 tabBar 页面后，所有跳转它的入口（index goAdmin/tapTitle、admin login 登录成功、slots/stats/settings 的「订单」nav）统一改为 `wx.switchTab`。
- 生产同步：server.js（防刷）md5 `0903a0161bda4094414d27cff7aab71b`，sudo 上传 + pm2 reload online ✓，只读验证 config/slots 正常；前端改动需开发者工具重新上传。

**十轮（4 项，2026-09-02 晚）**：
1. **首页滚动/遮挡修复**：第九轮自定义 tabBar（fixed、z-index 999、覆盖在页面底部）把首页原 `position:fixed; bottom:0` 的底部预约栏盖住，页面底部留白也被 tabBar 占掉 → 改为第八轮同款 sticky 方案，且 `bottom: calc(100rpx + env(safe-area-inset-bottom))` 偏移出 tabBar 高度（悬浮在 tabBar 之上）；三个 tab 页（index/orders/admin-home）统一加 `.tab-page`（全局类，padding-bottom: calc(110rpx + safe-area)）给 tabBar 让位。**教训：自定义 tabBar 是 fixed 覆盖层，不会给页面内容让位，所有 tab 页必须自行留白**。
2. **预约表单拆分预约人/就诊人**：预约人（姓名/手机号/微信号，均必填）+「为他人预约」勾选（勾选后显就诊人姓名/手机号；不勾选就诊人=预约人）；订单新增 `bookerName/bookerPhone/bookerWechatId/forOthers` 字段，`clientName/clientPhone` 语义=就诊人（不勾选时与预约人相同，旧参数提交自动回退兼容）；`clientWechatId` 保留旧字段=预约人微信号。**微信号无法通过微信 API 自动获取**，改为两级自动带入：本地记忆（booker_name/phone/wechat 存储）→ 该微信历史订单补缺。防刷维度改为 openid + 预约人手机号（日 10）+ 就诊人手机号（日 5，仅不同号时）。管理端/用户端订单详情展示预约人与就诊人分列，联系按钮优先 `bookerWechatId`。
3. **管理端时间 tab 日期条横滑**：flex 均分 14 天（过挤）→ `scroll-view scroll-x` 30 天 + `scroll-into-view="d-日期"` 选中定位；日历选到条外日期时围绕该日期重建 30 天条。
4. **介绍图片上传**：后端新增 `POST /api/admin/upload`（base64 JSON，服务端强制 ≤500KB + 后缀白名单 png/jpg/jpeg/gif/webp，存 `server/data/uploads/`，文件名 genId 白名单正则防穿越）与 `GET /api/uploads/:file`（公开只读 + 一年强缓存）；设置页「插入图片」按钮：chooseMedia(compressed) → 超 500KB 自动压缩重试（quality 60→30）→ 上传 → 追加 `![图片](/api/uploads/xx)` 到介绍末尾；`utils/md.js` 渲染时把 `/` 开头的相对图片地址拼上 baseUrl（getApp().globalData.baseUrl），换域名不破链。readBody 上限 1e6→2e6（base64 图片体）。
- 验证：本地 10 项全过（新表单下单、旧参数兼容、防刷（bookerPhone 跨 openid）、forOthers 缺就诊人拒绝（发现并修复后端回退漏洞）、上传成功/访问/超限拒绝/非法后缀/未授权 401/路径穿越）；生产 md5 `b84e0835a1272e47b5b0fa730db60d27` 同步 reload online ✓，uploads 目录自动创建、接口只读验证通过；前端改动需开发者工具重新上传。

**十一轮（3 项，2026-09-02 晚）**：
1. **预约页彻底去掉微信号**：用户明确微信号无法通过微信 API 获取（平台不开放），改为不再收集。后端 `createOrder` 移除 `bookerWechatId`/`clientWechatId` 字段存储；用户端/管理端订单详情移除「微信号」展示；管理端详情移除「去微信聊天」按钮，联系用户仅保留「拨打电话」。历史订单 JSON 里残留的 `clientWechatId` 属旧演示数据，无害不清理。
2. **我的页个人信息卡（头像昵称填写能力）**：`pages/orders` 新增个人信息卡——头像用 `<button open-type="chooseAvatar">`（用户主动选微信头像，超 500KB 或缺合法后缀时前端 compressImage 压缩重试）+ 昵称用 `<input type="nickname">`（键盘上方可一键填入微信昵称，失焦自动保存）；资料存用户表（`/api/user/profile` GET/POST 早已就绪，`upsertUser` 按 openid 落库）。姓名/手机号由下单时自动同步进用户表，只读展示。
3. **openid 关联用户预约单**：确认闭环——`POST /api/orders` 用 `x-openid` 头绑定订单（api.js 自动附加），下单同步 name/phone 进用户表；`GET /api/orders?openid=` 校验请求头 openid 一致防越权；`GET /api/admin/orders/:id` 附带 `order.user`（昵称/头像/姓名/手机号），管理端详情页顶部展示下单用户头像昵称卡。
- 验证：本地后端端到端全过（登录→改昵称→传头像→查询资料→下单（返回不含 bookerWechatId/clientWechatId）→资料同步 name/phone→管理端详情返回 order.user），测试数据已清理并重启后端。**生产已同步**（2026-09-02 晚）：server.js 先 scp 到 `/tmp` 再 `sudo cp` 覆盖（备份 `server.js.bak.20260902213611`），md5 本地=生产 `d87cc287e8a99dafeb2f5c9fc2d35c0e`，`sudo pm2 reload peizhen-api` online ✓；只读验证 config/profile 未授权/uploads 404 均按业务 code=1 正确拒绝；**生产 config 未动**（servicePrice 仍 200）。前端改动仍需开发者工具重新「编译」+「上传」发新版体验版。

**十二轮（数据备份能力，2026-09-03）**：
1. 背景：用户要求「保证服务在重启/升级时不丢失数据」。结论——当前 JSON 文件存储 + `db.js` 同步原子写（先写 `.tmp` 再 `rename`）+ 部署只覆盖 `server.js` 不碰 `data/`，**重启/常规升级本身不丢数据**；缺的是**灾难恢复兜底**（磁盘损坏/误删 data/误覆盖）。
2. 新增 `server/backup.js`（零依赖）：`start(dataDir)` 在进程启动时立即快照 + 每 N 小时定时快照，把 `data/` 完整复制（含 uploads 图片，排除 `.tmp` 残留）到备份目录；滚动保留最近 `KEEP` 份。默认备份目录 `path.join(__dirname,'..','backups')`（生产 `/opt/peizhen/backups`，与 server 代码隔离，误删 server 不影响备份）；环境变量 `BACKUP_DIR` / `BACKUP_KEEP`(默认30) / `BACKUP_INTERVAL_HOURS`(默认6)。
3. `server.js` 接入：抽出 `DATA_DIR` 常量，`server.listen` 回调里 `startBackup(DATA_DIR)`。**关键收益：升级=覆盖 server.js + reload=重启，重启即自动快照**，无需手动备份。
4. 验证：本地启动即生成快照（4 JSON + 3 图片完整）；滚动清理测试（KEEP=3 时 6 个快照收敛到 3 个、非法名不误删）。生产已同步：上传 server.js + backup.js，md5 本地=生产 `ff44ed436ff2ec3f94b3fe5050f2e76f`（server.js）/`f7c1e2bf7469ead05ef576254e7fd967`（backup.js），备份 `server.js.bak.20260903105341`，`pm2 reload` online ✓；生产 `/opt/peizhen/backups/snapshot-20260903-105342` 生成成功。
5. **发现（待用户确认）**：生产 `adminOpenids` 现只剩 `["dev_7cdad62293dd49f2"]`，原 `dev_c5102cd050db81dd` 已不在白名单（`isAdmin:false`）。根因：`/api/admin/config` 对 `adminOpenids` 是**整体替换**语义，管理端设置页提交会覆盖。非本次备份改动导致。**结论**：当前为模拟登录模式，openid 按 code 派生、每次登录都会漂移，`dev_c5102cd050db81dd` 属过时临时号，现状无需恢复；上线配真实 code2session 后 openid 才稳定。
6. **补充（同日）**：去掉启动日志里管理端密码的明文打印（改打「已设置（不在日志中打印明文）」），消除 `/var/log/peizhen/out.log` 泄密风险。生产已同步 server.js md5 `beb63c5c607ca09562f4e7834e046742`（备份 `server.js.bak.20260903114419`），reload online ✓，日志确认无明文。

**十三轮（WXML 方法调用修复，2026-09-03，纯前端）**：
- 用户报「管理界面微信白名单显示 undefined」。根因：WXML 数据绑定表达式**不支持方法调用**（`.slice/.replace/.indexOf/Math.round` 等），统一把缩略/格式化/高亮逻辑移到 JS 侧预计算字段——settings 白名单 `adminOpenidItems`（{full,short}）、about 头像首字 `avatarText`、order-detail `createdText/discountText`、book 备注高亮 `noteActive` 映射。纯前端改动，后端未动、无需同步生产。

**十四轮（5 项功能升级，2026-09-03）**：
1. **管理员删除记录**：新增 `DELETE /api/admin/orders/:id`（checkAdmin 保护，splice 永久删除）；管理端订单列表/详情页加「删除记录」按钮（删除后 switchTab 回列表）。
2. **预约待确认状态机 + 至少 2 小时**：订单状态改为 `pending → confirmed → completed`（可 cancel）；`POST /api/orders` 提交后 status=pending、新增 `confirmedAt`；`POST /api/admin/orders/:id/confirm` 确认后生效；`createOrder` 加 `durationHours < 2` 拦截 + 预约页 goBook 加 `<120` 分钟拦截。时段占用仍只排除 cancelled（pending 也占用防重复下单）。
3. **管理页订单/时间/统计按状态过滤**：`/api/admin/orders?status=`、`/api/admin/stats?status=`；时间页前端按 booked 时段 `orderStatus`（decorateSlots 新增返回）弱化高亮不匹配项。
4. **陪诊师头像**：config 新增 `escortAvatar`；设置页支持「微信头像 chooseAvatar」+「上传图片 chooseMedia」双方式（走 `/api/admin/upload` 管线，超限自动压缩重试）+ 清除；首页服务卡 + 介绍页展示圆形头像。
5. **手机号一键获取**：预约页手机号旁加 `button open-type="getPhoneNumber"` → `e.detail.code` → `POST /api/wechat/phone`（后端 code 调 `getuserphonenumber`，`access_token` 缓存 60s 刷新；模拟模式返回提示、前端回落手动输入）。
- 状态文案集中 `utils/util.js`（`orderStatusText/orderStatusLabel`：pending=待确认/confirmed=已确认/completed=已完成/cancelled=已取消）；api.js 新增 `del()`；CORS 两处 method 加 `DELETE`。
- 生产已同步：server.js md5 本地=生产 `19a3ba7075ff1c2b1e036e7bdaadfa5e`，备份 `server.js.bak.20260903-174008`，pm2 reload online ✓；只读验证 escortAvatar 字段、CORS 含 DELETE、confirm/stats 无鉴权返回业务码 401 均通过。前端需开发者工具重新编译+上传。

**十五轮（Web 管理页：增删管理员，2026-09-03）**：
- 需求：新增一个**浏览器访问**的 Web 管理页，用于**添加/删除小程序管理端微信白名单**，账号密码鉴权（账号 Austin、密码自动生成）。
- 后端：`server.js` 新增 `GET /manage`（返回 HTML）+ `POST /api/webadmin/login|logout|password`、`GET|POST /api/webadmin/admins`、`DELETE /api/webadmin/admins/:openid`；`config.webAdmin = { username, passHash, salt }`（`pbkdf2Sync(...,100000,64,'sha512')` **只存哈希绝不落盘明文**，校验 `timingSafeEqual` 防时序攻击）；**独立 `webTokens`**（8h，请求头 `x-web-token`，不复用 `checkAdmin`/`tokens`，避免 Web 凭据横向打通 `/api/admin/*`）；登录按 IP 限流（5 次失败锁 15 分钟，`clientIp()` 优先 `X-Forwarded-For`/`X-Real-IP`）；**至少保留 1 个管理员**（删最后一个被拒）；启动 `ensureWebAdmin()` 仅当 `passHash` 为空时用 `WEB_ADMIN_USERNAME`/`WEB_ADMIN_PASSWORD` 环境变量一次性初始化（生产改为直接把哈希写进 config，避免明文落盘）。
- 前端：`server/webadmin.html` 零依赖单页（登录卡 + 管理员列表 openid/备注 + 添加表单 + 删除二次确认 + 改密），localStorage 存 token，中文 UI，动态内容经 `esc()` HTML 转义。
- **凭据**：账号 **Austin**、密码 **`dF6gjLSE4NDYorJm`**（16 位强随机，已剔除易混淆字符 0/O/1/l/I）。明文仅告知用户，**不落盘服务器任何文件**。
- 验证：本地 15 项全过（错密码/错账号拒、登录成功、无 token/伪造 token 拒、增删、重复/非法/空 openid 拒、删最后一个保护、登出失效、连续 5 次失败限流）；生产已同步（server.js + webadmin.html 同传，md5 本地=生产 server.js `a68951833aac731b364a5743ff238c2c` / webadmin.html `bead49d2c74fa9df3541122256d554a0`，备份 server.js.bak.<ts> + config.json.bak.<ts>，密码哈希写入生产 config，pm2 reload online ✓；公网 `http://120.53.4.14/manage` 只读 + 登录校验通过）。

**十六轮（AppID 更换 + 体验版发布 + 真机排查，2026-09-03/04）**：
- **AppID 更换**：`project.config.json` appid `wxebd20e511c1560ef` → **`wx0175066b14b66cdd`**（DEPLOYMENT.md 同步，全项目 grep 零残留，JSON 校验通过）。本地/生产 `wxaAppid`/`wxaSecret` 均为空（模拟模式），换号无运行影响。**⚠️ 关键隐患**：openid 是 AppID 维度的，将来切真实登录（配 appid/secret 后）同一微信用户 openid 会完全不同 → 生产 adminOpenids 全部失效、历史订单归属失效；届时需在新 AppID 下重新走「管理端登录页复制 openid → /manage 加白名单」。新号的 AppSecret 需在 mp.weixin.qq.com「开发管理→开发设置」重新获取（旧号 Secret 不可复用）。
- **体验版发布流程**（写入 DEPLOYMENT.md §4.5）：开发者工具上传 → mp 后台「版本管理→开发版本→选为体验版」→「成员管理→体验成员」加人 → 扫码体验。**真机必须**：进入小程序 →「···」→「开发调试」→ 打开「调试 vConsole」，否则所有请求被合法域名校验拦截（报「无法连接服务」）。
- **体验版连不上的排查结论（2026-09-04）**：逐层验证 PM2 online、8300 监听、Nginx active、公网 `http://120.53.4.14/api/config` HTTP 200、UFW 80/443 放行——**服务器完全正常**；根因是 baseUrl 为 **IP + HTTP**，微信真机校验（必须 HTTPS + 备案域名）直接拦截。过渡方案=开调试模式；根治=域名备案后上 HTTPS（见 §11 待办 1）。排查时注意：前端 app.js 真机一律连生产（仅 devtools 连本地），上传旧版本体验包会带旧 baseUrl。

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

## 7. 访问地址配置（已改为服务端）

- `app.js` 按 `wx.getSystemInfoSync().platform` 自动切换：**devtools → `http://127.0.0.1:8300`（本地后端）**；**其余环境（真机预览/体验版）→ `PROD_BASE_URL = http://120.53.4.14`（生产服务端，Nginx 80→后端 8300 反代）**。默认 baseUrl 即生产地址。
- 改动入口只在 `app.js` 顶部两个常量 `PROD_BASE_URL` / `LOCAL_BASE_URL`；其余页面/工具统一经 `app().globalData.baseUrl` 引用，无硬编码。
- **域名校验（`urlCheck: false` 已在 project.config.json 开启）**：开发者工具模拟器 + 真机调试可直连 `http://120.53.4.14`（IP + HTTP 不校验）；但**体验版/正式版**微信后台仍强制校验 request 合法域名，IP + HTTP 会被拒 → 必须走「域名备案 + HTTPS + 公众平台服务器域名配置」（见 §8.6 TODO）。

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

### 8.5 生产环境现状（2026-09-01 已部署）

- **服务器**：腾讯云轻量 **120.53.4.14**（Ubuntu 24.04.4，4核/3.6G/40G），SSH 用户 `ubuntu`（本机 ed25519 公钥免密；登录用户曾用密码，部署后可改）。
- **后端**：`/opt/peizhen/server`（server.js + db.js + deploy/），PM2（root）`peizhen-api`，仅监听 `127.0.0.1:8300`（server.js 已支持 HOST 环境变量）；Nginx `80 → 127.0.0.1:8300` 反代。
- **管理命令**：`sudo pm2 ls / logs peizhen-api / reload peizhen-api`；改代码后上传 `server/` 并 reload。
- **数据**：服务器上是全新干净数据（价格 200/定金 50 为代码默认值），未传演示数据。
- **安全加固（2026-09-01 完成，详见当日工作日志）**：管理密码已改 20 位强随机（旧 123456 已失效，明文见当日会话，用户可随时在设置页再改）；**管理登录已改微信白名单+密码（v2，2026-09-01 17:30，验证码/手机号通道移除）**；UFW 已启用（仅放行 22/80/443，8300 显式 DENY）；fail2ban 已装并守护 sshd；SSH 已禁 root 密码登录（PermitRootLogin prohibit-password + PasswordAuthentication no，本机 ed25519 免密不受影响）。**生产 adminOpenids 现有 2 个：`dev_7cdad62293dd49f2`、`dev_400830b1b93973b1`（2026-09-04 核实；早期的 dev_c5102cd050db81dd 已被替换，管理员增删统一走 Web 管理页 /manage）。**
- **部署脚本**：`server/deploy/deploy.sh` 一键重装（apt+NodeSource+pm2+nginx+ufw），`ecosystem.config.js` 含 WX_APPID/WX_SECRET 环境变量位（切真实登录时填）。
- **已验证**：服务器本机 8300 直连 ✓、经 Nginx ✓、公网 `http://120.53.4.14/api/config` HTTP 200 ✓；新密码登录 ✓ / 旧密码拒绝 ✓ / 白名单外拒绝 ✓。
- **2026-09-01 晚升级同步**：6 项升级的 server.js 已 scp 覆盖生产（备份 `server.js.bak.<时间戳>`，md5 本地=生产 `5f44a283133b8e6f6eda85d85d4d082b`，`sudo pm2 restart peizhen-api` 后 online ✓）；只读验证通过（/api/config 含新字段、管理 x-openid 白名单通道正常、slots 正常）；**生产 config 未改动**——servicePrice 仍 200、discounts/departments 为空，待用户在设置页自行配置（勿代写，涉及定价决策）。
- **2026-09-01 深夜第六轮同步**：server.js（新增 about/wxCorpId 字段）已 scp 覆盖生产并重启，md5 本地=生产 `538aacaf8af9b765b0aa5619e8c078bb`，PM2 online ✓；只读验证 /api/config 与 /api/slots 均返回 about/wxCorpId 新字段（值为空，待用户在设置页填写）。
- **2026-09-01 晚第七轮同步**：server.js（stats custom 周期 + orders dateStart/dateEnd）已 scp 覆盖生产并重启，md5 本地=生产 `2deda1328cf0719ff657e27bd28a59fc`，PM2 online ✓；只读验证 custom 统计/区间过滤/原周期不回归均通过。
- **2026-09-02 第九轮同步**：server.js（预约防刷限流）已 sudo 上传覆盖生产并 reload，md5 本地=生产 `0903a0161bda4094414d27cff7aab71b`，PM2 online ✓；只读验证 config/slots 正常（防刷逻辑本地已验证，代码一致）。**坑**：`/opt/peizhen` 是 root 权限，ubuntu 直 scp 会 Permission denied，需先 scp 到 `/tmp` 再 `sudo cp` 覆盖。
- **坑**：macOS tar 上传会在服务器留 `._*` 文件需 `find . -name '._*' -delete`；PM2 以 root 跑，ubuntu 用户要看进程需 `sudo pm2 ls`；部署后务必核对 server.js md5 与本地一致（曾发生生产为旧版、少 send-code 接口的情况）。

## 9. 已知坑（踩过的，勿重复）

1. **macOS http_proxy 代理**：curl 访问 127.0.0.1 会走代理返回 502 → 一律 `curl --noproxy '*'`。
2. **后台进程**：nohup 启动的 server 随会话结束被回收 → 必须用 Bash 后台任务方式启动；换会话后先 curl 检查、停了就重启。
3. **模拟登录演示**：模拟模式按 code 派生 openid 才能演示「未绑定拒绝→密码绑定→一键登录」完整链路；固定 openid 演示不了。
4. **WXML 属性引号**：属性值内嵌套双引号会导致编译报错，用单引号替代。
5. **演示数据的 blocked 时段**：测试创建订单遇到「包含不可约时段」属预期（演示数据屏蔽了部分时段），换个日期即可。
6. **底栏不要用 `position: fixed` + 固定占位**：fixed 底栏会浮在内容上，占位高度一旦小于底栏实际高度（按钮增多就会超），底部内容就永久点不到/拉不动。统一用 `sticky; bottom:0` + flex 页面骨架（见 §5 八轮）。
7. **textarea 慎用 `auto-height`**：flex 容器内的自动高度 textarea 在 iOS 上会异常撑高并吞掉下方元素点击 → 用固定高度。
8. **开发者工具自动化端口默认关闭**：`cli auto` 的 y 确认在管道/伪终端下都不生效，需手动「设置 → 安全设置 → 服务端口」打开才能跑自动化脚本（本次未开启，改静态分析定位）。
9. **自定义 tabBar 是 fixed 覆盖层**：不会给页面内容让位，tab 页底部内容/底栏会被它盖住 → 所有 tab 页必须加 `.tab-page` 底部留白；页内 sticky 底栏要 `bottom: calc(100rpx + env(safe-area-inset-bottom))` 偏移出 tabBar 高度（见 §5 十轮）。
10. **微信不提供读取用户「微信号」的 API**（平台从未开放，登录授权也拿不到）→ 已放弃收集用户微信号；用户身份用 openid 关联，联系用户走手机号。头像/昵称也不能静默读（`wx.getUserProfile`/`getUserInfo` 已收回，统一返回「微信用户」+灰头像），只能用「头像昵称填写能力」：`button open-type="chooseAvatar"` + `input type="nickname"`（见 §5 十一轮）。

## 10. 用户偏好与沟通约定

- 用户为陪诊师（非技术背景），沟通用**简体中文**，讲结论和操作步骤，少讲原理。
- 每次反馈以编号清单提需求（已习惯这种往返方式），完成后逐项对账。
- 关心成本，倾向最小可行方案；上线意愿明确但节奏从容（先真机体验，暂未购服务器）。

## 11. 下一步待办（按优先级）

1. **域名 + ICP 备案**（1~2 周审核，最先启动）→ Nginx 换 server_name + certbot 上 HTTPS → 小程序 baseUrl 由 `http://120.53.4.14` 改 https 域名（当前体验版/正式版因 IP+HTTP 无法通过 request 合法域名校验，仅开发者工具/真机调试可用）
2. 微信登录切真实模式：管理端设置页填 wxaAppid/wxaSecret（或 PM2 env 填 WX_APPID/WX_SECRET）
3. 微信支付正式接入（后端统一下单 + 回调验签 + 前端 wx.requestPayment，方案已写在 README）— 需先注册个体户/企业 + 微信认证
4. ✅ 上线初始化（安全部分 2026-09-01 完成：强密码 + 微信白名单登录 + 系统加固；**管理员白名单现走 Web 管理页 /manage 维护**）；**剩余**：录入正式配置（价格/医院/备注等，生产 config 仍为默认值）
5. 可选优化：管理端订单导出、用户取消订单时限、消息通知（订阅消息）

## 12. 换电脑迁移指南（保证开发连续性）

> 目标：把整个项目拷到另一台电脑后，能立即继续开发、联调、部署生产。

### 12.1 需要带走的文件

| 内容 | 路径 | 说明 |
|------|------|------|
| **项目全部代码与文档** | `wx-app/` 整个目录 | 必带。含 AGENT-CONTEXT.md（本文件）/ README / DEPLOYMENT / server / miniprogram / scripts |
| 本机 AI 会话记忆（可选） | `wx-app/.workbuddy/` | 带走可延续 AI 上下文；不带也不影响开发（本文件已覆盖全部关键信息） |
| **SSH 私钥（关键！）** | `~/.ssh/`（ed25519 私钥对） | 生产免密登录全靠它，丢了只能走腾讯云控制台重置（见 12.3） |
| 交付包（可选） | `outputs/peizhen-yuyue.zip` | 可随时重新打包，可不带 |
| 不需要带 | `server/data/`、`server/backups/` | 本地演示数据而已，生产数据在服务器上 |

> 建议改用 **git** 管理（远程仓库如 Gitee/GitHub 私有仓库），换电脑直接 clone；注意 `.gitignore` 排除 `server/data/`、`outputs/`、`.workbuddy/`。

### 12.2 新电脑环境要求

1. **Node.js ≥ 18**（后端零 npm 依赖，`node server.js` 直接跑；用系统包管理器或 nvm 安装）。
2. **微信开发者工具**（导入项目根目录，AppID `wx0175066b14b66cdd`；详情→本地设置→勾选「不校验合法域名」）。
3. Python3（仅用于校验 JSON/打包脚本辅助，可选）。

### 12.3 SSH 访问生产（最容易卡住的一步）

- 生产：`ssh ubuntu@120.53.4.14`，**当前服务器已全局禁用密码登录**（PasswordAuthentication no），只能密钥登录。
- 换电脑三种方式：
  1. **私钥随行**：把旧电脑 `~/.ssh/` 的 ed25519 私钥对拷到新电脑同位置（`chmod 600`）。
  2. **新电脑生成新密钥对**：新电脑 `ssh-keygen -t ed25519`，然后**用旧电脑或腾讯云控制台**把新公钥追加到服务器 `/home/ubuntu/.ssh/authorized_keys`。
  3. **兜底**：腾讯云轻量控制台 → 服务器实例 → 「登录」（WebShell/VNC），或「重置密码/密钥」功能（影响最小的是 WebShell 登进去追加公钥）。
- 验证：`ssh -o BatchMode=yes ubuntu@120.53.4.14 'sudo pm2 ls'` 能返回即通。

### 12.4 凭据清单（在哪、丢了怎么找回）

| 凭据 | 值/位置 | 丢了怎么办 |
|------|---------|-----------|
| Web 管理页账号 | `Austin` / `dF6gjLSE4NDYorJm`（`http://120.53.4.14/manage`） | 登录页「修改密码」可自助改；彻底忘了 → 服务器上把 config.json 的 `webAdmin` 字段清空，用 `WEB_ADMIN_USERNAME=xxx WEB_ADMIN_PASSWORD=xxx` 环境变量重启后端即可重新初始化 |
| 小程序管理端密码（20 位） | 明文存在生产 `config.json` 的 `adminPassword` | `ssh ubuntu@120.53.4.14 'sudo cat /opt/peizhen/server/data/config.json'` 可取回；也可在管理端设置页改 |
| 服务器 SSH | 见 12.3 | 见 12.3 |
| 微信小程序后台 | mp.weixin.qq.com（用户本人账号，AppID `wx0175066b14b66cdd`） | 微信扫码登录，找回走微信官方流程 |
| AppSecret | **尚未配置**（wxaAppid/wxaSecret 均空，模拟登录模式） | 将来在 mp 后台「开发管理→开发设置」获取后配到生产（走 PM2 env，勿明文落 config） |

### 12.5 新电脑首次启动步骤

```bash
# 1. 启动本地后端（后台方式，勿用 nohup）
cd wx-app/server && node server.js
# 2. 验证（macOS 必须 --noproxy）
curl --noproxy '*' http://127.0.0.1:8300/api/config
# 3. 微信开发者工具导入 wx-app/ 目录 → 勾选不校验合法域名 → 编译
# 4. 部署生产：改完 server/ 代码后
#    scp server.js 到 /tmp → ssh sudo cp 覆盖（先备份）→ sudo pm2 reload peizhen-api
#    （完整流程见 DEPLOYMENT.md 与 §8.5）
```

### 12.6 关键事实速查（新会话冷启动必读）

- 生产 IP `120.53.4.14`，Nginx 80 → 127.0.0.1:8300 → PM2(root) `peizhen-api`；部署路径 `/opt/peizhen/server`。
- 代码目录 `server/`（零依赖纯 Node）+ `miniprogram/`（原生小程序）；数据是 JSON 文件不是数据库。
- 体验版真机需开「调试 vConsole」才能连服务器（IP+HTTP 过不了微信域名校验）。
- 项目**不是 git 仓库**（截至 2026-09-04），换电脑靠整目录拷贝。
- 所有历史决策与坑见本文件 §4/§5/§9；新会话接手先通读本文件再动手。

---
*最后更新：2026-09-04 12:10（第十六轮：AppID 更换 wx0175066b14b66cdd + 体验版发布/真机排查 + 新增 §12 换电脑迁移指南；生产 server.js md5 a68951833aac731b364a5743ff238c2c、webadmin.html bead49d2c74fa9df3541122256d554a0；adminOpenids 现有 2 个）*
