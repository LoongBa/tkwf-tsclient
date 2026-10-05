import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DomainHostClient } from "./domain-host-client";
import type { Transport } from "./transport";

function mockFetch(data: unknown, status = 200) {
  return vi.mocked(fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  } as Response);
}

describe("DomainHostClient V1.0.8 RPC events (end-to-end dispatch)", () => {
  const orderEvent = {
    name: "OrderCreated",
    type: "T.Events.OrderCreatedEvent",
    data: { id: 1 },
    timestamp: "2026-08-26T12:00:00Z",
  };

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => Promise.resolve(new Response()),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("onEvent 注册 + Use 发起调用 + 响应 extensions 携带事件 → handler 被调用", async () => {
    const handler = vi.fn();
    const host = DomainHostClient.init("test", { endpoint: "/graphql" });
    host.onEvent("OrderCreated", handler);

    mockFetch({
      data: { getOrder: { id: 1 } },
      extensions: { tkwf: { events: [orderEvent] } },
    });

    const guest = host.GetGuest();
    const res = await guest.query("getOrder", { id: 1 });

    expect(res).toEqual({ getOrder: { id: 1 } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ name: "OrderCreated", data: { id: 1 } }),
    );
  });

  it("未匹配事件名不触发", async () => {
    const handler = vi.fn();
    const host = DomainHostClient.init("test", { endpoint: "/graphql" });
    host.onEvent("OtherEvent", handler);

    mockFetch({
      data: { getOrder: { id: 1 } },
      extensions: { tkwf: { events: [orderEvent] } },
    });

    const guest = host.GetGuest();
    const res = await guest.query("getOrder", { id: 1 });

    expect(res).toEqual({ getOrder: { id: 1 } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("无事件响应 → handler 不触发，业务数据仍返回", async () => {
    const handler = vi.fn();
    const host = DomainHostClient.init("test", { endpoint: "/graphql" });
    host.onEvent("OrderCreated", handler);

    mockFetch({ data: { getOrder: { id: 1 } } });

    const guest = host.GetGuest();
    const res = await guest.query("getOrder", { id: 1 });

    expect(res).toEqual({ getOrder: { id: 1 } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("用户 onResponse interceptor 先于事件派发", async () => {
    const order: string[] = [];
    const host = DomainHostClient.init("test", { endpoint: "/graphql" });
    host.onResponse(() => { order.push("interceptor"); });
    host.onEvent("OrderCreated", () => { order.push("handler"); });

    mockFetch({
      data: { getOrder: { id: 1 } },
      extensions: { tkwf: { events: [orderEvent] } },
    });

    const guest = host.GetGuest();
    await guest.query("getOrder", { id: 1 });

    expect(order).toEqual(["interceptor", "handler"]);
  });

  it("getEventBus() 与 onEvent 共享同一总线", async () => {
    const handler = vi.fn();
    const host = DomainHostClient.init("test", { endpoint: "/graphql" });
    // 经 getEventBus().on 注册
    host.getEventBus().on("OrderCreated", handler);

    mockFetch({
      data: { getOrder: { id: 1 } },
      extensions: { tkwf: { events: [orderEvent] } },
    });
    const guest = host.GetGuest();
    await guest.query("getOrder", { id: 1 });

    expect(handler).toHaveBeenCalledTimes(1);

    // onEvent 与 getEventBus().on 为同一总线：host.onEvent 注册 + host RPC 派发
    const handler2 = vi.fn();
    host.onEvent("OrderCreated", handler2);
    mockFetch({
      data: { getOrder: { id: 2 } },
      extensions: { tkwf: { events: [orderEvent] } },
    });
    await guest.query("getOrder", { id: 2 });

    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("GetGuest() 返回的 user 发起 RPC 携带事件时 host eventBus 同样派发（Oracle M5）", async () => {
    const handler = vi.fn();
    const host = DomainHostClient.init("test", { endpoint: "/graphql" });
    host.onEvent("OrderCreated", handler);

    mockFetch({
      data: { getOrder: { id: 2 } },
      extensions: { tkwf: { events: [orderEvent] } },
    });

    const guest = host.GetGuest();
    await guest.query("getOrder", { id: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("dispose() 后不再派发（eventBus 已清空，transport 仍可用）", async () => {
    const handler = vi.fn();
    const host = DomainHostClient.init("test", { endpoint: "/graphql" });
    host.onEvent("OrderCreated", handler);

    const guest = host.GetGuest(); // 在 dispose 之前创建（transport 不受 dispose 影响）
    host.dispose();

    mockFetch({
      data: { getOrder: { id: 3 } },
      extensions: { tkwf: { events: [orderEvent] } },
    });

    const res = await guest.query("getOrder", { id: 3 });

    expect(res).toEqual({ getOrder: { id: 3 } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("注入自定义 transport 不经 onResponse 包装，不派发事件（开放项）", async () => {
    const handler = vi.fn();
    const customTransport: Transport = {
      execute: vi.fn().mockResolvedValue({ ok: true }),
      executeRawGraphQL: vi.fn(),
    };

    const host = DomainHostClient.init("test", { transport: customTransport });
    host.onEvent("OrderCreated", handler);

    const guest = host.GetGuest();
    await guest.query("getOrder", { id: 1 });

    expect(customTransport.execute).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("GetGuest() 透传 variableTypesMap 到 Use() 代理（V1.0.10）", async () => {
    const customTransport: Transport = {
      execute: vi.fn().mockResolvedValue({ ok: true }),
      executeRawGraphQL: vi.fn(),
    };

    const host = DomainHostClient.init("test", {
      transport: customTransport,
      variableTypesMap: { rankings_Execute: { request: "GetRankingsReqDtoInput!" } },
    });

    const guest = host.GetGuest();
    const api = guest.Use<{ rankings_Execute: (args: unknown) => Promise<unknown> }>();
    await api.rankings_Execute?.({ request: { id: 1 } });

    expect(customTransport.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "rankings_Execute",
        variableTypes: { request: "GetRankingsReqDtoInput!" },
      }),
    );
  });

  // V1.0.11（G16 根治）：GetGuest/GetUser 两条路径透传 operationKinds（v1.0.10 M4 先例对齐）
  it("GetGuest() 透传 operationKinds 到 Use() 代理（V1.0.11：Execute 字段判 query）", async () => {
    const customTransport: Transport = {
      execute: vi.fn().mockResolvedValue({ ok: true }),
      executeRawGraphQL: vi.fn(),
    };

    const host = DomainHostClient.init("test", {
      transport: customTransport,
      operationKinds: { createTask_Execute: "query" },
    });

    const guest = host.GetGuest();
    const api = guest.Use<{ createTask_Execute: (args: unknown) => Promise<unknown> }>();
    await api.createTask_Execute?.({ name: "x" });

    expect(customTransport.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "createTask_Execute",
        type: "query",
      }),
    );
  });

  it("GetUser() 透传 operationKinds 到 Use() 代理（V1.0.11：Execute 字段判 query）", async () => {
    const customTransport: Transport = {
      execute: vi.fn().mockResolvedValue({ ok: true }),
      executeRawGraphQL: vi.fn(),
    };
    // GetUser() 需从 storage 恢复会话
    const store = new Map<string, string>();
    store.set("test", JSON.stringify({ sessionKey: "sk_abc" }));
    const memoryStorage: Storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (index: number) => [...store.keys()][index] ?? null,
    };

    const host = DomainHostClient.init("test", {
      transport: customTransport,
      storage: memoryStorage,
      operationKinds: { createStudySession_Execute: "query" },
    });

    const user = host.GetUser();
    const api = user.Use<{ createStudySession_Execute: (args: unknown) => Promise<unknown> }>();
    await api.createStudySession_Execute?.({ id: 1 });

    expect(customTransport.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "createStudySession_Execute",
        type: "query",
      }),
    );
  });
});
