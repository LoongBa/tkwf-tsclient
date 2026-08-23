# GraphQL_Api.md 生成方案 — tkwf-tsclient 设计方案

> **承接方**：tkwf-tsclient 项目组（github.com/LoongBa/tkwf-tsclient）
> **提出方**：DMP-Lite.Merchant.AdminWeb（前端消费端）
> **版本**：v1.0.6 · 2026-08-14
> **性质**：tkwf-tsclient 对 RFC 的评审意见 + 设计方案（自查修订版）
> **关联**：`docs/codegen/GraphQL_Api.md-生成方案-转ts-client项目组.md`（RFC 原文）、`Agents_TKWF.md`（开发规则）

---

## 一、评估结论

**总体评价**：RFC 质量高，问题定义清晰、方案选型合理。tkwf-tsclient 项目组**同意方案方向和格式规范**，以下为逐项评审意见和细化设计。

### 1.1 问题认可

四个痛点（schema.graphql 3700 行噪音、Domain_Api.md C# 残留、ts-client.g.ts 字段树 token 轰炸、R00 过期）均为真实问题。Agentic Coding 场景下"契约存在 ≠ 前端可用"的可靠性风险（`ResetMerchantUserPassword` 未暴露、`ImportBatchDataController` 无分页列表）有实际复现路径，属**严重缺陷**，应优先解决。

### 1.2 方案定位认可

"同源、同步、同脚本生成"原则正确。`GraphQL_Api.md` 作为活态文档（禁止手改）符合 TKWF 哲学。

### 1.3 归属方案选择

**同意"先 A 后 B"策略**，但 tkwf-tsclient 的参与节奏如下：

| 阶段 | 内容 | 责任方 | tkwf-tsclient 角色 |
|------|------|--------|-------------------|
| **Phase 1**（当前） | 格式规范冻结 + 本设计方案 | ts-client 项目组 | 评审格式、输出本设计文档 |
| **Phase 2**（近期） | DMP-Lite `gen-ts-client.ts` 实现生成器 | DMP-Lite 消费端 | 不介入实现，仅消费端自完成 |
| **Phase 3**（远期） | 生成器下沉 tkwf-tsclient SDK | ts-client 项目组 | 提供 `parseGraphQLSchema()` + `generateGraphQLApiDoc()` 通用导出 |

### 1.4 消费端现状勘误（自查新增）

自查发现 RFC 中引用的若干路径与实际不符，以下为实测结果：

| RFC 描述 | 实际情况 |
|---------|---------|
| `scripts/gen-ts-client.ts` 在 AdminWeb 下 | 实际在 `DMP-Lite/scripts/gen-ts-client.ts`（解决方案根目录），AdminWeb `scripts/` 仅有 `mock-server.ts` |
| 脚本使用 schema 解析库 | 实际为**纯 regex + 花括号计数**解析，零 `graphql` npm 依赖 |
| `codegen-config.json` 存在 | **不存在**，为本方案 Phase 2 新增产物 |

消费端 `gen-ts-client.ts`（1111 行）当前的内部数据结构：

```typescript
// 消费端已有的解析模型（gen-ts-client.ts L111-131）
interface FieldArg { name: string; gqlType: string; optional: boolean; isList: boolean; }
interface FieldInfo { name: string; returnType: string; returnOptional: boolean; args: FieldArg[]; }
interface TypeFieldDef { name: string; gqlType: string; optional: boolean; }
```

**关键约束**：Phase 3 的 SDK 设计必须兼容该模型形态，使消费端能用 SDK 的 `parseGraphQLSchema()` 替换自有 regex 解析器，同时驱动 `ts-client.g.ts` 和 `GraphQL_Api.md` 双产物输出，**避免二次解析**。

---

## 二、RFC 逐项评审意见

### 2.1 内容格式规范（§4）— 批准 + 修订

**总体批准**：文档骨架（§4.1）、操作清单表（§4.2）、DTO 字段速查（§4.3）、暴露状态（§4.4）、页面映射（§4.5）结构合理。

