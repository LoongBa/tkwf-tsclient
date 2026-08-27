/**
 * V1.0.8 — RPC 响应携带事件：parseRpcEventEnvelope / base64UrlDecode / TkwfEventBus 单元测试。
 *
 * 覆盖 §4 验证清单逐项检查。
 */

// Buffer 在 Node.js 测试环境运行时可用，但仓库未依赖 @types/node，此处为编译期提供类型
declare const Buffer: {
  from(data: string, encoding: string): { toString(encoding: string): string };
};

import { describe, it, expect, vi } from "vitest";
import {
  parseRpcEventEnvelope,
  base64UrlDecode,
  TkwfEventBus,
  type RpcEventData,
} from "./event";

// ---------------------------------------------------------------------------
// 小工具：将字符串编码为 base64url（不含 padding），用于构造测试预期值
// ---------------------------------------------------------------------------
function toBase64Url(str: string): string {
  const b64 = Buffer.from(str, "utf-8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// parseRpcEventEnvelope
// ---------------------------------------------------------------------------
describe("parseRpcEventEnvelope", () => {
  const validEvent = {
    name: "OrderCreated",
    type: "TKW.MyProject.Events.OrderCreatedEvent",
    data: { orderId: 123 },
    triggeredBy: "u-42",
    timestamp: "2026-08-26T12:00:00Z",
    correlationId: "abc-123",
  };

  it("合法 envelope 对象解析成功，保留所有字段", () => {
    const result = parseRpcEventEnvelope({ events: [validEvent] });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(validEvent);
  });

  it("JSON 字符串输入解析成功（REST 路径——解码后的 header 值传入）", () => {
    const json = JSON.stringify({ events: [validEvent] });
    const result = parseRpcEventEnvelope(json);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(validEvent);
  });

  it("null 输入返回 []", () => {
    expect(parseRpcEventEnvelope(null)).toEqual([]);
  });

  it("undefined 输入返回 []", () => {
    expect(parseRpcEventEnvelope(undefined)).toEqual([]);
  });

  it("非对象（number）输入返回 []", () => {
    expect(parseRpcEventEnvelope(42)).toEqual([]);
  });

  it("非对象（boolean）输入返回 []", () => {
    expect(parseRpcEventEnvelope(true)).toEqual([]);
  });

  it("events 非数组时返回 []", () => {
    expect(parseRpcEventEnvelope({ events: "not-array" })).toEqual([]);
  });

  it("畸形 JSON 字符串返回 []", () => {
    expect(parseRpcEventEnvelope("{not json")).toEqual([]);
  });

  it("部分条目非法时逐条过滤，保留合法条目", () => {
    const input = {
      events: [
        { type: "NoName", timestamp: "now" },                // 缺少 name
        validEvent,                                           // 合法
      ],
    };
    const result = parseRpcEventEnvelope(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(validEvent);
  });

  it("type 非字符串时跳过该条目", () => {
    const input = {
      events: [
        { name: "Bad", type: 123, timestamp: "now" },
        validEvent,
      ],
    };
    const result = parseRpcEventEnvelope(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(validEvent);
  });

  it("timestamp 非字符串时跳过该条目", () => {
    const input = {
      events: [
        { name: "Bad", type: "T", timestamp: 12345 },
        validEvent,
      ],
    };
    const result = parseRpcEventEnvelope(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(validEvent);
  });

  it("data 缺失时默认为 {}", () => {
    const result = parseRpcEventEnvelope({
      events: [{ name: "E", type: "T", timestamp: "now" }],
    });
    expect(result[0].data).toEqual({});
  });

  it("triggeredBy 非字符串时设为 undefined", () => {
    const result = parseRpcEventEnvelope({
      events: [{ name: "E", type: "T", timestamp: "now", triggeredBy: 42 }],
    });
    expect(result[0].triggeredBy).toBeUndefined();
  });

  it("correlationId 非字符串时设为 undefined", () => {
    const result = parseRpcEventEnvelope({
      events: [{ name: "E", type: "T", timestamp: "now", correlationId: true }],
    });
    expect(result[0].correlationId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// base64UrlDecode
// ---------------------------------------------------------------------------
describe("base64UrlDecode", () => {
  it("Base64Url 含 -/_ 字符且无 padding 解码正确", () => {
    // "test>?data" 的 base64 编码为 "dGVzdD4/ZGF0YQ=="（含 / 字符）
    // base64url 为 "dGVzdD4_ZGF0YQ"（无 padding）
    const original = "test>?data";
    const b64url = toBase64Url(original);
    // 确认构造的 base64url 确实包含 - 或 _ 字符
    expect(b64url).toMatch(/[-_]/);
    expect(base64UrlDecode(b64url)).toBe(original);
  });

  it("UTF-8 中文文本 round-trip 不损坏", () => {
    const original = '{"name":"订单创建","data":{"订单号":123}}';
    const b64url = toBase64Url(original);
    expect(base64UrlDecode(b64url)).toBe(original);
  });

  it("标准 base64 无 padding 也能解码", () => {
    const original = "hello";
    const b64 = Buffer.from(original, "utf-8").toString("base64"); // "aGVsbG8="
    const noPad = b64.replace(/=+$/, ""); // "aGVsbG8"
    expect(base64UrlDecode(noPad)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// TkwfEventBus
// ---------------------------------------------------------------------------
describe("TkwfEventBus", () => {
  let bus: TkwfEventBus;
  let handler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    bus = new TkwfEventBus();
    handler = vi.fn();
  });

  const makeEvent = (name: string, overrides: Partial<RpcEventData> = {}): RpcEventData => ({
    name,
    type: "TestType",
    data: {},
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("on→emit 匹配事件名时派发到 handler", () => {
    bus.on("OrderCreated", handler);
    bus.emit(makeEvent("OrderCreated"));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("同一事件名注册多个 handler 全部触发", () => {
    const h2 = vi.fn();
    bus.on("E", handler);
    bus.on("E", h2);
    bus.emit(makeEvent("E"));
    expect(handler).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("未注册事件名 emit 时静默 no-op（handler 不被调用）", () => {
    bus.on("Other", handler);
    bus.emit(makeEvent("Unregistered"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("on 返回取消订阅函数，调用后 emit 不再派发该 handler", () => {
    const unsubscribe = bus.on("E", handler);
    unsubscribe();
    bus.emit(makeEvent("E"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("off 移除指定 handler，同事件名其他 handler 不受影响", () => {
    const h2 = vi.fn();
    bus.on("E", handler);
    bus.on("E", h2);
    bus.off("E", handler);
    bus.emit(makeEvent("E"));
    expect(handler).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("off 从未注册的事件/handler 是安全 no-op", () => {
    expect(() => {
      bus.off("NonExistent", handler);
      bus.off("E", handler); // handler 从未注册
    }).not.toThrow();
  });

  it("clear 移除所有 handler，后续 emit 不触发", () => {
    bus.on("E", handler);
    bus.clear();
    bus.emit(makeEvent("E"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("dispatch([]) 是 no-op", () => {
    bus.on("E", handler);
    bus.dispatch([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("dispatch(null) 是 no-op", () => {
    bus.on("E", handler);
    (bus.dispatch as (x: unknown) => void)(null);
    expect(handler).not.toHaveBeenCalled();
  });

  it("dispatch(undefined) 是 no-op", () => {
    bus.on("E", handler);
    (bus.dispatch as (x: unknown) => void)(undefined);
    expect(handler).not.toHaveBeenCalled();
  });

  it("dispatch([evt]) 逐一 emit 到匹配 handler", () => {
    const h2 = vi.fn();
    bus.on("A", handler);
    bus.on("B", h2);
    const evtA = makeEvent("A", { data: { x: 1 } });
    const evtB = makeEvent("B", { data: { y: 2 } });
    bus.dispatch([evtA, evtB]);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(evtA);
    expect(h2).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledWith(evtB);
  });

  it("handler 抛错不向外传播，通过 console.error 记录", () => {
    const err = new Error("handler failure");
    const throwingHandler = vi.fn(() => { throw err; });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    bus.on("E", throwingHandler);
    expect(() => bus.emit(makeEvent("E"))).not.toThrow();
    expect(throwingHandler).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalledWith("[tkwf] event handler error", err);
    consoleSpy.mockRestore();
  });
});