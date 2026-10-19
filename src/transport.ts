import type { ErrorCode } from "./domain-client-error";
import { DomainClientError, toErrorCode } from "./domain-client-error";
import { BaseHttpTransport } from "./base-http-transport";
import type { RpcEventData } from "./event";
import { parseRpcEventEnvelope } from "./event";

export interface RequestContext {
  field: string;
  type: "query" | "mutation";
  variables?: Record<string, unknown>;
  /** V4.9.26: 显式变量 GraphQL 类型声明。用于对象/复杂输入类型（如 LoginContextInput），
   * 默认 inferGraphQLType 对对象只能推断为 JSON，无法匹配 schema 的具体输入类型。 */
  variableTypes?: Record<string, string>;
  signal?: AbortSignal;
  timestamp: string;
}

export interface ResponseContext<T = unknown> {
  data: T;
  durationMs: number;
  request: RequestContext;
  /** V1.0.8: RPC 响应携带事件（ADR33 侧信道）。无事件时为 undefined。 */
  events?: RpcEventData[];
}

export type SignHandler = (context: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timestamp: string;
}) => Record<string, string> | Promise<Record<string, string>>;

export interface TransportOptions {
  url: string;
  signHandler?: SignHandler;
  onRequest?: (
    req: RequestContext,
  ) => void | RequestContext | Promise<RequestContext | void>;
  onResponse?: (res: ResponseContext, req: RequestContext) => void;
  retry?: {
    maxAttempts: number;
    baseDelaySeconds: number;
    maxDelaySeconds: number;
    jitter: boolean;
    retryOn: ErrorCode[];
  };
}

export interface Transport {
  execute<T>(operation: {
    field: string;
    type: "query" | "mutation";
    variables?: Record<string, unknown>;
    /** V4.9.26: 显式变量 GraphQL 类型声明。覆盖 inferGraphQLType 的自动推断（后者对 complex object 只能返回 JSON）。 */
    variableTypes?: Record<string, string>;
    sessionKey?: string;
    /** V1.0.12: 外部 IdP（JWT）会话的 Bearer 凭据——携带 Authorization: Bearer <bearerToken>。 */
    bearerToken?: string;
    signal?: AbortSignal;
    selection?: string;
  }): Promise<T>;

  /** V4.9.20: 执行原始 GraphQL 查询字符串（QueryBuilder 使用）。 */
  executeRawGraphQL<T>(
    query: string,
    sessionKey?: string,
    signal?: AbortSignal,
    /** V1.0.12: 尾参追加（源兼容）——JWT 会话 Bearer 凭据。 */
    bearerToken?: string,
  ): Promise<T>;

