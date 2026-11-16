import type { ErrorCode } from "./domain-client-error";
import { DomainClientError, toErrorCode } from "./domain-client-error";
import type {
  Transport,
  TransportOptions,
  RequestContext,
  ResponseContext,
} from "./transport";
import type { RpcEventData } from "./event";

/**
 * Base class for HTTP-based transport implementations.
 *
 * Provides the common HTTP lifecycle:
 * ① onRequest interceptor → ② signHandler → ③ fetch + retry → ④ onResponse callback
 *
 * Subclasses only need to implement:
 * - `execute()` — builds protocol-specific request body
 * - `parseResponse()` — extracts result from protocol-specific response format
 */
export abstract class BaseHttpTransport implements Transport {
  protected options: TransportOptions;

  constructor(options: TransportOptions) {
    const defaultRetry = { maxAttempts: 3, baseDelaySeconds: 1, maxDelaySeconds: 10, jitter: true, retryOn: ["NETWORK_ERROR", "SERVER_ERROR"] as ErrorCode[] };
    this.options = {
      ...options,
      retry: options.retry ?? defaultRetry,
    };
  }

  abstract execute<T>(operation: {
    field: string;
    type: "query" | "mutation";
    variables?: Record<string, unknown>;
    sessionKey?: string;
    bearerToken?: string;  // V1.0.12
    signal?: AbortSignal;
    selection?: string;
  }): Promise<T>;

  /** V4.9.20: 执行原始 GraphQL 查询字符串（QueryBuilder 使用）。 */
  abstract executeRawGraphQL<T>(
    query: string,
    sessionKey?: string,
    signal?: AbortSignal,
    bearerToken?: string,  // V1.0.12: 尾参追加（源兼容）
  ): Promise<T>;

  /**
   * Execute an HTTP request through the full lifecycle.
   *
   * @param request - The pre-built HTTP request (url, method, headers, body string)
   * @param ctx     - Request context for interceptors and timing
   */
  protected async executeHttp<T>(
    request: { url: string; method: string; headers: Record<string, string>; body: string },
    ctx: RequestContext,
  ): Promise<T> {
    const startTime =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    // ① onRequest interceptor — may mutate ctx
    if (this.options.onRequest) {
      const modified = await this.options.onRequest(ctx);
      if (modified) Object.assign(ctx, modified);
    }

    // ② signHandler — adds extra headers
    if (this.options.signHandler) {
      const extraHeaders = await this.options.signHandler({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
        timestamp: ctx.timestamp,
      });
      Object.assign(request.headers, extraHeaders);
    }

    // ③ fetch + retry
    const { data, json, headers } = await this.executeWithRetry<{
      data: T; json: unknown; headers: Headers;
    }>(async () => {
      let response: Response;
      try {
        response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          credentials: "same-origin",
          signal: ctx.signal,
          body: request.body || undefined,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new DomainClientError("Request cancelled", "CANCELLED", err);
        }
        if (err instanceof TypeError) {
          throw new DomainClientError("Network error", "NETWORK_ERROR", err);
        }
        throw err;
      }

      // Read response body text first (needed for error code parsing)
      const bodyText = await response.text();

      // HTTP status → canonical error code
      if (response.status === 401) {
        const errCode = toErrorCode(401, undefined, bodyText);
        throw new DomainClientError(
          errCode === "AUTH_REQUIRED" ? "未登录或会话已过期" :
          errCode === "AUTH_FAILED" ? "登录失败，用户名或密码错误" :
          "Session expired",
          errCode, 401);
      }
      if (response.status === 429) {
        // V1.1.0（P1-3 闭环）：429 不再丢弃 body/headers——解析 retryAfterSeconds 挂错误扩展字段，
        // 供调用方驱动倒计时（DMP send-code 429 body `retryAfterSeconds`；平台端点 `Retry-After` 头）。
        // 状态码保持固定 RATE_LIMITED 映射（与 body `rate_limited`/`TICKET_RATE_LIMITED` 语义等价，
        // 不改变既有 retryOn/RATE_LIMITED 行为）；SDK 不自动重试 429（RATE_LIMITED 不在默认 retryOn）。
        const retryAfterSeconds = BaseHttpTransport.parseRetryAfter(bodyText, response.headers);
        throw new DomainClientError("Rate limited", "RATE_LIMITED", undefined, retryAfterSeconds);
      }
      if (!response.ok) {
        // V1.0.15: 传入 bodyText 供 toErrorCode 开放业务码透传（400/403 的 {"error":"<code>"} 此前被丢弃恒 UNKNOWN）
        const errCode = toErrorCode(response.status, undefined, bodyText);
        throw new DomainClientError(`HTTP ${response.status}`, errCode);
      }

      const json = JSON.parse(bodyText);
      const data = this.parseResponse<T>(json, response.status);
      return { data, json, headers: response.headers };
    }, ctx.field);

