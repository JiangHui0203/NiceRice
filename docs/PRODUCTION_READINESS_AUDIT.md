# NiceRice Production Readiness Audit

> 审计目标：判断 NiceRice 当前代码距离“可以安全、稳定、可恢复地交给真实用户使用”还差什么。

审计日期：2026-09-14  
审计基线：`main` @ `b1bcc8e848fa70febfe60cbc6b31b78f1938568e`

---

## 1. Executive Summary

### 当前结论：**Conditional No-Go**

NiceRice 已经是一个完成度较高的 **Local-first functional MVP**。

核心本地链路——餐券记录、推荐、时间选择、计划创建、计划生命周期、偏好、日程、地点、好友与历史——已经具备明显的产品和工程基础。

同时，当前代码里已经存在不少值得保留的生产化意识：

- 默认 `localOnly = true`；
- 客户端不内置长期 API Secret；
- 云函数统一做输入归一化与字段白名单；
- 地图请求有超时、响应体上限与响应字段校验；
- OCR 只接受受控目录下的图片文件，并尝试在识别后删除临时文件；
- 订阅消息只能向当前调用用户本人发送；
- 邀请协议已经考虑所有权、响应者角色、版本冲突、并发 claim、撤销和 tombstone；
- 本地存储已经有 schema migration、reset、backup/import 校验和附件清理；
- 仓库中存在大量模块级、页面级、隐私、race-condition 和 concurrency 测试。

因此问题并不是“代码还只是 Demo”。

真正阻止它直接进入正式发布的是：**还没有把已有工程能力收敛成一个可重复验证的 production release process。**

在正式发布前，建议先处理本审计列出的 P0，再处理 P1。P2 不阻塞首个正式版本。

---

## 2. Severity Definition

| Level | Meaning |
| --- | --- |
| **P0 — Release Blocker** | 正式发布前必须解决或做出明确的范围收缩，否则无法合理声明 production-ready |
| **P1 — Hardening** | 可以不阻断极小范围试用，但公开使用前应优先补齐 |
| **P2 — Hygiene / Maintainability** | 不直接影响核心安全与正确性，但会影响长期维护、协作和项目专业度 |

---

# 3. P0 — Release Blockers

## P0-1. 明确并修正本地数据保护模型

### 当前状态

项目默认采用：

```text
localOnly = true
cloudUploadEnabled = false
encryptAttachments = true
```

这是正确的产品隐私方向。

但是当前 `privacyService` 使用自定义的 `lh-local-stream-v1`：

```text
本地 secret
    ↓
自定义 hash / seed
    ↓
xorshift 风格 keystream
    ↓
XOR plaintext
```

这个实现没有经过标准密码学验证，也没有 authenticated encryption / MAC 来检测密文被篡改。

因此它最多可以视为一种本地数据混淆或轻量保护，**不能作为“生产级安全加密”的依据。**

### Release Requirement

发布前必须二选一：

**方案 A：真正实现生产级本地保护**

- 使用经过验证的 authenticated-encryption 方案，并确认微信小程序运行环境中的可靠实现方式；
- 明确 nonce、key generation、key lifecycle、rotation 和 failure behavior；
- 新旧数据提供可回滚的 migration；
- 增加 tamper / corrupted ciphertext / lost-key / migration interruption 测试。

**方案 B：收缩安全声明**

如果首版没有可靠的标准加密实现，则：

- 保持 Local-first；
- 不再把当前自定义 cipher 描述为 production-grade encryption；
- 明确威胁模型：主要保护目标是“不默认上传私人生活数据”，而不是防御已获得设备存储访问能力的攻击者。

### Acceptance Criteria

```text
[ ] 已确定真实 threat model
[ ] README / UI / 隐私说明与实现能力一致
[ ] 不再依赖自定义 XOR stream 作为“安全加密”证明
[ ] 如果升级算法，旧数据迁移和失败恢复已验证
```

---

## P0-2. 建立唯一、可重复执行的测试入口与 CI Release Gate

### 当前状态

仓库里已经存在大量测试，这是明显优势。

