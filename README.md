# @tkwwf/ts-domain-client

TypeScript Domain 客户端 SDK，为 [TKWF.Domain](https://github.com/TKW-Framework/Domain) 框架设计的全功能前端客户端。
同时支持 **GraphQL**（HotChocolate 服务端）和 **REST** 两种传输协议。

---

## 安装

```json
// package.json
{
  "dependencies": {
    "@tkwwf/ts-domain-client": "file:path/to/ts-domain-client"
  }
}
```

## 快速开始

### GraphQL 模式（默认）

```typescript
import { DomainHostClient } from "@tkwwf/ts-domain-client";

// 匿名访问
const host = DomainHostClient.init("my-app", {
  endpoint: "/graphql",
});

const user = host.GetGuest();
const data = await user.query("getProducts", { page: 1 });
```

### REST 模式

```typescript
const host = DomainHostClient.init("my-app", {
  endpoint: "http://localhost:5000",   // 后端 base URL
  transportType: "rest",               // 切换为 REST 协议
  restPathPrefix: "/api",              // URL 前缀，默认 "/api"
});

const user = host.GetGuest();

// 查询 → GET  http://localhost:5000/api/getProducts?page=1
const data = await user.query("getProducts", { page: 1 });

// 变更 → POST http://localhost:5000/api/createProduct (JSON body)
const result = await user.mutate("createProduct", { name: "test" });
```

#### URL 映射规则

| 操作类型 | HTTP 方法 | URL 格式 |
|----------|-----------|----------|
| `query` | GET | `{url}{pathPrefix}/{field}?{variables}` |
| `mutation` | POST | `{url}{pathPrefix}/{field}` (JSON body) |

可通过 `restUrlMap` 覆盖特定字段的 URL 路径：

```typescript
const host = DomainHostClient.init("my-app", {
  endpoint: "http://localhost:5000",
  transportType: "rest",
  restUrlMap: {
    getUsers:        "/api/v2/merchant/users",
    loginByPassword: "/auth/login",
  },
});
```

---

## 使用方法

### 登录与认证

```typescript
const host = DomainHostClient.init("my-app", {
  endpoint: "/graphql",
  storage: localStorage, // sessionStorage（默认）或 localStorage
});

const user = host.GetGuest();

// 密码登录
const payload = await user.loginAs("admin", "password123");

// 短信验证码登录
const smsPayload = await user.loginBySms("13800138000", "123456");

// 统一上下文登录（支持多种认证方式）
const ctxPayload = await user.loginByContext("admin", "credential", {
  authType: "Password",    // Password | Sms | QrCode | Token
  loginFrom: "PcWeb",
  deviceId: "device-xxx",
});
```

### 使用 `Use()` 调用 API（推荐）

`Use()` 返回一个 Proxy，方法名自动映射到 GraphQL field 或 REST 端点。支持 `await`。

```typescript
interface IApi {
  getUser(args: { id: number }): Promise<{ id: number; name: string }>;
  createUser(args: { name: string; email: string }): Promise<{ id: number }>;
}

const api = user.Use<IApi>();

const userData = await api.getUser({ id: 1 });
const newUser = await api.createUser({ name: "Alice", email: "alice@test.com" });
```

**方法名 → 操作类型映射规则：**

| 前缀 | 操作类型 |
|------|----------|
| `create*`, `update*`, `delete*`, `add*`, `remove*` | mutation |
| `lock*`, `unlock*`, `reset*` | mutation |
| 其他 | query |

### 使用 `Call()` 链式调用

```typescript
const api = user.Call("merchant");
api.getUser({ id: 1 })
  .onSuccess((data) => console.log("用户:", data))
  .onError((err) => console.error("失败:", err.message));
```

### 从存储恢复会话（`GetUser`）

```typescript
const host = DomainHostClient.init("my-app", {
  endpoint: "/graphql",
  storage: localStorage,
});

try {
  const user = host.GetUser(); // 从 storage 恢复 sessionKey
  const api = user.Use<IApi>();
  const data = await api.getUser({ id: 1 });
} catch (err) {
  if (err.code === "AUTH_REQUIRED") {
    // 未登录，引导到登录页
  }
}
```

### 请求签名

```typescript
const host = DomainHostClient.init("my-app")
  .onSign(({ url, method, headers, body, timestamp }) => {
    const signature = computeSignature(body, timestamp);
    return { "X-Signature": signature, "X-Timestamp": timestamp };
  });
```

### 全局错误处理

```typescript
const host = DomainHostClient.init("my-app")
  .onGlobalError((error) => {
    console.error(`[${error.code}] ${error.message}`);
  });
```

### 心跳检测

```typescript
const host = DomainHostClient.init("my-app")
  .onPong(5, (status) => {
    // 每 5 分钟 ping 一次（仅用户活跃时）
    if (!status.isAuthenticated) {
      // 会话已过期，跳转登录
    }
  });
```

### 请求/响应拦截器

```typescript
const host = DomainHostClient.init("my-app")
  .onRequest((req) => {
    console.log(`→ ${req.type} ${req.field}`);
  })
  .onResponse((res, req) => {
    console.log(`← ${req.field} (${res.durationMs}ms)`);
  });
```

### 资源释放

```typescript
// React 中
useEffect(() => {
  return () => host.dispose();
}, []);
```

### REST 文件上传

RestTransport 独占的文件上传能力（GraphQLTransport 不支持）：

```typescript
import { RestTransport } from "@tkwwf/ts-domain-client";

const transport = new RestTransport({
  url: "http://localhost:5000",
  pathPrefix: "/api",
});

// 直接上传文件
const result = await transport.uploadFile<{ url: string }>(
  "merchant/upload",   // URL 路径：POST /api/merchant/upload
  fileBlob,            // File 或 Blob
  "file",              // FormData 字段名（默认 "file"）
  { category: "avatar" }, // 额外 FormData 字段
  sessionKey,          // 会话 Key
);

// 或通过 DomainHostClient 获取 transport 实例
// 注意：uploadFile 需要直接操作 transport 对象，不经过 Use()/Call()
```

> `uploadFile()` 走独立的 `multipart/form-data` POST 路径，不经过 `executeHttp()` 通用流程，因此不会触发重试逻辑。

---

## 设计方案

### 架构分层

```
┌──────────────────────────────────────────────────┐
│                  DomainHostClient                  │  ← 顶层工厂（入口）
│   init() → GetGuest() / GetUser() / dispose()     │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│                  DomainClientUser                  │  ← 用户会话管理
│   loginAs() / loginBySms() / loginByContext()     │
│   Use() / Call() / query() / mutate() / ping()    │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│                    ServiceProxy                    │  ← 动态代理
│   createUse() / createCall()                      │
│   方法名 → query/mutation 自动映射                │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│               Transport 接口层                      │  ← 多协议抽象
│   execute<T>(operation)                           │
└──────────┬──────────────────────┬────────────────┘
           │                      │
┌──────────▼──────────┐  ┌───────▼─────────────────┐
│   GraphQLTransport   │  │      RestTransport        │
│  GraphQL 文档构建    │  │  GET ↔ query / POST ↔    │
│  + HTTP 请求         │  │  mutation + 文件上传      │
└──────────┬──────────┘  └───────┬─────────────────┘
           │                      │
           └──────────┬──────────┘
                      │
┌─────────────────────▼────────────────────────────┐
│                BaseHttpTransport                   │  ← 通用 HTTP 生命周期
│  onRequest → signHandler → fetch + retry →       │
│  onResponse                                      │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│               DomainClientError                    │  ← 类型化错误码体系
│  NETWORK_ERROR / AUTH_EXPIRED / FORBIDDEN / ...   │
└──────────────────────────────────────────────────┘
```

### 传输协议抽象

核心设计思想：**Transport 接口** 定义了统一的 `execute()` 契约，上层（ServiceProxy、DomainClientUser）无需感知底层传输协议。

```typescript
interface Transport {
  execute<T>(operation: {
    field: string;          // 操作名称（GraphQL field 或 REST URL 路径段）
    type: "query" | "mutation";
    variables?: Record<string, unknown>;
    sessionKey?: string;
    signal?: AbortSignal;
    selection?: string;     // GraphQL 子字段选择（仅 GraphQLTransport 使用）
  }): Promise<T>;
}
```

`DomainHostClient.init()` 通过 `transportType: "graphql" | "rest"` 选择实现，应用层代码无需改动。

### BaseHttpTransport — 通用 HTTP 生命周期

`BaseHttpTransport` 是抽象基类，封装了所有 HTTP 传输共享的生命周期：

1. **`onRequest` 拦截器** — 请求前回调，可修改上下文
2. **`signHandler`** — 请求签名，注入自定义 header
3. **`fetch + 指数退避重试`** — 支持可配置的重试策略 + jitter
4. **`onResponse` 拦截器** — 响应后回调，记录耗时

子类只需实现两个抽象方法：
- `execute()` — 构建协议特定的请求体（GraphQL 文档 或 REST URL+JSON）
- `parseResponse()` — 从 HTTP 响应 JSON 中提取结果

### GraphQLTransport

- 自动构建 GraphQL 文档（变量声明、传入、字段选择）
- 自动推断变量 GraphQL 类型（`String!`, `Int!`, `Float!`, `Boolean!`, `[Type]`, `JSON`）
- 支持 `selection` 子字段选择（HotChocolate 必须）
- 始终使用 `POST` 方法

### RestTransport

- `query` → `GET`，`mutation` → `POST`，与 C# `Domain.ApiClient.Rest` 命名约定一致
- URL 格式：`{base}/{pathPrefix}/{field}`，默认 pathPrefix 为 `/api`
- 支持 `urlMap` 字段级 URL 覆盖
- 额外提供 `uploadFile()` 文件上传方法（独占，GraphQL 不支持）

### 动态代理（ServiceProxy）

- `Use()` — thenable Proxy，支持 `await` / `.onSuccess()` / `.onError()`
- `Call()` — 回调 Proxy（非 thenable），`.onSuccess()` / `.onError()`
- 方法名前缀启发式判断 query/mutation
- `selectionMap` — 自动附加子字段选择（GraphQL 模式）
- `explicitMutations` — 覆盖前缀启发式判断

### 类型化错误码

| 错误码 | HTTP 状态码 | GraphQL 扩展码 | 说明 |
|--------|-------------|----------------|------|
| `NETWORK_ERROR` | — | — | 网络故障（可重试） |
| `AUTH_EXPIRED` | 401 | `AUTH_FAILED` | 会话过期/未授权 |
| `AUTH_REQUIRED` | — | — | 需要登录（GetUser 无 session） |
| `FORBIDDEN` | 403 | `FORBIDDEN` | 权限不足 |
| `NOT_FOUND` | 404 | `NOT_FOUND` | 资源不存在 |
| `CONFLICT` | 409 | `CONFLICT` | 数据冲突 |
| `RATE_LIMITED` | 429 | — | 被限流 |
| `TIMEOUT` | 408/504 | `TIMEOUT` | 超时 |
| `VALIDATION_ERROR` | — | `VALIDATION_ERROR` | 参数校验失败 |
| `SERVER_ERROR` | 500+ | — | 服务端错误（可重试） |
| `CANCELLED` | — | — | 请求被取消 |
| `UNKNOWN` | — | — | 未分类错误 |

---

## 核心模块

### ChainablePromise / ChainableBuilder

**ChainablePromise**（Use）：
- `then` / `catch` 可用（thenable）
- `await` 可用
- `.onSuccess(fn)` — 成功回调
- `.onError(fn)` — 错误回调（错误继续传播）
- 支持全局错误处理器

**ChainableBuilder**（Call）：
- 非 thenable（无 `then`）
- `.onSuccess(fn)` — 成功回调
- `.onError(fn)` — 错误回调（错误被吞掉，不传播）

### Pager — 分页 URL 构建器

```typescript
const pager = new Pager({
  page: 2,
  pageSize: 20,
  total: 95,
  baseUrl: "/products",
  extraParams: { status: "active" },
});

pager.isFirst    // false
pager.isLast     // false
pager.prevPage   // "/products?page=1&pageSize=20&status=active"
pager.nextPage   // "/products?page=3&pageSize=20&status=active"
pager.lastPage   // "/products?page=5&pageSize=20&status=active"
pager.pages      // [1, 2, 3, 4, 5]
pager.withPageSize(50) // "/products?page=1&pageSize=50&status=active"
```

### QueryString — URL 查询参数字符串工具

```typescript
// 类型化解析
const filters = QueryString.parse({
  page:   { type: Number, default: 1 },
  status: { type: String, default: "active" },
  tags:   { transform: (raw) => raw.split(",") },
}, "?page=2&status=inactive&tags=a,b,c");
// → { page: 2, status: "inactive", tags: ["a", "b", "c"] }

// 构建查询字符串
QueryString.composite({ page: 1, status: "active" });
// → "?page=1&status=active"

// 推送到 URL（不刷新页面）
QueryString.push({ page: 3, status: "active" });
```

## SSR 支持

- `DomainClientUser` 自动检测 `sessionStorage` 可用性，不可用时使用内存存储
- `DomainHostClient` 的心跳监测在 SSR 环境自动跳过
- `QueryString.parse` 在无 `window` 环境可传入 `searchString` 参数

## 重试策略

默认对 `NETWORK_ERROR` 和 `SERVER_ERROR` 进行最多 3 次重试：

```typescript
const host = DomainHostClient.init("my-app", {
  endpoint: "/graphql",
  retry: {
    maxAttempts: 5,          // 最多重试次数
    baseDelaySeconds: 2,     // 初始延迟（指数增长）
    maxDelaySeconds: 30,     // 最大延迟
    jitter: true,            // 随机抖动防雪崩
    retryOn: ["NETWORK_ERROR", "SERVER_ERROR", "RATE_LIMITED"],
  },
});
```

## SSR 支持

- `DomainClientUser` 自动检测 `sessionStorage` 可用性，不可用时使用内存存储
- `DomainHostClient` 的心跳监测在 SSR 环境自动跳过
- `QueryString.parse` 在无 `window` 环境可传入 `searchString` 参数

## 开发

```bash
npm test       # 运行测试（127 tests across 7 test files）
npm run test   # vitest
```

## 参考

### 完整示例

DMP-Lite.AdminWeb 项目包含一份覆盖 SDK 所有场景的模板文件：

```
DMP-Lite.Merchant.AdminWeb/src/templates/ts-domain-client-examples.ts
```

涵盖以下场景（每个场景标注测试状态）：

| 部分 | 场景 | 状态 |
|------|------|------|
| 初始化 | GraphQL / REST / 自定义重试 | ✅ 测试通过 |
| 认证 | 密码登录 / 短信登录 / Context 登录 / 安全登录 / 安全注册 / 登出 | ✅/⏳/❌ |
| 会话 | 恢复会话 / 心跳 / 手动 Ping | ✅ |
| 业务 API | Use<T>() / Call() / 通用 query/mutate | ✅ |
| 错误处理 | 按错误码分发 / 全局处理器 | ✅ |
| 拦截器 | 请求/响应日志 / 请求签名 | ✅ |
| Crypto | PBKDF2 / HMAC / 编码转换 | ✅ |
| 工具类 | Pager / QueryString | ✅ |
| React 集成 | 资源释放 / useRpcQuery | ✅ |

## 许可

内部使用。
