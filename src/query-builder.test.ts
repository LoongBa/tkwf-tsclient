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

  protected compileGraphQL(): string {
    const fields = this._fields.length > 0
      ? this._fields.join(" ")
      : this.defaultFields().join(" ");
    const whereClause = this.buildWhereClause();
    const orderClause = this.buildOrderClause();
    const afterClause = this._afterCursor
      ? `, after: "${this._afterCursor}"`
      : "";
    const pageInfo = this._cursorCache.size > 0 || this._afterCursor
      ? " pageInfo { endCursor hasNextPage }"
      : "";
    return `query { mockEntity(first: ${this._pageSize}${afterClause}${whereClause}${orderClause}) { totalCount nodes { ${fields} }${pageInfo} } }`;
  }

  protected createFieldsProxy(): MockEntityFields {
    // 返回一个代理对象，每个属性访问返回对应的操作符对象
    const proxy = new Proxy({} as MockEntityFields, {
      get: (_target, prop: string | symbol) => {
        const fieldName = typeof prop === "string" ? prop : "";
        switch (fieldName) {
          case "id": case "amount":
            return createNumberOperators(fieldName, proxy);
          case "userName": case "status":
            return createStringOperators(fieldName, proxy);
          case "createTime":
            return createDateOperators(fieldName, proxy);
          case "isDeleted":
            return createBooleanOperators(fieldName, proxy);
          default:
            return createStringOperators(fieldName, proxy);
        }
      },
    });
    return proxy;
  }

  protected createOrderByProxy(): MockEntityOrderByFields {
    return new Proxy({} as MockEntityOrderByFields, {
      get: (_target, prop: string | symbol) => {
        const field = typeof prop === "string" ? prop : "";
        return {
          field,
          isDesc: false,
          asc(): SortNode { return { field, isDesc: false, asc: this.asc as () => SortNode, desc: this.desc as () => SortNode }; },
          desc(): SortNode { return { field, isDesc: true, asc: this.asc as () => SortNode, desc: this.desc as () => SortNode }; },
        } as SortNode;
      },
    });
  }
}

// ── 操作符工厂（模拟 codegen 应生成的等价逻辑） ──

function createStringOperators<TFields>(field: string, proxy: TFields): StringFieldOperators<TFields> {
  return {
    eq: (val) => new LeafNode(field, "eq", val, proxy),
    neq: (val) => new LeafNode(field, "neq", val, proxy),
    contains: (val) => new LeafNode(field, "contains", val, proxy),
    startsWith: (val) => new LeafNode(field, "startsWith", val, proxy),
    endsWith: (val) => new LeafNode(field, "endsWith", val, proxy),
    in: (val) => new LeafNode(field, "in", val, proxy),
    nin: (val) => new LeafNode(field, "nin", val, proxy),
  };
}

function createNumberOperators<TFields>(field: string, proxy: TFields): NumberFieldOperators<TFields> {
  return {
    eq: (val) => new LeafNode(field, "eq", val, proxy),
    neq: (val) => new LeafNode(field, "neq", val, proxy),
    gt: (val) => new LeafNode(field, "gt", val, proxy),
    gte: (val) => new LeafNode(field, "gte", val, proxy),
    lt: (val) => new LeafNode(field, "lt", val, proxy),
    lte: (val) => new LeafNode(field, "lte", val, proxy),
    in: (val) => new LeafNode(field, "in", val, proxy),
    nin: (val) => new LeafNode(field, "nin", val, proxy),
  };
}

function createDateOperators<TFields>(field: string, proxy: TFields): DateFieldOperators<TFields> {
  return {
    eq: (val) => new LeafNode(field, "eq", val, proxy),
    neq: (val) => new LeafNode(field, "neq", val, proxy),
    gt: (val) => new LeafNode(field, "gt", val, proxy),
    gte: (val) => new LeafNode(field, "gte", val, proxy),
    lt: (val) => new LeafNode(field, "lt", val, proxy),
    lte: (val) => new LeafNode(field, "lte", val, proxy),
  };
}

function createBooleanOperators<TFields>(field: string, proxy: TFields): BooleanFieldOperators<TFields> {
  return {
    eq: (val) => new LeafNode(field, "eq", val, proxy),
    neq: (val) => new LeafNode(field, "neq", val, proxy),
    isTrue: () => new LeafNode(field, "eq", true, proxy),
    isFalse: () => new LeafNode(field, "eq", false, proxy),
  };
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
    qb.where(x => x.a.eq("1").and(x => x.b.eq("2")).and(x => x.c.eq("3")));
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
});