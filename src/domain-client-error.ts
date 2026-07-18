/** Error codes for programmatic handling - never match on message strings */
export type ErrorCode =
  | "NETWORK_ERROR"
  | "AUTH_EXPIRED"
  | "AUTH_REQUIRED"
  | "VALIDATION_ERROR"
  | "SERVER_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TIMEOUT"
  | "CANCELLED"
  | "RATE_LIMITED"
  | "FORBIDDEN"
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
  AUTH_FAILED: "AUTH_EXPIRED",
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  TIMEOUT: "TIMEOUT",
};

/** Map HTTP status + optional GraphQL errors to a canonical ErrorCode */
export function toErrorCode(
  status: number,
  graphqlErrors?: unknown[],
): ErrorCode {
  // HTTP status takes priority (wire-level errors before business-logic errors)
  if (status === 401) return "AUTH_EXPIRED";
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
