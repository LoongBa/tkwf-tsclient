# @tkwf/tsclient

TypeScript Domain 客户端 SDK，为 [TKWF](https://github.com/LoongBa/TKW.Framework) 框架设计的全功能前端客户端。
同时支持 **GraphQL**（HotChocolate 服务端）和 **REST** 两种传输协议。

---

## 安装

```json
// package.json
{
  "dependencies": {
    "@tkwf/tsclient": "^1.0.0"
  }
}
```

## 快速开始

### 1. 全局配置（应用入口）

把 `Tkwf.configure()` 放在应用入口文件（如 `main.tsx`、`app.ts`、`layout.tsx`），**只配置一次**：

```typescript
import { Tkwf } from "@tkwf/tsclient";

// 应用入口（如 main.tsx）
Tkwf.configure("default", {
  endpoint: "/graphql",
  storage: localStorage,          // ← 会话持久化方式（见下文 §1.2）
  onUnauthorized: () => { window.location.href = "/login"; },
  onGlobalError: (err) => { showToast(err.message); },
  onSign: (ctx) => ({ "X-Signature": computeSignature(ctx.body, ctx.timestamp) }),
  onPong: { intervalMinutes: 5, handler: (status) => {
    if (!status.isAuthenticated) redirectToLogin();
  }},
});

// 多场景支持（如不同商户隔离）
Tkwf.configure("merchant-a", {
  endpoint: "/merchant-a/graphql",
  storage: sessionStorage,
  onUnauthorized: () => { window.location.href = "/merchant/login"; },
});
```

#### 1.1 会话生命周期

```
login() → 服务端返回 sessionKey → 自动持久化到 storage → 页面刷新
  → GetUser() 从 storage 恢复 sessionKey → 正常调用 API
  → logout() → 清除 storage 中的 sessionKey
```

#### 1.2 会话持久化方式（storage）

| 选项 | 说明 | 适用场景 |
|------|------|---------|
| `sessionStorage`（默认） | 关闭 tab 后 session 自动清除 | 安全要求较高的场景 |
| `localStorage` | 关闭浏览器后 session 仍保留 | 需要保持登录状态 |
| **自定义 Storage** | 实现 `{ getItem, setItem, removeItem }` | 从 cookie 读取、加密存储等 |

> **JWT 外部 IdP 会话（v1.0.12+）**：默认建议 `sessionStorage`。外部 IdP 登录产生
> access（2h）+ refresh（30d rotation）JWT 对；若用 `localStorage` 持久化，需自行评估 XSS
> 暴露风险——**Bearer 凭据被窃取即 30 天有效**，与可单点吊销的 sessionKey 根本不同（见"外部 IdP 登录"）。

**自定义 Storage 示例**（从 cookie 读写 sessionKey）：

```typescript
import { Tkwf } from "@tkwf/tsclient";

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=86400`;
}

function removeCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0`;
}

const cookieStorage: Storage = {
  getItem: (key) => getCookie(key),
  setItem: (key, value) => setCookie(key, value),
  removeItem: (key) => removeCookie(key),
  get length() { return document.cookie.split(";").length; },
  key: (index) => document.cookie.split(";")[index]?.split("=")[0]?.trim() ?? null,
  clear: () => { /* 按需实现 */ },
};

Tkwf.configure("default", {
  endpoint: "/graphql",
  storage: cookieStorage,  // ← 使用 cookie 持久化 sessionKey
  // ...
});
```

### 2. 页面中使用

配置完成后，**任何页面或组件**中直接使用 `Tkwf.User` 或 `Tkwf.Guest`：

```typescript
// 认证用户 —— 预先验证身份，无本地 session 时触发 onUnauthorized
const profile = await Tkwf.User.Use<UserInfoService>().getMyProfile();

// 游客 —— 不预先验证，直接调用，是否允许由服务端裁决
const products = await Tkwf.Guest.Use<IPublicApi>().getProducts();

// 多场景切换
const user = Tkwf.GetUser("merchant-a");
const data = await user.Use<IMerchantApi>().getList({ page: 1 });

// 链式回调（onSuccess / onError）
Tkwf.User.Use<UserInfoService>()
  .getMyProfile()
  .onSuccess((data) => setProfile(data))
  .onError((err) => toast(err.message));

// 查询构建器
const orders = await Tkwf.User.Query<OrderEntity>("Order")
  .where(o => o.status.eq("Paid"))
  .toArray();
```

