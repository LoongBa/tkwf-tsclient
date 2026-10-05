import { describe, it, expect, vi } from "vitest";
import { ServiceProxy } from "./service-proxy";
import type { Transport } from "./transport";

function createMockTransport(): Transport {
  return {
    execute: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe("ServiceProxy", () => {
  // V1.0.11（G16 根治）：废弃前缀启发式单次告警（M5）。置于文件最前，保证 module 级
  // heuristicWarned flag 在 suppress 用例验证时尚未触发（vitest 每文件独立模块实例）。
  describe("heuristic deprecation warning (V1.0.11)", () => {
    it("suppressHeuristicWarning: true → 无告警（判定结果不变）", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const transport = createMockTransport();
        const proxy = new ServiceProxy({ transport, suppressHeuristicWarning: true });
        const api = proxy.createUse();

        // removeUser 命中前缀启发式 → mutation（判定不受 suppress 影响）
        await api.removeUser?.({ id: 1 });

        expect(transport.execute).toHaveBeenCalledWith(
          expect.objectContaining({ field: "removeUser", type: "mutation" }),
        );
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("未配置 operationKinds 且字段落启发式 → console.warn 恰好一次（module 级去重）", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const transport = createMockTransport();
        const proxy = new ServiceProxy({ transport });
        const api = proxy.createUse();

        // 第一次启发式命中 → 告警
        await api.createUser?.({ name: "test" });
        // 第二次仍落启发式 → 去重不再告警
        await api.updateProfile?.({ name: "test" });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("operationKinds"),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("isMutation detection", () => {
    it("classifies create* methods as mutation", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({ transport });
      const api = proxy.createUse();

      await api.createUser?.({ name: "test" });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "createUser", type: "mutation" }),
      );
    });

    it("classifies update* methods as mutation", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({ transport });
      const api = proxy.createUse();

      await api.updateProfile?.({ name: "test" });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "updateProfile", type: "mutation" }),
      );
    });

    it("classifies delete* methods as mutation", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({ transport });
      const api = proxy.createUse();

      await api.deleteItem?.({ id: 1 });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "deleteItem", type: "mutation" }),
      );
    });

    it("classifies get* methods as query", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({ transport });
      const api = proxy.createUse();

      await api.getUser?.({ id: 1 });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "getUser", type: "query" }),
      );
    });

    it("classifies search* methods as query", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({ transport });
      const api = proxy.createUse();

      await api.searchUsers?.({ q: "foo" });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "searchUsers", type: "query" }),
      );
    });
  });

  describe("explicitMutations", () => {
    it("classifies ping as mutation when in explicitMutations", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        explicitMutations: new Set(["ping"]),
      });
      const api = proxy.createUse();

      await api.ping?.();

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "ping", type: "mutation" }),
      );
    });

    it("classifies logout as mutation when in explicitMutations", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        explicitMutations: new Set(["logout"]),
      });
      const api = proxy.createUse();

      await api.logout?.();

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "logout", type: "mutation" }),
      );
    });

    it("classifies loginByPassword as mutation when in explicitMutations", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        explicitMutations: new Set(["loginByPassword"]),
      });
      const api = proxy.createUse();

      await api.loginByPassword?.({ userName: "admin", password: "s" });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "loginByPassword", type: "mutation" }),
      );
    });

    it("falls back to prefix heuristic for non-explicit names", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        explicitMutations: new Set(["ping"]), // only ping
      });
      const api = proxy.createUse();

      // getUser doesn't match prefix nor explicitMutations → query
      await api.getUser?.();

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "getUser", type: "query" }),
      );
    });
  });

  // V1.0.11（G16 根治）：operationKinds 权威映射（M1/M2/M4/M3 integration）
  describe("operationKinds (V1.0.11 G16 根治)", () => {
    it("operationKinds query 命中 → type query（G16 复刻：Execute 字段不再 400）", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        operationKinds: {
          removeBuddy_Execute: "query",
          createTask_Execute: "query",
          createStudySession_Execute: "query",
          updateTask_Execute: "query",
        },
      });
      const api = proxy.createUse();

      await api.removeBuddy_Execute?.({ buddyId: 1 });
      await api.createTask_Execute?.({ name: "x" });
      await api.createStudySession_Execute?.({ id: 1 });
      await api.updateTask_Execute?.({ id: 1 });

      // 前缀启发式会把 remove*/create*/update* 判为 mutation → 现在权威映射判定恒 query
      expect(transport.execute).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ field: "removeBuddy_Execute", type: "query" }));
      expect(transport.execute).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ field: "createTask_Execute", type: "query" }));
      expect(transport.execute).toHaveBeenNthCalledWith(3,
        expect.objectContaining({ field: "createStudySession_Execute", type: "query" }));
      expect(transport.execute).toHaveBeenNthCalledWith(4,
        expect.objectContaining({ field: "updateTask_Execute", type: "query" }));
    });

    it("operationKinds mutation 命中 → type mutation（权威映射反向验证）", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        operationKinds: {
          loginByPassword: "mutation",
          logout: "mutation",
        },
      });
      const api = proxy.createUse();

      await api.loginByPassword?.({ userName: "admin", password: "s" });
      await api.logout?.();

      expect(transport.execute).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ field: "loginByPassword", type: "mutation" }));
      expect(transport.execute).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ field: "logout", type: "mutation" }));
    });

    it("operationKinds 未命中 → explicitMutations 兜底（内置登录仍 mutation）", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        // loginByPassword 不在 operationKinds → 落到 explicitMutations
        operationKinds: { someQuery: "query" },
        explicitMutations: new Set(["loginByPassword"]),
      });
      const api = proxy.createUse();

      await api.loginByPassword?.({ userName: "admin", password: "s" });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "loginByPassword", type: "mutation" }),
      );
    });

    it("operationKinds 未命中且非 explicitMutations → 前缀启发式兜底（非前缀 query 字段）", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        operationKinds: { createTask_Execute: "query" }, // 未覆盖 getUser
      });
      const api = proxy.createUse();

      // getUser 不在 operationKinds / explicitMutations → 启发式 → 非前缀 → query
      await api.getUser?.({ id: 1 });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "getUser", type: "query" }),
      );
    });

    it("integration: operationKinds 经 createUse → transport 捕获 execute({type}) 断言 type === 'query'", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        operationKinds: { createTask_Execute: "query" },
      });
      const api = proxy.createUse();

      await api.createTask_Execute?.({ name: "x" });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ field: "createTask_Execute", type: "query" }),
      );
      // 直接断言 transport 捕获的 execute 参数 type（HTTP 体不再 mutation { ... }）
      const call = vi.mocked(transport.execute).mock.calls[0]?.[0];
      expect(call?.type).toBe("query");
    });
  });

  describe("selectionMap", () => {
    it("includes subfield selection when selectionMap has the field", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        selectionMap: { merchantUserInfo: "pageInfo { ... } nodes { id name } totalCount" },
      });
      const api = proxy.createUse();

      await api.merchantUserInfo?.({ first: 10 });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          field: "merchantUserInfo",
          selection: "pageInfo { ... } nodes { id name } totalCount",
        }),
      );
    });

    it("omits selection when field not in map", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        selectionMap: { otherField: "id" },
      });
      const api = proxy.createUse();

      await api.someField?.();

      expect(transport.execute).toHaveBeenCalledWith(
        expect.not.objectContaining({ selection: "id" }),
      );
    });
  });

  describe("variableTypesMap", () => {
    it("passes variableTypes when variableTypesMap has the field", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        // rankings_Execute 不匹配前缀启发式，explicitMutations 声明其为 mutation（与真实 schema 一致）
        explicitMutations: new Set(["rankings_Execute"]),
        variableTypesMap: { rankings_Execute: { request: "GetRankingsReqDtoInput!" } },
      });
      const api = proxy.createUse();

      await api.rankings_Execute?.({ request: { page: 1 } });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          field: "rankings_Execute",
          type: "mutation",
          variableTypes: { request: "GetRankingsReqDtoInput!" },
        }),
      );
    });

    it("omits variableTypes when field not in map", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        variableTypesMap: { otherField: { request: "OtherInput!" } },
      });
      const api = proxy.createUse();

      await api.rankings_Execute?.();

      expect(transport.execute).toHaveBeenCalledWith(
        expect.not.objectContaining({ variableTypes: expect.anything() }),
      );
    });

    it("options variableTypes overrides variableTypesMap", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        variableTypesMap: { rankings_Execute: { request: "FromMap!" } },
      });
      const api = proxy.createUse();

      await api.rankings_Execute?.(
        { request: { page: 1 } },
        { variableTypes: { request: "OverrideInput!" } },
      );

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ variableTypes: { request: "OverrideInput!" } }),
      );
    });

    it("omits variableTypes when no map configured and no options bag", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({ transport });
      const api = proxy.createUse();

      await api.rankings_Execute?.({ request: { page: 1 } });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.not.objectContaining({ variableTypes: expect.anything() }),
      );
    });

    it("integration: forwards full operation payload including variableTypes", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({
        transport,
        sessionKey: "sk_test",
        selectionMap: { createRanking: "request { id name }" },
        variableTypesMap: { createRanking: { request: "CreateRankingInput!" } },
      });
      const api = proxy.createUse();
      const ac = new AbortController();

      await api.createRanking?.(
        { request: { id: 1, name: "x" } },
        { signal: ac.signal },
      );

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          field: "createRanking",
          type: "mutation",
          variables: { request: { id: 1, name: "x" } },
          selection: "request { id name }",
          variableTypes: { request: "CreateRankingInput!" },
          sessionKey: "sk_test",
          signal: ac.signal,
        }),
      );
    });
  });

  describe("signal forwarding", () => {
    it("forwards signal from options arg", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({ transport });
      const api = proxy.createUse();
      const abortController = new AbortController();

      await api.getUser?.({ id: 1 }, { signal: abortController.signal });

      expect(transport.execute).toHaveBeenCalledWith(
        expect.objectContaining({ signal: abortController.signal }),
      );
    });

    it("works without options arg", async () => {
      const transport = createMockTransport();
      const proxy = new ServiceProxy({ transport });
      const api = proxy.createUse();

      await api.getUser?.({ id: 1 });

      expect(transport.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe("response unwrapping", () => {
    it("resolves with the field-keyed value（GraphQL data 形状）", async () => {
      const transport = createMockTransport();
      // GraphQLTransport 契约：execute 返回 { [field]: 数据 }
      vi.mocked(transport.execute).mockResolvedValue({
        getUser: { id: 1, name: "Alice" },
      });
      const proxy = new ServiceProxy({ transport });
      const api = proxy.createUse();

      const result = await api.getUser?.({ id: 1 });
      expect(result).toEqual({ id: 1, name: "Alice" });
    });

    it("falls back to raw result when field key absent（REST 平铺形状）", async () => {
      const transport = createMockTransport();
      vi.mocked(transport.execute).mockResolvedValue({ status: "ok" });
      const proxy = new ServiceProxy({ transport });
      const api = proxy.createUse();

      const result = await api.createUser?.({});
      expect(result).toEqual({ status: "ok" });
    });
  });
});