    // ④ onResponse callback
    const durationMs =
      typeof performance !== "undefined"
        ? performance.now() - startTime
        : Date.now() - (startTime as number);

    const events = this.extractEvents(json, headers);
    if (this.options.onResponse) {
      this.options.onResponse(
        { data: data as T, durationMs, request: ctx, ...(events ? { events } : {}) } satisfies ResponseContext<T>,
        ctx,
      );
    }

    return data as T;
  }

  /**
   * Parse the HTTP JSON response body.
   * Subclasses override this to handle protocol-specific response formats.
   *
   * @param json   - Parsed JSON from the response body
   * @param status - HTTP status code (for error mapping)
   */
  protected abstract parseResponse<T>(json: unknown, status: number): T;

  /**
   * V1.0.8: 从响应中提取 RPC 事件载荷（ADR33 侧信道）。
   * @param json    - 已解析的响应 JSON（GraphQL 用 extensions；REST 用不到）
   * @param headers - fetch Response 头（REST 用 X-TKWF-Events）
   * @returns 事件数组；无事件返回 undefined
   */
  protected extractEvents(_json: unknown, _headers: Headers): RpcEventData[] | undefined {
    return undefined;
  }

  // ── Retry machinery ──────────────────────────────────────────────────────

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    _fieldName: string,
    attempt: number = 0,
  ): Promise<T> {
    const retryConfig = this.options.retry!;
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        err instanceof DomainClientError &&
        retryConfig.retryOn.includes(err.code) &&
        attempt + 1 < retryConfig.maxAttempts;

      if (isRetryable) {
        const delayMs =
          BaseHttpTransport.calculateBackoff(
            attempt + 1,
            retryConfig.baseDelaySeconds,
            retryConfig.maxDelaySeconds,
            retryConfig.jitter,
          ) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.executeWithRetry(fn, _fieldName, attempt + 1);
      }
      throw err;
    }
  }

  /** Exponential backoff with optional jitter */
  static calculateBackoff(
    attempt: number,
    baseSeconds: number,
    maxSeconds: number,
    jitter: boolean,
  ): number {
    const delay = Math.min(baseSeconds * Math.pow(2, attempt - 1), maxSeconds);
    return jitter ? delay * (0.5 + Math.random() * 0.5) : delay;
  }

  /**
   * V1.1.0（P1-3）：从 429 响应解析重试等待秒数——优先级：
   * 1. body `retryAfterSeconds`（DMP 端点契约，number 或字符串数字）
   * 2. body `retryAfter`（同形态兜底）
   * 3. `Retry-After` 响应头（平台端点：整秒数，或 HTTP-date 按当前时钟差计算）
   * 解析失败/缺失 → undefined（调用方按自身策略，如固定提示）。
   */
  private static parseRetryAfter(bodyText: string, headers: Headers): number | undefined {
    if (bodyText) {
      try {
        const body = JSON.parse(bodyText) as Record<string, unknown>;
        for (const key of ["retryAfterSeconds", "retryAfter"]) {
          const v = body?.[key];
          if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
          if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0) {
            return Number(v);
          }
        }
      } catch { /* body 非 JSON（如纯文本）→ 走 Retry-After 头 */ }
    }
    const header = headers?.get?.("Retry-After");
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds;
      const date = Date.parse(header);
      if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
    }
    return undefined;
  }
}
