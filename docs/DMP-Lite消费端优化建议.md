# DMP-Lite 消费端优化建议

> 基于 `@tkwf/tsclient` v1.0.5 的 SDK 现状，对 DMP-Lite 消费端项目提出以下优化建议。
> 对应 SDK 审核报告中的预存 tsc 错误（68 处）清理。

---

## 优先级：🔴 P0 — 编译错误清理

### 问题

`src/examples/ts-client-examples.ts` 存在大量 TS6133（unused variable）错误。该文件是 v1.0.3 及之前的 API 示例模板，但在 v1.0.4 中：
- `Call()` 方法被移除
- `Use<T>()` 第二参数签名变更
- 部分示例方法已不再适用

由于 `tsconfig.json` 的 `noUnusedLocals: true` 配置，这导致每次 `tsc` 都报一堆错误。

### 建议方案

**推荐方案：tsconfig exclude（低成本）**

在 `tsconfig.json` 的 `exclude` 数组中添加该文件：

```json
{
  "compilerOptions": {
    "noUnusedLocals": true
  },
  "exclude": [
    "node_modules",
    "dist",
    "src/examples/ts-client-examples.ts"
  ]
}
```

**优点**：0 代码修改，立即消除编译噪音，不影响示例文件保留作为参考。

**备选方案：更新到 V1.0.4+ 规范**

如果该文件有实际参考价值，则需要：
- 替换所有 `Call()` 调用为 `Use<T>()` 直接调用
- 更新 `Use<T>()` 的第二参数签名
- 补充 `selection` 参数（v1.0.4 要求 `transport.execute()` 必须显式提供 `selection`）
- 补充 `variableTypes` 参数（复杂输入类型场景）

**成本较高**，且示例文件需要持续维护以对齐 SDK 版本，不推荐。

---

## 优先级：🟡 P1 — 认证事件机制简化

### 问题

`query-client.ts` 中有一套基于 `CustomEvent` 的认证过期处理机制：

```
AUTH_EXPIRED → dispatchEvent(AUTH_UNAUTHORIZED_EVENT) → App.tsx 监听 → 跳转登录页
```

但在 v1.0.4+ 的 SDK 中，Tkwf 门面已经提供了两套成熟的回调机制：

| 机制 | 触发时机 | 覆盖场景 |
|------|---------|---------|
| `onUnauthorized` | `Tkwf.User.GetUser()` 无本地 session | 页面刷新/首次访问 → 无 session → 跳登录 |
| `onGlobalError` | API 调用返回 401（AUTH_EXPIRED） | 会话过期后发起 API 调用 → 跳登录 |

两者组合已经覆盖了"无 session"和"session 过期"两种场景，`query-client.ts` 的事件机制成为冗余。

### 建议方案

**步骤 1：确认 `Tkwf.configure` 已配置完整**

在 `main.tsx` 或 `App.tsx` 中确认已有：

```typescript
Tkwf.configure("default", {
  endpoint: "/graphql",
  storage: localStorage,
  onUnauthorized: () => { window.location.href = "/login"; },
  onGlobalError: (err) => {
    if (err.code === "AUTH_EXPIRED") {
      window.location.href = "/login";
    }
    // 其他错误处理...
  },
});
```

**步骤 2：删除冗余代码**

- 删除 `query-client.ts` 中的 `handleAuthExpired()` 方法
- 删除 `AUTH_UNAUTHORIZED_EVENT` 常量定义
- 删除 `dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT))` 调用
- 删除 `App.tsx` 中的 `addEventListener(AUTH_UNAUTHORIZED_EVENT, ...)` 监听

**步骤 3：清理 barrel exports**

如果 `query-client.ts` 导出了 `AUTH_UNAUTHORIZED_EVENT` 或 `handleAuthExpired`，一并从 `index.ts` 移除。

### 风险

- 如果 DMP-Lite 中还存在其他消费者（如 iframe 子页面）通过 `window.addEventListener` 监听该事件，则需要同步迁移
- 删除后需要确认 `onGlobalError` 在 `Tkwf.configure` 中已正确配置，否则 API 401 会静默丢失

---

## 优先级：🟡 P2 — useRpcQuery/useRpcMutation 清理

### 问题

`@tkwf/tsclient` SDK 中从未实现过 `useRpcQuery` 和 `useRpcMutation` 这两个 React hooks，且 `@tanstack/react-query` 不是 SDK 的依赖项。

如果 DMP-Lite 消费端有类似封装（如 `src/hooks/useRpcQuery.ts`），则需要评估其价值。

### 建议方案

**如果 DMP-Lite 中存在 `useRpcQuery`/`useRpcMutation` 封装：**

检查其实现，如果只是 `useQuery`/`useMutation` 的极薄包装（不引用 Tkwf、不做额外逻辑），则：

**推荐方案：直接删除，页面改用 `@tanstack/react-query` 的 `useQuery`/`useMutation`**

```typescript
// 之前
import { useRpcQuery } from "@/hooks/useRpcQuery";
const { data } = useRpcQuery({ queryKey: ["profile"], queryFn: () => ... });

// 之后
import { useQuery } from "@tanstack/react-query";
const { data } = useQuery({ queryKey: ["profile"], queryFn: () => ... });
```

**保留理由（如果决定保留）：**
- 如果包装提供了 `TData` 泛型便利，且页面中大量使用该泛型
- 如果未来计划在 hooks 中注入 Tkwf 实例（如 SSR 场景）

**不保留理由：**
- 多余抽象层，增加心智负担
- 新开发者需要额外学习这个包装层
- 如果未来 React Query 升级，包装层可能成为升级障碍

---

## 执行顺序建议

```
迭代 N（当前）
  ├── P0: tsconfig exclude examples 文件 → 立即消除 68 处 tsc 错误
  └── P1: 确认 onGlobalError 配置 → 删除事件机制代码
迭代 N+1
  └── P2: 评估 useRpcQuery 封装价值 → 决定删除或保留
```

---

## 验证清单

- [ ] `tsc --noEmit` 零新增错误
- [ ] 登录 → 页面刷新 → 自动恢复 session（`onUnauthorized` 不误触发）
- [ ] 登出 → 发起 API 调用 → 跳转登录页（`onGlobalError` 触发跳转）
- [ ] session 过期 → 发起 API 调用 → 跳转登录页（`onGlobalError` 的 `AUTH_EXPIRED` 分支）
- [ ] 删除事件机制后，无 `console.error` 警告（无未监听的事件）