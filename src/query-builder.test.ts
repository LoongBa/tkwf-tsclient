// V4.9.20: QueryBuilder 单元测试
// 模拟 codegen 产物（MerchantUserInfoQueryBuilder），验证 SDK 核心能力。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  QueryBuilderBase,
  registerQueryBuilder,
  createQueryBuilder,
  resetQueryBuilderRegistry,
  CompoundNode,
  LeafNode,
  createOperators,
  createStringOps,
  createNumberOps,
  createDateOps,
  createBooleanOps,
  dummyAsc,
  dummyDesc,
} from "./query-builder";
import type {
  PredicateNode,
  StringFieldOperators,
  NumberFieldOperators,
  DateFieldOperators,
  BooleanFieldOperators,
  SortNode,
  PagedResponse,
} from "./query-builder-types";
import { PagedResponse as PagedResponseClass } from "./query-builder-types";
import { GraphQLTransport } from "./transport";
import type { Transport } from "./transport";

// ── 模拟实体类型（codegen 应生成等价类型） ──

interface MockEntity {
  id: number;
  userName: string;
  status: string;
  amount: number;
  createTime: string;
  isDeleted: boolean;
}

// ── 模拟字段代理接口（codegen 应生成等价接口） ──

interface MockEntityFields {
  id: NumberFieldOperators<MockEntityFields>;
  userName: StringFieldOperators<MockEntityFields>;
  status: StringFieldOperators<MockEntityFields>;
  amount: NumberFieldOperators<MockEntityFields>;
  createTime: DateFieldOperators<MockEntityFields>;
  isDeleted: BooleanFieldOperators<MockEntityFields>;
}

interface MockEntityOrderByFields {
  id: SortNode;
  userName: SortNode;
  createTime: SortNode;
  amount: SortNode;
}

type MockEntitySelectFields = Partial<{
  id: true;
  userName: true;
  status: true;
  amount: true;
  createTime: true;
  isDeleted: true;
}>;

// ── 模拟 QueryBuilder 子类（codegen 应生成等价类） ──

class MockEntityQueryBuilder extends QueryBuilderBase<
  MockEntity,
  MockEntityFields,
  MockEntityOrderByFields,
  MockEntitySelectFields
> {
  protected defaultFields(): string[] {
    return ["id", "userName", "status", "amount", "createTime", "isDeleted"];
  }

  protected createFieldsProxy(): MockEntityFields {
    return this.createFieldsProxyFrom<MockEntityFields>({
      id: "Long", userName: "String", status: "String",
      amount: "Decimal", createTime: "DateTime", isDeleted: "Boolean",
    });
  }
}

// ── Mock QueryBuilder 已在 beforeEach 中注册（配合 resetQueryBuilderRegistry 隔离测试） ──

// ── 测试辅助 ──

function createMockTransport(): Transport {
  return {
    execute: vi.fn(),
    executeRawGraphQL: vi.fn(),
  };
}

function mockFetchResponse(data: unknown) {
  return vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ data })),
    json: () => Promise.resolve({ data }),
  } as Response);
}

// ── 测试用例 ──

