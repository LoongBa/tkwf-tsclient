import { describe, it, expect, vi } from "vitest";
import { ServiceProxy } from "./service-proxy";
import type { Transport } from "./transport";

function createMockTransport(): Transport {
  return {
    execute: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe("ServiceProxy", () => {
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