**以下为需要修订的细节**：

| 位置 | 原文 | 修订意见 | 理由 |
|------|------|---------|------|
| §4.1 标题 | `GraphQL API 契约（GraphQL_Api）— 前端/Agent 消费版` | `GraphQL API 契约 — 前端/Agent 消费版` | 括号内 `GraphQL_Api` 与文件名冗余，文件名即命名空间 |
| §4.2 参数列 | TS 签名含 `!` 表必选 | **去掉 `!`，统一用 `?` 表可选，无 `?` 即必选** | TS 类型签名中 `!` 不是合法语法，易混淆；无 `?` = 必选是 TS 开发者直觉 |
| §4.2 返回列 | 只列 DTO 名 | **增加 scalar 返回标注**（如 `Boolean`、`Int`、`String`），DTO 名保持原样 | 非 DTO 返回（如 `deleteStore` 返回 `Boolean`）在列中不可区分，Agent 无法判断是否需要查 DTO 表 |
| §4.3 字段速查 | 剔除 `isFromPersistentSource`、`toDto` | **增加过滤器配置化**：由生成器维护一个 `ignoredFields: Set<string>` 配置 | 不同项目噪音字段可能不同，硬编码在 SDK 不可取 |
| §4.4 状态判定 | 规则表体（二值：✅/🔴） | 增加一条状态：**🟡 部分暴露**（Query 已暴露但 Mutation 缺失，或反之） | 单个域内部分操作暴露的情况常见，二值状态不足以表达 |
| §4.5 页面映射 | 从 R03/R00 提取 | **首版留空 + 标注"待补充"**，由消费端手动维护 | 页面→操作映射依赖前端路由表，SDK 无此信息，不应由生成器自动推断 |

### 2.2 生成器实现要求（§5）— 评审

| 要求 | 评审意见 |
|------|---------|
| §5.1 输入/输出 | 同意。补充：**SDK 分两层**——先 `parseGraphQLSchema(schemaText): ParsedSchema`，再 `generateGraphQLApiDoc(parsed, options): string`。消费端可复用 `ParsedSchema` 驱动双产物（ts-client.g.ts + GraphQL_Api.md），避免二次解析 |
| §5.2.1 枚举根类型 | 同意。GraphQL introspection 或 schema AST 均可 |
| §5.2.2 DTO 字段提取 | 同意。补充：需区分**标量字段**与**关联类型字段**，关联类型字段应在 DTO 速查表中注明 `→ 见 XxxDto` |
| §5.2.3 说明提取 | 同意。**注意**：消费端当前 regex 解析器**完全丢弃**描述/注释（`if (line.trim().startsWith('"')) continue;`），Phase 3 的 `parseGraphQLSchema()` 需补齐此能力。建议优先级：`"""` 描述块 > `#` 行注释 > `@cost` 指令参数 > 空字符串 |
| §5.2.4 状态判定 | 同意首版用配置清单。**重要**：配置清单应放在消费端 `codegen-config.json`，不侵入 tkwf-tsclient SDK |

### 2.3 验收标准（§6）— 批准

五项验收标准合理。补充第 6 项：

| # | 验收项 | 判定 |
|---|--------|------|
| 6 | SDK 导出函数签名稳定 | `parseGraphQLSchema()` / `generateGraphQLApiDoc()` 接口设计经 Momus 评审，格式冻结后不改 |

### 2.4 工作量估算（§7）— 评审

| 阶段 | 估算 | 评审 |
|------|:----:|------|
| ① 生成器实现（并入 gen-ts-client.ts） | 0.5~1 人日 | 合理，但需加 0.5 人日用于格式渲染调优（markdown 表格对齐、长字段截断） |
| ② 缺口状态判定 | 0.5 人日 | 合理（首版配置清单） |
| ③ 页面→操作映射 | 0.5 人日 | 首版建议留空，此 0.5 人日可延后 |
| ④ 评审 + 文档冻结 | 0.5 人日 | 本文件即完成此阶段 |
| ⑤ 方案 B：tkwf-tsclient 导出 | 2~3 人日 | 见 §四 细化（含 `parseGraphQLSchema` + `generateGraphQLApiDoc` + 测试） |