### 3. 完整登录流程

```typescript
import { Tkwf } from "@tkwf/tsclient";

// 登录页
async function handleLogin(userName: string, password: string) {
  const guest = Tkwf.Guest;                          // 游客身份
  const payload = await guest.loginAs(userName, password);
  // 成功后，sessionKey 自动持久化到 storage（由 SDK 内部完成）
  // 后续页面刷新后，Tkwf.User.Use<>() 会自动恢复会话
}

// 其他页面
async function loadProfile() {
  // Tkwf.User 内部自动从 storage 恢复 sessionKey
  // 无 sessionKey 时触发 onUnauthorized（跳转登录页）
  const profile = await Tkwf.User.Use<UserInfoService>().getMyProfile();
}

// 注销
async function handleLogout() {
  const user = Tkwf.User;
  await user.Use<IApi>().logout({ broadcast: true });
  // sessionKey 已清除，再次访问 Tkwf.User 会触发 onUnauthorized
}
```

---

## 进阶用法

### GraphQL 模式（默认）

```typescript
import { DomainHostClient } from "@tkwf/tsclient";

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
| `query` + `explicitBodyQueries` | GET | `{url}{pathPrefix}/{field}` (JSON body) |

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

#### GET + JSON body（V4.9.19）

当服务端 GET 端点使用 `[FromBody]` 绑定复杂 DTO 参数（SG2 生成的 REST 端点），客户端需配置 `restExplicitBodyQueries` 告知 RestTransport 对指定 query 字段发送 GET + JSON body：

```typescript
const host = DomainHostClient.init("my-app", {
  endpoint: "http://localhost:5000",
  transportType: "rest",
  restExplicitBodyQueries: new Set(["getMyCoupons", "getClaimCenter", "getExchange"]),
});
```

行为：variables 序列化为 JSON body（`Content-Type: application/json`），`?fields` 投影仍走 query string。

---

## 使用方法

### 登录与认证

```typescript
// 使用 Tkwf.Guest 登录（已全局配置，无需重复 init）
const guest = Tkwf.Guest;

// 密码登录
const payload = await guest.loginAs("admin", "password123");
// 成功后 sessionKey 自动持久化到 storage

// 短信验证码登录
const smsPayload = await guest.loginBySms("13800138000", "123456");

// 统一上下文登录（支持多种认证方式）
const ctxPayload = await guest.loginByContext("admin", "credential", {
  authType: "Password",    // Password | Sms | QrCode | Token
  loginFrom: "PcWeb",
  deviceId: "device-xxx",
});
```

### 外部 IdP 登录（V1.0.12）

对接认证中心（`TKWF.Ext.AuthCenter`）`POST {prefix}/login/external/{channelType}` 端点族，
支持微信静默认证（snsapi_base）/ 事件取 OpenId（ticket）等外部身份提供方登录。外部 IdP 登录
产物是 **JWT 会话**（与服务端 `TokenResponse` wire 契约 1:1 映射：`accessToken`/`refreshToken`/
`tokenType`/`expiresIn`，camelCase），与 GraphQL 登录的 `sessionKey` 会话**独立并存、互不隐式转换**
（两形态至多一个激活；`restore()` 按字段存在性识别）。

```typescript
import { Tkwf, RestTransport, resolveOAuthCallback } from "@tkwf/tsclient";

// ① 解析微信 OAuth 回调（redirectUri?code=...&state=...）——纯工具，导航编排归消费端
const cb = resolveOAuthCallback(window.location.href);   // { code?, state?, error?, errorDescription? }

// ② 外部 IdP 登录（Guest 语义）——成功即落 JWT 会话并持久化
const guest = Tkwf.Guest;
const session = await guest.loginByExternal("wechat_oauth", {
  code: cb.code!,          // 平台协议字段原样透传（code / channel_id / state / ticket…）
  channel_id: "wx-xxx",
  state: cb.state,
});
// session = { accessToken, refreshToken, tokenType, expiresIn }（严格 4 字段）

