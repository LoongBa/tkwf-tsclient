import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RestTransport } from "./rest-transport";

function mockFetch(data: unknown, status = 200, headers: Headers = new Headers()) {
  return vi.mocked(fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
    headers,
  } as Response);
}

describe("RestTransport", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => Promise.resolve(new Response()),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET (query)", () => {
    it("sends GET request with correct URL", async () => {
      const fetchMock = mockFetch([{ id: 1, name: "Alice" }]);
      const transport = new RestTransport({ url: "http://localhost:5000" });

      await transport.execute({
        field: "users",
        type: "query",
      });

      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:5000/api/users");
      expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
    });

    it("appends variables as query string", async () => {
      const fetchMock = mockFetch({ items: [] });
      const transport = new RestTransport({ url: "http://localhost:5000" });

      await transport.execute({
        field: "users",
        type: "query",
        variables: { page: 1, size: 20 },
      });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("page=1");
      expect(url).toContain("size=20");
      expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
    });

    it("sends sessionKey as header", async () => {
      const fetchMock = mockFetch({ ok: true });
      const transport = new RestTransport({ url: "http://localhost:5000" });

      await transport.execute({
        field: "users",
        type: "query",
        sessionKey: "sk_test",
      });

      const headers = (fetchMock.mock.calls[0][1] as Record<string, unknown>).headers as Record<string, string>;
      expect(headers["X-Session-Key"]).toBe("sk_test");
    });

    it("converts GraphQL selection to ?fields query parameter", async () => {
      const fetchMock = mockFetch({ items: [] });
      const transport = new RestTransport({ url: "http://localhost:5000" });

      await transport.execute({
        field: "users",
        type: "query",
        selection: "{ Id Name Amount }",
      });

      const url = fetchMock.mock.calls[0][0] as string;
      // URLSearchParams 将逗号编码为 %2C，服务端（ASP.NET Query）自动解码回逗号
      expect(url).toContain("fields=Id%2CName%2CAmount");
      expect(decodeURIComponent(url)).toContain("fields=Id,Name,Amount");
    });

    it("merges selection fields with existing variables", async () => {
      const fetchMock = mockFetch({ items: [] });
      const transport = new RestTransport({ url: "http://localhost:5000" });

      await transport.execute({
        field: "users",
        type: "query",
        variables: { page: 1 },
        selection: "{Id,Name}",
      });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain("page=1");
      expect(decodeURIComponent(url)).toContain("fields=Id,Name");
    });
  });

  describe("GET + body (explicitBodyQueries)", () => {
    const bodyQueries = new Set(["getMyCoupons"]);

    it("sends GET with JSON body when field is in explicitBodyQueries", async () => {
      const fetchMock = mockFetch({ items: [] });
      const transport = new RestTransport({
        url: "http://localhost:5000",
        explicitBodyQueries: bodyQueries,
      });

      await transport.execute({
        field: "getMyCoupons",
        type: "query",
        variables: { page: 1 },
      });

      const call = fetchMock.mock.calls[0];
      expect(call[0]).toBe("http://localhost:5000/api/getMyCoupons");
      expect(call[1]?.method).toBe("GET");
      // variables → JSON body
      const body = JSON.parse((call[1] as Record<string, unknown>).body as string);
      expect(body).toEqual({ page: 1 });
      // Content-Type 必须设置（GET + body 需要）
      const headers = (call[1] as Record<string, unknown>).headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("keeps query string default when field NOT in explicitBodyQueries", async () => {
      const fetchMock = mockFetch({ items: [] });
      const transport = new RestTransport({
        url: "http://localhost:5000",
        explicitBodyQueries: bodyQueries,
      });

      await transport.execute({
        field: "getProducts",
        type: "query",
        variables: { page: 1 },
      });

      const call = fetchMock.mock.calls[0];
      const url = call[0] as string;
      expect(url).toContain("page=1");
      expect(call[1]?.method).toBe("GET");
      // 非 body 查询 → body 为空（executeHttp 中空字符串被转为 undefined）
      expect((call[1] as Record<string, unknown>).body).toBeUndefined();
    });

    it("keeps ?fields projection on query string for GET+body", async () => {
      const fetchMock = mockFetch({ items: [] });
      const transport = new RestTransport({
        url: "http://localhost:5000",
        explicitBodyQueries: bodyQueries,
      });

      await transport.execute({
        field: "getMyCoupons",
        type: "query",
        variables: { page: 1 },
        selection: "{ Id Name }",
      });

      const call = fetchMock.mock.calls[0];
      const url = call[0] as string;
      // ?fields 仍在 query string
      expect(decodeURIComponent(url)).toContain("fields=Id,Name");
      // variables 仍在 body（不混入 query string）
      const body = JSON.parse((call[1] as Record<string, unknown>).body as string);
      expect(body).toEqual({ page: 1 });
    });

    it("does not affect mutation POST", async () => {
      const fetchMock = mockFetch({ ok: true });
      const transport = new RestTransport({
        url: "http://localhost:5000",
        explicitBodyQueries: bodyQueries,
      });

      await transport.execute({
        field: "createCoupon",
        type: "mutation",
        variables: { name: "x" },
      });

      const call = fetchMock.mock.calls[0];
      expect(call[1]?.method).toBe("POST");
      const body = JSON.parse((call[1] as Record<string, unknown>).body as string);
      expect(body).toEqual({ name: "x" });
    });
  });

  describe("POST (mutation)", () => {
    it("sends POST request with JSON body", async () => {
      const fetchMock = mockFetch({ success: true });
      const transport = new RestTransport({ url: "http://localhost:5000" });

      await transport.execute({
        field: "users",
        type: "mutation",
        variables: { name: "Bob" },
      });

      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:5000/api/users");
      expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");

      const body = JSON.parse((fetchMock.mock.calls[0][1] as Record<string, unknown>).body as string);
      expect(body).toEqual({ name: "Bob" });
    });

    it("sets Content-Type for POST", async () => {
      const fetchMock = mockFetch({ ok: true });
      const transport = new RestTransport({ url: "http://localhost:5000" });

      await transport.execute({
        field: "login",
        type: "mutation",
      });

      const headers = (fetchMock.mock.calls[0][1] as Record<string, unknown>).headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("urlMap", () => {
    it("uses urlMap when provided", async () => {
      const fetchMock = mockFetch({ ok: true });
      const transport = new RestTransport({
        url: "http://localhost:5000",
        urlMap: { getUsers: "/api/v2/merchant/users" },
      });

      await transport.execute({ field: "getUsers", type: "query" });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toBe("http://localhost:5000/api/v2/merchant/users");
    });

    it("falls back to pathPrefix when field not in urlMap", async () => {
      const fetchMock = mockFetch({ ok: true });
      const transport = new RestTransport({
        url: "http://localhost:5000",
        urlMap: { otherField: "/custom/path" },
      });

      await transport.execute({ field: "getUsers", type: "query" });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toBe("http://localhost:5000/api/getUsers");
    });
  });

  describe("custom pathPrefix", () => {
    it("uses custom pathPrefix", async () => {
      const fetchMock = mockFetch({ ok: true });
      const transport = new RestTransport({
        url: "http://localhost:5000",
        pathPrefix: "/rest",
      });

      await transport.execute({ field: "ping", type: "query" });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toBe("http://localhost:5000/rest/ping");
    });
  });

  describe("HTTP status handling (inherited from BaseHttpTransport)", () => {
    it("throws AUTH_EXPIRED on 401", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false, status: 401,
        text: () => Promise.resolve("{}"),
        json: () => Promise.resolve({}),
        headers: new Headers(),
      } as Response);
      const transport = new RestTransport({ url: "http://localhost:5000" });

      await expect(
        transport.execute({ field: "me", type: "query" }),
      ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
    });

    it("returns data on success", async () => {
      mockFetch({ id: 1, name: "Alice" });
      const transport = new RestTransport({ url: "http://localhost:5000" });

      const result = await transport.execute<{ id: number; name: string }>({
        field: "users/1",
        type: "query",
      });

      expect(result).toEqual({ id: 1, name: "Alice" });
    });
  });

  describe("uploadFile", () => {
    it("sends multipart/form-data POST", async () => {
      const fetchMock = mockFetch({ url: "https://cdn.example.com/file.pdf" });
      const transport = new RestTransport({ url: "http://localhost:5000" });

      const file = new Blob(["test content"], { type: "text/plain" });
      const result = await transport.uploadFile<{ url: string }>(
        "upload",
        file,
        "file",
        { userId: "42" },
      );

      expect(result.url).toBe("https://cdn.example.com/file.pdf");
      const call = fetchMock.mock.calls[0];
      expect(call[0]).toBe("http://localhost:5000/api/upload");
      expect(call[1]?.method).toBe("POST");
      expect(call[1]?.body).toBeInstanceOf(FormData);
    });
  });

  describe("V1.0.8 RPC events (header side channel)", () => {
    // 无 @types/node：提供最小 Buffer 类型（运行时为全局 Buffer，Node ≥18 支持 base64url）
    const encode = (env: unknown): string =>
      Buffer.from(JSON.stringify(env), "utf-8").toString("base64url");

    // 带真实 Headers 的 mock fetch（execute() 路径走 response.text()）
    function mockFetchWithHeaders(body: unknown, headers: Headers, status = 200) {
      return vi.mocked(fetch).mockResolvedValueOnce({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body),
        headers,
      } as Response);
    }

    it("提取：X-TKWF-Events 头解码后 onResponse 收到事件数组，data 原样透传", async () => {
      const event = {
        name: "OrderCreated",
        type: "T.Events.OrderCreatedEvent",
        data: { orderId: 1 },
        timestamp: "2026-08-26T12:00:00Z",
      };
      const headers = new Headers({ "X-TKWF-Events": encode({ events: [event] }) });
      mockFetchWithHeaders({ items: [{ id: 1 }] }, headers);

      let received: { events?: unknown; data?: unknown } | undefined;
      const transport = new RestTransport({
        url: "http://localhost:5000",
        onResponse: (res) => { received = res; },
      });

      const data = await transport.execute({ field: "users", type: "query" });

      expect(data).toEqual({ items: [{ id: 1 }] });
      expect(received?.events).toEqual([event]);
    });

    it("无头：无 X-TKWF-Events 时 events === undefined", async () => {
      mockFetchWithHeaders({ ok: true }, new Headers());

      let received: { events?: unknown } | undefined;
      const transport = new RestTransport({
        url: "http://localhost:5000",
        onResponse: (res) => { received = res; },
      });

      await transport.execute({ field: "ping", type: "query" });

      expect(received?.events).toBeUndefined();
    });

    it("截断标记：X-TKWF-Events-Truncated 时尽力解析失败则丢弃（console.warn），不阻断业务", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      // 合法 Base64Url，但截断后为不完整 JSON → JSON.parse 失败 → [] → events undefined
      const partial = Buffer.from('{"events":[{"name":"OrderCreated"', "utf-8").toString("base64url");
      const headers = new Headers({
        "X-TKWF-Events": partial,
        "X-TKWF-Events-Truncated": "true",
      });
      mockFetchWithHeaders({ items: [{ id: 1 }] }, headers);

      let received: { events?: unknown; data?: unknown } | undefined;
      const transport = new RestTransport({
        url: "http://localhost:5000",
        onResponse: (res) => { received = res; },
      });

      // 不得抛错——事件尽力而为，业务结果仍正常返回
      const data = await transport.execute({ field: "users", type: "query" });

      expect(warnSpy).toHaveBeenCalled();
      expect(received?.events).toBeUndefined();
      expect(data).toEqual({ items: [{ id: 1 }] });
    });

    it("非法 Base64Url：解码失败丢弃，不阻断业务", async () => {
      const headers = new Headers({ "X-TKWF-Events": "!!!not-base64!!!" });
      mockFetchWithHeaders({ ok: true }, headers);

      let received: { events?: unknown; data?: unknown } | undefined;
      const transport = new RestTransport({
        url: "http://localhost:5000",
        onResponse: (res) => { received = res; },
      });

      const data = await transport.execute({ field: "ping", type: "query" });

      expect(received?.events).toBeUndefined();
      expect(data).toEqual({ ok: true });
    });

    it("空事件数组：{events:[]} → events === undefined", async () => {
      const headers = new Headers({ "X-TKWF-Events": encode({ events: [] }) });
      mockFetchWithHeaders({ ok: true }, headers);

      let received: { events?: unknown } | undefined;
      const transport = new RestTransport({
        url: "http://localhost:5000",
        onResponse: (res) => { received = res; },
      });

      await transport.execute({ field: "ping", type: "query" });

      expect(received?.events).toBeUndefined();
    });

    it("中文 UTF-8 事件名 round-trip：解码后事件不损坏", async () => {
      const event = {
        name: "订单创建",
        type: "T.Events.OrderCreatedEvent",
        data: { 订单: "abc" },
        timestamp: "2026-08-26T12:00:00Z",
      };
      const headers = new Headers({ "X-TKWF-Events": encode({ events: [event] }) });
      mockFetchWithHeaders({ ok: true }, headers);

      let received: { events?: unknown } | undefined;
      const transport = new RestTransport({
        url: "http://localhost:5000",
        onResponse: (res) => { received = res; },
      });

      await transport.execute({ field: "ping", type: "query" });

      expect(received?.events).toEqual([event]);
    });

    it("uploadFile 路径：响应头同样提取并派发事件（Oracle S2）", async () => {
      const event = {
        name: "FileUploaded",
        type: "T.Events.FileUploadedEvent",
        data: { url: "x" },
        timestamp: "2026-08-26T12:00:00Z",
      };
      const headers = new Headers({ "X-TKWF-Events": encode({ events: [event] }) });
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ url: "x" }),
        headers,
      } as Response);

      let received: { events?: unknown; data?: unknown } | undefined;
      const transport = new RestTransport({
        url: "http://localhost:5000",
        onResponse: (res) => { received = res; },
      });

      const result = await transport.uploadFile<{ url: string }>(
        "merchant/upload",
        new Blob(["x"]),
      );

      expect(result.url).toBe("x");
      expect(received?.events).toEqual([event]);
    });
  });
});
