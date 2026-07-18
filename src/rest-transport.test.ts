import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RestTransport } from "./rest-transport";

function mockFetch(data: unknown, status = 200) {
  return vi.mocked(fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
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
        ok: false, status: 401, json: () => Promise.resolve({}),
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
});