describe("QueryBuilder", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => Promise.resolve(new Response()),
    );
    resetQueryBuilderRegistry(); // 每次测试前重置注册表，隔离测试污染
    // 重新注册 MockEntity
    registerQueryBuilder("MockEntity", (transport, field, sessionKey) =>
      new MockEntityQueryBuilder(transport, field, sessionKey));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 过滤 ──

  it("T1: single field eq filter", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.userName.eq("admin"));
    expect(qb["_filters"]).toEqual([{ userName: { eq: "admin" } }]);
  });

  it("T2: multiple where calls → AND", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.status.eq("Active")).where(x => x.amount.gt(100));
    expect(qb["_filters"]).toEqual([
      { status: { eq: "Active" } },
      { amount: { gt: 100 } },
    ]);
  });

  it("T3: single where with .and() → single compound AND", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.userName.eq("admin").and(x => x.status.eq("Active")));
    expect(qb["_filters"]).toEqual([
      { and: [{ userName: { eq: "admin" } }, { status: { eq: "Active" } }] },
    ]);
  });

  it("T4: OR branch", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.status.eq("Active").or(x => x.status.eq("Pending")));
    expect(qb["_filters"]).toEqual([
      { or: [{ status: { eq: "Active" } }, { status: { eq: "Pending" } }] },
    ]);
  });

  it("T5: string operators", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.userName.contains("admin"));
    expect(qb["_filters"]).toEqual([{ userName: { contains: "admin" } }]);
    // 第二个 where 追加到新 builder
    const qb2 = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb2.where(x => x.userName.startsWith("a"));
    expect(qb2["_filters"]).toEqual([{ userName: { startsWith: "a" } }]);
    const qb3 = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb3.where(x => x.userName.endsWith("z"));
    expect(qb3["_filters"]).toEqual([{ userName: { endsWith: "z" } }]);
  });

  it("T6: number operators", () => {
    let qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.amount.gt(100));
    expect(qb["_filters"]).toEqual([{ amount: { gt: 100 } }]);
    qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.amount.gte(200));
    expect(qb["_filters"]).toEqual([{ amount: { gte: 200 } }]);
    qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.amount.lt(300));
    expect(qb["_filters"]).toEqual([{ amount: { lt: 300 } }]);
    qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.amount.lte(400));
    expect(qb["_filters"]).toEqual([{ amount: { lte: 400 } }]);
  });

  it("T7: boolean isFalse (≈ !x.isDeleted)", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.isDeleted.isFalse());
    expect(qb["_filters"]).toEqual([{ isDeleted: { eq: false } }]);
  });

  // ── 排序 ──

  it("T8: single field orderBy desc", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.orderBy(x => x.createTime.desc());
    expect(qb["_sorts"]).toEqual([{ field: "createTime", desc: true }]);
  });

  it("T9: multi-field sort with thenBy", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.orderBy(x => x.status.asc()).thenBy(x => x.createTime.desc());
    expect(qb["_sorts"]).toEqual([
      { field: "status", desc: false },
      { field: "createTime", desc: true },
    ]);
  });

  // ── 字段选择 ──

  it("T10: object-style select", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.select({ id: true, userName: true });
    expect(qb["_fields"]).toEqual(["id", "userName"]);
  });

  it("T11: default fields when no select", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    expect(qb["_fields"]).toEqual([]);
    // 编译时使用 defaultFields()
    expect(qb["defaultFields"]()).toEqual([
      "id", "userName", "status", "amount", "createTime", "isDeleted",
    ]);
  });

  // ── 分页 ──

  it("T12: page parameters", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.page(2, 30);
    expect(qb["_page"]).toBe(2);
    expect(qb["_pageSize"]).toBe(30);
  });

  it("T13: take limits", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.take(50);
    expect(qb["_pageSize"]).toBe(50);
  });

  // ── GraphQL 编译 ──

  it("T14: full chain compiles correct GraphQL", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.status.eq("Active"));
    qb.orderBy(x => x.createTime.desc());
    qb.select({ id: true, userName: true });
    qb.page(1, 20);
    const query = qb["compileGraphQL"]();
    expect(query).toContain("mockEntity(first: 20");
    expect(query).toContain("where: { status: { eq: \"Active\" } }");
    expect(query).toContain("order: { createTime: DESC }");
    expect(query).toContain("nodes { id userName }");
  });

  it("T15: executeRawGraphQL is called on execute", async () => {
    const transport = createMockTransport();
    const qb = createQueryBuilder<MockEntity>("MockEntity", transport, "sk_test");
    qb.where(x => x.status.eq("Active"));
    qb.select({ id: true });

    vi.mocked(transport.executeRawGraphQL).mockResolvedValue({
      mockEntity: { totalCount: 1, nodes: [{ id: 1, userName: "admin" }] },
    } as any);

    const result = await qb.toListAsync();
    expect(transport.executeRawGraphQL).toHaveBeenCalledWith(
      expect.stringContaining("mockEntity(first: 100"),
      "sk_test",
      undefined,
    );
    expect(result).toEqual([{ id: 1, userName: "admin" }]);
  });

  it("T16: toPageAsync returns PagedResponse with cursor cache", async () => {
    const transport = createMockTransport();
    transport.executeRawGraphQL = vi.fn<[string, string?, AbortSignal?], any>().mockResolvedValue({
      mockEntity: {
        totalCount: 50,
        nodes: [{ id: 1 }, { id: 2 }],
        pageInfo: { endCursor: "cursor_1", hasNextPage: true },
      },
    });
    const qb = createQueryBuilder<MockEntity>("MockEntity", transport);

    qb.where(x => x.status.eq("Active"));
    qb.select({ id: true });

    const result = await qb.toPageAsync();
    expect(result.totalCount).toBe(50);
    expect(result.items).toHaveLength(2);
    expect(result.pageInfo?.endCursor).toBe("cursor_1");
    // 游标已缓存
    expect(qb["_cursorCache"].has(1)).toBe(true);
    expect(qb["_latestCursor"]).toBe("cursor_1");
  });

  // ── 注册表 ──

  it("createQueryBuilder throws for unregistered entity", () => {
    expect(() => createQueryBuilder("NonExistentEntity", createMockTransport()))
      .toThrow("No QueryBuilder registered for entity: 'NonExistentEntity'");
  });

  // ── 边界情况 ──

  it("T17: no where clause compiles clean GraphQL", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.select({ id: true });
    const query = qb["compileGraphQL"]();
    expect(query).toContain("mockEntity(first: 100");
    expect(query).not.toContain("where:");
  });

  it("T18: special characters in string values are escaped", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.userName.eq('admin"'));
    const filter = qb["_filters"][0] as any;
    // 转义后的值应为 JSON.stringify('admin"') = '"admin\\""'
    const serialized = QueryBuilderBase.toHCWhereCondition(filter);
    expect(serialized).toContain('"admin\\""');
  });

  it("T19: null filter value serializes correctly", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.userName.eq(null as any));
    const filter = qb["_filters"][0] as any;
    const serialized = QueryBuilderBase.toHCWhereCondition(filter);
    expect(serialized).toContain("null");
  });

  it("T20: deep nesting (3+ levels AND/OR)", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.userName.eq("1").and(x => x.status.eq("2")).and(x => x.createTime.eq("3")));
    expect(qb["_filters"].length).toBe(1);
    const filter = qb["_filters"][0] as any;
    expect(filter.and).toHaveLength(3);
  });

  it("T21: empty CompoundNode throws on and/or", () => {
    const node = new CompoundNode<any>("and", []);
    expect(() => node.and((x: any) => x)).toThrow("empty compound predicate");
    expect(() => node.or((x: any) => x)).toThrow("empty compound predicate");
  });

  it("T22: nextPage/prevPage cursor management", async () => {
    const transport = createMockTransport();
    transport.executeRawGraphQL = vi.fn<[string, string?, AbortSignal?], any>().mockResolvedValue({
      mockEntity: {
        totalCount: 50, nodes: [{ id: 1 }],
        pageInfo: { endCursor: "cursor_1", hasNextPage: true },
      },
    });
    const qb = createQueryBuilder<MockEntity>("MockEntity", transport);
    qb.select({ id: true });
    await qb.toPageAsync();
    // nextPage 使用缓存的游标
    qb.nextPage(20);
    expect(qb["_page"]).toBe(2);
    expect(qb["_pageSize"]).toBe(20);
    expect(qb["_afterCursor"]).toBe("cursor_1");
    // prevPage 回到第 1 页
    qb.prevPage();
    expect(qb["_page"]).toBe(1);
    expect(qb["_afterCursor"]).toBeUndefined();
  });

  it("T23: registerQueryBuilder warns on duplicate registration", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const factory = (t: any, f: string, s?: string) => new MockEntityQueryBuilder(t, f, s);
    registerQueryBuilder("MockEntity", factory);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Duplicate registration"),
    );
    warnSpy.mockRestore();
  });

  it("T24: empty array in/nin serializes correctly", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.where(x => x.userName.in([]));
    const filter = qb["_filters"][0] as any;
    expect(filter).toEqual({ userName: { in: [] } });
  });

  it("T25: formatScalar throws on NaN/Infinity", () => {
    expect(() => QueryBuilderBase["formatScalar"](NaN)).toThrow();
    expect(() => QueryBuilderBase["formatScalar"](Infinity)).toThrow();
  });

  // ── v1.0.5 基类去重化（compileGraphQL/createOrderByProxy/操作符工厂下沉到 SDK） ──

  it("T26: metadata-driven createFieldsProxy maps gqlTypes via createOperators", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    // userName → "String" → createStringOps
    qb.where(x => x.userName.contains("a"));
    expect(qb["_filters"][0]).toEqual({ userName: { contains: "a" } });
    // isDeleted → "Boolean" → createBooleanOps
    qb.where(x => x.isDeleted.isFalse());
    expect(qb["_filters"][1]).toEqual({ isDeleted: { eq: false } });
    // amount → "Decimal" → createNumberOps
    qb.where(x => x.amount.gt(100));
    expect(qb["_filters"][2]).toEqual({ amount: { gt: 100 } });
    // createTime → "DateTime" → createDateOps
    qb.where(x => x.createTime.lte("2024-01-01"));
    expect(qb["_filters"][3]).toEqual({ createTime: { lte: "2024-01-01" } });
  });

  it("T27: compileGraphQL from base class matches entity resolver + default fields", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    const query = qb["compileGraphQL"]();
    expect(query).toBe(
      "query { mockEntity(first: 100) { totalCount nodes { id userName status amount createTime isDeleted } } }",
    );
  });

  it("T28: createOrderByProxy from base returns SortNode with field", () => {
    const qb = createQueryBuilder<MockEntity>("MockEntity", createMockTransport());
    qb.orderBy(x => x.createTime.desc());
    expect(qb["_sorts"]).toEqual([{ field: "createTime", desc: true }]);
    // 基类代理返回的 SortNode 携带 dummyAsc/dummyDesc 方法
    const node = (qb as any)["createOrderByProxy"]().createTime as SortNode;
    expect(node.field).toBe("createTime");
    expect(node.isDesc).toBe(false);
    expect(node.desc().isDesc).toBe(true);
    expect(node.asc().isDesc).toBe(false);
  });

  it("T29: imported SDK operator factories produce identical filters", () => {
    const ops = createStringOps<MockEntityFields>("userName", {} as MockEntityFields);
    expect(ops.eq("admin").toFilter()).toEqual({ userName: { eq: "admin" } });
    const numOps = createNumberOps<MockEntityFields>("amount", {} as MockEntityFields);
    expect(numOps.gt(100).toFilter()).toEqual({ amount: { gt: 100 } });
    const dateOps = createDateOps<MockEntityFields>("createTime", {} as MockEntityFields);
    expect(dateOps.lte("2024-01-01").toFilter()).toEqual({ createTime: { lte: "2024-01-01" } });
    const boolOps = createBooleanOps<MockEntityFields>("isDeleted", {} as MockEntityFields);
    expect(boolOps.isTrue().toFilter()).toEqual({ isDeleted: { eq: true } });
    // createOperators 按 gqlType 路由到对应分族工厂
    const routed = createOperators<MockEntityFields>(
      "status", "String", {} as MockEntityFields,
    ) as StringFieldOperators<MockEntityFields>;
    expect(routed.eq("Active").toFilter()).toEqual({ status: { eq: "Active" } });
    // dummyAsc/dummyDesc 为纯函数，返回新的 SortNode
    expect(typeof dummyAsc).toBe("function");
    expect(typeof dummyDesc).toBe("function");
  });
});