// ③ 会话恢复：Tkwf.User 内部识别 JWT 会话 → 请求自动携带 Authorization: Bearer
// ④ 显式续期（P5 显式，不做自动隐式 refresh）
try {
  await Tkwf.User.refreshJwt();              // 成功 → 更新会话持久化
} catch (err) {
  // JWT_SESSION_INVALID → refresh 已失效，需重新登录；AUTH_EXPIRED → access 过期可续
}
```

**通道配置（GraphQL 主传输下）**：`loginByExternal`/`refreshJwt` 走 REST 通道。REST 主传输
（`transportType: "rest"`）自动可用；GraphQL 主传输下需注入专用 REST 通道：

```typescript
Tkwf.configure("default", {
  endpoint: "/graphql",
  transportType: "graphql",
  // 外部 IdP 登录专用 REST 通道（认证中心基址 + 路径映射；URL 唯一解析源 = urlMap）
  externalLoginTransport: new RestTransport({
    url: "http://auth-center:5000",              // 认证中心 base
    pathPrefix: "/api/auth",                     // AuthCenter RoutePrefix 默认
    // 默认路径：loginByExternal=/api/auth/login/external/{channelType}，refreshToken=/api/auth/refresh
    // 消费方按实际 RoutePrefix 覆盖：
    urlMap: {
      loginByExternal: "/api/auth/login/external/{channelType}",
      refreshToken: "/api/auth/refresh",
    },
  }),
});
```

> ⚠️ **Federation RoutePrefix 拼写**：微信授权发起（authorize）与 OAuth 回调属 Federation 扩展，
> RoutePrefix 默认 **`/feberation`**（服务端既有拼写，非 `/federation`）：`POST /feberation/authorize/start`
> 返回 `{ authorize_url, state }`（snake_case 匿名对象）供消费端 302 跳转；回调为
> `GET /feberation/{platformId}/oauth[/{channelId}]/callback`（302 回跳）。本 SDK 不封装 authorize
> 发起（P2 服务端权威；归消费端/未来迭代）。
>
> ⚠️ **错误语义分层**：access 过期（401）→ `AUTH_EXPIRED`（refresh 可能仍有效，可调 `refreshJwt()`
> 续期）；refresh 失效（4xx）→ `JWT_SESSION_INVALID`（需重新登录，SDK 已清会话）。

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

> ⚠️ **V1.0.11（G16 根治）起：该前缀启发式映射已废弃（deprecated）**——SDK 判定已被权威 `operationKinds` 映射取代。仅作为未接线 operationKinds 的向后兼容兜底保留，命中时触发单次 `console.warn` 告警（可经 `suppressHeuristicWarning: true` 静默）。

| 前缀 | 操作类型 |
|------|----------|
| `create*`, `update*`, `delete*`, `add*`, `remove*` | mutation |
| `lock*`, `unlock*`, `reset*` | mutation |
| 其他 | query |

**权威操作类型映射（`operationKinds`，V1.0.11 G16 根治）：**

服务端 SG 把 `Xxx_ExecuteAsync` 判为**非 mutation**（Query 根），而前缀启发式会把 `remove*/create*` 误判为 mutation → 发送 `mutation { removeBuddy_Execute }` → HTTP 400。根治方式：codegen **在生成期**从 schema 根类型权威产出 `operationKinds` 单映射（`{ field: 'query' | 'mutation' }`），SDK 运行时**纯读取零猜测**——判定顺序：`operationKinds` 命中 → `explicitMutations` 兜底 → 前缀启发式（废弃）。

```typescript
import { operationKinds, operationSelection, operationVariableTypes } from "./ts-client.g";