---

## 三、Q1-Q5 决策意见

| # | 问题 | tkwf-tsclient 意见 | 决策 |
|---|------|-------------------|------|
| **Q1** | 生成器先放消费端（方案 A）还是直接下沉 SDK（方案 B）？ | **先 A 后 B**。Phase 2 由 DMP-Lite 在 `gen-ts-client.ts` 实现，Phase 3 由 tkwf-tsclient 提供 `parseGraphQLSchema()` + `generateGraphQLApiDoc()` 通用导出 | ✅ 与 RFC 一致 |
| **Q2** | `GraphQL_Api.md` 命名是否 OK？ | **同意**。与 `Domain_Api.md`、`DataService_API.md` 命名家族一致 | ✅ `GraphQL_Api.md` |
| **Q3** | 缺口状态数据源：读 Domain_Api.md 自动 vs 维护配置清单？ | **首版用配置清单**。耦合低、可快速落地。二期可考虑自动对照 | ✅ 首版配置清单 |
| **Q4** | 输出路径：`AdminWeb/docs/codegen/` vs `.TKWF/merchant/`？ | **`AdminWeb/docs/codegen/`**。SDK 函数返回 markdown 字符串，由消费端决定写入路径 | ✅ AdminWeb/docs/codegen/ |
| **Q5** | 是否支持多项目复用？ | **是**。`generateGraphQLApiDoc(parsed, options)` 的 `options` 包含 `domainName`、`ignoredFields`、`groupOverrides` 等参数 | ✅ 参数化设计 |

---

## 四、Phase 3 设计：tkwf-tsclient SDK 导出方案

### 4.1 架构：两层分离

```
消费端 gen-ts-client.ts
  │
  ├─ const parsed = parseGraphQLSchema(schemaText)   ← SDK 导出，一次解析
  │
  ├─ generateTsClient(parsed)                        ← 消费端自有，输出 ts-client.g.ts
  │
  └─ generateGraphQLApiDoc(parsed, options)           ← SDK 导出，输出 markdown 字符串
```

**核心改进**（相比 v1.0 初稿）：将"解析"与"渲染"分离。消费端调用 `parseGraphQLSchema()` 一次，得到 `ParsedSchema` 中间模型，然后分别喂给 ts-client.g.ts 生成器（消费端自有逻辑）和 `generateGraphQLApiDoc()`（SDK 提供）。避免二次解析，且消费端可逐步迁移 regex 解析器到 SDK 的 AST 解析器。

### 4.2 中间模型：`ParsedSchema`

