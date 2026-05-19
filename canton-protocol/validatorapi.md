# Validator Internal API

**Base URL:** `http://<host>:5003/api/validator`  
**Version:** 0.0.1  
**Source:** [validator-internal.yaml](https://raw.githubusercontent.com/hyperledger-labs/splice/refs/heads/main/apps/validator/src/main/openapi/validator-internal.yaml)

---

## Authentication

所有管理接口需要在请求头中携带 JWT Bearer Token。

```
Authorization: Bearer <token>
```

| Security Scheme | 说明 |
|----------------|------|
| `userAuth` | JWT token，`sub` 字段为被操作用户的 ledger API user name |
| `adminAuth` | JWT Token，`sub` 字段为 validator operator 的 ledger API user name |

**开发环境 Unsafe Token（HS256）：**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
.eyJhdWQiOiJodHRwczovL2NhbnRvbi5uZXR3b3JrLmdsb2JhbCIsInN1YiI6ImxlZGdlci1hcGktdXNlciJ9
.A0VZW69lWWNVsjZmDDpVvr1iQ_dJLga3f-K2bicdtsc
```
Payload: `{ "aud": "https://canton.network.global", "sub": "ledger-api-user" }`

---

## 端点概览

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/readyz` | 无 | Readiness 健康检查 |
| GET | `/livez` | 无 | Liveness 健康检查 |
| GET | `/v0/validator-user` | 无 | 获取 validator operator 公开信息 |
| POST | `/v0/register` | userAuth | 当前用户自助 onboard |
| POST | `/v0/admin/users` | adminAuth | 管理员 onboard 指定用户 |
| GET | `/v0/admin/users` | adminAuth | 列出所有已 onboard 用户 |
| POST | `/v0/admin/users/offboard` | adminAuth | 管理员 offboard 用户 |
| GET | `/v0/admin/participant/identities` | adminAuth | 导出 participant 身份信息 |
| GET | `/v0/admin/participant/global-domain-connection-config` | adminAuth | 获取全局 synchronizer 连接配置 |
| GET | `/v0/admin/domain/data-snapshot` | adminAuth | 获取 validator 域数据快照 |
| GET | `/v0/admin/transfer-preapprovals` | adminAuth | 列出所有 TransferPreapproval 合约 |
| GET | `/v0/admin/transfer-preapprovals/by-party/{receiver-party}` | adminAuth | 查询指定接收方的 TransferPreapproval |
| DELETE | `/v0/admin/transfer-preapprovals/by-party/{receiver-party}` | adminAuth | 取消指定接收方的 TransferPreapproval |
| POST | `/v0/admin/external-party/topology/generate` | adminAuth | 生成外部 party 拓扑交易 |
| POST | `/v0/admin/external-party/topology/submit` | adminAuth | 提交外部 party 拓扑交易 |
| POST | `/v0/admin/external-party/setup-proposal` | adminAuth | 创建 ExternalPartySetupProposal |
| GET | `/v0/admin/external-party/setup-proposal` | adminAuth | 列出所有 ExternalPartySetupProposal |
| POST | `/v0/admin/external-party/setup-proposal/prepare-accept` | adminAuth | 准备接受 SetupProposal 的交易 |
| POST | `/v0/admin/external-party/setup-proposal/submit-accept` | adminAuth | 提交签名后的 SetupProposal 接受交易 |
| GET | `/v0/admin/external-party/balance` | adminAuth | 查询外部 party 余额 |
| POST | `/v0/admin/external-party/transfer-preapproval/prepare-send` | adminAuth | ⚠️ 已废弃：准备 TransferCommand 交易 |
| POST | `/v0/admin/external-party/transfer-preapproval/submit-send` | adminAuth | ⚠️ 已废弃：提交 TransferCommand 交易 |

---

## 健康检查

### GET `/readyz`

Readiness 检查，无需认证。

### GET `/livez`

Liveness 检查，无需认证。

---

## 用户管理

### GET `/v0/validator-user`

获取 validator operator 的公开信息，无需认证。

**响应 200：**
```json
{
  "party_id": "string",
  "user_name": "string",
  "featured": true
}
```

---

### POST `/v0/register`

认证用户自助 onboard。JWT `sub` 作为 ledger API user name，自动分配 Daml party 并初始化钱包合约。

**认证：** `userAuth`

**请求体：** 空对象 `{}`（nullable）

**响应 200：**
```json
{
  "party_id": "string"
}
```

---

### POST `/v0/admin/users`

管理员 onboard 指定用户。

**认证：** `adminAuth`

**请求体：**
```json
{
  "name": "string",
  "party_id": "string",
  "createPartyIfMissing": false
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 用户名，无 `party_id` 时也作为 Party Hint |
| `party_id` | ❌ | 指定已有 party ID；不填则生成新 party |
| `createPartyIfMissing` | ❌ | `true` 时若 party 不存在则自动创建，默认 `false` |

**响应 200：**
```json
{
  "party_id": "string"
}
```

---

### GET `/v0/admin/users`

列出此 validator 上所有已 onboard 的用户名。

**认证：** `adminAuth`

**响应 200：**
```json
{
  "usernames": ["string"]
}
```

---

### POST `/v0/admin/users/offboard`

Offboard 指定用户，归档其钱包 Daml 合约并删除 ledger API 用户（不归档用户自有的其他合约）。

**认证：** `adminAuth`

**Query 参数：**

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `username` | ✅ | string | 要 offboard 的用户名 |

**响应：** `200 OK` / `404 Not Found`

---

## 节点管理

### GET `/v0/admin/participant/identities`

导出 participant 身份信息（`NodeIdentitiesDump`），用于运维和支持场景。

**认证：** `adminAuth`

**响应 200：** `NodeIdentitiesDump` 对象（包含节点密钥、证书等身份数据）

---

### GET `/v0/admin/participant/global-domain-connection-config`

获取全局 synchronizer 的连接配置。

**认证：** `adminAuth`

**响应 200：**
```json
{
  "sequencer_connections": {
    "connections": [
      {
        "sequencer_alias": "string",
        "endpoints": ["string"],
        "transport_security": true
      }
    ],
    "sequencer_trust_threshold": 1,
    "sequencer_liveness_margin": 0,
    "submission_request_amplification": {
      "factor": 1.0,
      "patience_seconds": 0
    }
  }
}
```

---

### GET `/v0/admin/domain/data-snapshot`

获取 validator 的域数据快照（party 列表、ACS、节点身份）。

**认证：** `adminAuth`

**Query 参数：**

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `timestamp` | ✅ | string | ISO-8601 UTC 时间，如 `2024-01-01T00:00:00.000Z` |
| `migration_id` | ❌ | int64 | 当前 migration ID |
| `force` | ❌ | boolean | `true` 则跳过时间戳合法性检查，不推荐生产使用 |

**响应 200：**
```json
{
  "data_snapshot": {
    "participant": { },
    "participant_users": { },
    "acs_snapshot": "<base64>",
    "acs_timestamp": "string",
    "dars": [{ "hash": "string", "content": "<base64>" }],
    "migration_id": 0,
    "domain_id": "string",
    "created_at": "string",
    "synchronizer_was_paused": false,
    "separate_payload_files": false,
    "acs_format": "admin_api"
  },
  "migration_id": 0
}
```

`acs_format` 枚举值：`admin_api` | `ledger_api`

---

## Transfer Preapproval

### GET `/v0/admin/transfer-preapprovals`

列出当前 validator operator 作为 provider 的所有 `TransferPreapproval` 合约。

**认证：** `adminAuth`

**响应 200：**
```json
{
  "contracts": [ /* ContractWithState[] */ ]
}
```

---

### GET `/v0/admin/transfer-preapprovals/by-party/{receiver-party}`

查询指定接收方的 `TransferPreapproval` 合约。

**认证：** `adminAuth`

**Path 参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `receiver-party` | ✅ | 接收方 party ID |

**响应：** `200 OK` / `404 Not Found`

```json
{
  "transfer_preapproval": { /* ContractWithState */ }
}
```

---

### DELETE `/v0/admin/transfer-preapprovals/by-party/{receiver-party}`

取消（归档）指定接收方的 `TransferPreapproval` 合约。

**认证：** `adminAuth`

**Path 参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `receiver-party` | ✅ | 接收方 party ID |

**响应：** `200 OK` / `404 Not Found`

---

## 外部 Party 管理

外部 party 使用自持私钥（ED25519）进行离线签名，validator 负责提交已签名的拓扑和 Daml 交易。

### 外部 Party Onboard 流程

```
1. generate topology  →  2. submit topology  →  3. create setup-proposal
→  4. prepare-accept  →  5. 外部签名  →  6. submit-accept
→  TransferPreapproval 合约创建完成
```

---

### POST `/v0/admin/external-party/topology/generate`

生成外部 party 所需的 3 条拓扑交易（namespace、party-to-participant、party-to-key），返回每条交易及其待签名 hash。

**认证：** `adminAuth`

**请求体：**
```json
{
  "party_hint": "my-external-party",
  "public_key": "<hex-encoded ed25519 public key>"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `party_hint` | ✅ | Party 名称提示，实际 ID = hint + 公钥指纹 |
| `public_key` | ✅ | hex 编码的 ED25519 公钥（32 字节） |

**响应 200：**
```json
{
  "party_id": "my-external-party::1220...",
  "topology_txs": [
    {
      "topology_tx": "<base64 encoded topology transaction>",
      "hash": "<hex-encoded hash>"
    }
  ]
}
```

---

### POST `/v0/admin/external-party/topology/submit`

提交已签名的拓扑交易，将外部 party 注册到 Canton 网络。

**认证：** `adminAuth`

**请求体：**
```json
{
  "public_key": "<hex-encoded ed25519 public key>",
  "signed_topology_txs": [
    {
      "topology_tx": "<base64，与 generate 返回一致>",
      "signed_hash": "<hex-encoded ed25519 签名，格式 r||s>"
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `public_key` | ✅ | hex 编码 ED25519 公钥 |
| `signed_topology_txs[].topology_tx` | ✅ | 原样传回 generate 返回的 base64 交易 |
| `signed_topology_txs[].signed_hash` | ✅ | 对 generate 返回 hash 的 ED25519 签名（hex，r\|\|s） |

**响应 200：**
```json
{
  "party_id": "my-external-party::1220..."
}
```

---

### POST `/v0/admin/external-party/setup-proposal`

由 validator operator 为外部 party 创建 `ExternalPartySetupProposal` 合约，随后外部 party 需要签名接受。

**认证：** `adminAuth`

**请求体：**
```json
{
  "user_party_id": "my-external-party::1220..."
}
```

**响应：** `200 OK` / `404 Not Found` / `409 Conflict`（已存在）

```json
{
  "contract_id": "string"
}
```

---

### GET `/v0/admin/external-party/setup-proposal`

列出所有 `ExternalPartySetupProposal` 合约。

**认证：** `adminAuth`

**响应 200：**
```json
{
  "contracts": [ /* ContractWithState[] */ ]
}
```

---

### POST `/v0/admin/external-party/setup-proposal/prepare-accept`

准备接受 `ExternalPartySetupProposal` 的 Daml 交易，返回待签名的 `tx_hash`。

**认证：** `adminAuth`

**请求体：**
```json
{
  "contract_id": "string",
  "user_party_id": "my-external-party::1220...",
  "verbose_hashing": false
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `contract_id` | ✅ | create setup-proposal 返回的合约 ID |
| `user_party_id` | ✅ | 外部 party ID |
| `verbose_hashing` | ❌ | `true` 则返回哈希细节，仅用于调试 |

**响应 200：**
```json
{
  "transaction": "<base64 encoded PreparedTransaction>",
  "tx_hash": "<hex-encoded transaction hash>",
  "hashing_details": "string (仅 verbose_hashing=true 时存在)"
}
```

> `transaction` 对应 protobuf `PreparedTransaction` 定义，可用标准 protobuf 库解码。

---

### POST `/v0/admin/external-party/setup-proposal/submit-accept`

提交外部 party 签名后的接受交易，成功后创建 `TransferPreapproval` 合约。

**认证：** `adminAuth`

**请求体：**
```json
{
  "submission": {
    "party_id": "my-external-party::1220...",
    "transaction": "<base64，prepare-accept 返回的原值>",
    "signed_tx_hash": "<hex-encoded ed25519 签名，格式 r||s>",
    "public_key": "<hex-encoded ed25519 公钥>"
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `submission.party_id` | ✅ | 外部 party ID |
| `submission.transaction` | ✅ | prepare-accept 返回的 base64 交易（原样传回） |
| `submission.signed_tx_hash` | ✅ | 对 `tx_hash` 的 ED25519 签名（hex，r\|\|s，64 字节） |
| `submission.public_key` | ✅ | hex 编码 ED25519 公钥（32 字节） |

**响应：** `200 OK` / `404 Not Found`

```json
{
  "transfer_preapproval_contract_id": "string",
  "update_id": "string"
}
```

---

### GET `/v0/admin/external-party/balance`

查询外部 party 的 Amulet 余额明细。

**认证：** `adminAuth`

**Query 参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `party_id` | ✅ | 外部 party ID |

**响应：** `200 OK` / `404 Not Found`

```json
{
  "party_id": "string",
  "total_unlocked_coin": "string",
  "total_locked_coin": "string",
  "total_coin_holdings": "string",
  "accumulated_holding_fees_unlocked": "string",
  "accumulated_holding_fees_locked": "string",
  "accumulated_holding_fees_total": "string",
  "total_available_coin": "string",
  "computed_as_of_round": 0
}
```

---

## ⚠️ 已废弃接口

以下接口已废弃，建议使用 `setup-proposal` 流程替代。

### POST `/v0/admin/external-party/transfer-preapproval/prepare-send`

为外部 party 准备 `TransferCommand` 交易（从外部 party 向指定接收方转账）。

**认证：** `adminAuth`

**请求体：**
```json
{
  "sender_party_id": "string",
  "receiver_party_id": "string",
  "amount": 10.0,
  "expires_at": "2024-01-01T00:00:00Z",
  "nonce": 0,
  "verbose_hashing": false,
  "description": "string"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `sender_party_id` | ✅ | 外部发送方 party ID |
| `receiver_party_id` | ✅ | 接收方 party ID |
| `amount` | ✅ | 转账金额（CC） |
| `expires_at` | ✅ | 交易过期时间（ISO-8601） |
| `nonce` | ✅ | TransferCommand 计数器，从 0 开始每次 +1；可从 Scan `/v0/transfer-command-counter/{party}` 读取 |
| `verbose_hashing` | ❌ | 调试用，默认 `false` |
| `description` | ❌ | 备注 |

**响应 200：**
```json
{
  "transaction": "<base64 PreparedTransaction>",
  "tx_hash": "<hex>",
  "transfer_command_contract_id_prefix": "string",
  "hashing_details": "string"
}
```

---

### POST `/v0/admin/external-party/transfer-preapproval/submit-send`

提交 prepare-send 生成的已签名交易。仅等待 `TransferCommand` 合约创建，实际转账由 SV 自动化执行。

**认证：** `adminAuth`

**请求体：**
```json
{
  "submission": {
    "party_id": "string",
    "transaction": "<base64>",
    "signed_tx_hash": "<hex r||s>",
    "public_key": "<hex>"
  }
}
```

**响应 200：**
```json
{
  "update_id": "string"
}
```

---

## 数据类型

### `ExternalPartySubmission`

外部 party 签名提交的通用结构，用于 `submit-accept` 和 `submit-send`。

```json
{
  "party_id": "string",
  "transaction": "<base64 PreparedTransaction>",
  "signed_tx_hash": "<hex ed25519 signature r||s>",
  "public_key": "<hex ed25519 public key>"
}
```

### `ContractWithState`

合约及其状态，来自 `common-internal.yaml`。

### `ContractId`

合约 ID 字符串，来自 `common-external.yaml`。

### `NodeIdentitiesDump`

节点身份数据（密钥、证书等），来自 `common-internal.yaml`。

### `DomainMigrationDump`

```json
{
  "participant": { /* NodeIdentitiesDump */ },
  "participant_users": { /* ParticipantUsersData */ },
  "acs_snapshot": "<base64>",
  "acs_timestamp": "string",
  "dars": [{ "hash": "string", "content": "<base64>" }],
  "migration_id": 0,
  "domain_id": "string",
  "created_at": "string",
  "synchronizer_was_paused": false,
  "separate_payload_files": false,
  "acs_format": "admin_api | ledger_api"
}
```

### `SequencerConnections`

```json
{
  "connections": [
    {
      "sequencer_alias": "string",
      "endpoints": ["<host:port>"],
      "transport_security": true
    }
  ],
  "sequencer_trust_threshold": 1,
  "sequencer_liveness_margin": 0,
  "submission_request_amplification": {
    "factor": 1.0,
    "patience_seconds": 0
  }
}
```

---

## ED25519 签名说明

所有需要外部 party 签名的接口，均遵循以下规范：

| 项目 | 规范 |
|------|------|
| 算法 | ED25519 |
| 公钥格式 | hex 编码，原始 32 字节（SPKI DER 末尾 32 字节） |
| 签名格式 | hex 编码，原始 64 字节（r\|\|s 拼接，无 ASN.1 包装） |
| 待签名数据 | prepare 接口返回的 `tx_hash`（hex 解码后的原始字节） |

**Node.js 示例：**
```js
const hashBytes = Buffer.from(tx_hash, 'hex');
const signature = crypto.sign(null, hashBytes, privateKey).toString('hex');
```
