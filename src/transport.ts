import type { ErrorCode } from "./domain-client-error";
import { DomainClientError, toErrorCode } from "./domain-client-error";
import { BaseHttpTransport } from "./base-http-transport";

export interface RequestContext {
  field: string;
  type: "query" | "mutation";
  variables?: Record<string, unknown>;
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
    sessionKey?: string;
    signal?: AbortSignal;
    selection?: string;
  }): Promise<T>;
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
    sessionKey?: string;
    signal?: AbortSignal;
    selection?: string;
  }): Promise<T> {
    const { field, type, variables, sessionKey, signal, selection } = operation;

    // Build GraphQL document
    const varNames = variables ? Object.keys(variables) : [];
    const varDecl =
      varNames.length > 0
        ? `(${varNames.map((v) => `$${v}: ${inferGraphQLType(variables![v])}`).join(", ")})`
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
    const ctx: RequestContext = { field, type, variables, signal, timestamp };

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
