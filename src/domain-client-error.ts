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
  | "UNKNOWN";

/** Base error class for all RPC errors */
export class DomainClientError extends Error {
  readonly code: ErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: ErrorCode, cause?: unknown) {
    super(message);
    this.name = "DomainClientError";
    this.code = code;
    this.cause = cause;
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

  return "UNKNOWN";
}
