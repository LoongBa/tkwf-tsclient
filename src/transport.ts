import type { ErrorCode } from "./domain-client-error";
import { DomainClientError, toErrorCode } from "./domain-client-error";
import { BaseHttpTransport } from "./base-http-transport";

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
    signal?: AbortSignal;
    selection?: string;
  }): Promise<T>;

  /** V4.9.20: 执行原始 GraphQL 查询字符串（QueryBuilder 使用）。 */
  executeRawGraphQL<T>(query: string, sessionKey?: string, signal?: AbortSignal): Promise<T>;
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
    signal?: AbortSignal;
    selection?: string;
  }): Promise<T> {
    const { field, type, variables, variableTypes, sessionKey, signal, selection } = operation;

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

  // V4.9.20: 执行原始 GraphQL 查询字符串（QueryBuilder 使用）。
  // 复用 BaseHttpTransport 的签名/拦截器/重试链路。
  async executeRawGraphQL<T>(query: string, sessionKey?: string, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sessionKey) headers["X-Session-Key"] = sessionKey;
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