Tkwf.configure("default", {
  endpoint: "/graphql",
  operationKinds,                            // ← V1.0.11：权威操作类型映射（codegen 产物）
  selectionMap: operationSelection,          // 既有同源配置
  variableTypesMap: operationVariableTypes,  // 既有同源配置（V1.0.10）
});
```

`operationKinds` 由消费端生成器产出，两条路径：

- **路径 1（推荐）**：生成器使用 SDK `schema-parser` 的 `buildOperationKinds(parsed)` 纯函数（与 `buildVariableTypesMap` 对称，同源同代）。
- **路径 2（自研生成器）**：`gen-ts-client.ts` 已从 schema 权威提取 `queryFields`/`mutationFields`（带 `type`）——追加 `export const operationKinds` 从两者合并派生（约 5 行）。

未升级生成器/未配置 `operationKinds` 的消费端完全不受影响（判定行为与旧版一致，仅新增单次废弃告警信号）。

**GraphQL 变量类型声明（`variableTypesMap`，V1.0.10）：**

Use<T>() 调用带复杂 DTO 入参（对象/列表）的命名操作时，SDK 无法自动推断其 GraphQL 输入类型（`inferGraphQLType` 对 object 只能退回 `JSON`），后端 HotChocolate 会报 400（`The variable ... is not compatible with the type of the current location`）。需通过 `variableTypesMap` 显式声明每个操作的变量类型，配置同 `selectionMap`——由 codegen 生成（消费端 g.ts 生成器调用 `buildVariableTypesMap(parsed)` 产 `operationVariableTypes`），逐级透传到 ServiceProxy：

```typescript
Tkwf.configure("default", {
  endpoint: "/graphql",
  // selectionMap 同源生成（codegen）：{ field: { varName: "GraphQLType!" } }
  variableTypesMap: {
    rankings_Execute: { request: "GetRankingsReqDtoInput!" },
    // ...
  },
});
```

亦可在调用点以 `args[1]` options 覆盖（与 `signal`/`selection` 同模式）：

```typescript
await api.rankings_Execute(
  { request: { page: 1 } },
  { variableTypes: { request: "GetRankingsReqDtoInput!" } },  // 逐调用覆盖（codegen 默认已足够，非预期用法）
);
```

未配置时行为与旧版完全一致（object 入参推断为 `JSON`）。

### 从存储恢复会话（`GetUser`）

```typescript
// Tkwf.User 内部自动从 storage 恢复 sessionKey
// 无 sessionKey 时触发 onUnauthorized 并抛 AUTH_REQUIRED
try {
  const api = Tkwf.User.Use<IApi>();
  const data = await api.getUser({ id: 1 });
} catch (err) {
  if (err instanceof DomainClientError && err.code === "AUTH_REQUIRED") {
    // 未登录，引导到登录页（onUnauthorized 已触发）
  }
}
```

### 请求签名

在 `Tkwf.configure()` 中通过 `onSign` 配置：

```typescript
Tkwf.configure("default", {
  endpoint: "/graphql",
  onSign: ({ url, method, headers, body, timestamp }) => {
    const signature = computeSignature(body, timestamp);
    return { "X-Signature": signature, "X-Timestamp": timestamp };
  },
});
```

### 全局错误处理

在 `Tkwf.configure()` 中通过 `onGlobalError` 配置：

```typescript
Tkwf.configure("default", {
  endpoint: "/graphql",
  onGlobalError: (error) => {
    console.error(`[${error.code}] ${error.message}`);
  },
});
```

### 心跳检测

在 `Tkwf.configure()` 中通过 `onPong` 配置：

```typescript
Tkwf.configure("default", {
  endpoint: "/graphql",
  onPong: { intervalMinutes: 5, handler: (status) => {
    // 每 5 分钟 ping 一次（仅用户活跃时）
    if (!status.isAuthenticated) {
      // 会话已过期，跳转登录
    }
  }},
});
```

### 请求/响应拦截器

在 `Tkwf.configure()` 中配置：

```typescript
Tkwf.configure("default", {
  endpoint: "/graphql",
  onRequest: (req) => {
    console.log(`→ ${req.type} ${req.field}`);
  },
  onResponse: (res, req) => {
    console.log(`← ${req.field} (${res.durationMs}ms)`);
  },
});
```

### 事件监听（V1.0.8）

服务端可在 RPC 响应侧信道携带领域事件（GraphQL `extensions.tkwf.events` / REST `X-TKWF-Events` 响应头）。客户端通过 `onEvent` 注册 Handler，每次响应自动解包派发——**不破坏业务返回值，事件走独立侧信道**：

```typescript
const host = DomainHostClient.init("my-app", {
  endpoint: "/graphql",
});

// 注册事件 Handler（事件名匹配 RpcEventData.name）
host.onEvent("OrderCreated", (event) => {
  console.log(`订单已创建：${JSON.stringify(event.data)}`);
});

