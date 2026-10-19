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
      if (response.status === 429)
        throw new DomainClientError("Rate limited", "RATE_LIMITED");
      if (!response.ok) {
        const errCode = toErrorCode(response.status);
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
}
