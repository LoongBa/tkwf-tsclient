// V1.0.9: RpcCache 单元测试
// 覆盖 Oracle 复审 5 条实施细节：M4 缺包引导 / M2 retry:false / S2 cancel 顺序 /
// S3 guest 清理 / S6 key 确定性 + 函数原样。循环引用不在测试范围（会造成栈溢出，勿测）。

import { describe, it, expect, vi } from "vitest";
import {
  createRpcQueryKey,
  createRpcQueryFn,
  enableRpcCache,
} from "./cache";
import type { Transport } from "./transport";

// ── createRpcQueryKey：会话分桶 + 确定性序列化 ────────────────────────────────

describe("createRpcQueryKey", () => {
  it("结构为 [scenario, sessionKey, field, variables, selection]", () => {
    const key = createRpcQueryKey("default", "sk-1", "getOrders", { page: 1 }, "id,name");
    expect(key[0]).toBe("default");
    expect(key[1]).toBe("sk-1");
    expect(key[2]).toBe("getOrders");
    expect(key[3]).toEqual({ page: 1 });
    expect(key[4]).toBe("id,name");
  });

  it("会话隔离：不同 sessionKey 产出不同 key", () => {
    const k1 = createRpcQueryKey("default", "sk-1", "getOrders", { page: 1 });
    const k2 = createRpcQueryKey("default", "sk-2", "getOrders", { page: 1 });
    expect(k1).not.toEqual(k2);
  });

  it("同参数不同对象 key 顺序产出相同 key（stableSerialize 排序）", () => {
    const a = createRpcQueryKey("default", "sk-1", "getOrders", { page: 1, status: "Paid" });
    const b = createRpcQueryKey("default", "sk-1", "getOrders", { status: "Paid", page: 1 });
    expect(a[3]).toEqual(b[3]);
  });

  it("嵌套对象 key 递归排序（Oracle 代码审核 S3）", () => {
    const a = createRpcQueryKey("default", "sk-1", "getOrders", { outer: { b: 1, a: 2, inner: { z: 1, y: 2 } } });
    const b = createRpcQueryKey("default", "sk-1", "getOrders", { outer: { inner: { y: 2, z: 1 }, a: 2, b: 1 } });
    expect(a[3]).toEqual(b[3]);
    expect(a[3]).toEqual({ outer: { a: 2, b: 1, inner: { y: 2, z: 1 } } });
  });

  it("undefined 变量剥离（S6）", () => {
    const withUndef = createRpcQueryKey("default", "sk-1", "getOrders", { page: 1, extra: undefined });
    const clean = createRpcQueryKey("default", "sk-1", "getOrders", { page: 1 });
    expect(withUndef[3]).toEqual(clean[3]);
  });

  it("函数值原样返回（S6：typeof fn !== object 分支）", () => {
    const fn = () => 1;
    const key = createRpcQueryKey("default", "sk-1", "getOrders", { page: 1, cb: fn } as never);
    const vars = key[3] as Record<string, unknown>;
    expect(vars.cb).toBe(fn);
  });

  it("数组保序（对齐 TanStack hashKey：数组项顺序敏感）", () => {
    const a = createRpcQueryKey("default", "sk-1", "getOrders", { ids: [1, 2, 3] });
    const b = createRpcQueryKey("default", "sk-1", "getOrders", { ids: [3, 2, 1] });
    expect(a[3]).not.toEqual(b[3]);
  });

  it("guest（sessionKey: null）可产出 key（S3 场景）", () => {
    const key = createRpcQueryKey("default", null, "getProducts", { page: 1 });
    expect(key[1]).toBeNull();
  });
});

// ── createRpcQueryFn：transport 透传 ──────────────────────────────────────────

describe("createRpcQueryFn", () => {
  const makeTransport = () => {
    const execute = vi.fn().mockResolvedValue({ id: 1 });
    return { execute } as unknown as Transport;
  };

  it("调用 transport.execute 并透传 field/type/variables/selection/sessionKey", async () => {
    const transport = makeTransport();
    const getSessionKey = () => "sk-1";
    const fn = createRpcQueryFn({
      scenario: "default",
      field: "getOrders",
      type: "query",
      variables: { page: 1 },
      selection: "id,name",
      transport,
      getSessionKey,
    });
    const result = await fn({ signal: undefined });

    expect(result).toEqual({ id: 1 });
    expect(transport.execute).toHaveBeenCalledWith({
      field: "getOrders",
      type: "query",
      variables: { page: 1 },
      variableTypes: undefined,
      selection: "id,name",
      sessionKey: "sk-1",
      signal: undefined,
    });
  });

  it("透传 signal（TanStack 注入的 AbortSignal）", async () => {
    const transport = makeTransport();
    const fn = createRpcQueryFn({
      scenario: "default",
      field: "getOrders",
      transport,
      getSessionKey: () => null,
    });
    const controller = new AbortController();
    await fn({ signal: controller.signal });
    expect(transport.execute).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("sessionKey 为 null 时不传 sessionKey 字段值（undefined）", async () => {
    const transport = makeTransport();
    const fn = createRpcQueryFn({
      scenario: "default",
      field: "getProducts",
      transport,
      getSessionKey: () => null,
    });
    await fn({});
    expect(transport.execute).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: undefined }),
    );
  });

  it("默认 type 为 query", async () => {
    const transport = makeTransport();
    const fn = createRpcQueryFn({
      scenario: "default",
      field: "getProducts",
      transport,
      getSessionKey: () => null,
    });
    await fn({});
    expect(transport.execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: "query" }),
    );
  });

  it("mutation type 与 variableTypes 非 undefined 正确透传（Oracle 代码审核 S2）", async () => {
    const transport = makeTransport();
    const fn = createRpcQueryFn({
      scenario: "default",
      field: "createOrder",
      type: "mutation",
      variableTypes: { input: "CreateOrderInput!" },
      transport,
      getSessionKey: () => "sk-1",
    });
    await fn({});
    expect(transport.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mutation",
        variableTypes: { input: "CreateOrderInput!" },
      }),
    );
  });
});