// 终端或批量管理（高级用法）
const bus = host.getEventBus();
bus.on("OrderShipped", (event) => { /* ... */ });
bus.off("OrderShipped", handler);   // 显式注销
bus.clear();                        // 清空所有 Handler
```

事件载荷结构：

```typescript
interface RpcEventData {
  name: string;           // 事件名（如 "OrderCreated"）
  type: string;           // 完整类型名（如 "TKW.MyProject.Events.OrderCreatedEvent"）
  data: unknown;          // 事件字段（JSON 化）
  triggeredBy?: string;   // 触发者（可选）
  timestamp: string;      // ISO 时间戳
  correlationId?: string; // 关联 ID（可选）
}
```

**特性**：
- 优先级：用户 `onResponse` interceptor 先于事件派发触发
- 容错：单条事件解析失败自动跳过（不丢整个侧信道）；事件 Handler 抛错不外泄
- 无事件响应时 `res.events === undefined`，现有行为完全不变
- `dispose()` 后事件不再派发（Handler 已清空）

### 资源释放

```typescript
// React 中
useEffect(() => {
  return () => Tkwf.reset(); // 或直接不处理（建议在应用卸载时处理）
}, []);
```

### REST 文件上传

RestTransport 独占的文件上传能力（GraphQLTransport 不支持）：

```typescript
import { RestTransport } from "@tkwf/tsclient";

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
// 注意：uploadFile 需要直接操作 transport 对象，不经过 Use() 调用
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
│   Use() / query() / mutate() / ping()             │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│                    ServiceProxy                    │  ← 动态代理
│   createUse()                                     │
│   方法名 → query/mutation 自动映射                  │
│   （operationKinds 权威判定，V1.0.11）             │
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
    variableTypes?: Record<string, string>;  // GraphQL 变量类型声明（V4.9.26，复杂 DTO 入参必须）
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
- `variableTypes` 覆盖 — 显式声明复杂 DTO/列表入参的 GraphQL 类型（`inferGraphQLType` 对 object 只能推断 `JSON`，需 codegen 生成并经 Use() 的 `variableTypesMap` 透传，见上）
- 支持 `selection` 子字段选择（HotChocolate 必须）
- 始终使用 `POST` 方法

### RestTransport

- `query` → `GET`，`mutation` → `POST`，与 C# `Domain.ApiClient.Rest` 命名约定一致
- URL 格式：`{base}/{pathPrefix}/{field}`，默认 pathPrefix 为 `/api`
- 支持 `urlMap` 字段级 URL 覆盖
- 额外提供 `uploadFile()` 文件上传方法（独占，GraphQL 不支持）

### 动态代理（ServiceProxy）

- `Use()` — thenable Proxy，支持 `await` / `.onSuccess()` / `.onError()`
- `operationKinds` — **V1.0.11（G16 根治）**：操作→类型权威映射（codegen 产物，schema 根类型权威判定），判定优先级最高——命中即直接决定 query/mutation，不再走前缀启发式（根治 HTTP 400）
- 方法名前缀启发式判断 query/mutation（**V1.0.11 起废弃**，仅未接线 operationKinds 的向后兼容兜底；命中触发单次告警）
- `selectionMap` — 自动附加子字段选择（GraphQL 模式）
- `variableTypesMap` — 自动透传变量 GraphQL 类型声明（V1.0.10，codegen 同源生成；复杂 DTO 入参必需，见上）
- `explicitMutations` — 覆盖前缀启发式判断（V1.0.11 起为 operationKinds 之后的兜底）
- `suppressHeuristicWarning` — V1.0.11：关闭废弃前缀启发式单次告警（生产环境可静默）

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
| `INVALID_ARGUMENT`（V1.0.12） | 400 | — | 外部 IdP 登录参数校验失败（channelType 空/缺 code，前置守卫或服务端透传） |
| `EXTERNAL_LOGIN_FAILED`（V1.0.12） | — | — | 外部 IdP 登录传输失败（无 REST 通道/网络失败） |
| `JWT_SESSION_INVALID`（V1.0.12） | 400 | — | JWT 会话无效（响应缺 accessToken / refresh 失效需重登） |

---

## 核心模块

### ChainablePromise

**ChainablePromise**（Use）：
- `then` / `catch` 可用（thenable）
- `await` 可用
- `.onSuccess(fn)` — 成功回调
- `.onError(fn)` — 错误回调（错误继续传播）
- 支持全局错误处理器

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

## RPC 缓存（V1.0.9，可选）

