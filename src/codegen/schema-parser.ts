// V1.0.6: GraphQL schema 解析器。
// 将 schema.graphql SDL 文本解析为结构化中间模型 ParsedSchema，
// 供消费端同时驱动 ts-client.g.ts 和 GraphQL_Api.md 生成。
//
// 依赖：graphql 包（optional peerDependency），运行时动态 import。

import type {
  DocumentNode,
  ObjectTypeDefinitionNode, InputObjectTypeDefinitionNode,
  InterfaceTypeDefinitionNode, EnumTypeDefinitionNode,
  FieldDefinitionNode, InputValueDefinitionNode,
  TypeNode, NamedTypeNode, ListTypeNode, NonNullTypeNode,
  StringValueNode,
} from "graphql";

// ── 导出类型 ──

export type GraphQLScalar =
  | "String" | "Int" | "Float" | "Boolean" | "ID" | "Long"
  | "DateTime" | "LocalDate" | "Decimal" | "UUID" | "URL" | "Byte" | "JSON" | "Short";

export interface ParsedArg {
  name: string;
  gqlType: string;
  isNonNull: boolean;
  isList: boolean;
  /** 列表元素是否非空（`[Int!]` 的 `!`），仅 isList=true 时有效 */
  listElemNonNull?: boolean;
  defaultValue?: string;
}

export interface ParsedOperation {
  name: string;
  kind: "query" | "mutation";
  args: ParsedArg[];
  returnType: string;
  returnIsList: boolean;
  returnIsNonNull: boolean;
  description?: string;
}

export interface ParsedField {
  name: string;
  gqlType: string;
  isNonNull: boolean;
  isList: boolean;
  description?: string;
  isScalar: boolean;
}

export interface ParsedType {
  name: string;
  kind: "object" | "interface" | "input" | "enum";
  fields: ParsedField[];
  enumValues?: string[];
  description?: string;
}

export interface ParsedSchema {
  operations: ParsedOperation[];
  types: ParsedType[];
  source: string;
}

// ── 内部常量 ──

const SCALAR_SET = new Set<string>([
  "String", "Int", "Float", "Boolean", "ID",
  "Long", "DateTime", "LocalDate", "Decimal", "UUID", "URL", "Byte", "JSON", "Short",
]);

// ── 类型解包辅助 ──

function stripWrapper(t: TypeNode): { namedType: string; isNonNull: boolean; isList: boolean; listElemNonNull: boolean } {
  let isOuterNonNull = false;
  let isOuterList = false;
  let listElemNonNull = false;
  let current: TypeNode = t;

  // 剥外层非空
  if (current.kind === "NonNullType") {
    isOuterNonNull = true;
    current = (current as NonNullTypeNode).type;
  }

  // 剥外层列表
  if (current.kind === "ListType") {
    isOuterList = true;
    current = (current as ListTypeNode).type;

    // 列表元素非空：[Type!]
    if (current.kind === "NonNullType") {
      listElemNonNull = true;
      current = (current as NonNullTypeNode).type;
    }
  }

  const namedType = current.kind === "NamedType"
    ? (current as NamedTypeNode).name.value
    : extractNamedType(current);

  return { namedType, isNonNull: isOuterNonNull, isList: isOuterList, listElemNonNull };
}

function extractNamedType(t: TypeNode): string {
  if (t.kind === "NamedType") return (t as NamedTypeNode).name.value;
  if (t.kind === "NonNullType") return extractNamedType((t as NonNullTypeNode).type);
  if (t.kind === "ListType") return extractNamedType((t as ListTypeNode).type);
  return "Unknown";
}

function getDescription(node: { description?: StringValueNode | null; leadingComments?: string }): string | undefined {
  return node.description?.value ?? undefined;
}

// ── 字段解析 ──

interface FieldParseResult { name: string; gqlType: string; isNonNull: boolean; isList: boolean; description?: string }

function parseField(field: FieldDefinitionNode): FieldParseResult {
  const { namedType, isNonNull, isList } = stripWrapper(field.type);
  return {
    name: field.name.value,
    gqlType: namedType,
    isNonNull,
    isList,
    description: getDescription(field),
  };
}

function parseFieldFromInputValue(field: InputValueDefinitionNode): FieldParseResult {
  const { namedType, isNonNull, isList } = stripWrapper(field.type);
  return {
    name: field.name.value,
    gqlType: namedType,
    isNonNull,
    isList,
    description: getDescription(field),
  };
}

function parseArg(arg: InputValueDefinitionNode): ParsedArg {
  const { namedType, isNonNull, isList, listElemNonNull } = stripWrapper(arg.type);
  let defaultValue: string | undefined;
  if (arg.defaultValue) {
    switch (arg.defaultValue.kind) {
      case "IntValue": case "FloatValue": case "StringValue":
      case "BooleanValue": case "EnumValue":
        defaultValue = (arg.defaultValue as any).value;
        break;
      case "NullValue":
        defaultValue = "null";
        break;
      case "ListValue":
        defaultValue = "[]";
        break;
      case "ObjectValue":
        defaultValue = "{}";
        break;
    }
  }
  return {
    name: arg.name.value,
    gqlType: namedType,
    isNonNull,
    isList,
    listElemNonNull,
    defaultValue,
  };
}

function toGraphQLTypeString(arg: ParsedArg): string {
  if (!arg.isList) return `${arg.gqlType}${arg.isNonNull ? "!" : ""}`;
  return `[${arg.gqlType}${arg.listElemNonNull ? "!" : ""}]${arg.isNonNull ? "!" : ""}`;
}

