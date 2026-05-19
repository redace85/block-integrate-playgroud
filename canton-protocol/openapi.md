# Canton Ledger API v2 接口分类汇总

共 **47 个路径、约 65 个方法**。

---

## 一、Commands — 命令提交（同步 & 异步）

| 路径 | 方法 | 说明 |
|---|---|---|
| `/v2/commands/submit-and-wait` | POST | 提交命令并同步等待完成 |
| `/v2/commands/submit-and-wait-for-transaction` | POST | 提交并等待返回 Transaction |
| `/v2/commands/submit-and-wait-for-reassignment` | POST | 提交并等待 Reassignment |
| `/v2/commands/submit-and-wait-for-transaction-tree` | POST | 提交并等待 Transaction Tree |
| `/v2/commands/async/submit` | POST | 异步提交命令 |
| `/v2/commands/async/submit-reassignment` | POST | 异步提交 Reassignment |
| `/v2/commands/completions` | POST | 查询命令完成情况（流式） |

---

## 二、Interactive Submission — 交互式提交（两阶段）

| 路径 | 方法 | 说明 |
|---|---|---|
| `/v2/interactive-submission/prepare` | POST | 准备交易（第一阶段） |
| `/v2/interactive-submission/execute` | POST | 执行交易（第二阶段，异步） |
| `/v2/interactive-submission/executeAndWait` | POST | 执行并同步等待 |
| `/v2/interactive-submission/executeAndWaitForTransaction` | POST | 执行并等待 Transaction |
| `/v2/interactive-submission/preferred-package-version` | GET | 获取首选 package 版本 |
| `/v2/interactive-submission/preferred-packages` | POST | 查询首选 packages |

---

## 三、Updates — 账本更新/事务查询

| 路径 | 方法 | 说明 |
|---|---|---|
| `/v2/updates` | POST | 流式获取 updates（含 transactions/reassignments） |
| `/v2/updates/flats` | POST | 流式获取 flat transactions |
| `/v2/updates/trees` | POST | 流式获取 transaction trees |
| `/v2/updates/transaction-by-offset` | POST | 按 offset 查 flat transaction |
| `/v2/updates/update-by-offset` | POST | 按 offset 查 update |
| `/v2/updates/transaction-tree-by-offset/{offset}` | GET | 按 offset 查 transaction tree |
| `/v2/updates/transaction-by-id` | POST | 按 ID 查 flat transaction |
| `/v2/updates/update-by-id` | POST | 按 ID 查 update |
| `/v2/updates/transaction-tree-by-id/{update-id}` | GET | 按 ID 查 transaction tree |

---

## 四、State — 账本状态

| 路径 | 方法 | 说明 |
|---|---|---|
| `/v2/state/active-contracts` | POST | 获取活跃合约集（ACS） |
| `/v2/state/connected-synchronizers` | GET | 获取已连接的 Synchronizers |
| `/v2/state/ledger-end` | GET | 获取账本末尾 offset |
| `/v2/state/latest-pruned-offsets` | GET | 获取最新裁剪 offsets |

---

## 五、Events — 事件查询

| 路径 | 方法 | 说明 |
|---|---|---|
| `/v2/events/events-by-contract-id` | POST | 按合约 ID 查询事件 |

---

## 六、Contracts — 合约查询

| 路径 | 方法 | 说明 |
|---|---|---|
| `/v2/contracts/contract-by-id` | POST | 按 ID 查询合约 |

---

## 七、Packages & DARs — 包管理

| 路径 | 方法 | 说明 |
|---|---|---|
| `/v2/dars/validate` | POST | 验证 DAR 文件 |
| `/v2/dars` | POST | 上传 DAR 文件 |
| `/v2/packages` | GET / POST | 列出 / 上传 package |
| `/v2/packages/{package-id}` | GET | 下载指定 package |
| `/v2/packages/{package-id}/status` | GET | 查询 package 状态 |
| `/v2/package-vetting` | GET / POST | 查询 / 提交 package vetting |

---

## 八、Parties — 参与方管理

| 路径 | 方法 | 说明 |
|---|---|---|
| `/v2/parties` | GET / POST | 列出 / 分配参与方 |
| `/v2/parties/{party}` | GET / PATCH | 查询 / 更新参与方 |
| `/v2/parties/participant-id` | GET | 获取 participant ID |
| `/v2/parties/external/allocate` | POST | 分配外部参与方 |
| `/v2/parties/external/generate-topology` | POST | 生成外部参与方拓扑 |

---

## 九、Users — 用户管理

| 路径 | 方法 | 说明 |
|---|---|---|
| `/v2/users` | GET / POST | 列出 / 创建用户 |
| `/v2/users/{user-id}` | GET / DELETE / PATCH | 查询 / 删除 / 更新用户 |
| `/v2/authenticated-user` | GET | 获取当前认证用户 |
| `/v2/users/{user-id}/rights` | GET / POST / PATCH | 查询 / 授予 / 撤销权限 |
| `/v2/users/{user-id}/identity-provider-id` | PATCH | 修改用户的身份提供商 |

---

## 十、Identity Providers (IDPs) — 身份提供商管理

| 路径 | 方法 | 说明 |
|---|---|---|
| `/v2/idps` | GET / POST | 列出 / 创建 IDP |
| `/v2/idps/{idp-id}` | GET / DELETE / PATCH | 查询 / 删除 / 更新 IDP |

---

## 十一、Version — 版本信息

| 路径 | 方法 | 说明 |
|---|---|---|
| `/v2/version` | GET | 获取 Ledger API 版本信息 |

---

**总结：** 这是 Canton/Daml **Ledger API v2** 的完整 OpenAPI 规范，核心围绕：提交命令、查询账本状态/事务、管理合约与包、以及用户/参与方/身份认证的管理。