```typescript
// src/codegen/schema-parser.ts

/** GraphQL 标量类型枚举 */
export type GraphQLScalar = "String" | "Int" | "Float" | "Boolean" | "ID" | "Long" | "DateTime" | "LocalDate" | "Decimal" | "UUID" | "URL" | "Byte" | "JSON";

/** 字段参数 */
export interface ParsedArg {
  name: string;
  /** GraphQL 类型名（已去 `!`/`[]`，用 isList/isNonNull 表达） */
  gqlType: string;
  isNonNull: boolean;
  isList: boolean;
  /** 默认值（字面量字符串），无则为 undefined */
  defaultValue?: string;
}

/** 根类型字段（Query/Mutation 操作） */
export interface ParsedOperation {
  name: string;
  kind: "query" | "mutation";
  args: ParsedArg[];
  /** 返回类型名（已去 `!`/`[]`） */
  returnType: string;
  returnIsList: boolean;
  returnIsNonNull: boolean;
  /** 描述（`"""` 块 > `#` 注释），无则为 undefined */
  description?: string;
}

/** DTO 字段定义 */
export interface ParsedField {
  name: string;
  gqlType: string;
  isNonNull: boolean;
  isList: boolean;
  description?: string;
  /** 是否标量字段（用于 DTO 速查表区分标量/关联类型） */
  isScalar: boolean;
}

/** DTO 类型定义 */
export interface ParsedType {
  name: string;
  kind: "object" | "interface" | "input" | "enum";
  fields: ParsedField[];
  /** enum 类型的可选值（kind === "enum" 时有效） */
  enumValues?: string[];
  description?: string;
}

/** 解析后的完整 schema 模型 */
export interface ParsedSchema {
  operations: ParsedOperation[];
  types: ParsedType[];
  /** 原始 schema 文本（调试用） */
  source: string;
}
```

> **设计依据**：字段集与消费端 `gen-ts-client.ts` 的 `FieldArg` / `FieldInfo` / `TypeFieldDef` 对齐，消费端迁移时字段名一一对应。新增 `description`（消费端当前丢弃，Phase 3 补齐）和 `isScalar`（用于 DTO 速查表区分标量/关联类型）。

### 4.3 解析函数：`parseGraphQLSchema()`

```typescript
/**
 * 解析 GraphQL schema 文本为结构化中间模型。
 * 内部使用 `graphql` 包的 `parse()` + 自定义 AST 遍历。
 * @param schemaText GraphQL schema 文本（SDL）
 * @throws Error 若 schemaText 不是合法 SDL
 */
export function parseGraphQLSchema(schemaText: string): ParsedSchema;
```

**实现要点**：

1. 调用 `graphql.parse(schemaText)` 得到 `DocumentNode`
2. 遍历 `definitions`：
   - `ObjectTypeDefinition`（`type Query` / `type Mutation` / `type XxxDto`）→ 提取字段
   - `InputObjectTypeDefinition`（`input XxxInput`）→ 提取字段
   - `InterfaceTypeDefinition` → 提取字段
   - `EnumTypeDefinition` → 提取 enumValues
3. 标量判定：维护 `SCALAR_SET`（String/Int/Float/Boolean/ID/Long/DateTime/LocalDate/Decimal/UUID/URL/Byte/JSON），`gqlType` 在集合内则 `isScalar = true`
4. Query/Mutation 识别：`ObjectTypeDefinition` 名称为 `Query` 或 `Mutation` 时，其字段提取为 `ParsedOperation`

### 4.4 渲染函数：`generateGraphQLApiDoc()`

```typescript
// src/codegen/graphql-api-doc.ts

/** 暴露状态（与 §2.1 修订后的四值状态对齐） */
export type ExposureStatus = "exposed" | "unexposed" | "missing" | "partial";

export interface GenerateGraphQLApiDocOptions {
  /** 业务域名称，用于文档标题。默认 'GraphQL' */
  domainName?: string;
  /** 忽略的 DTO 字段名（生成器噪音）。默认：new Set(['isFromPersistentSource', 'toDto']) */
  ignoredFields?: Set<string>;
  /** 暴露状态配置清单：{ 操作名: ExposureStatus }。未列出的操作默认 'exposed'（schema 中存在即暴露） */
  exposureStatus?: Record<string, ExposureStatus>;
  /** 页面→操作映射：{ 路由: 操作名[] }。提供时生成 §五章节，否则留空标注"待补充" */
  pageMapping?: Record<string, string[]>;
  /** 缺口表阻塞页面映射：{ 操作名: 阻塞页面路由 } */
  blockingPages?: Record<string, string>;
  /** 操作说明覆盖：{ 操作名: 说明文字 }。未覆盖的从 ParsedOperation.description 提取 */
  descriptions?: Record<string, string>;
  /** 业务域分组覆盖：{ 操作名: 域名 }。未覆盖的走 heuristic 分组 */
  groupOverrides?: Record<string, string>;
  /** 标量→TS 类型映射覆盖（默认见 SCALAR_TS_MAP）。消费端可追加自定义标量 */
  scalarMap?: Record<string, string>;
}

/**
 * 从已解析的 schema 模型生成前端/Agent 可读的 API 契约文档（markdown）。
 * @param parsed 由 parseGraphQLSchema() 返回的中间模型
 * @param options 渲染选项
 * @returns markdown 文本字符串（消费端自行写入文件）
 */
export function generateGraphQLApiDoc(
  parsed: ParsedSchema,
  options?: GenerateGraphQLApiDocOptions,
): string;
```

> **v1.0 → v1.1 变更**：
> - 移除 `outputPath`（函数返回 string，消费端自行写文件，避免路径职责混乱）
> - 移除 `includePageMapping`（由 `pageMapping` 是否提供隐式决定）
> - `exposureStatus` 增加 `'partial'` 状态（与 §2.1 新增的 🟡 对齐）
> - 新增 `groupOverrides`（§4.5 引用但在 v1.0 options 中遗漏）
> - 新增 `scalarMap`（消费端 `SCALAR_MAP` 配置旋钮映射）

### 4.5 标量→TS 类型映射

```typescript
// src/codegen/graphql-api-doc.ts

/** 默认标量→TS 类型映射（消费端 SCALAR_MAP 的通用子集） */
export const DEFAULT_SCALAR_TS_MAP: Record<string, string> = {
  String: "string", ID: "string", URL: "string", UUID: "string",
  Int: "number", Float: "number", Long: "number", Decimal: "number", Byte: "number", Short: "number",
  Boolean: "boolean",
  DateTime: "string", LocalDate: "string",
  JSON: "unknown",
};
```

消费端可通过 `options.scalarMap` 追加项目特定标量（如 `Decimal: "string"` 若项目选择字符串表示）。

### 4.6 业务域分组 heuristic

复用 SDK 已有的 `MUTATION_PREFIXES`（`src/service-proxy.ts` L5-8）作为操作类型判断基础，分组规则如下：

| 操作名模式 | 分组名 | 示例 |
|-----------|--------|------|
| `list*` / `get*` / `*ById` / `query*` + 业务词 | 提取业务词（复数→单数） | `listStores` → `store` |
| `create*` / `update*` / `delete*` / `remove*` / `add*` + 业务词 | 提取业务词 | `createStore` → `store` |
| `lock*` / `unlock*` / `reset*` + 业务词 | 提取业务词 | `resetPassword` → `password` |
| `login*` / `logout` / `ping` | `auth` | `loginByPassword` → `auth` |
| 无前缀匹配 | `other` | `dashboard` → `other` |
| `options.groupOverrides` 覆盖 | 自定义 | `{ listPaymentLogs: "payment-log" }` |

> **v1.0 → v1.1 变更**：v1.0 的 heuristic 表未涵盖 `auth` 特殊分组，实际消费端有 `SPECIAL_SERVICES` 映射（login/logout/ping → Auth）。v1.1 内置此规则。

### 4.7 `generateGraphQLApiDoc` 内部处理流程

```
输入：ParsedSchema + Options
  │
  ├─ 1. 过滤类型：排除 Query/Mutation/Subscription 根类型
  │     → 排除 ignoredFields 中的字段
  │     → 标注 isScalar
  │
  ├─ 2. 操作→DTO 关联：对每个 ParsedOperation，追溯 returnType
  │     → 标量返回（isScalar）直接标注，不建 DTO 表
  │     → DTO 返回在 §4.3 DTO 速查表中建条目
  │
  ├─ 3. 业务域分组：按 §4.6 heuristic + groupOverrides
  │
  ├─ 4. 暴露状态标注：合并 schema 存在性 + options.exposureStatus
  │     → schema 有且 exposureStatus 未标注 = ✅ exposed
  │     → exposureStatus = 'unexposed' = 🔴 有契约未暴露
  │     → exposureStatus = 'missing' = 🔴 缺失
  │     → exposureStatus = 'partial' = 🟡 部分暴露
  │
  ├─ 5. Markdown 渲染：按 RFC §4 格式输出
  │     → §一 操作概览（域×分类统计表）
  │     → §二 按域操作清单（核心表）
  │     → §三 DTO 字段速查（仅被操作引用的 DTO）
  │     → §四 暴露状态与缺口
  │     → §五 页面→操作映射（pageMapping 提供时输出，否则标注"待补充"）
  │
  └─ 输出：markdown 字符串
```

### 4.8 涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/codegen/schema-parser.ts` | **新增** | `parseGraphQLSchema()` + `ParsedSchema` / `ParsedOperation` / `ParsedType` / `ParsedField` 类型 |
| `src/codegen/graphql-api-doc.ts` | **新增** | `generateGraphQLApiDoc()` + `GenerateGraphQLApiDocOptions` + `DEFAULT_SCALAR_TS_MAP` |
| `src/codegen/graphql-api-doc.test.ts` | **新增** | 单元测试（见 §六） |
| `src/codegen/index.ts` | **新增** | codegen 模块入口，透出上述导出 |
| `src/index.ts` | **修改** | 新增 `export * from "./codegen"` |
| `package.json` | **修改** | 新增 `graphql` optional peerDependency |
| `tsconfig.build.json` | 确认 | `include: ["src"]` 已覆盖 `src/codegen/`，无需修改 |

### 4.9 依赖策略

**`graphql` 包作为 optional peerDependency**：

```json
{
  "peerDependencies": {
    "graphql": "^16.0.0"
  },
  "peerDependenciesMeta": {
    "graphql": {
      "optional": true
    }
  },
  "devDependencies": {
    "graphql": "^16.0.0"
  }
}
```

- `peerDependencies` + `optional: true`：消费端不使用 codegen 时无需安装 `graphql`
- `devDependencies`：SDK 自身测试时需要（CI 安装 devDependencies）
- `parseGraphQLSchema()` 运行时动态 `import("graphql")`，不存在时抛友好错误：`"graphql package is required for codegen features. Install it: npm i graphql"`
- `generateGraphQLApiDoc()` 仅消费 `ParsedSchema`（纯数据），**不依赖 `graphql` 包**，无 graphql 时也可用（消费端可自行构造 `ParsedSchema`）

> **关键**：`generateGraphQLApiDoc()` 不直接 import `graphql` 类型（如 `DocumentNode`），只接受 `ParsedSchema`。这样渲染函数零 `graphql` 依赖，消费端即使不装 `graphql` 也能手动构造 `ParsedSchema` 调用渲染。

---

## 五、推迟项：`validateGraphQLApiDoc()`（远期）

v1.0 初稿将 `validateGraphQLApiDoc()` 列为 Phase 2 辅助。自查认为**过度设计**：

- Phase 2 消费端自行实现生成器，格式合规由人工 review 保证
- Phase 3 SDK 提供生成器后，消费端直接调 `generateGraphQLApiDoc()`，输出必然合规（同源生成）
- 独立的验证函数仅在"消费端自行魔改生成逻辑"时有用，但这违反"禁止手改生成物"原则

**决策**：**移除 `validateGraphQLApiDoc()`**。若未来确有需求（如跨项目格式审计），另立方案。

---

## 六、测试计划

### 6.1 `schema-parser.test.ts`

| 测试 | 验证点 |
|------|--------|
| 基础解析 | `type Query { hello: String }` → `operations[0].name === "hello"`，`returnType === "String"`，`isScalar === true` |
| Mutation 识别 | `type Mutation { createStore(name: String): StoreDto }` → `kind === "mutation"`，`args[0].name === "name"` |
| 非空/列表 | `listStores(filter: StoreFilter!): [StoreDto!]!` → `returnIsList === true`，`returnIsNonNull === true`，`args[0].isNonNull === true` |
| DTO 提取 | `type StoreDto { id: ID! name: String! address: AddressDto }` → `fields[2].isScalar === false`，`fields[2].gqlType === "AddressDto"` |
| Enum 提取 | `enum Status { ACTIVE INACTIVE }` → `kind === "enum"`，`enumValues === ["ACTIVE", "INACTIVE"]` |
| 描述提取 | `"""查询门店"""\nstore(id: ID!): StoreDto` → `description === "查询门店"` |
| 默认值 | `page: Int = 1` → `defaultValue === "1"` |
| 非法输入 | `parseGraphQLSchema("not valid")` → throws |

### 6.2 `graphql-api-doc.test.ts`

| 测试 | 验证点 |
|------|--------|
| 文档骨架 | 输出包含 `## 一、操作概览` / `## 二、按域操作清单` / `## 三、DTO 字段速查` / `## 四、暴露状态与缺口` / `## 五、页面→操作映射` |
| 标量返回标注 | `deleteStore: Boolean` → 操作清单返回列为 `Boolean`（非 DTO 名） |
| DTO 速查仅含被引用的 | schema 有 `UnusedDto` 但无操作返回它 → 速查表中不出现 |
| ignoredFields | `options.ignoredFields = new Set(["toDto"])` → DTO 速查表中无 `toDto` 字段 |
| 暴露状态 ✅ | 无 `exposureStatus` 配置 → schema 中存在的操作标注 ✅ |
| 暴露状态 🔴 | `exposureStatus = { resetPassword: "unexposed" }` → 标注 🔴 有契约未暴露 |
| 暴露状态 🟡 | `exposureStatus = { importBatch: "partial" }` → 标注 🟡 部分暴露 |
| 分组 heuristic | `listStores` / `createStore` → 同属 `store` 域 |
| groupOverrides | `{ listStores: "shop" }` → 归入 `shop` 域而非 `store` |
| pageMapping 留空 | 无 `pageMapping` → §五输出 `> 待补充` |
| pageMapping 提供 | `{ "/stores": ["listStores"] }` → §五输出映射表 |
| 零 graphql 依赖 | `generateGraphQLApiDoc(parsed, {})` 不 import `graphql` 包（静态分析） |

---

## 七、版本计划

| 版本 | 内容 | 依赖 |
|:----|:-----|:-----|
| **v1.1.0** | 新增 `src/codegen/` 模块：`parseGraphQLSchema()` + `generateGraphQLApiDoc()` + 类型定义 + 测试 | 本设计文档评审通过 |
| — | DMP-Lite 升级 `@tkwf/tsclient@^1.1.0`，`gen-ts-client.ts` 改为 `parseGraphQLSchema()` 一次解析 + 分别生成 ts-client.g.ts / GraphQL_Api.md | v1.1.0 发布 |
| — | DMP-Lite 删除 `gen-ts-client.ts` 中的 regex 解析逻辑，完全依赖 SDK `parseGraphQLSchema()` | v1.1.0 + 消费端适配 |

---

## 八、涉及文件总览

### tkwf-tsclient（Phase 3）

| 文件 | 操作 |
|------|------|
| `src/codegen/schema-parser.ts` | 新增 |
| `src/codegen/graphql-api-doc.ts` | 新增 |
| `src/codegen/graphql-api-doc.test.ts` | 新增 |
| `src/codegen/schema-parser.test.ts` | 新增 |
| `src/codegen/index.ts` | 新增 |
| `src/index.ts` | 修改：新增导出 |
| `package.json` | 修改：新增 `graphql` optional peerDependency + devDependency |
| `docs/codegen/GraphQL_Api.md-设计方案.md` | 本文件 |

### DMP-Lite（Phase 2，消费端自行完成）

| 文件 | 操作 | 说明 |
|------|------|------|
| `DMP-Lite/scripts/gen-ts-client.ts` | 修改 | 新增 `generateGraphQLApiMarkdown()` 函数（Phase 2 内联实现，Phase 3 替换为 SDK 调用） |
| `DMP-Lite/scripts/codegen-config.json` | 新增 | 暴露状态配置清单、忽略字段、页面映射 |
| `DMP-Lite/DMP-Lite.Merchant.AdminWeb/docs/codegen/GraphQL_Api.md` | 新增 | 生成物，禁止手改 |

> **路径勘误**：`gen-ts-client.ts` 在 `DMP-Lite/scripts/`（解决方案根），不在 AdminWeb 下。`GraphQL_Api.md` 输出到 AdminWeb/docs/codegen/。

---

## 九、验收标准

| # | 验收项 | 判定 |
|---|--------|------|
| 1 | 本设计文档经消费端确认 | 消费端确认 Q1-Q5 决策 |
| 2 | SDK `npm run build` 通过 | exit 0 |
| 3 | SDK `npm test` 通过（含 §六新增测试） | 全部通过 |
| 4 | `parseGraphQLSchema(schemaText)` 输出 `ParsedSchema` 结构正确 | §6.1 全部测试通过 |
| 5 | `generateGraphQLApiDoc(parsed, {})` 输出符合 RFC §4 格式 | §6.2 全部测试通过 |
| 6 | 无 `graphql` 包时 SDK 基础功能不受影响 | `import { Tkwf } from "@tkwf/tsclient"` 不报错；`generateGraphQLApiDoc()` 可用（仅 `parseGraphQLSchema()` 报友好错误） |
| 7 | 生成文档无 C# 残留 | grep `DMP_Lite.Domain` / `System\.` 零匹配 |
| 8 | 缺口状态通过配置清单正确标注 | `exposureStatus` 配置如实反映到文档（含 🟡 partial） |

---

## 附录 A：v1.0 → v1.1 自查修订记录

| # | 问题 | v1.0 | v1.1 修复 |
|---|------|------|-----------|
| 1 | 缺少 `ParsedSchema` 中间模型，消费端被迫二次解析 | 直接 `generateGraphQLApiDoc(schemaText)` | 分离 `parseGraphQLSchema()` + `generateGraphQLApiDoc(parsed)`，消费端一次解析双产物 |
| 2 | `exposureStatus` 缺 `'partial'` | 只有 3 值 | 增加 `'partial'`，与 §2.1 新增的 🟡 状态对齐 |
| 3 | `groupOverrides` 引用未定义 | §4.5 引用但 §4.1 options 无此字段 | §4.4 options 新增 `groupOverrides` |
| 4 | `outputPath` 与返回值矛盾 | options 含 `outputPath` 但函数返回 string | 移除 `outputPath`，消费端自行写文件 |
| 5 | `DocumentNode` 类型导入问题 | 函数签名含 `DocumentNode`（来自 graphql） | `parseGraphQLSchema` 只接受 `string`，`generateGraphQLApiDoc` 只接受 `ParsedSchema`，渲染函数零 graphql 依赖 |
| 6 | 无测试计划 | 无 | 新增 §六 测试计划（schema-parser + graphql-api-doc） |
| 7 | 消费端配置旋钮未映射 | 无 `scalarMap` | 新增 `scalarMap`，映射消费端 `SCALAR_MAP` |
| 8 | `validateGraphQLApiDoc` 过度设计 | Phase 2 列为辅助 | 移除（§五），远期有需求另立 |
| 9 | 分组 heuristic 不含 auth 特殊分组 | 仅 CRUD 前缀 | 新增 `login*` / `logout` / `ping` → `auth` |
| 10 | 消费端路径错误 | `scripts/gen-ts-client.ts` 在 AdminWeb 下 | 勘误：在 `DMP-Lite/scripts/`（解决方案根） |
| 11 | 描述提取未说明消费端现状 | 仅说"建议顺序" | 补充：消费端当前完全丢弃描述，Phase 3 需补齐 |
| 12 | SDK `MUTATION_PREFIXES` 未复用 | 分组 heuristic 另造规则 | §4.6 明确复用 `service-proxy.ts` 的 `MUTATION_PREFIXES` |

---

## 附录 B：变更记录

| 版本 | 日期 | 修改内容 |
|:----|:-----|:---------|
| v1.0 | 2026-08-14 | 初稿：tkwf-tsclient 对 RFC 的评审 + 设计方案 |
| v1.1 | 2026-08-14 | 自查修订：分离 parse/render 两层；补齐 ParsedSchema 中间模型；exposureStatus 增加 partial；补齐 groupOverrides/scalarMap；移除 validateGraphQLApiDoc；新增测试计划；勘误消费端路径；复用 SDK MUTATION_PREFIXES |