`@tkwf/tsclient` 核心保持零运行时依赖；缓存能力借鉴 [TanStack Query](https://tanstack.com/query) 的框架无关核心 `@tanstack/query-core`（缓存/去重/SWR/失效），以 **optional peerDependency + 懒加载** 形态接入：不安装 query-core 时行为与之前完全一致，安装后通过 `@tkwf/tsclient/cache` 子路径获得缓存 API。

### 安装

```bash
# React 消费端（若已用 @tanstack/react-query，query-core 已在 node_modules，无需安装）
npm install @tanstack/query-core
```

SDK 的 `@tanstack/query-core` 为 **optional peerDependency**——npm 不会自动安装，仅在使用缓存功能时需要。

### 使用

```tsx
// React 示例（Vue 消费端用 @tanstack/vue-query，接入方式相同）
import { useQuery } from "@tanstack/react-query";
import { Tkwf } from "@tkwf/tsclient";
import { createRpcQueryKey, createRpcQueryFn, enableRpcCache } from "@tkwf/tsclient/cache";
import type { QueryClient } from "@tanstack/query-core";

// 应用入口调用一次（每次调用创建独立 QueryClient，勿在组件内调用）
const cache = await enableRpcCache<QueryClient>();
const client = cache.getQueryClient();

// 共享同一组 variables，防止 key/fn 分叉导致缓存 miss
const variables = { page: 1 };
const queryFn = createRpcQueryFn({
  scenario: "default", field: "getOrders", type: "query",
  variables, selection: "id,name",
  transport: Tkwf.User.getTransport(),
  getSessionKey: () => Tkwf.User.sessionKey,
});
const queryKey = createRpcQueryKey("default", Tkwf.User.sessionKey, "getOrders", variables, "id,name");

const { data, isPending } = useQuery({ queryKey, queryFn, queryClient: client });
```

### 会话清理

缓存 key 采用**会话分桶** `[scenario, sessionKey, field, variables, selection]`——不同登录会话数据天然隔离。

> ⚠️ **`logout()` 不会自动清缓存** —— 必须在登出流程中显式调用 `clearSession`，否则旧会话缓存残留：

```typescript
// 登出流程
await Tkwf.User.logout();
cache.clearSession("default", oldSessionKey);  // 先 cancel 再 remove，防 in-flight 竞态
```

### Vite 配置

Vite dev 模式对可选依赖的动态 import 可能报 `Failed to resolve import`，需在 `vite.config.ts` 排除预构建：

```typescript
export default defineConfig({
  optimizeDeps: { exclude: ["@tanstack/query-core"] },
});
```

### 重试协调

SDK 的 transport 层已有重试（见上节），缓存层默认 `retry: false`（**单一重试归属**）——transport 重试失败后，TanStack 不再二次重试。如消费端需由 TanStack 接管重试，请将 transport 配置为不重试（`retryOn: []` 或 `maxAttempts: 1`），并在 query 配置中显式设置 `retry`。

### 事件语义

v1.0.8 的 RPC 事件（GraphQL `extensions.tkwf.events` / REST `X-TKWF-Events`）在**真实请求后**由 transport 派发；缓存命中不产生真实请求，因此**不重放事件**——符合"事件是已发生的一次性领域信号"语义。带事件的响应 data 会被正常缓存；如需对带事件响应禁用缓存，在 TanStack 侧配置 `gcTime: 0` / `staleTime: Infinity` + 手动 `invalidateQueries`。

### 依赖缺失

未安装 `@tanstack/query-core` 时调用 `enableRpcCache()` 会抛引导错误：

```
The "@tanstack/query-core" package is required for the RPC cache. Install it: npm install @tanstack/query-core
```

## SSR 支持

- `DomainClientUser` 自动检测 `sessionStorage` 可用性，不可用时使用内存存储
- `DomainHostClient` 的心跳监测在 SSR 环境自动跳过
- `QueryString.parse` 在无 `window` 环境可传入 `searchString` 参数

## 开发

```bash
npm test       # 运行测试（379 tests across 15 test files）
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
| 业务 API | Use<T>() / 通用 query/mutate | ✅ |
| 错误处理 | 按错误码分发 / 全局处理器 | ✅ |
| 拦截器 | 请求/响应日志 / 请求签名 | ✅ |
| Crypto | PBKDF2 / HMAC / 编码转换 | ✅ |
| 工具类 | Pager / QueryString | ✅ |
| React 集成 | 资源释放 / RpcCache（`@tkwf/tsclient/cache` + TanStack） | ✅ |

## 许可

MIT
