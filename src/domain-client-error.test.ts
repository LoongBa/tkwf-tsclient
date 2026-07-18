import { describe, it, expect } from "vitest";
import { DomainClientError, toErrorCode } from "./domain-client-error";

describe("DomainClientError", () => {
  it("sets name to DomainClientError", () => {
    const err = new DomainClientError("oops", "SERVER_ERROR");
    expect(err.name).toBe("DomainClientError");
  });

  it("stores message and code", () => {
    const err = new DomainClientError("not found", "NOT_FOUND");
    expect(err.message).toBe("not found");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("stores cause when provided", () => {
    const cause = new Error("underlying");
    const err = new DomainClientError("wrapped", "SERVER_ERROR", cause);
    expect(err.cause).toBe(cause);
  });

  it("works with undefined cause", () => {
    const err = new DomainClientError("no cause", "UNKNOWN");
    expect(err.cause).toBeUndefined();
  });

  it("supports instanceof check", () => {
    const err = new DomainClientError("test", "VALIDATION_ERROR");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DomainClientError);
  });
});

describe("toErrorCode", () => {
  it("returns AUTH_EXPIRED for status 401", () => {
    expect(toErrorCode(401)).toBe("AUTH_EXPIRED");
  });

  it("returns RATE_LIMITED for status 429", () => {
    expect(toErrorCode(429)).toBe("RATE_LIMITED");
  });

  it("returns SERVER_ERROR for 500 and above", () => {
    expect(toErrorCode(500)).toBe("SERVER_ERROR");
    expect(toErrorCode(502)).toBe("SERVER_ERROR");
    expect(toErrorCode(503)).toBe("SERVER_ERROR");
  });

  it("returns NOT_FOUND for status 404", () => {
    expect(toErrorCode(404)).toBe("NOT_FOUND");
  });

  it("returns VALIDATION_ERROR when graphql errors have VALIDATION_ERROR code in extensions", () => {
    const graphqlErrors = [
      {
        message: "some error",
        extensions: { code: "VALIDATION_ERROR" },
      },
    ];
    expect(toErrorCode(200, graphqlErrors)).toBe("VALIDATION_ERROR");
  });

  it("returns VALIDATION_ERROR when graphql error message contains validation (case-insensitive)", () => {
    const graphqlErrors = [
      {
        message: "Validation failed: name is required",
      },
    ];
    expect(toErrorCode(200, graphqlErrors)).toBe("VALIDATION_ERROR");
  });

  it("returns FORBIDDEN for status 403", () => {
    expect(toErrorCode(403)).toBe("FORBIDDEN");
  });

  it("returns UNKNOWN for non-matching status without graphql errors", () => {
    expect(toErrorCode(418)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when graphql errors array is empty", () => {
    expect(toErrorCode(400, [])).toBe("UNKNOWN");
  });

  it("handle null or non-object entries in graphql errors gracefully", () => {
    const graphqlErrors = [null, "string error", 42];
    expect(toErrorCode(400, graphqlErrors)).toBe("UNKNOWN");
  });

  it("maps AUTH_FAILED server code to AUTH_EXPIRED", () => {
    const graphqlErrors = [
      { message: "invalid credentials", extensions: { code: "AUTH_FAILED" } },
    ];
    expect(toErrorCode(200, graphqlErrors)).toBe("AUTH_EXPIRED");
  });

  it("maps NOT_FOUND server code from extensions", () => {
    const graphqlErrors = [
      { message: "resource not found", extensions: { code: "NOT_FOUND" } },
    ];
    expect(toErrorCode(200, graphqlErrors)).toBe("NOT_FOUND");
  });

  it("maps FORBIDDEN server code from extensions", () => {
    const graphqlErrors = [
      { message: "insufficient permissions", extensions: { code: "FORBIDDEN" } },
    ];
    expect(toErrorCode(200, graphqlErrors)).toBe("FORBIDDEN");
  });

  it("detects NOT_FOUND from error message text", () => {
    const graphqlErrors = [{ message: "Entity not found: Order#42" }];
    expect(toErrorCode(200, graphqlErrors)).toBe("NOT_FOUND");
  });

  it("detects FORBIDDEN from error message text", () => {
    const graphqlErrors = [{ message: "Forbidden: admin role required" }];
    expect(toErrorCode(200, graphqlErrors)).toBe("FORBIDDEN");
  });

  it("detects UNAUTHORIZED from error message text", () => {
    const graphqlErrors = [{ message: "Unauthorized access" }];
    expect(toErrorCode(200, graphqlErrors)).toBe("AUTH_EXPIRED");
  });

  it("prefers status-based code over graphql error codes", () => {
    const graphqlErrors = [
      { message: "validation error", extensions: { code: "VALIDATION_ERROR" } },
    ];
    // 401 takes priority even with validation errors
    expect(toErrorCode(401, graphqlErrors)).toBe("AUTH_EXPIRED");
    expect(toErrorCode(500, graphqlErrors)).toBe("SERVER_ERROR");
  });

  describe("CONFLICT", () => {
    it("returns CONFLICT for status 409", () => {
      expect(toErrorCode(409)).toBe("CONFLICT");
    });

    it("maps CONFLICT server code from extensions", () => {
      const graphqlErrors = [
        { message: "duplicate entry", extensions: { code: "CONFLICT" } },
      ];
      expect(toErrorCode(200, graphqlErrors)).toBe("CONFLICT");
    });
  });

  describe("TIMEOUT", () => {
    it("returns TIMEOUT for status 408", () => {
      expect(toErrorCode(408)).toBe("TIMEOUT");
    });

    it("returns TIMEOUT for status 504", () => {
      expect(toErrorCode(504)).toBe("TIMEOUT");
    });

    it("maps TIMEOUT server code from extensions", () => {
      const graphqlErrors = [
        { message: "operation timed out", extensions: { code: "TIMEOUT" } },
      ];
      expect(toErrorCode(200, graphqlErrors)).toBe("TIMEOUT");
    });
  });
});