包括但不限于：

```text
recommendation
coupon / plan stores
backup / privacy persistence
screenshot lifecycle
map privacy / cache
weather edge cases / race conditions
invite status / race / concurrency
page contracts
UI helper logic
```

但是目前：

- 根目录没有统一 package/test runner；
- `cloudfunctions/lifeServices/package.json` 的 `test` 仍是 `No tests configured`；
- 没有 `.github/workflows/`；
- 当前 main commit 没有 CI status。

也就是说，**测试很多，但目前不是发布门禁。**

一次未来修改可以让部分测试失败，而提交仍然正常进入 main。

### Release Requirement

需要提供一个唯一命令，例如：

```bash
npm test
```

或：

```bash
node scripts/run-tests.js
```

它至少应：

1. 自动发现或显式列出全部正式测试；
2. 任意测试失败时返回 non-zero exit code；
3. 在干净环境下可重复运行；
4. 在 CI 中对 PR / main push 自动执行；
5. 把 security-critical tests 纳入必跑集合。

### Minimum Release Gate

至少应包含：

```text
config security
privacy persistence
backup import validation
coupon / plan repository
recommendation
route / location privacy
OCR upload restrictions
invite server guards
invite concurrency
page contracts
```

### Acceptance Criteria

```text
[ ] 一个命令运行完整测试集
[ ] CI 自动执行
[ ] main / release 不接受失败测试
[ ] 云函数 package.json 不再显示“No tests configured”
[ ] release candidate 保存一份通过记录
```

---

## P0-3. 建立 Formal Release Configuration，并完成微信平台侧隐私/权限核验

### 当前状态

开发配置仍明显保留了 prototype / development 属性：

```text
CLOUD_ENV_ID = ""
project.config.json: urlCheck = false
project.config.json: autoAudits = false
pages/debug/index 仍注册在 app.json
```

其中 `urlCheck=false` 对本地开发方便，但不能代替真实发布环境的合法域名和 HTTPS 配置。

仓库代码也无法证明微信公众平台后台的以下内容已经完成：

- 隐私保护指引；
- 位置能力用途声明；
- request / upload / download 合法域名；
- 云开发环境；
- OCR OpenAPI 权限；
- 订阅消息模板；
- 正式版服务状态；
- 实际审核所需的权限与用户告知。

### Release Requirement

把环境明确拆成：

```text
development
trial
formal
```

formal 构建必须满足：

- 不依赖开发者工具关闭域名校验；
- 不向普通用户暴露 debug 配置页面；
- 云端能力启用时使用明确的 formal cloud env；
- 开发/测试模板 ID、provider key、调试参数不进入客户端包；
- 微信公众平台后台实际配置与 `app.json`、产品 UI、隐私说明一致。

### Acceptance Criteria

```text
[ ] formal 配置独立于开发配置
[ ] debug 页面从 formal build 移除或严格不可达
[ ] 所有实际请求域名已在平台配置
[ ] 位置权限用途与实际行为一致
[ ] 订阅消息模板已真实申请并验证
[ ] OCR / 云能力权限已真实验证
[ ] 平台隐私保护指引逐项核对完成
```

> 具体平台规则可能变化，因此正式提交前应以当时微信公众平台后台和官方文档为最终标准。

---

## P0-4. 做一次真实设备的 End-to-End Release Candidate 验收

### 当前状态

项目已经有很多单元/模块测试，但 production readiness 最后必须经过真实设备行为验证。

特别是微信小程序里，下列能力无法完全由 Node 测试替代：

```text
storage quota / storage failure
chooseLocation / getLocation 权限
系统日历
微信分享
云函数权限
订阅消息授权
OCR 文件上传与删除
不同网络条件
真实设备前后台切换
不同微信版本 / 基础库行为
```

### Required E2E Journey

至少完整跑通：

```text
首次启动
  ↓
添加餐券
  ↓
保存地点 / 截图
  ↓
生成推荐
  ↓
选择时间
  ↓
创建 Plan
  ↓
改期
  ↓
邀请朋友（若启用云端）
  ↓
朋友确认 / 改期提议
  ↓
加入系统日历 / 请求提醒
  ↓
完成计划
  ↓
查看历史
  ↓
导出备份
  ↓
清空数据
  ↓
重新导入并验证恢复
```

