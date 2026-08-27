/**
 * V1.0.8 — RPC 响应携带事件（ADR33 阶段 3）：跨进程事件契约 + 进程内事件总线。
 *
 * 本模块定义服务端 RPC 响应侧信道携带的领域事件载荷类型，并提供容错解析、
 * Base64Url 解码与本地事件派发能力。事件是尽力而为的附加（best-effort），
 * 不得阻断业务结果。
 */

/**
 * Node.js `Buffer` 的最小类型声明。
 * 仓库未依赖 `@types/node`，此处仅为编译期提供 `Buffer.from(...)` 的类型，
 * 运行时在 Node 环境中仍取全局 `Buffer`。
 */
declare const Buffer: {
  from(data: string, encoding: "base64"): {
    toString(encoding: "binary"): string;
  };
};

/** 单个 RPC 响应携带的领域事件（对齐 ADR33 §决策 2 载荷）。 */
export interface RpcEventData {
  name: string;
  type: string;
  /** 事件字段（JSON 化）。框架侧"事件字段 JSON 化"未限定为对象，用 unknown 保持契约严谨。 */
  data: unknown;
  triggeredBy?: string;
  timestamp: string;
  correlationId?: string;
}

/** RPC 响应事件载荷 envelope。 */
export interface RpcEventEnvelope {
  events: RpcEventData[];
}

/** 事件 Handler：收到匹配事件名时回调。 */
export type EventHandler = (event: RpcEventData) => void;

/**
 * 容错解析：逐条过滤，单条非法跳过，其余保留（对齐框架侧"单条失败不丢整个侧信道"）。
 *
 * 同时接受已解析对象与 JSON 字符串；整体非法返回 `[]`，内部 `JSON.parse`
 * 异常时 try/catch 返回 `[]`。
 */
export function parseRpcEventEnvelope(raw: unknown): RpcEventData[] {
  let env: unknown = raw;
  if (typeof raw === "string") {
    try {
      env = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!env || typeof env !== "object") return [];
  const events = (env as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];

  const out: RpcEventData[] = [];
  for (const item of events) {
    const e = item as Record<string, unknown> | null | undefined;
    if (!e) continue;
    if (
      typeof e.name !== "string" ||
      typeof e.type !== "string" ||
      typeof e.timestamp !== "string"
    ) {
      continue; // 跳过非法条目
    }
    out.push({
      name: e.name,
      type: e.type,
      data: e.data ?? {},
      triggeredBy: typeof e.triggeredBy === "string" ? e.triggeredBy : undefined,
      timestamp: e.timestamp,
      correlationId: typeof e.correlationId === "string" ? e.correlationId : undefined,
    });
  }
  return out;
}

/**
 * Base64Url(UTF-8 JSON) 解码。框架侧 REST 侧信道固定此编码。
 *
 * 解码失败由调用方（RestTransport）捕获处理，本函数不自行 try/catch。
 */
export function base64UrlDecode(str: string): string {
  // ① Base64Url 字母表 → 标准 Base64（-/_ 替代 +//）
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // ② 补 padding（Base64Url 通常省略 =）
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  // ③ 跨环境二进制解码 + UTF-8 还原（关键：中文事件名/data 不可损坏）
  const binary =
    typeof atob === "function"
      ? atob(padded) // 浏览器
      : Buffer.from(padded, "base64").toString("binary"); // Node
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * TkwfEventBus — 进程内事件注册与派发器（仅服务 RPC 同步事件）。
 *
 * 内部按事件名索引 Handler；事件派发不得破坏主流程返回值。
 */
export class TkwfEventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  /**
   * 注册 Handler，返回取消订阅函数。
   * @param eventName 事件名（匹配 RpcEventData.name）
   * @param handler 收到匹配事件名时回调
   * @returns 取消订阅函数
   */
  on(eventName: string, handler: EventHandler): () => void {
    let set = this.handlers.get(eventName);
    if (!set) {
      set = new Set<EventHandler>();
      this.handlers.set(eventName, set);
    }
    set.add(handler);
    return () => this.off(eventName, handler);
  }

  /**
   * 显式注销 Handler。
   * @param eventName 事件名
   * @param handler 需移除的 Handler
   */
  off(eventName: string, handler: EventHandler): void {
    const set = this.handlers.get(eventName);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.handlers.delete(eventName);
  }

  /**
   * 按 name 匹配并派发到已注册 Handler。
   * 未注册事件名静默 no-op；Handler 抛错不向外传播（console.error 记录）。
   * @param event 待派发的领域事件
   */
  emit(event: RpcEventData): void {
    const set = this.handlers.get(event.name);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch (err) {
        console.error("[tkwf] event handler error", err);
      }
    }
  }

  /**
   * 解包 envelope 并逐一 emit（内部供 transport 层调用）。
   * 防御性处理：空/非法输入直接返回。
   * @param envelope 事件数组
   */
  dispatch(envelope: RpcEventData[]): void {
    if (!Array.isArray(envelope) || envelope.length === 0) return;
    for (const event of envelope) this.emit(event);
  }

  /**
   * 清空所有 Handler（dispose 用）。
   */
  clear(): void {
    this.handlers.clear();
  }
}
