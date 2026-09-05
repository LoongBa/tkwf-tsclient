// V1.0.9 — RpcCache：可选 RPC 响应缓存（借鉴 TanStack Query-core，optional peerDependency + 懒加载）。
//
// 设计边界：
// - SDK 核心不实现缓存逻辑、不内置观察者/状态机，只导出框架无关的
//   queryKey 派生（createRpcQueryKey）、queryFn 适配（createRpcQueryFn）与
//   懒加载工厂（enableRpcCache）。
// - 复用 src/codegen/schema-parser.ts:244-252 的"可选依赖 + 动态 import + 引导错误"模板：
//   未安装 @tanstack/query-core 时抛清晰安装指引，不静默降级。
// - 缓存 key 采用会话分桶：[scenario, sessionKey, field, stableSerialize(variables), selection]——
//   TanStack 无会话维度（key 由应用层管），tsclient 必须纳入以隔离不同登录会话数据。
// - 单一重试归属：transport 层已有重试（retryOn 错误码），缓存层显式 retry:false。

import type { Transport } from "./transport";

// ── 配置与类型（零运行时，静态引用，不加载 query-core）──────────────────────────

export interface RpcCacheConfig {
  /** staleTime 默认值（毫秒）。query-core 语义：期限内不重新请求。默认 0 = 重取 + 去重兜底。 */
  staleTime?: number;
  /** gcTime 默认值（毫秒）。query-core 语义：无观察者后保留时长。 */
  gcTime?: number;
}

/** 缓存 key：会话分桶。selection 可选（REST 模式无子字段选择）。 */
export type RpcQueryKey = readonly [
  scenario: string,
  sessionKey: string | null,
  field: string,
  variables: unknown,
  selection?: string,
];

/**
 * 传给 queryFn 的上下文。对齐 TanStack QueryFunctionContext 的可用字段子集——
 * 只暴露 signal（TanStack 保证注入），不声明 TanStack 不提供的幻影字段。
 * 修订说明（Oracle M1）：原 RpcQueryContext<T> 含必填 fetcher 与 variableTypes，
 * TanStack QueryFunctionContext 无此二字段，strictFunctionTypes 下消费端赋给
 * useQuery({ queryFn }) 逆变检查失败不可编译；createRpcQueryFn 也从未使用 ctx.fetcher。
 */
export interface RpcQueryContext {
  signal?: AbortSignal;
}

/** createRpcQueryFn 的入参：与 createRpcQueryKey 共享同一组 variables/selection（防 key/fn 分叉）。 */
export interface RpcQueryOptions {
  scenario: string;
  field: string;
  type?: "query" | "mutation";
  variables?: Record<string, unknown>;
  variableTypes?: Record<string, string>;
  selection?: string;
  transport: Transport;
  getSessionKey: () => string | null;
}

/** enableRpcCache 返回的缓存客户端。泛型 T 由调用点指定（enableRpcCache<QueryClient>()），消除消费端 as 收窄。 */
export interface RpcCacheClient<T = unknown> {
  /** QueryClient 实例。未装 query-core 时 T 退化为 unknown，.d.ts 无 query-core 类型引用不炸。 */
  getQueryClient(): T;
  /**
   * 清理指定会话（scenario + sessionKey）的全部缓存条目。
   * 用 TanStack partial match（前缀匹配）清空 [scenario, sessionKey, ...]；
   * 先 cancelQueries 再 removeQueries 防 in-flight 请求写入已清除的 key（S2）。
   * sessionKey 接受 null（guest 查询，S3）。
   */
  clearSession(scenario: string, sessionKey: string | null): void;
}

// ── queryKey 派生（框架无关、零依赖、确定性序列化）──────────────────────────────

export function createRpcQueryKey(
  scenario: string,
  sessionKey: string | null,
  field: string,
  variables?: Record<string, unknown>,
  selection?: string,
): RpcQueryKey {
  return [scenario, sessionKey, field, stableSerialize(variables), selection] as const;
}

// ── queryFn 适配：把 tsclient Transport 调用包装成 TanStack queryFn 形态 ──────────

export function createRpcQueryFn<T>(
  options: RpcQueryOptions,
): (ctx: RpcQueryContext) => Promise<T> {
  const { transport, field, type = "query", variables, variableTypes, selection, getSessionKey } = options;
  return (ctx) =>
    transport.execute<T>({
      field,
      type,
      variables,
      variableTypes,
      selection,
      sessionKey: getSessionKey() ?? undefined,
      signal: ctx.signal,
    });
}

// ── 懒加载工厂（复用 schema-parser 模板；Oracle M4：webpackIgnore + 变量模块名）────

const QUERY_CORE_MODULE = "@tanstack/query-core";

export async function enableRpcCache<T = unknown>(config?: RpcCacheConfig): Promise<RpcCacheClient<T>> {
  let queryCore: typeof import("@tanstack/query-core");
  try {
    // Oracle M4: webpackIgnore 防止 Webpack 5 静态分析尝试解析可选依赖（未装时 build 失败）；
    // 变量模块名绕过 Vite 静态分析。Vite 侧另需消费端 optimizeDeps.exclude（见 README）。
    queryCore = await import(/* webpackIgnore: true */ QUERY_CORE_MODULE);
  } catch {
    throw new Error(
      'The "@tanstack/query-core" package is required for the RPC cache. Install it: npm install @tanstack/query-core',
    );
  }
  const { QueryClient } = queryCore;
  const client = new QueryClient({
    defaultOptions: {
      // Oracle M2（最关键必修项）：queries 必须显式 retry:false —— TanStack 默认 query retry=3，
      // 若省略则 transport 重试 3 次抛错后 TanStack 再重试 3 次（每次又触发 transport 重试），
      // 最坏 12 次尝试，违反"单一重试归属"裁决。
      queries: { staleTime: config?.staleTime ?? 0, gcTime: config?.gcTime, retry: false },
      mutations: { retry: false },
    },
  });
  return {
    getQueryClient: () => client as unknown as T,
    clearSession: (scenario, sessionKey) => {
      const prefix = [scenario, sessionKey] as const;
      // S2：先 cancel 再 remove。cancelQueries 为异步，removeQueries 本身也会终止
      // 观察者并阻止 in-flight 写入，竞态防护实质成立（fire-and-forget 可接受）。
      client.cancelQueries({ queryKey: prefix });
      client.removeQueries({ queryKey: prefix });
    },
  };
}

// ── 确定性序列化（对齐 TanStack hashKey：对象 key 排序、undefined 剥离、数组保序）──
// 说明（Oracle S6）：RPC variables 必须 JSON 可序列化（transport 层会因不可序列化而报错），
// 循环引用不在支持范围内（会造成栈溢出，调用方须保证 variables 无循环引用）；
// 函数值原样返回（typeof fn !== "object" 分支），TanStack hashKey 序列化时函数在数组中变 null。
// Date 对象会退化为 {}（Object.keys(Date) 为空）——调用方应将时间传 ISO 字符串。

function stableSerialize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableSerialize);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = stableSerialize(v);
  }
  return out;
}
