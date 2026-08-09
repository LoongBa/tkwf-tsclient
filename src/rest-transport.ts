import { DomainClientError } from "./domain-client-error";
import { BaseHttpTransport } from "./base-http-transport";
import type { RequestContext, TransportOptions } from "./transport";
import { QueryString } from "./query-string";

export interface RestTransportOptions extends TransportOptions {
  /**
   * URL path prefix prepended to the field name.
   * Default: `"/api"`.
   *
   * The full URL becomes `{url}/{pathPrefix}/{field}`.
   * Example: url=`"http://localhost:5000"`, pathPrefix=`"/api"`, field=`"getUsers"`
   *          → `GET http://localhost:5000/api/getUsers`
   */
  pathPrefix?: string;

  /**
   * Explicit URL path overrides per field name.
   * When provided, the field's full URL becomes `{url}{urlMap[field]}`.
   * This takes precedence over `pathPrefix`.
   *
   * Example:
   * ```ts
   * urlMap: {
   *   getUsers:  "/api/v2/merchant/users",
   *   loginByPassword: "/auth/login",
   * }
   * ```
   */
  urlMap?: Record<string, string>;

  /**
   * V4.9.19: Query field names that should send GET + JSON body.
   *
   * When a query operation's field is in this set, its `variables` are
   * serialized as a JSON **body** instead of a query string, while the HTTP
   * method stays `GET` (and `Content-Type: application/json` is set).
   *
   * This is required for server-side `[FromBody]` on GET endpoints
   * (SG2 generated REST endpoints with a single complex DTO parameter).
   *
   * `selection` (`?fields`, projection) still goes to the query string even
   * for body-queries, so projection semantics are preserved.
   *
   * Example:
   * ```ts
   * explicitBodyQueries: new Set(["getMyCoupons", "getClaimCenter", "getExchange"])
   * ```
   */
  explicitBodyQueries?: ReadonlySet<string>;
}

/**
 * REST transport implementation.
 *
 * Maps the abstract `Transport.execute()` operation to standard REST/HTTP:
 *
 * | Operation          | HTTP  | URL                                 |
 * |--------------------|-------|--------------------------------------|
 * | `type: "query"`    | GET   | `{url}/{path}/{field}?{variables}`  |
 * | `type: "mutation"` | POST  | `{url}/{path}/{field}`  (JSON body) |
 *
 * URL Convention (matching C# `Domain.ApiClient.Rest`):
 * - Query  → GET  `/api/{field}?param=value`
 * - Mutation → POST `/api/{field}`  (JSON body)
 *
 * File upload support via explicit `upload()` method.
 *
 * @example
 * ```ts
 * const transport = new RestTransport({
 *   url: "http://localhost:5000",
 *   signHandler: mySignHandler,
 * });
 * const result = await transport.execute({
 *   field: "users",
 *   type: "query",
 *   variables: { page: 1, size: 20 },
 * });
 * // → GET http://localhost:5000/api/users?page=1&size=20
 * ```
 */
export class RestTransport extends BaseHttpTransport {
  private pathPrefix: string;
  private urlMap?: Record<string, string>;
  private explicitBodyQueries?: ReadonlySet<string>;

  constructor(options: RestTransportOptions) {
    super(options);
    this.pathPrefix = options.pathPrefix ?? "/api";
    this.urlMap = options.urlMap;
    this.explicitBodyQueries = options.explicitBodyQueries;
  }

