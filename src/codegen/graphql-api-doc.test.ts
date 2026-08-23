// V1.0.6: graphql-api-doc 单元测试

import { describe, it, expect } from "vitest";
import { generateGraphQLApiDoc, DEFAULT_SCALAR_TS_MAP } from "./graphql-api-doc";
import type { ParsedSchema } from "./schema-parser";

// ── 帮助函数 ──

function makeSimpleSchema(ops?: ParsedSchema["operations"], types?: ParsedSchema["types"]): ParsedSchema {
  return {
    operations: ops ?? [
      { name: "hello", kind: "query", args: [], returnType: "String", returnIsList: false, returnIsNonNull: false },
    ],
    types: types ?? [],
    source: "",
  };
}

describe("generateGraphQLApiDoc", () => {
  // 1. 文档骨架
  it("输出包含五章节标题", () => {
    const doc = generateGraphQLApiDoc(makeSimpleSchema());
    expect(doc).toContain("## 一、操作概览");
    expect(doc).toContain("## 二、按域操作清单");
    expect(doc).toContain("## 三、DTO 字段速查");
    expect(doc).toContain("## 四、暴露状态与缺口");
    expect(doc).toContain("## 五、页面→操作映射");
  });

  // 2. 标量返回标注
  it("标量返回在操作清单中标注为类型名（非 DTO 名）", () => {
    const schema = makeSimpleSchema([
      { name: "deleteStore", kind: "mutation", args: [], returnType: "Boolean", returnIsList: false, returnIsNonNull: false },
    ]);
    const doc = generateGraphQLApiDoc(schema);
    // 返回列应显示 `Boolean`（非 Backtick 包裹的 DTO 名）
    expect(doc).toContain("Boolean");
  });

  // 3. DTO 速查仅含被引用的
  it("DTO 速查表仅包含操作引用的 DTO", () => {
    const schema = makeSimpleSchema(
      [
        { name: "getStore", kind: "query", args: [], returnType: "StoreDto", returnIsList: false, returnIsNonNull: false },
      ],
      [
        { name: "StoreDto", kind: "object", fields: [{ name: "id", gqlType: "ID", isNonNull: true, isList: false, isScalar: true }] },
        { name: "UnusedDto", kind: "object", fields: [{ name: "x", gqlType: "String", isNonNull: false, isList: false, isScalar: true }] },
      ],
    );
    const doc = generateGraphQLApiDoc(schema);
    expect(doc).toContain("StoreDto");
    expect(doc).not.toContain("UnusedDto");
  });

  // 4. ignoredFields
  it("ignoredFields 过滤 DTO 字段", () => {
    const schema = makeSimpleSchema(
      [
        { name: "getStore", kind: "query", args: [], returnType: "StoreDto", returnIsList: false, returnIsNonNull: false },
      ],
      [
        {
          name: "StoreDto", kind: "object",
          fields: [
            { name: "id", gqlType: "ID", isNonNull: true, isList: false, isScalar: true },
            { name: "toDto", gqlType: "String", isNonNull: false, isList: false, isScalar: true },
          ],
        },
      ],
    );
    const doc = generateGraphQLApiDoc(schema, { ignoredFields: new Set(["toDto"]) });
    expect(doc).toContain("id");
    expect(doc).not.toContain("toDto");
  });

  // 5. 暴露状态 ✅
  it("无 exposureStatus 配置时 schema 存在的操作标注 ✅", () => {
    const doc = generateGraphQLApiDoc(makeSimpleSchema());
    expect(doc).toContain("✅");
  });

  // 6. 暴露状态 🔴
  it("exposureStatus=unexposed 标注 🔴", () => {
    const schema = makeSimpleSchema([
      { name: "resetPassword", kind: "mutation", args: [], returnType: "Boolean", returnIsList: false, returnIsNonNull: false },
    ]);
    const doc = generateGraphQLApiDoc(schema, { exposureStatus: { resetPassword: "unexposed" } });
    expect(doc).toContain("🔴");
  });

  // 7. 暴露状态 🟡
  it("exposureStatus=partial 标注 🟡", () => {
    const schema = makeSimpleSchema([
      { name: "importBatch", kind: "query", args: [], returnType: "Boolean", returnIsList: false, returnIsNonNull: false },
    ]);
    const doc = generateGraphQLApiDoc(schema, { exposureStatus: { importBatch: "partial" } });
    expect(doc).toContain("🟡");
  });

  // 8. 分组 heuristic
  it("listStores / createStore 同属 store 域", () => {
    const schema = makeSimpleSchema([
      { name: "listStores", kind: "query", args: [], returnType: "String", returnIsList: false, returnIsNonNull: false },
      { name: "createStore", kind: "mutation", args: [], returnType: "String", returnIsList: false, returnIsNonNull: false },
    ]);
    const doc = generateGraphQLApiDoc(schema);
    // 两个操作应在同一行中显示 store 域
    const matches = doc.match(/store/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  // 9. groupOverrides
  it("groupOverrides 覆盖分组", () => {
    const schema = makeSimpleSchema([
      { name: "listStores", kind: "query", args: [], returnType: "String", returnIsList: false, returnIsNonNull: false },
    ]);
    const doc = generateGraphQLApiDoc(schema, { groupOverrides: { listStores: "shop" } });
    expect(doc).toContain("shop");
  });

  // 10. pageMapping 留空
  it("无 pageMapping 时输出'待补充'", () => {
    const doc = generateGraphQLApiDoc(makeSimpleSchema());
    expect(doc).toContain("待补充");
  });

  // 11. pageMapping 提供
  it("pageMapping 提供时输出映射表", () => {
    const schema = makeSimpleSchema([
      { name: "listStores", kind: "query", args: [], returnType: "String", returnIsList: false, returnIsNonNull: false },
    ]);
    const doc = generateGraphQLApiDoc(schema, { pageMapping: { "/stores": ["listStores"] } });
    expect(doc).toContain("/stores");
    expect(doc).toContain("listStores");
    expect(doc).not.toContain("待补充");
  });

  // 12. 描述覆盖
  it("descriptions 覆盖操作说明", () => {
    const schema = makeSimpleSchema([
      { name: "listStores", kind: "query", args: [], returnType: "String", returnIsList: false, returnIsNonNull: false, description: "旧说明" },
    ]);
    const doc = generateGraphQLApiDoc(schema, { descriptions: { listStores: "新说明" } });
    expect(doc).toContain("新说明");
    expect(doc).not.toContain("旧说明");
  });

  // 14. scalarMap 影响参数列渲染
  it("scalarMap 影响参数 TS 类型", () => {
    const schema = makeSimpleSchema([
      {
        name: "getStore", kind: "query",
        args: [{ name: "id", gqlType: "ID", isNonNull: true, isList: false }],
        returnType: "String", returnIsList: false, returnIsNonNull: false,
      },
    ]);
    const doc = generateGraphQLApiDoc(schema, { scalarMap: { ID: "number" } });
    expect(doc).toContain("id: number");
  });

  // 15. blockingPages 显示在缺口表
  it("blockingPages 显示在缺口表", () => {
    const schema = makeSimpleSchema([
      { name: "importBatch", kind: "query", args: [], returnType: "String", returnIsList: false, returnIsNonNull: false },
    ]);
    const doc = generateGraphQLApiDoc(schema, {
      exposureStatus: { importBatch: "missing" },
      blockingPages: { importBatch: "/import-batches" },
    });
    expect(doc).toContain("/import-batches");
  });
});