还必须跑失败路径：

```text
拒绝定位权限
无网络
地图 provider timeout
OCR 失败
云环境未配置
模板未配置
邀请已过期
邀请已被别人响应
本地存储写入失败
备份文件损坏
```

### Acceptance Criteria

```text
[ ] 至少 iOS + Android 各一台真机
[ ] 正常主链路全部通过
[ ] 关键失败链路全部有明确用户反馈和安全降级
[ ] 没有 silent data loss
[ ] 没有“失败但 UI 显示成功”
```

---

# 4. Cloud Feature Scope Decision

NiceRice 的核心是 Local-first，因此“必须部署所有云能力才能发布”并不成立。

发布前应该明确选择一种 scope：

### Option A — Local-first First Release

首个正式版本只承诺本地核心链路。

那么应该：

```text
隐藏尚未完成的云功能入口
或明确标记为 unavailable / beta
```

此时 `CLOUD_ENV_ID` 为空本身不是错误。

### Option B — Cloud-enhanced First Release

如果首版就承诺：

```text
真实路线
OCR
跨设备邀请
订阅消息
```

则在发布前必须：

```text
配置 CLOUD_ENV_ID
部署 lifeServices
配置地图 provider 环境变量
开通 OCR
配置订阅模板
完成真实云端 E2E
完成成本 / 限流 / 日志监控
```

建议第一版优先采用 **Option A 或非常克制的 Option B**，不要因为已有代码就同时承诺所有外部能力。

---

# 5. P1 — Security & Reliability Hardening

## P1-1. Rate Limit 需要从单实例内存升级为可跨实例控制

当前云函数的 rate limit 基于进程内 `Map`。

优点是简单，并且可以限制同一实例内的明显滥用。

但 serverless 环境可能同时存在多个实例，也可能重启，所以这不是可靠的全局限流。

对于会产生成本的接口，建议补充：

```text
按 OPENID / action 的共享限流
provider 额度预算
每日调用上限
异常峰值告警
```

重点关注：

```text
OCR
route
reverseGeocode
subscribe message
invite mutation
```

---

## P1-2. Invite Capability ID 应由可信端生成

当前邀请模型本质上是一种 bearer capability：

> 拥有 invite ID 的用户可以读取对应的公开邀请快照。

公开快照已经主动排除了 creator/responder OpenID，这是正确的；但仍包含：

```text
计划标题
餐厅 / venue
地址
日期与时间
预约信息
```

因此 capability ID 必须不可预测。

客户端当前会优先使用 `crypto.getRandomValues`，这条路径较好；但是兼容 fallback 使用了 `Math.random()`。

同时 server 允许符合格式的 client-supplied invite ID。

正式版建议：

- invite ID 由服务端用 CSPRNG 生成；
- 不再信任客户端提供随机性；
- 客户端生成只作为离线 local invite 标识，不直接成为云端 capability；
- 保留现有 tombstone 机制，避免已撤销 capability ID 被重新注册。

---

## P1-3. OCR 临时文件需要 orphan cleanup 策略

当前 OCR 在 `finally` 中尝试删除上传文件，这是好的实现。

但是删除失败目前只记录 warning。

正式环境建议再加一层：

```text
固定 OCR 上传目录
短 retention policy
定期 orphan sweep
最大文件年龄
容量 / 数量报警
```

从而避免异常情况下私人截图长期留在云存储。

---

## P1-4. 建立真正的 Observability

当前很多失败会：

```text
console.warn
console.error
返回受控错误
```

这对开发足够，但正式服务还需要回答：

```text
今天 OCR 失败率是多少？
地图 provider 有没有变慢？
有多少用户遇到 cloud_not_configured？
邀请冲突率是否异常？
有没有 OCR 文件删除失败积压？
provider 调用成本是否异常？
```

建议逐步加入：