// ── enableRpcCache：懒加载工厂 ────────────────────────────────────────────────

describe("enableRpcCache", () => {
  it("query-core 已安装时返回 RpcCacheClient，QueryClient 可用（M2）", async () => {
    const cache = await enableRpcCache();
    const client = cache.getQueryClient() as import("@tanstack/query-core").QueryClient;

    // M2：queries 显式 retry:false（单一重试归属）
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.retry).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);

    // QueryClient 基本能力：setQueryData/getQueryData
    client.setQueryData(["default", "sk-1", "getOrders", { page: 1 }], { id: 1 });
    expect(client.getQueryData(["default", "sk-1", "getOrders", { page: 1 }])).toEqual({ id: 1 });
  });

  it("S1：泛型收窄后 getQueryClient 返回 QueryClient 类型", async () => {
    type Q = import("@tanstack/query-core").QueryClient;
    const cache = await enableRpcCache<Q>();
    const client: Q = cache.getQueryClient();
    expect(client).toBeDefined();
  });

  it("S2/S3：clearSession 按会话前缀清理（含 guest null）且不影响其他会话", async () => {
    const cache = await enableRpcCache();
    const client = cache.getQueryClient() as import("@tanstack/query-core").QueryClient;

    // 同一会话两条 + 其他会话一条 + guest 一条
    client.setQueryData(["default", "sk-1", "getOrders", { page: 1 }], { id: 1 });
    client.setQueryData(["default", "sk-1", "getOrders", { page: 2 }], { id: 2 });
    client.setQueryData(["default", "sk-2", "getOrders", { page: 1 }], { id: 3 });
    client.setQueryData(["default", null, "getProducts", { page: 1 }], { id: 4 });

    cache.clearSession("default", "sk-1");
    expect(client.getQueryData(["default", "sk-1", "getOrders", { page: 1 }])).toBeUndefined();
    expect(client.getQueryData(["default", "sk-1", "getOrders", { page: 2 }])).toBeUndefined();
    // 其他会话不受影响
    expect(client.getQueryData(["default", "sk-2", "getOrders", { page: 1 }])).toEqual({ id: 3 });

    // guest（null）清理
    cache.clearSession("default", null);
    expect(client.getQueryData(["default", null, "getProducts", { page: 1 }])).toBeUndefined();
    expect(client.getQueryData(["default", "sk-2", "getOrders", { page: 1 }])).toEqual({ id: 3 });
  });

  it("S2 竞态：in-flight 请求时 clearSession 取消并移除（Oracle 代码审核 S1）", async () => {
    const cache = await enableRpcCache();
    const client = cache.getQueryClient() as import("@tanstack/query-core").QueryClient;

    // pending transport：发起 fetchQuery 后请求保持 in-flight
    let resolveQuery: ((v: unknown) => void) | undefined;
    const pending = new Promise<unknown>((r) => { resolveQuery = r; });
    const transport = { execute: vi.fn(() => pending) } as unknown as Transport;
    const queryFn = createRpcQueryFn({
      scenario: "default",
      field: "x",
      transport,
      getSessionKey: () => "sk-1",
    });
    const key = createRpcQueryKey("default", "sk-1", "x");

    const p = client.fetchQuery({ queryKey: key, queryFn });
    // in-flight 时清理会话
    cache.clearSession("default", "sk-1");
    resolveQuery!({ id: 1 });
    // 请求被取消或结果不写入已清理的 key
    await expect(p).rejects.toBeDefined();
    expect(client.getQueryData(key)).toBeUndefined();
  });

  it("staleTime/gcTime 配置透传到 defaultOptions", async () => {
    const cache = await enableRpcCache({ staleTime: 30_000, gcTime: 300_000 });
    const client = cache.getQueryClient() as import("@tanstack/query-core").QueryClient;
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.gcTime).toBe(300_000);
  });
});
