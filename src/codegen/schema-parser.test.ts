// V1.0.6: schema-parser 单元测试

import { describe, it, expect } from "vitest";
import { parseGraphQLSchema, buildVariableTypesMap, buildOperationKinds } from "./schema-parser";

describe("parseGraphQLSchema", () => {
  // 1. 基础解析
  it("解析基础 Query 操作", async () => {
    const schema = `
      type Query {
        hello: String
      }
    `;
    const result = await parseGraphQLSchema(schema);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].name).toBe("hello");
    expect(result.operations[0].kind).toBe("query");
    expect(result.operations[0].returnType).toBe("String");
    expect(result.operations[0].returnIsList).toBe(false);
    expect(result.operations[0].returnIsNonNull).toBe(false);
    expect(result.operations[0].args).toHaveLength(0);
  });

  // 2. Mutation 识别
  it("正确识别 Mutation 操作", async () => {
    const schema = `
      type Mutation {
        createStore(name: String!): StoreDto
      }
      type StoreDto { id: ID! }
    `;
    const result = await parseGraphQLSchema(schema);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].name).toBe("createStore");
    expect(result.operations[0].kind).toBe("mutation");
    expect(result.operations[0].args).toHaveLength(1);
    expect(result.operations[0].args[0].name).toBe("name");
    expect(result.operations[0].args[0].gqlType).toBe("String");
    expect(result.operations[0].args[0].isNonNull).toBe(true);
  });

  // 3. 非空/列表
  it("正确处理非空和列表类型", async () => {
    const schema = `
      type Query {
        listStores(filter: StoreFilter!): [StoreDto!]!
      }
      type StoreDto { id: ID! }
      input StoreFilter { name: String }
    `;
    const result = await parseGraphQLSchema(schema);
    expect(result.operations).toHaveLength(1);
    const op = result.operations[0];
    expect(op.returnIsList).toBe(true);
    expect(op.returnIsNonNull).toBe(true);
    expect(op.args[0].isNonNull).toBe(true);
    expect(op.args[0].gqlType).toBe("StoreFilter");
  });

  // 4. DTO 提取
  it("提取 DTO 字段并区分标量/关联类型", async () => {
    const schema = `
      type Query {
        store(id: ID!): StoreDto
      }
      type StoreDto {
        id: ID!
        name: String!
        address: AddressDto
      }
      type AddressDto {
        city: String!
      }
    `;
    const result = await parseGraphQLSchema(schema);
    const storeDto = result.types.find((t) => t.name === "StoreDto");
    expect(storeDto).toBeDefined();
    expect(storeDto!.fields).toHaveLength(3);
    // id: 标量
    expect(storeDto!.fields[0].name).toBe("id");
    expect(storeDto!.fields[0].isScalar).toBe(true);
    // name: 标量
    expect(storeDto!.fields[1].name).toBe("name");
    expect(storeDto!.fields[1].isScalar).toBe(true);
    // address: 关联类型
    expect(storeDto!.fields[2].name).toBe("address");
    expect(storeDto!.fields[2].isScalar).toBe(false);
    expect(storeDto!.fields[2].gqlType).toBe("AddressDto");
  });

  // 5. Enum 提取
  it("提取 Enum 类型和枚举值", async () => {
    const schema = `
      type Query { status: Status }
      enum Status { ACTIVE INACTIVE PENDING }
    `;
    const result = await parseGraphQLSchema(schema);
    const statusEnum = result.types.find((t) => t.name === "Status");
    expect(statusEnum).toBeDefined();
    expect(statusEnum!.kind).toBe("enum");
    expect(statusEnum!.enumValues).toEqual(["ACTIVE", "INACTIVE", "PENDING"]);
  });

  // 6. 描述提取
  it("提取描述（块注释）", async () => {
    const schema = [
      "type Query {",
      '  """查询门店详情"""',
      "  store(id: ID!): StoreDto",
      "}",
      "type StoreDto { id: ID! }",
    ].join("\n");
    const result = await parseGraphQLSchema(schema);
    expect(result.operations[0].description).toBe("查询门店详情");
  });

  // 7. 默认值
  it("提取参数默认值", async () => {
    const schema = `
      type Query {
        listStores(page: Int = 1, pageSize: Int = 20): [StoreDto]
      }
      type StoreDto { id: ID! }
    `;
    const result = await parseGraphQLSchema(schema);
    expect(result.operations[0].args).toHaveLength(2);
    expect(result.operations[0].args[0].defaultValue).toBe("1");
    expect(result.operations[0].args[1].defaultValue).toBe("20");
  });

  // 8. 非法输入
  it("非法 schema 文本抛出错误", async () => {
    await expect(parseGraphQLSchema("not valid graphql schema !!")).rejects.toThrow();
  });

  // 8b. 空 schema
  it("空 schema（无 Query/Mutation）返回空 operations", async () => {
    const schema = `
      scalar JSON
      directive @cost(weight: String) on FIELD_DEFINITION
    `;
    const result = await parseGraphQLSchema(schema);
    expect(result.operations).toHaveLength(0);
    expect(result.types).toHaveLength(0);
  });

  // 8c. Input 类型
  it("提取 Input 类型", async () => {
    const schema = `
      type Query { createStore(input: CreateStoreInput!): StoreDto }
      input CreateStoreInput {
        name: String!
        address: String
      }
      type StoreDto { id: ID! }
    `;
    const result = await parseGraphQLSchema(schema);
    const inputType = result.types.find((t) => t.name === "CreateStoreInput");
    expect(inputType).toBeDefined();
    expect(inputType!.kind).toBe("input");
    expect(inputType!.fields).toHaveLength(2);
  });
});

