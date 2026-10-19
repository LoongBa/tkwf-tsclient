import { describe, it, expect, vi, beforeEach } from "vitest";
import { DomainClientUser } from "./domain-client-user";
import { DomainClientError } from "./domain-client-error";
import type { Transport, ExternalLoginResult } from "./transport";

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
            input: expect.objectContaining({ authType: "SECURE_PASSWORD" }),
          }),
        }),
      );
    });
  });

  describe("loginByContext()", () => {
    it("uses default enum values PC_WEB / PASSWORD when context omitted", async () => {
      vi.mocked(transport.execute).mockResolvedValue({
        loginByContext: { success: true, sessionKey: "sk_ctx" },
      });
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });

      await user.loginByContext("admin", "x").catch(() => {});

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          field: "loginByContext",
          variables: expect.objectContaining({
            input: expect.objectContaining({
              loginFrom: "PC_WEB",
              authType: "PASSWORD",
            }),
          }),
        }),
      );
    });

    it("passes explicit loginFrom/authType when provided", async () => {
      vi.mocked(transport.execute).mockResolvedValue({
        loginByContext: { success: true, sessionKey: "sk_ctx" },
      });
      const user = new DomainClientUser({ transport, storage, storageKey: "test" });

      await user.loginByContext("admin", "x", {
        loginFrom: "APP",
        authType: "SMS_CODE",
      }).catch(() => {});

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: expect.objectContaining({
            input: expect.objectContaining({
              loginFrom: "APP",
              authType: "SMS_CODE",
            }),
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

    it("passes variableTypesMap to proxy when configured", async () => {
      const vtMap = { rankings_Execute: { request: "GetRankingsReqDtoInput!" } };
      vi.mocked(transport.execute).mockResolvedValue({ ok: true });
      const user = new DomainClientUser({
        transport,
        storage,
        storageKey: "test",
        variableTypesMap: vtMap,
      });

      const api = user.Use<{ rankings_Execute: (args: unknown) => Promise<unknown> }>();
      await api.rankings_Execute?.({ request: { id: 1 } });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          field: "rankings_Execute",
          variableTypes: { request: "GetRankingsReqDtoInput!" },
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

    // V1.0.11（G16 根治）：operationKinds 透传 + explicitMutations 合并语义（M7）
    it("passes operationKinds to proxy when configured（Execute 字段按权威映射判 query）", async () => {
      vi.mocked(transport.execute).mockResolvedValue({ ok: true });
      const user = new DomainClientUser({
        transport,
        storage,
        storageKey: "test",
        operationKinds: { removeBuddy_Execute: "query" },
      });

      const api = user.Use<{ removeBuddy_Execute: (args: unknown) => Promise<unknown> }>();
      await api.removeBuddy_Execute?.({ buddyId: 1 });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          field: "removeBuddy_Execute",
          type: "query",
        }),
      );
    });

    it("explicitMutations 合并语义：消费端配置 ∪ 内置 EXPLICIT_MUTATIONS（并集兜底）", async () => {
      vi.mocked(transport.execute).mockResolvedValue({ ok: true });
      const user = new DomainClientUser({
        transport,
        storage,
        storageKey: "test",
        explicitMutations: new Set(["myCustomOp"]),
      });

      const api = user.Use<{
        myCustomOp: (args: unknown) => Promise<unknown>;
        loginByPassword: (args: unknown) => Promise<unknown>;
      }>();
      // 消费端配置字段（非前缀）→ mutation（经合并）
      await api.myCustomOp?.({});
      // 内置登录字段（operationKinds 未配置）→ 仍 mutation（EXPLICIT_MUTATIONS ∪ 消费端）
      await api.loginByPassword?.({ userName: "admin", password: "s" });

      expect(transport.execute).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ field: "myCustomOp", type: "mutation" }));
      expect(transport.execute).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ field: "loginByPassword", type: "mutation" }));
    });

    it("suppressHeuristicWarning 透传到 ServiceProxy（配置可接受，不改变判定）", async () => {
      vi.mocked(transport.execute).mockResolvedValue({ ok: true });
      const user = new DomainClientUser({
        transport,
        storage,
        storageKey: "test",
        suppressHeuristicWarning: true,
      });

      const api = user.Use<{ createUser: (args: unknown) => Promise<unknown> }>();
      await api.createUser?.({ name: "test" });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "createUser", type: "mutation" }),
      );
    });
  });

  // ── V1.0.12: 外部 IdP 登录（JWT 会话）──

  describe("V1.0.12 外部 IdP 登录（JWT 会话）", () => {
    const extLoginResult = {
      accessToken: "at1",
      refreshToken: "rt1",
      tokenType: "Bearer",
      expiresIn: 7200,
    };

    describe("M1 loginByExternal wire casing", () => {
      it("正路径: 成功建立 externalSession 并持久化（4 字段 / isAuthenticated / sessionKey=null）", async () => {
        const extLogin = vi.fn(async () => ({ ...extLoginResult }));
        transport.loginByExternal = extLogin;
        transport.refreshToken = vi.fn(async () => ({
          accessToken: "at2",
          refreshToken: "rt2",
          tokenType: "Bearer",
          expiresIn: 3600,
        }));

        const user = new DomainClientUser({ transport, storage, storageKey: "test" });
        const result = await user.loginByExternal("wechat_oauth", {
          code: "c1",
          channel_id: "w",
        });

        // 返回 ExternalLoginResult 严格 4 字段（wire 1:1，N2: 无 userName/displayName）
        expect(result).toEqual(extLoginResult);
        expect(user.externalSession?.accessToken).toBe("at1");
        expect(user.isAuthenticated).toBe(true);
        expect(user.sessionKey).toBeNull();
        expect(user.userName).toBeNull();
        expect(user.displayName).toBeNull();
        // 通道调用契约
        expect(extLogin).toHaveBeenCalledWith(
          expect.objectContaining({
            channelType: "wechat_oauth",
            parameters: expect.objectContaining({ code: "c1", channel_id: "w" }),
          }),
        );
        // 持久化：externalSession 对象 + expiresAt 为 > now 的 unix ms 数字
        const raw = storage.getItem("test");
        expect(raw).not.toBeNull();
        const persisted = JSON.parse(raw as string);
        expect(persisted.externalSession).toEqual(
          expect.objectContaining({ accessToken: "at1", refreshToken: "rt1" }),
        );
        expect(typeof persisted.externalSession.expiresAt).toBe("number");
        expect(persisted.externalSession.expiresAt).toBeGreaterThan(Date.now());
        expect(persisted.sessionKey).toBeNull();
      });

      it("负路径: wire casing 错误（snake_case）→ JWT_SESSION_INVALID 且不写 storage", async () => {
        // 模拟服务端返 snake_case（accessToken undefined）→ 守卫显式失败
        transport.loginByExternal = vi.fn(
          async (): Promise<ExternalLoginResult> =>
            ({ access_token: "x" } as unknown as ExternalLoginResult),
        );

        const user = new DomainClientUser({ transport, storage, storageKey: "test" });

        await expect(
          user.loginByExternal("wechat_oauth", { code: "c1" }),
        ).rejects.toMatchObject({ code: "JWT_SESSION_INVALID" });

        expect(storage.setItem).not.toHaveBeenCalled();
        expect(storage.getItem("test")).toBeNull();
        expect(user.isAuthenticated).toBe(false);
        expect(user.externalSession).toBeNull();
      });
    });

    describe("M2 restore 双形态", () => {
      it("(a) 旧格式 sessionKey 分支恢复", () => {
        storage.setItem("test", JSON.stringify({ sessionKey: "sk1", userName: "u" }));
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });

        expect(user.restore()).toBe(true);
        expect(user.sessionKey).toBe("sk1");
        expect(user.isAuthenticated).toBe(true);
        expect(user.userName).toBe("u");
        expect(user.externalSession).toBeNull();
      });

      it("(b) externalSession 分支恢复 + userName/displayName null（N2）", () => {
        storage.setItem(
          "test",
          JSON.stringify({
            sessionKey: null,
            userName: null,
            displayName: null,
            externalSession: {
              accessToken: "at1",
              refreshToken: "rt1",
              expiresAt: 1234567890,
            },
          }),
        );
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });

        expect(user.restore()).toBe(true);
        expect(user.externalSession).toEqual({
          accessToken: "at1",
          refreshToken: "rt1",
          expiresAt: 1234567890,
        });
        expect(user.isAuthenticated).toBe(true);
        expect(user.userName).toBeNull();
        expect(user.displayName).toBeNull();
        expect(user.sessionKey).toBeNull();
      });

      it("(c) 两分支互斥: sessionKey 优先（同时含两者走 sessionKey 分支）", () => {
        storage.setItem(
          "test",
          JSON.stringify({
            sessionKey: "sk1",
            userName: "u",
            externalSession: {
              accessToken: "at1",
              refreshToken: "rt1",
              expiresAt: 1,
            },
          }),
        );
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });

        expect(user.restore()).toBe(true);
        expect(user.sessionKey).toBe("sk1");
        expect(user.userName).toBe("u");
        expect(user.externalSession).toBeNull();
      });
    });

    describe("M3 前置守卫（INVALID_ARGUMENT）", () => {
      it("channelType 空 → INVALID_ARGUMENT 且 loginByExternal mock 未被调", async () => {
        const extLogin = vi.fn(async () => ({ ...extLoginResult }));
        transport.loginByExternal = extLogin;
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });

        await expect(
          user.loginByExternal("", { code: "c1" }),
        ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
        expect(extLogin).not.toHaveBeenCalled();
        expect(storage.setItem).not.toHaveBeenCalled();
      });

      it("parameters 缺 code → INVALID_ARGUMENT（不送服务端）", async () => {
        const extLogin = vi.fn(async () => ({ ...extLoginResult }));
        transport.loginByExternal = extLogin;
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });

        await expect(
          user.loginByExternal("wechat_oauth", {}),
        ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
        expect(extLogin).not.toHaveBeenCalled();
      });
    });

    describe("M4 无能力守卫（EXTERNAL_LOGIN_FAILED）", () => {
      it("transport 无 loginByExternal/refreshToken 且未注入 externalLoginTransport → 抛 EXTERNAL_LOGIN_FAILED", async () => {
        // createMockTransport 仅注册 execute（无外部登录/刷新能力）+ 显式 memoryStorage
        const plainTransport: Transport = { execute: vi.fn() };
        const user = new DomainClientUser({
          transport: plainTransport,
          storage: createMockStorage(),
          storageKey: "k",
        });

        const error = await user
          .loginByExternal("wechat_oauth", { code: "c1" })
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DomainClientError);
        expect((error as DomainClientError).code).toBe("EXTERNAL_LOGIN_FAILED");
        expect(plainTransport.execute).not.toHaveBeenCalled();
      });
    });

    describe("M5 refreshJwt", () => {
      it("(a) 成功: 调 refreshToken({refreshToken}) → 更新 externalSession + persist", async () => {
        const extRefresh = vi.fn(async () => ({
          accessToken: "at2",
          refreshToken: "rt2",
          tokenType: "Bearer",
          expiresIn: 3600,
        }));
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        transport.refreshToken = extRefresh;
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });
        await user.loginByExternal("wechat_oauth", { code: "c1" });

        const result = await user.refreshJwt();

        expect(extRefresh).toHaveBeenCalledWith(
          expect.objectContaining({ refreshToken: "rt1" }),
        );
        expect(result.accessToken).toBe("at2");
        expect(user.externalSession).toEqual(
          expect.objectContaining({ accessToken: "at2", refreshToken: "rt2" }),
        );
        expect(user.externalSession?.expiresAt).toBeGreaterThan(Date.now());
        const persisted = JSON.parse(storage.getItem("test") as string);
        expect(persisted.externalSession.accessToken).toBe("at2");
      });

      it("(b) 无 externalSession → JWT_SESSION_INVALID", async () => {
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });

        await expect(user.refreshJwt()).rejects.toMatchObject({
          code: "JWT_SESSION_INVALID",
        });
      });

      it("(c) transport 有 loginByExternal 但无 refreshToken 能力 → EXTERNAL_LOGIN_FAILED", async () => {
        // 仅注册 loginByExternal（不注册 refreshToken）
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });
        await user.loginByExternal("wechat_oauth", { code: "c1" });

        await expect(user.refreshJwt()).rejects.toMatchObject({
          code: "EXTERNAL_LOGIN_FAILED",
        });
      });

      it("(d) JWT_SESSION_INVALID 失败 → 清 externalSession + persist（Oracle 代码审核 M1：防死循环）", async () => {
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        transport.refreshToken = vi.fn(async () => {
          throw new DomainClientError(
            "External session expired — refresh token is invalid or revoked. Please re-authenticate.",
            "JWT_SESSION_INVALID",
          );
        });
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });
        await user.loginByExternal("wechat_oauth", { code: "c1" });
        expect(user.externalSession).not.toBeNull();

        await expect(user.refreshJwt()).rejects.toMatchObject({
          code: "JWT_SESSION_INVALID",
        });

        // 强制重登语义：会话已清 + 持久化已清
        expect(user.externalSession).toBeNull();
        expect(user.isAuthenticated).toBe(false);
        const persisted = storage.getItem("test");
        expect(persisted).toBeNull();
      });

      it("(e) NETWORK_ERROR 失败 → externalSession 保留（S4 语义：瞬态失败不清会话）", async () => {
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        transport.refreshToken = vi.fn(async () => {
          throw new DomainClientError("Network error", "NETWORK_ERROR");
        });
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });
        await user.loginByExternal("wechat_oauth", { code: "c1" });

        await expect(user.refreshJwt()).rejects.toMatchObject({
          code: "NETWORK_ERROR",
        });

        // 网络瞬态失败：会话保留（access 仍可用至过期）
        expect(user.externalSession).toEqual(
          expect.objectContaining({ accessToken: "at1", refreshToken: "rt1" }),
        );
        expect(storage.getItem("test")).not.toBeNull();
      });
    });

    describe("N3 形态切换互斥（至多一个非 null）", () => {
      it("(a) loginByContext 成功后 loginByExternal → sessionKey 清 null、externalSession 已设、storage 无 sessionKey 值", async () => {
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        vi.mocked(transport.execute).mockResolvedValue({
          loginByContext: { success: true, sessionKey: "sk_ctx", userName: "u" },
        });
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });

        await user.loginByContext("admin", "x");
        expect(user.sessionKey).toBe("sk_ctx");

        await user.loginByExternal("wechat_oauth", { code: "c1" });

        expect(user.sessionKey).toBeNull();
        expect(user.externalSession?.accessToken).toBe("at1");
        expect(user.isAuthenticated).toBe(true);
        const persisted = JSON.parse(storage.getItem("test") as string);
        expect(persisted.sessionKey).toBeNull();
        expect(persisted.externalSession?.accessToken).toBe("at1");
        // 重新 restore 仍走 externalSession 分支（sessionKey 分支不会误命中）
        const fresh = new DomainClientUser({ transport, storage, storageKey: "test" });
        expect(fresh.restore()).toBe(true);
        expect(fresh.sessionKey).toBeNull();
        expect(fresh.externalSession?.accessToken).toBe("at1");
      });

      it("(b) loginByExternal 成功后 loginByContext → externalSession 清 null", async () => {
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });
        await user.loginByExternal("wechat_oauth", { code: "c1" });
        expect(user.externalSession?.accessToken).toBe("at1");

        vi.mocked(transport.execute).mockResolvedValue({
          loginByContext: { success: true, sessionKey: "sk_ctx" },
        });
        await user.loginByContext("admin", "x");

        expect(user.externalSession).toBeNull();
        expect(user.sessionKey).toBe("sk_ctx");
        expect(user.isAuthenticated).toBe(true);
      });

      it("(b2) loginByExternal 成功后 loginByPassword（loginAs 明文路径）→ externalSession 清 null", async () => {
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        const user = new DomainClientUser({
          transport,
          storage,
          storageKey: "test",
          useSecureLogin: false,
        });
        await user.loginByExternal("wechat_oauth", { code: "c1" });

        vi.mocked(transport.execute).mockResolvedValue({
          loginByPassword: { success: true, sessionKey: "sk_pw" },
        });
        await user.loginAs("admin", "secret");

        expect(user.externalSession).toBeNull();
        expect(user.sessionKey).toBe("sk_pw");
        expect(user.isAuthenticated).toBe(true);
      });
    });

    describe("M6 Bearer 透传（JWT 会话）", () => {
      it("loginByExternal 后 query() 携带 bearerToken", async () => {
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        vi.mocked(transport.execute).mockResolvedValue({ data: "ok" });
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });
        await user.loginByExternal("wechat_oauth", { code: "c1" });

        await user.query("getX");

        expect(transport.execute).toHaveBeenCalledWith(
          expect.objectContaining({ field: "getX", bearerToken: "at1" }),
        );
      });

      it("restore() 恢复 externalSession 后 query() 携带 bearerToken", async () => {
        storage.setItem(
          "test",
          JSON.stringify({
            externalSession: { accessToken: "at1", refreshToken: "rt1", expiresAt: 1234567890 },
          }),
        );
        vi.mocked(transport.execute).mockResolvedValue({ data: "ok" });
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });
        expect(user.restore()).toBe(true);

        await user.query("getX");

        expect(transport.execute).toHaveBeenCalledWith(
          expect.objectContaining({ field: "getX", bearerToken: "at1" }),
        );
      });

      it("Use<T>() ServiceProxy 透传 bearerToken", async () => {
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        vi.mocked(transport.execute).mockResolvedValue({ getUser: { id: 1 } });
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });
        await user.loginByExternal("wechat_oauth", { code: "c1" });

        const api = user.Use<{ getUser: (args: unknown) => Promise<unknown> }>();
        await api.getUser?.({ id: 1 });

        expect(transport.execute).toHaveBeenCalledWith(
          expect.objectContaining({ field: "getUser", bearerToken: "at1" }),
        );
      });

      it("logout() 携带 bearerToken 且清 externalSession", async () => {
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        vi.mocked(transport.execute).mockResolvedValue({ logout: { success: true } });
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });
        await user.loginByExternal("wechat_oauth", { code: "c1" });

        await user.logout();

        expect(transport.execute).toHaveBeenCalledWith(
          expect.objectContaining({ field: "logout", bearerToken: "at1" }),
        );
        expect(user.externalSession).toBeNull();
        expect(user.sessionKey).toBeNull();
        expect(user.isAuthenticated).toBe(false);
      });
    });

    describe("logout / clearLocalState（M4 配套）", () => {
      it("loginByExternal 后 logout() → externalSession 清空 + storage.removeItem 被调", async () => {
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        vi.mocked(transport.execute).mockResolvedValue({ logout: { success: true } });
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });
        await user.loginByExternal("wechat_oauth", { code: "c1" });
        expect(storage.getItem("test")).not.toBeNull();

        await user.logout();

        expect(user.externalSession).toBeNull();
        expect(user.isAuthenticated).toBe(false);
        expect(user.userName).toBeNull();
        expect(user.displayName).toBeNull();
        expect(storage.removeItem).toHaveBeenCalledWith("test");
        expect(storage.getItem("test")).toBeNull();
      });

      it("clearLocalState 后全字段复位为空闲态", async () => {
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        vi.mocked(transport.execute).mockResolvedValue({ logout: { success: true } });
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });
        await user.loginByExternal("wechat_oauth", { code: "c1" });

        await user.logout();

        expect({
          externalSession: user.externalSession,
          sessionKey: user.sessionKey,
          isAuthenticated: user.isAuthenticated,
        }).toEqual({
          externalSession: null,
          sessionKey: null,
          isAuthenticated: false,
        });
      });
    });

    // Oracle 代码审核 S3：N3 互斥未覆盖 loginBySms 路径
    describe("N3 补全：loginBySms 形态互斥", () => {
      it("loginByExternal 成功后 loginBySms → externalSession 清 null", async () => {
        transport.loginByExternal = vi.fn(async () => ({ ...extLoginResult }));
        vi.mocked(transport.execute).mockResolvedValue({
          loginBySms: { success: true, sessionKey: "sk_sms", userName: "u2" },
        });
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });

        await user.loginByExternal("wechat_oauth", { code: "c1" });
        expect(user.externalSession).not.toBeNull();

        await user.loginBySms("13800138000", "123456");

        expect(user.externalSession).toBeNull();
        expect(user.sessionKey).toBe("sk_sms");
        const persisted = JSON.parse(storage.getItem("test") as string);
        expect(persisted.externalSession).toBeNull();
        expect(persisted.sessionKey).toBe("sk_sms");
      });
    });

    // Oracle 代码审核 S4：loginByExternal 不经 ServiceProxy 启发式/transport.execute
    describe("M8 补全：loginByExternal 专走 REST 能力通道（不经 ServiceProxy 启发式）", () => {
      it("user.loginByExternal() 调用的是专用通道能力方法，而非 transport.execute（启发式路由）", async () => {
        const extLogin = vi.fn(async () => ({ ...extLoginResult }));
        transport.loginByExternal = extLogin;
        const user = new DomainClientUser({ transport, storage, storageKey: "test" });

        await user.loginByExternal("wechat_oauth", { code: "c1" });

        // 专走 RestTransport.loginByExternal 能力方法（P3 能力即注册）
        expect(extLogin).toHaveBeenCalledTimes(1);
        expect(extLogin).toHaveBeenCalledWith(
          expect.objectContaining({ channelType: "wechat_oauth", parameters: { code: "c1" } }),
        );
        // 不经 transport.execute（ServiceProxy 字段启发式/isMutation 路由——该路径会被误判为 GraphQL mutation）
        expect(transport.execute).not.toHaveBeenCalled();
      });
    });
  });
});