- request / trace ID；
- 结构化错误码统计；
- provider latency；
- success / failure rate；
- quota / cost dashboard；
- 不包含私人正文的最小化 operational logs；
- 高错误率告警。

Local-first 不意味着不需要 operational observability；关键是日志里不要重新收集本来不需要上传的私人生活数据。

---

## P1-5. Backup / Restore 做 transactional E2E 验证

当前备份代码在输入校验方面已经相当谨慎，包括：

- 大小限制；
- collection/item 上限；
- ID 检查；
- 日期、状态、坐标检查；
- prototype pollution 防护；
- 不导出 live GPS、provider credential 等 device-local 信息；
- 不跨设备恢复本地截图路径。

下一步重点不是继续增加 schema check，而是验证：

```text
恢复到一半失败怎么办？
原数据是否仍然存在？
多个 store 是否会进入半新半旧状态？
恢复后 Coupon ↔ Plan 引用是否一致？
```

正式版最好具有：

```text
validate all
  ↓
prepare
  ↓
commit
  ↓
post-restore integrity check
  ↓
失败则 rollback / 保留原 snapshot
```

---

## P1-6. Cloud 功能需要多设备一致性测试

Invite 代码已经对 concurrency 做了很多正确处理：

- creator / responder 角色分离；
- recipient 不能修改计划正文；
- conditional claim；
- planUpdatedAt version check；
- idempotency；
- revoke tombstone。

因此下一步不应继续无限增加 protocol 逻辑，而应该做真实多设备测试：

```text
A 发起邀请
B、C 同时打开
B 确认
C 再确认
A 同时修改计划
弱网重试
应用后台恢复
删除邀请后旧分享再次打开
```

目标是验证数据库真实行为与本地 mock/concurrency test 一致。

---

# 6. P2 — Repository & Release Hygiene

## P2-1. 不再跟踪 `project.private.config.json`

当前该文件已经提交到仓库，虽然现阶段没有发现 API Secret，但从职责上它仍属于开发者本地配置。

建议：

```text
.gitignore:
project.private.config.json
```

然后将当前文件从 Git tracking 中移除。

---

## P2-2. 清理 quickstart 遗留命名

例如 `project.config.json` 中仍存在：

```text
projectname: quickstart-wx-cloud
```

正式项目建议统一为 NiceRice / 有时好饭相关命名，减少 prototype 痕迹。

---

## P2-3. Dependency / Lockfile Policy

`lifeServices` 当前依赖 `wx-server-sdk`，但仓库没有形成明确的 dependency update / lockfile / vulnerability review 过程。

建议 production build 固定依赖版本，并规定：

```text
依赖更新频率
security advisory 处理
lockfile 是否纳入仓库
部署时的可重复安装方式
```

---

## P2-4. 文档状态源收敛

目前已经有：

```text
README.md
ARCHITECTURE.md
项目状态同步.md
公共服务API接入路线.md
V0.2开发验证清单.md
PRODUCTION_READINESS_AUDIT.md
```

建议以后明确：

```text
README                  产品入口
ARCHITECTURE            当前系统事实
PRODUCTION_READINESS    上线差距
项目状态同步            开发过程记录
```

旧状态文档不要继续承担“最终真相”的职责，否则容易与代码漂移。

---

# 7. What Is Already Strong

Production audit 不只是列问题。以下部分不建议推倒重写。

## 7.1 Local-first 默认值

默认不上传私人生活数据，是 NiceRice 最有价值的架构决定之一。

它让外部 API 故障、云环境尚未配置时，核心产品仍然成立。

## 7.2 Client Secret Discipline

天气等客户端长期 credential 当前保持为空，并且已经有 security test 防止真实 key 被重新写回 deployable bundle。

这个原则应继续保持：

> **长期第三方密钥只存在于可信服务端环境。**

## 7.3 Cloud Input Validation

`lifeServices` 已经包含：

```text
request size limit
field allowlist
coordinate validation
provider validation
bounded error messages
response size limit
timeout
OpenID-based caller context
```

这比把第三方 API 直接暴露给页面层成熟得多。

## 7.4 Subscription Recipient Control

