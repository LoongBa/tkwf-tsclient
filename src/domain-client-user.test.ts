import { describe, it, expect, vi, beforeEach } from "vitest";
import { DomainClientUser } from "./domain-client-user";
import type { Transport } from "./transport";

function createMockTransport(): Transport {
  return {
    execute: vi.fn(),
  };
}

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}

describe("DomainClientUser", () => {
  let transport: Transport;
  let storage: Storage;

  beforeEach(() => {
    transport = createMockTransport();
    storage = createMockStorage();
  });

  describe("session persistence", () => {
    it("restore() returns false when no stored session", () => {
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });
      expect(user.restore()).toBe(false);
      expect(user.isAuthenticated).toBe(false);
    });

    it("restore() loads session from storage when available", () => {
      storage.setItem("test", JSON.stringify({
        sessionKey: "sk_abc",
        userName: "admin",
        displayName: "Admin",
      }));
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });
      const result = user.restore();

      expect(result).toBe(true);
      expect(user.sessionKey).toBe("sk_abc");
      expect(user.isAuthenticated).toBe(true);
      expect(user.userName).toBe("admin");
      expect(user.displayName).toBe("Admin");
    });

    it("restore() returns false on corrupted JSON", () => {
      storage.setItem("test", "not-json");
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });
      expect(user.restore()).toBe(false);
    });
  });

  describe("loginAs()", () => {
    it("sends mutation type to transport (legacy plaintext path)", async () => {
      vi.mocked(transport.execute).mockResolvedValue({
        loginByPassword: { success: true, sessionKey: "sk_new" },
      });
      const user = new DomainClientUser({ transport, storage, storageKey: "test", useSecureLogin: false });

      await user.loginAs("admin", "secret");

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "loginByPassword", type: "mutation" }),
      );
    });

    it("persists session on success (legacy plaintext path)", async () => {
      vi.mocked(transport.execute).mockResolvedValue({
        loginByPassword: { success: true, sessionKey: "sk_new", userName: "admin" },
      });
      const user = new DomainClientUser({ transport, storage, storageKey: "test", useSecureLogin: false });

      await user.loginAs("admin", "secret");

      expect(user.isAuthenticated).toBe(true);
      expect(user.sessionKey).toBe("sk_new");
      expect(storage.setItem).toHaveBeenCalled();
    });

    it("does not persist on failed login (legacy plaintext path)", async () => {
      vi.mocked(transport.execute).mockResolvedValue({
        loginByPassword: { success: false, message: "wrong password" },
      });
      const user = new DomainClientUser({ transport, storage, storageKey: "test", useSecureLogin: false });

      await user.loginAs("admin", "wrong");

      expect(user.isAuthenticated).toBe(false);
      expect(user.sessionKey).toBeNull();
    });
  });

  describe("loginSecure()", () => {
    it("performs challenge-response flow", async () => {
      const mockRequestChallenge = vi.mocked(transport.execute)
        .mockResolvedValueOnce({
          requestChallenge: {
            challengeToken: "dGhpcyBpcyBhIHRva2Vu", // fake base64
            salt: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
            iterations: 600000,
          },
        })
        .mockResolvedValueOnce({
          loginByContext: { success: true, sessionKey: "sk_secure" },
        });

      const user = new DomainClientUser({ transport, storage, storageKey: "test" });

      const result = await user.loginSecure("admin", "secret");

      expect(result.success).toBe(true);
      expect(result.sessionKey).toBe("sk_secure");
      // First call: requestChallenge
      expect(mockRequestChallenge).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ field: "requestChallenge" }));
      // Second call: loginByContext with SecurePassword authType
      expect(mockRequestChallenge).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          field: "loginByContext",
          variables: expect.objectContaining({
            input: expect.objectContaining({ authType: "SecurePassword" }),
          }),
        }),
      );
    });
  });

  describe("ping()", () => {
    it("sends mutation type (fix: was query)", async () => {
      vi.mocked(transport.execute).mockResolvedValue({
        ping: { success: true, isAuthenticated: false },
      });
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });

      await user.ping();

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "ping", type: "mutation" }),
      );
    });

    it("returns null on error (swallowed)", async () => {
      vi.mocked(transport.execute).mockRejectedValue(new Error("network"));
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });

      const result = await user.ping();

      expect(result).toBeNull();
    });
  });

  describe("logout()", () => {
    it("sends mutation type when authenticated", async () => {
      vi.mocked(transport.execute).mockResolvedValue({
        logout: { success: true },
      });
      storage.setItem("test", JSON.stringify({ sessionKey: "sk_abc" }));
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });
      user.restore();

      await user.logout();

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "logout", type: "mutation" }),
      );
    });

    it("clears local state even if transport fails", async () => {
      vi.mocked(transport.execute).mockRejectedValue(new Error("network"));
      storage.setItem("test", JSON.stringify({ sessionKey: "sk_abc" }));
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });
      user.restore();

      await user.logout();

      expect(user.isAuthenticated).toBe(false);
      expect(user.sessionKey).toBeNull();
    });

    it("skips transport call if not authenticated", async () => {
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });

      await user.logout();

      expect(transport.execute).not.toHaveBeenCalled();
    });
  });

  describe("query() and mutate()", () => {
    it("query() sends type:query", async () => {
      vi.mocked(transport.execute).mockResolvedValue({ data: "ok" });
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });

      await user.query("getUsers");

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "getUsers", type: "query" }),
      );
    });

    it("mutate() sends type:mutation", async () => {
      vi.mocked(transport.execute).mockResolvedValue({ data: "ok" });
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });

      await user.mutate("deleteUser", { id: 1 });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "deleteUser", type: "mutation" }),
      );
    });

    it("query() passes signal when provided", async () => {
      vi.mocked(transport.execute).mockResolvedValue({ data: "ok" });
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });
      const ac = new AbortController();

      await user.query("getUsers", {}, { signal: ac.signal });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ signal: ac.signal }),
      );
    });
  });

  describe("Use() proxy", () => {
    it("passes selectionMap to proxy when configured", async () => {
      const selMap = { merchantUserInfo: "pageInfo { } nodes { id } totalCount" };
      vi.mocked(transport.execute).mockResolvedValue({ ok: true });
      const user = new DomainClientUser({
        transport,
        storage,
        storageKey: "test",
        selectionMap: selMap,
      });

      const api = user.Use<{ merchantUserInfo: (args: unknown) => Promise<unknown> }>();
      await api.merchantUserInfo?.({ first: 10 });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          field: "merchantUserInfo",
          selection: "pageInfo { } nodes { id } totalCount",
        }),
      );
    });

    it("handles Use() without selectionMap", async () => {
      vi.mocked(transport.execute).mockResolvedValue({ ok: true });
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });

      const api = user.Use<{ getUsers: (args: unknown) => Promise<unknown> }>();
      await api.getUsers?.({});

      expect(transport.execute).toHaveBeenCalledWith(
        expect.not.objectContaining({ selection: expect.anything() }),
      );
    });

    it("classifies loginByPassword as mutation via explicitMutations", async () => {
      vi.mocked(transport.execute).mockResolvedValue({ ok: true });
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });

      const api = user.Use<{ loginByPassword: (args: unknown) => Promise<unknown> }>();
      await api.loginByPassword?.({ userName: "admin", password: "s" });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "loginByPassword", type: "mutation" }),
      );
    });

    it("classifies getUser as query", async () => {
      vi.mocked(transport.execute).mockResolvedValue({ ok: true });
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });

      const api = user.Use<{ getUsers: (args: unknown) => Promise<unknown> }>();
      await api.getUsers?.({});

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "getUsers", type: "query" }),
      );
    });
  });
});