/** 由 ParsedSchema 构建操作→变量→GraphQL 类型映射（供消费端 g.ts 生成器输出 variableTypesMap）。
 * 精确重建 schema 声明类型（含列表 4 种可空性组合），非空 input 对象如 GetRankingsReqDtoInput!。
 * Oracle M1 落地：覆盖全部 4 种列表组合（[T!]! / [T]! / [T!] / [T]）。 */
export function buildVariableTypesMap(
  parsed: ParsedSchema,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const op of parsed.operations) {
    if (op.args.length === 0) continue;
    const vars: Record<string, string> = {};
    for (const arg of op.args) {
      vars[arg.name] = toGraphQLTypeString(arg);
    }
    out[op.name] = vars;
  }
  return out;
}

/** 由 ParsedSchema 构建操作→类型单映射（供消费端生成器输出 operationKinds）。
 *  数据源为 schema 根类型权威判定（ParsedOperation.kind，Query/Mutation 根类型提取）。
 *  V1.0.11（G16 根治）：SDK 运行时纯读取该映射判定操作类型，不再走前缀启发式。
 *  对称于 buildVariableTypesMap（v1.0.10）。 */
export function buildOperationKinds(
  parsed: ParsedSchema,
): Record<string, "query" | "mutation"> {
  const out: Record<string, "query" | "mutation"> = {};
  for (const op of parsed.operations) out[op.name] = op.kind;
  return out;
}

// ── 类型定义解析 ──

function parseObjectType(def: ObjectTypeDefinitionNode): ParsedType {
  return {
    name: def.name.value,
    kind: "object",
    fields: (def.fields ?? []).map((f) => {
      const { name, gqlType, isNonNull, isList, description } = parseField(f);
      return {
        name,
        gqlType,
        isNonNull,
        isList,
        description,
        isScalar: SCALAR_SET.has(gqlType),
      };
    }),
    description: getDescription(def),
  };
}

function parseInputType(def: InputObjectTypeDefinitionNode): ParsedType {
  return {
    name: def.name.value,
    kind: "input",
    fields: (def.fields ?? []).map((f) => {
      const { name, gqlType, isNonNull, isList, description } = parseFieldFromInputValue(f);
      return {
        name,
        gqlType,
        isNonNull,
        isList,
        description,
        isScalar: SCALAR_SET.has(gqlType),
      };
    }),
    description: getDescription(def),
  };
}

function parseInterfaceType(def: InterfaceTypeDefinitionNode): ParsedType {
  return {
    name: def.name.value,
    kind: "interface",
    fields: (def.fields ?? []).map((f) => {
      const { name, gqlType, isNonNull, isList, description } = parseField(f);
      return {
        name,
        gqlType,
        isNonNull,
        isList,
        description,
        isScalar: SCALAR_SET.has(gqlType),
      };
    }),
    description: getDescription(def),
  };
}

function parseEnumType(def: EnumTypeDefinitionNode): ParsedType {
  return {
    name: def.name.value,
    kind: "enum",
    fields: [],
    enumValues: (def.values ?? []).map((v) => v.name.value),
    description: getDescription(def),
  };
}

// ── 主解析函数 ──

/**
 * 解析 GraphQL schema 文本为结构化中间模型。
 * 内部使用 `graphql` 包的 `parse()` + 自定义 AST 遍历。
 * @param schemaText GraphQL schema 文本（SDL）
 * @throws Error 若 graphql 包未安装或 schemaText 不合法
 */
export async function parseGraphQLSchema(schemaText: string): Promise<ParsedSchema> {
  let graphql: typeof import("graphql");
  try {
    graphql = await import("graphql");
  } catch {
    throw new Error(
      'The "graphql" package is required for parseGraphQLSchema(). Install it: npm install graphql',
    );
  }

  const doc: DocumentNode = graphql.parse(schemaText);

  const operations: ParsedOperation[] = [];
  const types: ParsedType[] = [];
  const ROOT_TYPES = new Set(["Query", "Mutation", "Subscription"]);

  for (const def of doc.definitions) {
    switch (def.kind) {
      case "ObjectTypeDefinition": {
        const objDef = def as ObjectTypeDefinitionNode;
        const name = objDef.name.value;

        if (ROOT_TYPES.has(name)) {
          // Query / Mutation → 提取为操作
          const kind = name === "Mutation" ? "mutation" : "query";
          for (const field of objDef.fields ?? []) {
            const { namedType, isNonNull, isList } = stripWrapper(field.type);
            operations.push({
              name: field.name.value,
              kind,
              args: (field.arguments ?? []).map(parseArg),
              returnType: namedType,
              returnIsList: isList,
              returnIsNonNull: isNonNull,
              description: getDescription(field),
            });
          }
        } else {
          types.push(parseObjectType(objDef));
        }
        break;
      }
      case "InputObjectTypeDefinition": {
        types.push(parseInputType(def as InputObjectTypeDefinitionNode));
        break;
      }
      case "InterfaceTypeDefinition": {
        types.push(parseInterfaceType(def as InterfaceTypeDefinitionNode));
        break;
      }
      case "EnumTypeDefinition": {
        types.push(parseEnumType(def as EnumTypeDefinitionNode));
        break;
      }
      // ScalarTypeDefinition / UnionTypeDefinition / DirectiveDefinition 等暂不处理
    }
  }

  return { operations, types, source: schemaText };
}