  // ── V1.0.12: 外部 IdP 登录能力（P3 能力即注册，null 即不支持）──
  /**
   * V1.0.12: 外部 IdP 登录——对接认证中心 `POST {base}{urlMap["loginByExternal"]}`
   *（默认 `/api/auth/login/external/{channelType}`）。仅 RestTransport 实现；
   * GraphQLTransport 不注册（null = 不支持，调用方守卫抛 EXTERNAL_LOGIN_FAILED）。
   */
  loginByExternal?(input: {
    channelType: string;
    parameters: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<ExternalLoginResult>;

  /** V1.0.12: 外部 IdP 会话续期——`POST {base}{urlMap["refreshToken"] ?? "/api/auth/refresh"}`，
   *  body `{ refreshToken }`（camelCase 显式契约）。仅 RestTransport 实现。 */
  refreshToken?(input: {
    refreshToken: string;
    signal?: AbortSignal;
  }): Promise<ExternalLoginResult>;
}

/**
 * V1.0.12: 外部 IdP 登录结果——与服务端 AuthCenter `TokenResponse` wire 契约 1:1 映射（P2 下游纯消费）。
 * 服务端 wire 为 camelCase（record 无 [JsonPropertyName]，Results.Ok 默认 camelCase）：
 * `accessToken` / `refreshToken` / `tokenType` / `expiresIn`。严格 4 字段（不含 userName/displayName——
 * 服务端无此二字段，JWT claims 亦无显示名；消费方按需另调 profile API，N2）。
 */
export interface ExternalLoginResult {
  accessToken: string;
  refreshToken: string;
  tokenType: string;   // "Bearer"
  expiresIn: number;   // 秒（服务端 ExpiresIn int）
}

/**
 * GraphQL transport implementation.
 *
 * Builds a GraphQL document from the operation parameters, then delegates
 * the HTTP lifecycle (interceptors, signing, fetch, retry) to BaseHttpTransport.
 */
export class GraphQLTransport extends BaseHttpTransport {
  constructor(options: TransportOptions) {
    super(options);
  }

  async execute<T>(operation: {
    field: string;
    type: "query" | "mutation";
    variables?: Record<string, unknown>;
    variableTypes?: Record<string, string>;
    sessionKey?: string;
    bearerToken?: string;
    signal?: AbortSignal;
    selection?: string;
  }): Promise<T> {
    const { field, type, variables, variableTypes, sessionKey, bearerToken, signal, selection } = operation;

    // Build GraphQL document
    const varNames = variables ? Object.keys(variables) : [];
    const varDecl =
      varNames.length > 0
        ? `(${varNames.map((v) => `$${v}: ${variableTypes?.[v] ?? inferGraphQLType(variables![v])}`).join(", ")})`
        : "";
    const varPass =
      varNames.length > 0
        ? `(${varNames.map((v) => `${v}: $${v}`).join(", ")})`
        : "";

    const sel = selection ? ` { ${selection} }` : "";
    const document = `${type}${varDecl} { ${field}${varPass}${sel} }`;

    // Prepare request
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (sessionKey) headers["X-Session-Key"] = sessionKey;
    // V1.0.12: JWT 会话 Bearer 携带（与 X-Session-Key 并列，两形态互斥由 DomainClientUser 保证）
    if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;

    const timestamp = new Date().toISOString();
    const ctx: RequestContext = { field, type, variables, variableTypes, signal, timestamp };

    return this.executeHttp<T>(
      {
        url: this.options.url,
        method: "POST",
        headers,
        body: JSON.stringify({ query: document, variables }),
      },
      ctx,
    );
  }

  protected parseResponse<T>(json: unknown, status: number): T {
    const { data, errors } = json as { data?: T; errors?: unknown[] };
    if (errors?.length) {
      const firstErr = errors[0] as { message?: string } | undefined;
      const errCode = toErrorCode(status, errors);
      throw new DomainClientError(
        firstErr?.message ?? "GraphQL error",
        errCode,
        errors,
      );
    }
    return data as T;
  }

  protected extractEvents(json: unknown, _headers: Headers): RpcEventData[] | undefined {
    const extensions = (json as { extensions?: { tkwf?: { events?: unknown[] } } })?.extensions?.tkwf?.events;
    if (!Array.isArray(extensions) || extensions.length === 0) return undefined;
    // Oracle S1: 与 REST 路径一致，经 parseRpcEventEnvelope 逐条过滤——畸形条目（如 null/缺 name）
    // 不进入 res.events，也不暴露给用户 onResponse（对齐"单条失败不丢整个侧信道"语义）。
    const events = parseRpcEventEnvelope({ events: extensions });
    return events.length ? events : undefined;
  }

  // V4.9.20: 执行原始 GraphQL 查询字符串（QueryBuilder 使用）。
  // 复用 BaseHttpTransport 的签名/拦截器/重试链路。
  async executeRawGraphQL<T>(
    query: string,
    sessionKey?: string,
    signal?: AbortSignal,
    bearerToken?: string,  // V1.0.12: 尾参追加（源兼容），JWT 会话 Bearer 凭据
  ): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sessionKey) headers["X-Session-Key"] = sessionKey;
    if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;  // V1.0.12
    const timestamp = new Date().toISOString();
    const ctx: RequestContext = { field: "raw", type: "query", timestamp, signal };
    return this.executeHttp<T>(
      { url: this.options.url, method: "POST", headers, body: JSON.stringify({ query }) },
      ctx,
    );
  }
}

function inferGraphQLType(value: unknown): string {
  if (value === null || value === undefined) return "String!";
  if (typeof value === "number") return Number.isInteger(value) ? "Int!" : "Float!";
  if (typeof value === "boolean") return "Boolean!";
  if (Array.isArray(value))
    return `[${inferGraphQLType(value[0])}]`;
  if (typeof value === "object") return "JSON";
  return "String!";
}
