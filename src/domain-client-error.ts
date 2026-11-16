import {
  SERVER_CODE_MAP as GeneratedServerCodeMap,
  type ErrorCode as ServerErrorCode,
} from "./generated/error-codes";

/** Client-side error codes (includes server codes + client-only codes) */
export type ErrorCode =
  | ServerErrorCode
  | "AUTH_EXPIRED"
  | "SERVER_ERROR"
  | "TIMEOUT"
  | "CANCELLED"
  | "RATE_LIMITED"
  | "UNKNOWN"
  // V1.0.12: 外部 IdP 登录（JWT 会话）客户端码 —— 与既有客户端独有码同位（非生成物）
  | "INVALID_ARGUMENT"
  | "EXTERNAL_LOGIN_FAILED"
  | "JWT_SESSION_INVALID";

/** Base error class for all RPC errors */
export class DomainClientError extends Error {
  readonly code: ErrorCode;
  readonly cause?: unknown;
  /** V1.1.0（P1-3 闭环）：429 频控命中的重试等待秒数——DMP 端点读 body `retryAfterSeconds` /
   *  平台端点读 `Retry-After` 响应头（秒或 HTTP-date）。未命中（无 body/头字段）为 undefined。
   *  供调用方驱动倒计时（send-code 429 场景），SDK 不自动重试（RATE_LIMITED 不在默认 retryOn）。 */
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    code: ErrorCode,
    cause?: unknown,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "DomainClientError";
    this.code = code;
    this.cause = cause;
    if (retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = retryAfterSeconds;
    } else if (cause instanceof DomainClientError && cause.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = cause.retryAfterSeconds;
    }
  }
}

/** Maps server-side GraphQL extensions.code values to canonical ErrorCode */
const SERVER_CODE_MAP: Record<string, ErrorCode> = {
  // Generated server codes (from DomainException.ErrorCodes)
  ...GeneratedServerCodeMap,
  // Legacy mapping: old servers send AUTH_FAILED for session expiration
  AUTH_FAILED: "AUTH_EXPIRED",
  // Server extensions.code aliases
  TIMEOUT: "TIMEOUT",
};

/** Map HTTP status + optional GraphQL errors to a canonical ErrorCode */
export function toErrorCode(
  status: number,
  graphqlErrors?: unknown[],
  responseBody?: string,
): ErrorCode {
  // HTTP status takes priority (wire-level errors before business-logic errors)
  if (status === 401) {
    // Try to distinguish AUTH_REQUIRED vs AUTH_FAILED from response body
    if (responseBody) {
      try {
        const body = JSON.parse(responseBody);
        if (body.errorCode === "AUTH_FAILED") return "AUTH_FAILED";
        if (body.errorCode === "AUTH_REQUIRED") return "AUTH_REQUIRED";
      } catch { /* ignore parse errors */ }
    }
    return "AUTH_EXPIRED";
  }
  // V1.0.12: 外部 IdP 登录——服务端 REST 响应 body 显式携带 errorCode 时透传
  // （400 INVALID_ARGUMENT 缺 code / channelType 无效；refresh 4xx JWT_SESSION_INVALID——M7 分层）。
  // 仅当 body 明确给出 errorCode 才提前返回；无 body / body 无数码时**回落既有路径**
  // （GraphQL extensions.code → UNKNOWN），不破坏 400 + extensions.code 的既有映射行为。
  if (status === 400 && responseBody) {
    try {
      const body = JSON.parse(responseBody);
      if (body.errorCode === "INVALID_ARGUMENT") return "INVALID_ARGUMENT";
      if (body.errorCode === "JWT_SESSION_INVALID") return "JWT_SESSION_INVALID";
      // V1.1.0（P0-2 闭环）：400 分支 ProblemDetails errorCode **通用透传**——票据族业务码
      // （TICKET_INVALID / ACCOUNT_FROZEN / ACCOUNT_DISABLED 等开放集）不落 UNKNOWN。
      // 既有两个硬编码保持优先（行为不回退）；其余 string errorCode 原样透传。
      if (typeof body.errorCode === "string" && body.errorCode.length > 0) {
        return body.errorCode as ErrorCode;
      }
    } catch { /* ignore parse errors */ }
  }
  if (status === 403) return "FORBIDDEN";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status >= 500) return "SERVER_ERROR";
  if (status === 404) return "NOT_FOUND";

  // Check GraphQL extensions.code from server
  if (graphqlErrors?.length) {
    for (const err of graphqlErrors) {
      if (typeof err === "object" && err !== null) {
        const extensions = (err as Record<string, unknown>).extensions;
        if (extensions && typeof extensions === "object") {
          const code = (extensions as Record<string, unknown>).code;
          if (typeof code === "string") {
            const mapped = SERVER_CODE_MAP[code];
            if (mapped) return mapped;
          }
        }
        // Fallback: scan message text for well-known keywords
        const message = (err as Record<string, unknown>).message;
        if (typeof message === "string") {
          const lower = message.toLowerCase();
          if (lower.includes("not found")) return "NOT_FOUND";
          if (lower.includes("forbidden")) return "FORBIDDEN";
          if (lower.includes("unauthorized")) return "AUTH_EXPIRED";
          if (lower.includes("validation")) return "VALIDATION_ERROR";
        }
      }
    }
  }

  // V1.1.0（P0-2 闭环）：ProblemDetails（RFC 9457）errorCode **通用透传**——任意未固定映射状态
  // （如 422）携带平台错误码时原样透传；位于 401 特殊分支与固定状态映射之后（不改变既有映射），
  // 先于 body.error 透传（errorCode 键优先于 error 键——平台信封在 DMP 简信封之前）。
  // 票据族 400 码已在 400 分支提前返回；此处兜底其余状态（TicketRedeem 之外、平台新端点等）。
  if (responseBody) {
    try {
      const body = JSON.parse(responseBody);
      if (typeof body?.errorCode === "string" && body.errorCode.length > 0) {
        return body.errorCode as ErrorCode;
      }
    } catch { /* ignore parse errors */ }
  }

  // V1.0.15: 开放业务码透传——REST 错误体 {"error":"<业务码>"}（DMP 免登录/建档/兑票端点契约，业务码开放集）。
  // 置于固定状态映射与 GraphQL 解析之后（仅"未知码"场景生效，不改变既有映射）；运行时 code 可为任意业务码（断言声明语义）
  if (responseBody) {
    try {
      const body = JSON.parse(responseBody);
      if (typeof body?.error === "string" && body.error.length > 0) {
        return body.error as ErrorCode;
      }
    } catch { /* ignore parse errors */ }
  }

  return "UNKNOWN";
}
