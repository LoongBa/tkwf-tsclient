import { DomainClientError } from "./domain-client-error";
import { BaseHttpTransport } from "./base-http-transport";
import type { RequestContext, TransportOptions, ResponseContext, ExternalLoginResult } from "./transport";
import { parseRpcEventEnvelope, base64UrlDecode, type RpcEventData } from "./event";
import { QueryString } from "./query-string";

/**
 * 默认外部 IdP 登录端点 path（V1.0.12）——对齐认证中心 AuthCenter RoutePrefix 默认 `/api/auth`
 * （`AuthCenterEndpointOptions.RoutePrefix`，探索实证）。消费方可经 `urlMap["loginByExternal"]` 覆盖。
 * 支持 `{channelType}` 模板参数（urlMap 模板扩展，仅 loginByExternal 使用）。
 */
const DEFAULT_EXTERNAL_LOGIN_PATH = "/api/auth/login/external/{channelType}";

/** 默认 refresh 端点 path（V1.0.12）——AuthCenter `POST {prefix}/refresh`。 */
const DEFAULT_REFRESH_PATH = "/api/auth/refresh";

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
    bearerToken?: string;  // V1.0.12
    signal?: AbortSignal;
    selection?: string;
  }): Promise<T> {
    const { field, type, variables, sessionKey, bearerToken, signal, selection } = operation;

    // Resolve URL path
    const urlPath = this.urlMap?.[field] ?? `${this.pathPrefix}/${field}`;

    // Map operation type → HTTP method
    const method: string = type === "query" ? "GET" : "POST";

    // V4.9.19: 检查该 query 字段是否应发送 GET + JSON body
    const getWithBody = type === "query" && this.explicitBodyQueries?.has(field) === true;

    // Headers
    const headers: Record<string, string> = {};
    if (sessionKey) headers["X-Session-Key"] = sessionKey;
    // V1.0.12: JWT 会话 Bearer 携带
    if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;
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
  async executeRawGraphQL<T>(
    _query: string,
    _sessionKey?: string,
    _signal?: AbortSignal,
    _bearerToken?: string,  // V1.0.12: 签名一致性（REST 不支持，恒抛）
  ): Promise<T> {
    throw new Error("QueryBuilder is GraphQL-only; REST transport does not support executeRawGraphQL.");
  }

  // ── V1.0.12: 外部 IdP 登录能力（P3 能力即注册——仅 RestTransport 实现；GraphQLTransport 不注册）──

  /**
   * V1.0.12: 外部 IdP 登录——对接认证中心 `POST {base}{path}/login/external/{channelType}`。
   *
   * - path 解析 = URL 单一事实源 urlMap：`urlMap["loginByExternal"] ?? DEFAULT_EXTERNAL_LOGIN_PATH`
   * - `{channelType}` 模板参数经 `encodeURIComponent` 注入 path（S2，防特殊字符路径错配）
   * - body = 参数原样透传（含 code/channel_id/state/ticket 等平台协议字段，无客户端枚举）
   * - 成功 → `ExternalLoginResult`（camelCase wire 1:1 映射）；响应缺 accessToken → `JWT_SESSION_INVALID`
   * - 沿用 BaseHttpTransport 生命周期（onRequest/signHandler/retry/onResponse/事件）
   */
  async loginByExternal(input: {
    channelType: string;
    parameters: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<ExternalLoginResult> {
    if (!input.channelType || !input.channelType.trim()) {
      // 守卫硬失败（前置校验，不送服务端）
      throw new DomainClientError(
        "External login failed: channelType must be a non-empty string.",
        "INVALID_ARGUMENT",
      );
    }
    if (!input.parameters.code && !input.parameters.ticket) {
      throw new DomainClientError(
        "External login failed: 'code' (or 'ticket' for the ticket channel) parameter is required.",
        "INVALID_ARGUMENT",
      );
    }

    const rawPath = this.urlMap?.["loginByExternal"] ?? DEFAULT_EXTERNAL_LOGIN_PATH;
    const path = rawPath.replace(/\{channelType\}/g, encodeURIComponent(input.channelType.trim()));
    const url = `${this.options.url}${path}`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const timestamp = new Date().toISOString();
    const ctx: RequestContext = {
      field: "loginByExternal",
      type: "mutation",
      variables: input.parameters,
      signal: input.signal,
      timestamp,
    };

    return this.executeHttp<ExternalLoginResult>(
      { url, method: "POST", headers, body: JSON.stringify(input.parameters) },
      ctx,
    );
  }

  /**
   * V1.0.12: 外部 IdP 会话续期——`POST {base}{urlMap["refreshToken"] ?? "/api/auth/refresh"}`。
   *
   * - body = `JSON.stringify({ refreshToken })`（camelCase 显式契约——服务端 RefreshRequest 无
   *   [JsonPropertyName]，wire key 为 `refreshToken`，非 `refresh_token`）
   * - 4xx（refresh token 失效/被撤销）→ 抛 `JWT_SESSION_INVALID`（M7 错误分层：与 access 401 AUTH_EXPIRED 可区分；
   *   调用方据此决定 re-prompt 而非自动跳转）
   * - 网络失败（NETWORK_ERROR）→ 保留 externalSession（access 仍可用至过期）——S4 语义由调用方分层
   */
  async refreshToken(input: {
    refreshToken: string;
    signal?: AbortSignal;
  }): Promise<ExternalLoginResult> {
    if (!input.refreshToken) {
      throw new DomainClientError(
        "External session refresh failed: refreshToken is required.",
        "INVALID_ARGUMENT",
      );
    }

    const path = this.urlMap?.["refreshToken"] ?? DEFAULT_REFRESH_PATH;
    const url = `${this.options.url}${path}`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const timestamp = new Date().toISOString();
    const ctx: RequestContext = {
      field: "refreshToken",
      type: "mutation",
      variables: { refreshToken: input.refreshToken },
      signal: input.signal,
      timestamp,
    };

    try {
      return await this.executeHttp<ExternalLoginResult>(
        {
          url,
          method: "POST",
          headers,
          body: JSON.stringify({ refreshToken: input.refreshToken }),
        },
        ctx,
      );
    } catch (err) {
      // M7/S4 错误分层（Oracle 代码审核 M4）：仅把**明确的 refresh 业务失败**归一为 JWT_SESSION_INVALID——
      // refresh token 失效/被撤销（服务端 4xx 且 body 命中 INVALID_ARGUMENT / JWT_SESSION_INVALID / AUTH_EXPIRED）。
      // 不归一：NETWORK_ERROR/CANCELLED/TIMEOUT（网络瞬态，保留会话由调用方决策）+
      // SERVER_ERROR/RATE_LIMITED（5xx/429 是服务端瞬态故障——归一为 JWT_SESSION_INVALID 会让调用方
      // （一旦 M1 修复）清会话强制重登，违反 P7 不可逆状态变更原则）。
      if (
        err instanceof DomainClientError &&
        (err.code === "JWT_SESSION_INVALID" ||
          err.code === "INVALID_ARGUMENT" ||
          err.code === "AUTH_EXPIRED")
      ) {
        throw new DomainClientError(
          "External session expired — refresh token is invalid or revoked. Please re-authenticate.",
          "JWT_SESSION_INVALID",
          err,
        );
      }
      throw err;
    }
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
   * V1.0.8: 从 REST 响应头提取 RPC 事件。
   *
   * `X-TKWF-Events` 携带 Base64Url(UTF-8 JSON) 编码的事件信封。
   * 全链路容忍失败（解码/解析失败一律丢弃），绝不阻断业务流。
   */
  protected extractEvents(_json: unknown, headers: Headers): RpcEventData[] | undefined {
    const raw = headers.get("X-TKWF-Events");
    if (!raw) return undefined;
    // 截断标记——4KB 预算截断后 payload 是不完整 JSON，尽力解析失败则丢弃（不阻断业务）
    if (headers.get("X-TKWF-Events-Truncated") === "true") {
      console.warn("[tkwf] RPC events truncated (4KB budget), partial parse may fail");
    }
    let decoded: string;
    try { decoded = base64UrlDecode(raw); }
    catch { return undefined; }          // 解码失败 → 丢弃，不阻断业务
    const env = parseRpcEventEnvelope(decoded); // 内部 JSON.parse try/catch → []
    return env.length ? env : undefined;
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
    bearerToken?: string,  // V1.0.12: 尾参追加（源兼容）；JWT 会话 Bearer 凭据
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
    if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;  // V1.0.12

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

    // V1.0.8: 上传路径同样提取并携带事件（Oracle S2）
    const events = this.extractEvents(data, response.headers);
    if (this.options.onResponse) {
      this.options.onResponse(
        { data: data as T, durationMs, request: ctx, ...(events ? { events } : {}) } satisfies ResponseContext<T>,
        ctx,
      );
    }

    return data;
  }
}