  async execute<T>(operation: {
    field: string;
    type: "query" | "mutation";
    variables?: Record<string, unknown>;
    sessionKey?: string;
    signal?: AbortSignal;
    selection?: string;
  }): Promise<T> {
    const { field, type, variables, sessionKey, signal, selection } = operation;

    // Resolve URL path
    const urlPath = this.urlMap?.[field] ?? `${this.pathPrefix}/${field}`;

    // Map operation type → HTTP method
    const method: string = type === "query" ? "GET" : "POST";

    // V4.9.19: 检查该 query 字段是否应发送 GET + JSON body
    const getWithBody = type === "query" && this.explicitBodyQueries?.has(field) === true;

    // Headers
    const headers: Record<string, string> = {};
    if (sessionKey) headers["X-Session-Key"] = sessionKey;
    // POST 始终需要 Content-Type；GET + body 也需要
    if (method !== "GET" || getWithBody) headers["Content-Type"] = "application/json";

    const timestamp = new Date().toISOString();
    const ctx: RequestContext = { field, type, variables, signal, timestamp };

    // Build URL and body
    let url: string;
    let body: string;
    if (method === "GET" && !getWithBody) {
      // 原有 GET 逻辑：variables → query string
      const mergedVars = { ...(variables ?? {}) } as Record<string, unknown>;
      if (selection) {
        // GraphQL "{ Id Name Amount }" → REST "Id,Name,Amount" for ?fields
        mergedVars.fields = RestTransport.selectionToFields(selection);
      }
      const qs = QueryString.composite(mergedVars);
      url = `${this.options.url}${urlPath}${qs}`;
      body = "";
    } else {
      // POST 或 GET + body：variables → JSON body
      url = `${this.options.url}${urlPath}`;
      // V4.9.19: GET + body 时 selection(?fields) 仍走 query string 保持投影语义
      if (getWithBody && selection) {
        url += QueryString.composite({ fields: RestTransport.selectionToFields(selection) });
      }
      body = JSON.stringify(variables ?? {});
    }

    return this.executeHttp<T>({ url, method, headers, body }, ctx);
  }

  // V4.9.20: QueryBuilder 是 GraphQL 专属能力，REST 模式不支持。
  async executeRawGraphQL<T>(_query: string, _sessionKey?: string, _signal?: AbortSignal): Promise<T> {
    throw new Error("QueryBuilder is GraphQL-only; REST transport does not support executeRawGraphQL.");
  }

  /**
   * V4.9.19: 将 GraphQL selection 字符串（如 "{ Id Name Amount }"）转换为
   * REST ?fields 参数值（如 "Id,Name,Amount"）。
   */
  private static selectionToFields(selection: string): string {
    return selection
      .replace(/[{}]/g, "")
      .replace(/,/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .join(",");
  }

  protected parseResponse<T>(json: unknown, _status: number): T {
    return json as T;
  }

  /**
   * Upload a file via multipart/form-data POST.
   * REST-specific capability (not available on GraphQL transport).
   *
   * @param field   - URL path (e.g. `"merchant/upload"`)
   * @param file    - File or Blob to upload
   * @param fieldName - Form field name for the file (default: `"file"`)
   * @param extraFields - Additional form fields
   * @param sessionKey - Session key for auth header
   * @param signal  - Optional AbortSignal
   */
  async uploadFile<T>(
    field: string,
    file: Blob,
    fieldName: string = "file",
    extraFields?: Record<string, string>,
    sessionKey?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const urlPath = this.urlMap?.[field] ?? `${this.pathPrefix}/${field}`;
    const url = `${this.options.url}${urlPath}`;

    const formData = new FormData();
    formData.append(fieldName, file);
    if (extraFields) {
      for (const [key, value] of Object.entries(extraFields)) {
        formData.append(key, value);
      }
    }

    const headers: Record<string, string> = {};
    if (sessionKey) headers["X-Session-Key"] = sessionKey;

    const timestamp = new Date().toISOString();
    const ctx: RequestContext = { field, type: "mutation", timestamp, signal };

    const startTime =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    // onRequest interceptor
    if (this.options.onRequest) {
      const modified = await this.options.onRequest(ctx);
      if (modified) Object.assign(ctx, modified);
    }

    // signHandler
    if (this.options.signHandler) {
      const extraHeaders = await this.options.signHandler({
        url,
        method: "POST",
        headers,
        timestamp,
      });
      Object.assign(headers, extraHeaders);
    }

    // fetch with FormData (can't use executeHttp because FormData ≠ string body)
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        credentials: "include",
        signal: ctx.signal,
        body: formData,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new DomainClientError("Upload cancelled", "CANCELLED", err);
      }
      throw err;
    }

    if (response.status === 401) {
      throw new DomainClientError("Session expired", "AUTH_EXPIRED", 401);
    }
    if (!response.ok) {
      throw new Error(`Upload failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as T;

    const durationMs =
      typeof performance !== "undefined"
        ? performance.now() - startTime
        : Date.now() - (startTime as number);

    if (this.options.onResponse) {
      this.options.onResponse(
        { data: data as T, durationMs, request: ctx },
        ctx,
      );
    }

    return data;
  }
}
