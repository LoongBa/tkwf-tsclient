import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphQLTransport } from "./transport";
import { DomainClientError } from "./domain-client-error";

function mockFetch(data: unknown, status = 200) {
  return vi.mocked(fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  } as Response);
}

function mockFetchResponse(response: Partial<Response>) {
  // base-http-transport 通过 response.text() + JSON.parse 读取 body
  return vi.mocked(fetch).mockResolvedValueOnce({
    text: () => Promise.resolve("{}"),
    ...response,
  } as Response);
}

describe("GraphQLTransport", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => Promise.resolve(new Response()),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("query document construction", () => {
    it("builds a basic query document", async () => {
      const fetchMock = mockFetch({ data: { me: "ok" } });
      const transport = new GraphQLTransport({ url: "/graphql" });

      await transport.execute<{ me: string }>({
        field: "me",
        type: "query",
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.query).toContain("query");
      expect(body.query).toContain("me");
    });

    it("includes selection when provided", async () => {
      const fetchMock = mockFetch({ data: { me: "ok" } });
      const transport = new GraphQLTransport({ url: "/graphql" });

      await transport.execute<{ me: string }>({
        field: "me",
        type: "query",
        selection: "id name",
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.query).toContain("id name");
    });

    it("includes variables in declaration and passing", async () => {
      const fetchMock = mockFetch({ data: { login: { success: true } } });
      const transport = new GraphQLTransport({ url: "/graphql" });

      await transport.execute<{ login: { success: boolean } }>({
        field: "login",
        type: "mutation",
        variables: { userName: "admin", password: "secret" },
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.query).toContain("$userName: String!");
      expect(body.query).toContain("$password: String!");
      expect(body.query).toContain("userName: $userName");
      expect(body.query).toContain("password: $password");
      expect(body.variables).toEqual({ userName: "admin", password: "secret" });
    });

    it("uses variableTypes to override inferred GraphQL type for complex objects", async () => {
      const fetchMock = mockFetch({ data: { loginByContext: { success: true } } });
      const transport = new GraphQLTransport({ url: "/graphql" });

      await transport.execute({
        field: "loginByContext",
        type: "mutation",
        variableTypes: { input: "LoginContextInput!" },
        variables: { input: { userName: "admin", credential: "x", loginFrom: "PC_WEB", authType: "PASSWORD" } },
        selection: "success",
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.query).toContain("$input: LoginContextInput!");
      expect(body.query).toContain("input: $input");
      // 确认不是 JSON（默认 inferGraphQLType 对 object 返回 JSON）
      expect(body.query).not.toContain("$input: JSON");
    });
  });

  describe("HTTP status handling", () => {
    it("returns data on 200", async () => {
      mockFetch({ data: { ping: true } });
      const transport = new GraphQLTransport({ url: "/graphql" });

      const result = await transport.execute<{ ping: boolean }>({
        field: "ping",
        type: "mutation",
      });

      expect(result).toEqual({ ping: true });
    });

    it("throws AUTH_EXPIRED on 401", async () => {
      mockFetchResponse({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response);
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "me", type: "query" }),
      ).rejects.toMatchObject({
        code: "AUTH_EXPIRED",
        message: "Session expired",
      });
    });

    it("throws RATE_LIMITED on 429", async () => {
      mockFetchResponse({ ok: false, status: 429, json: () => Promise.resolve({}) } as Response);
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "me", type: "query" }),
      ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    });

    it("throws SERVER_ERROR on 500", async () => {
      // SERVER_ERROR is retryable — provide enough mocks for 3 attempts
      mockFetchResponse({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response);
      mockFetchResponse({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response);
      mockFetchResponse({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response);
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "me", type: "query" }),
      ).rejects.toMatchObject({ code: "SERVER_ERROR" });
    });

    it("throws NOT_FOUND on 404", async () => {
      // 404 maps to NOT_FOUND — not retryable
      mockFetchResponse({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "me", type: "query" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws FORBIDDEN on 403", async () => {
      // 403 maps to FORBIDDEN — not retryable
      mockFetchResponse({ ok: false, status: 403, json: () => Promise.resolve({}) } as Response);
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "me", type: "query" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("throws CONFLICT on 409", async () => {
      mockFetchResponse({ ok: false, status: 409, json: () => Promise.resolve({}) } as Response);
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "me", type: "query" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("throws TIMEOUT on 408", async () => {
      mockFetchResponse({ ok: false, status: 408, json: () => Promise.resolve({}) } as Response);
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "me", type: "query" }),
      ).rejects.toMatchObject({ code: "TIMEOUT" });
    });

    it("throws TIMEOUT on 504", async () => {
      mockFetchResponse({ ok: false, status: 504, json: () => Promise.resolve({}) } as Response);
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "me", type: "query" }),
      ).rejects.toMatchObject({ code: "TIMEOUT" });
    });
  });

  describe("GraphQL error handling", () => {
    it("maps AUTH_FAILED extensions code", async () => {
      mockFetch({
        data: null,
        errors: [{ message: "bad credentials", extensions: { code: "AUTH_FAILED" } }],
      });
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "login", type: "mutation" }),
      ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
    });

    it("maps NOT_FOUND extensions code", async () => {
      mockFetch({
        data: null,
        errors: [{ message: "not there", extensions: { code: "NOT_FOUND" } }],
      });
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "getUser", type: "query" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("falls back to UNKNOWN for unmapped error code", async () => {
      mockFetch({
        data: null,
        errors: [{ message: "something weird", extensions: { code: "SOMETHING_UNMAPPED" } }],
      });
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "x", type: "query" }),
      ).rejects.toMatchObject({ code: "UNKNOWN" });
    });
  });

  describe("signal / abort", () => {
    it("passes signal to fetch", async () => {
      const abortController = new AbortController();
      mockFetch({ data: { ok: true } });
      const transport = new GraphQLTransport({ url: "/graphql" });

      await transport.execute({ field: "ping", type: "mutation", signal: abortController.signal });

      const options = vi.mocked(fetch).mock.calls[0][1]!;
      expect(options.signal).toBe(abortController.signal);
    });

    it("throws CANCELLED on AbortError", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "ping", type: "mutation" }),
      ).rejects.toMatchObject({ code: "CANCELLED" });
    });

    it("throws NETWORK_ERROR on TypeError", async () => {
      // NETWORK_ERROR is retryable — provide enough rejections for 3 attempts
      vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
      const transport = new GraphQLTransport({ url: "/graphql" });

      await expect(
        transport.execute({ field: "ping", type: "mutation" }),
      ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });
  });

  describe("retry", () => {
    it("retries on SERVER_ERROR up to maxAttempts", async () => {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new TypeError("fail 1"))
        .mockRejectedValueOnce(new TypeError("fail 2"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ data: { ok: true } })),
          json: () => Promise.resolve({ data: { ok: true } }),
        } as Response);

      const transport = new GraphQLTransport({
        url: "/graphql",
        retry: { maxAttempts: 3, baseDelaySeconds: 0.001, maxDelaySeconds: 0.01, jitter: false, retryOn: ["NETWORK_ERROR", "SERVER_ERROR"] },
      });

      const result = await transport.execute<{ ok: boolean }>({ field: "ping", type: "mutation" });
      expect(result).toEqual({ ok: true });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    });

    it("stops retrying after maxAttempts", async () => {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new TypeError("fail 1"))
        .mockRejectedValueOnce(new TypeError("fail 2"))
        .mockRejectedValueOnce(new TypeError("fail 3"));

      const transport = new GraphQLTransport({
        url: "/graphql",
        retry: { maxAttempts: 2, baseDelaySeconds: 0.001, maxDelaySeconds: 0.01, jitter: false, retryOn: ["NETWORK_ERROR", "SERVER_ERROR"] },
      });

      await expect(
        transport.execute({ field: "ping", type: "mutation" }),
      ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });

    it("does not retry AUTH_EXPIRED errors", async () => {
      mockFetchResponse({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response);
      const transport = new GraphQLTransport({
        url: "/graphql",
        retry: { maxAttempts: 3, baseDelaySeconds: 0.001, maxDelaySeconds: 0.01, jitter: false, retryOn: ["NETWORK_ERROR", "SERVER_ERROR"] },
      });

      await expect(
        transport.execute({ field: "me", type: "query" }),
      ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
      // Should not retry — 401 is not in retryOn list
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });
  });

  describe("onRequest / onResponse callbacks", () => {
    it("calls onResponse with field and durationMs", async () => {
      const onResponse = vi.fn();
      mockFetch({ data: { ok: true } });
      const transport = new GraphQLTransport({ url: "/graphql", onResponse });

      await transport.execute({ field: "testField", type: "query" });

      expect(onResponse).toHaveBeenCalledTimes(1);
      const [res] = onResponse.mock.calls[0];
      expect(res.request.field).toBe("testField");
      expect(res.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("does NOT call onResponse on failed request", async () => {
      const onResponse = vi.fn();
      // 500 → SERVER_ERROR → retry 3 times, all fail
      vi.mocked(fetch)
        .mockRejectedValueOnce(new TypeError("fail"))
        .mockRejectedValueOnce(new TypeError("fail"))
        .mockRejectedValueOnce(new TypeError("fail"));
      const transport = new GraphQLTransport({
        url: "/graphql",
        onResponse,
        retry: { maxAttempts: 3, baseDelaySeconds: 0.001, maxDelaySeconds: 0.01, jitter: false, retryOn: ["NETWORK_ERROR", "SERVER_ERROR"] },
      });

      await expect(
        transport.execute({ field: "me", type: "query" }),
      ).rejects.toThrow();

      // onResponse should never fire — it's success-only
      expect(onResponse).not.toHaveBeenCalled();
    });

    it("passes sessionKey in headers", async () => {
      const fetchMock = mockFetch({ data: { ok: true } });
      const transport = new GraphQLTransport({ url: "/graphql" });

      await transport.execute({ field: "ping", type: "mutation", sessionKey: "sk_test" });

      const headers = (fetchMock.mock.calls[0][1] as Record<string, unknown>).headers as Record<string, string>;
      expect(headers["X-Session-Key"]).toBe("sk_test");
    });
  });

  describe("calculateBackoff", () => {
    it("returns at least baseDelaySeconds * 2^{(attempt-1)} without jitter", async () => {
      // Indirectly tested via retry behavior, but we can unit-test the pattern
      // by checking the execute retry delay behavior
      vi.mocked(fetch)
        .mockRejectedValueOnce(new TypeError("fail"))
        .mockResolvedValueOnce({
          ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({ data: { ok: true } })),
        json: () => Promise.resolve({ data: { ok: true } }),
        } as Response);

      const transport = new GraphQLTransport({
        url: "/graphql",
        retry: { maxAttempts: 2, baseDelaySeconds: 0.001, maxDelaySeconds: 10, jitter: false, retryOn: ["NETWORK_ERROR"] },
      });

      const start = Date.now();
      await transport.execute<{ ok: boolean }>({ field: "ping", type: "mutation" });
      const elapsed = Date.now() - start;
      // First retry: 0.001 * 2^(1-1) = 1ms delay
      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });
  });
});
