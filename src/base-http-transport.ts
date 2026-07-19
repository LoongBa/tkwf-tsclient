import type { ErrorCode } from "./domain-client-error";
import { DomainClientError, toErrorCode } from "./domain-client-error";
import type {
  Transport,
  TransportOptions,
  RequestContext,
  ResponseContext,
} from "./transport";

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
    signal?: AbortSignal;
    selection?: string;
  }): Promise<T>;

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
    const data = await this.executeWithRetry<T>(async () => {
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

      // HTTP status → canonical error code
      if (response.status === 401)
        throw new DomainClientError("Session expired", "AUTH_EXPIRED", 401);
      if (response.status === 429)
        throw new DomainClientError("Rate limited", "RATE_LIMITED");
      if (!response.ok) {
        const errCode = toErrorCode(response.status);
        throw new DomainClientError(`HTTP ${response.status}`, errCode);
      }

      const json = await response.json();
      return this.parseResponse<T>(json, response.status);
    }, ctx.field);

    // ④ onResponse callback
    const durationMs =
      typeof performance !== "undefined"
        ? performance.now() - startTime
        : Date.now() - (startTime as number);

    if (this.options.onResponse) {
      this.options.onResponse(
        { data: data as T, durationMs, request: ctx } satisfies ResponseContext<T>,
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