describe("buildVariableTypesMap", () => {
  // 1. 完整 schema：非空 input 对象 + 4 种列表可空性组合（M6 全覆盖）
  it("构建操作→变量→GraphQL 类型映射（含 4 种列表组合）", async () => {
    const schema = `
      type Query {
        rankings_Execute(request: GetRankingsReqDtoInput!): RankingsResult!
      }
      type Mutation {
        batch(ids: [Int!]!, codes: [String], flags: [Boolean!], names: [String]!): Boolean
      }
      input GetRankingsReqDtoInput {
        id: ID!
      }
      type RankingsResult { id: ID! }
    `;
    const parsed = await parseGraphQLSchema(schema);
    const map = buildVariableTypesMap(parsed);
    expect(map).toEqual({
      rankings_Execute: { request: "GetRankingsReqDtoInput!" },
      batch: {
        ids: "[Int!]!",
        codes: "[String]",
        flags: "[Boolean!]",
        names: "[String]!",
      },
    });
  });

  // 2. 无参数操作跳过
  it("无参数操作不出现在返回对象中", async () => {
    const schema = `
      type Query {
        ping: Boolean!
      }
    `;
    const parsed = await parseGraphQLSchema(schema);
    expect(buildVariableTypesMap(parsed)).toEqual({});
  });

  // 3. 可空标量参数
  it("可空标量参数不加感叹号", async () => {
    const schema = `
      type Query {
        list(page: Int): [String]
      }
    `;
    const parsed = await parseGraphQLSchema(schema);
    const map = buildVariableTypesMap(parsed);
    expect(map.list).toEqual({ page: "Int" });
  });

  // 4. listElemNonNull 解析（M7）
  it("解析列表元素非空标志 listElemNonNull", async () => {
    const schema = `
      type Query {
        a(ids: [Int!]): Boolean
        b(codes: [Int]): Boolean
      }
    `;
    const parsed = await parseGraphQLSchema(schema);
    const [a, b] = parsed.operations;
    expect(a.args[0].listElemNonNull).toBe(true);
    expect(b.args[0].listElemNonNull).toBe(false);
  });
});

describe("buildOperationKinds", () => {
  // V1.0.11（G16 根治）：操作→类型单映射（M9）
  it("构建操作→类型单映射（query/mutation 全字段，含 *_Execute query 字段）", async () => {
    const schema = `
      type Query {
        removeBuddy_Execute(input: RemoveBuddyInput!): Boolean!
        createTask_Execute(input: CreateTaskInput!): Boolean!
        getUser(id: ID!): UserDto
      }
      type Mutation {
        loginByPassword(userName: String!, password: String!): LoginPayload!
        logout(broadcast: Boolean): Boolean!
      }
      type UserDto { id: ID! }
      type LoginPayload { success: Boolean! }
      input RemoveBuddyInput { buddyId: ID! }
      input CreateTaskInput { name: String! }
    `;
    const parsed = await parseGraphQLSchema(schema);
    const kinds = buildOperationKinds(parsed);
    // 服务端 SG 把 *_Execute 判为 Query 根（非 mutation）——映射忠实反映 schema 权威判定
    expect(kinds).toEqual({
      removeBuddy_Execute: "query",
      createTask_Execute: "query",
      getUser: "query",
      loginByPassword: "mutation",
      logout: "mutation",
    });
  });

  it("无 Query/Mutation 操作时返回空对象", async () => {
    const schema = `
      scalar JSON
      directive @cost(weight: String) on FIELD_DEFINITION
    `;
    const parsed = await parseGraphQLSchema(schema);
    expect(buildOperationKinds(parsed)).toEqual({});
  });

  it("query 与 mutation 同名不冲突（各自根类型归属）", async () => {
    const schema = `
      type Query {
        status: String!
      }
      type Mutation {
        createOrder(input: CreateOrderInput!): Boolean!
      }
      input CreateOrderInput { id: ID! }
    `;
    const parsed = await parseGraphQLSchema(schema);
    expect(buildOperationKinds(parsed)).toEqual({
      status: "query",
      createOrder: "mutation",
    });
  });
});