服务端不允许客户端任意指定另一个 OpenID 作为消息接收者。

这个约束应保留。

## 7.5 Invite Ownership / Concurrency

邀请协议已经明显超过普通 MVP 水平。

尤其是：

```text
creator 不能替好友确认
recipient 不能修改计划正文
single-responder claim
version check
tombstone
idempotent retry
```

这些都属于正确的 production-oriented defensive design。

## 7.6 Data Lifecycle

本地迁移、reset、截图清理、backup sanitization 已经考虑了很多容易被忽略的失败场景。

特别是“最后删除 encryption secret，避免残余密文永久不可恢复”的处理思路是正确的。

---

# 8. Recommended Remediation Order

建议不要同时重构所有东西。

最有效率的顺序是：

```text
Step 1
统一 test runner + CI
        ↓
以后所有安全修改都有回归保护

Step 2
确定本地 security threat model
替换 / 降级 custom encryption
        ↓
把隐私承诺和真实实现对齐

Step 3
建立 development / trial / formal 配置
移除 formal debug surface
        ↓
形成真正的 release build

Step 4
决定首版 cloud scope
Local-only or Cloud-enhanced
        ↓
只联调真正要上线的外部能力

Step 5
真机 E2E + 多设备 invite testing
        ↓
验证微信运行时真实行为

Step 6
微信后台隐私 / 权限 / 域名 / 模板核验
        ↓
提交审核

Step 7
补 observability / distributed rate limit / cleanup
        ↓
公开扩大用户范围
```

---

# 9. Release Checklist

正式 Release Candidate 可以使用下面这张最小检查表。

### Security & Privacy

```text
[ ] Local-first 行为与 UI 描述一致
[ ] 本地数据保护方案已完成 threat-model review
[ ] 不使用未经验证的 custom cipher 宣称生产级安全
[ ] 客户端 bundle 不包含第三方长期 Secret
[ ] OCR / location / invite 上传都有显式用户边界
[ ] Debug 页面不进入 formal surface
```

### Reliability

```text
[ ] 完整测试命令 PASS
[ ] CI PASS
[ ] storage migration PASS
[ ] backup → reset → restore PASS
[ ] offline / permission denied PASS
[ ] provider timeout / malformed response PASS
[ ] app foreground/background PASS
```

### Cloud — if enabled

```text
[ ] CLOUD_ENV_ID 已配置为 formal env
[ ] lifeServices 已部署
[ ] provider keys 只存在于云端环境变量
[ ] OCR 权限正常
[ ] OCR 临时文件清理验证
[ ] route / geocode 真机验证
[ ] invitation multi-device E2E PASS
[ ] subscription template 真机 PASS
[ ] rate / cost monitoring 已建立
```

### WeChat Release

```text
[ ] app.json 权限与真实使用一致
[ ] 隐私保护指引已更新
[ ] 合法域名已配置
[ ] required private APIs 已核对
[ ] Trial build 真机通过
[ ] Formal build 不依赖 DevTools 特殊设置
```

---

# 10. Go / No-Go Rule

当以下条件全部满足时，可以把状态从：

```text
Functional MVP
```

升级为：

```text
Production Release Candidate
```

条件是：

```text
P0 全部关闭
+ CI 全绿
+ 真机主流程通过
+ 备份恢复通过
+ 正式环境 / 隐私配置通过
+ 所有对用户可见的云功能真实可用或明确关闭
```

在此之前，最准确的状态仍然是：

> **NiceRice 已经具备完整且有工程深度的本地 MVP，但还需要一轮 release engineering 和安全收口，才能进入 production。**

---

# 11. Final Assessment

NiceRice 当前最值得肯定的一点，是它已经过了“继续加功能”的阶段。

现在真正需要做的不是再增加一个页面、一个 scorer 或一个云 API。

而是把已经存在的能力收紧：

```text
能测试
能发布
能失败
能恢复
能解释
能保护用户数据
```

当这些成立时，NiceRice 才真正从一个完成度很高的个人项目，变成一个可以放心交给别人使用的产品。
