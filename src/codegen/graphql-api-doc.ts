// V1.0.6: GraphQL API 契约文档生成器。
// 从 ParsedSchema 中间模型渲染为前端/Agent 可读的 GraphQL_Api.md 文档。
// 零 graphql 依赖：仅消费 ParsedSchema 纯数据，不 import graphql 包。

import type {
  ParsedSchema, ParsedOperation, ParsedField,
} from "./schema-parser";

// ── 导出类型 ──

export type ExposureStatus = "exposed" | "unexposed" | "missing" | "partial";

export interface GenerateGraphQLApiDocOptions {
  /** 业务域名称，用于文档标题。默认 'GraphQL' */
  domainName?: string;
  /** 忽略的 DTO 字段名（生成器噪音）。默认：new Set(['isFromPersistentSource', 'toDto']) */
  ignoredFields?: Set<string>;
  /** 暴露状态配置清单：{ 操作名: ExposureStatus }。未列出的操作默认 'exposed' */
  exposureStatus?: Record<string, ExposureStatus>;
  /** 页面→操作映射：{ 路由: 操作名[] }。提供时生成页面映射章节 */
  pageMapping?: Record<string, string[]>;
  /** 缺口表阻塞页面：{ 操作名: 阻塞页面路由 } */
  blockingPages?: Record<string, string>;
  /** 操作说明覆盖：{ 操作名: 说明文字 }。未覆盖的从 ParsedOperation.description 提取 */
  descriptions?: Record<string, string>;
  /** 业务域分组覆盖：{ 操作名: 域名 }。未覆盖的走 heuristic 分组 */
  groupOverrides?: Record<string, string>;
  /** 标量→TS 类型映射覆盖（默认见 DEFAULT_SCALAR_TS_MAP） */
  scalarMap?: Record<string, string>;
}

// ── 导出常量 ──

export const DEFAULT_SCALAR_TS_MAP: Record<string, string> = {
  String: "string", ID: "string", URL: "string", UUID: "string",
  Int: "number", Float: "number", Long: "number", Decimal: "number", Byte: "number", Short: "number",
  Boolean: "boolean",
  DateTime: "string", LocalDate: "string",
  JSON: "unknown",
};

// ── 内部常量 ──

const MUTATION_PREFIXES = [
  "create", "update", "delete", "add", "remove",
  "lock", "unlock", "reset",
];

const QUERY_PREFIXES = ["list", "get", "query"];
const AUTH_OPERATIONS = new Set(["login", "logout", "ping"]);

// ── 业务域分组 ──

function determineDomain(name: string, overrides?: Record<string, string>): string {
  if (overrides?.[name]) return overrides[name];

  const lower = name.toLowerCase();

  // auth 特殊分组
  if (AUTH_OPERATIONS.has(lower) || lower.startsWith("login")) return "auth";

  // CRUD 前缀
  for (const prefix of MUTATION_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return extractBusinessWord(name, prefix.length);
    }
  }
  for (const prefix of QUERY_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return extractBusinessWord(name, prefix.length);
    }
  }

  // *ById 模式
  const byIdIdx = lower.lastIndexOf("byid");
  if (byIdIdx > 0) {
    return extractBusinessWord(name, 0, byIdIdx);
  }

  return "other";
}

function extractBusinessWord(name: string, start: number, end?: number): string {
  const slice = end !== undefined ? name.slice(start, end) : name.slice(start);
  // camelCase → 小写
  let word = slice.charAt(0).toLowerCase() + slice.slice(1);
  // 复数→单数（简单规则）
  if (word.endsWith("ies")) {
    word = word.slice(0, -3) + "y";
  } else if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("ches") || word.endsWith("shes")) {
    word = word.slice(0, -2);
  } else if (word.endsWith("s") && !word.endsWith("ss")) {
    word = word.slice(0, -1);
  }
  return word;
}

// ── TS 类型渲染 ──

function toTsType(gqlType: string, isList: boolean, isNonNull: boolean, scalarMap: Record<string, string>): string {
  const base = scalarMap[gqlType] ?? gqlType;
  let result = base;
  if (isList) result = `${result}[]`;
  if (!isNonNull) result = `${result} | null`;
  return result;
}

function formatArgs(args: ParsedOperation["args"], scalarMap: Record<string, string>): string {
  if (args.length === 0) return "—";
  const fields = args.map((a) => {
    const tsType = toTsType(a.gqlType, a.isList, a.isNonNull, scalarMap);
    return `${a.name}${a.isNonNull ? "" : "?"}: ${tsType}`;
  });
  return `{ ${fields.join("; ")} }`;
}

// ── 暴露状态渲染 ──

function formatStatus(
  op: ParsedOperation,
  exposureStatus?: Record<string, ExposureStatus>,
): string {
  const configured = exposureStatus?.[op.name];
  if (configured) {
    switch (configured) {
      case "exposed": return "✅";
      case "unexposed": return "🔴 有契约未暴露";
      case "missing": return "🔴 缺失";
      case "partial": return "🟡 部分暴露";
    }
  }
  return "✅";
}

// ── 主渲染函数 ──

/**
 * 从已解析的 schema 模型生成前端/Agent 可读的 API 契约文档（markdown）。
 * @param parsed 由 parseGraphQLSchema() 返回的中间模型
 * @param options 渲染选项
 * @returns markdown 文本字符串（消费端自行写入文件）
 */
export function generateGraphQLApiDoc(
  parsed: ParsedSchema,
  options?: GenerateGraphQLApiDocOptions,
): string {
  const {
    domainName = "GraphQL",
    ignoredFields = new Set(["isFromPersistentSource", "toDto"]),
    exposureStatus,
    pageMapping,
    blockingPages,
    descriptions,
    groupOverrides,
    scalarMap,
  } = options ?? {};

  const mergedScalarMap = { ...DEFAULT_SCALAR_TS_MAP, ...scalarMap };

  // ── 按域分组 ──
  const domainMap = new Map<string, ParsedOperation[]>();
  for (const op of parsed.operations) {
    const domain = determineDomain(op.name, groupOverrides);
    if (!domainMap.has(domain)) domainMap.set(domain, []);
    domainMap.get(domain)!.push(op);
  }
  const sortedDomains = [...domainMap.keys()].sort();

  // ── 操作→DTO 引用集 ──
  const referencedTypes = new Set<string>();
  for (const op of parsed.operations) {
    if (!mergedScalarMap[op.returnType]) {
      referencedTypes.add(op.returnType);
    }
  }

  // ── 构建 DTO 速查表 ──
  const dtoFieldMap = new Map<string, ParsedField[]>();
  for (const type of parsed.types) {
    if (type.kind === "enum" || type.kind === "input") continue;
    if (!referencedTypes.has(type.name)) continue;
    const filtered = type.fields.filter((f) => !ignoredFields.has(f.name));
    dtoFieldMap.set(type.name, filtered);
  }

  // ── 构建输出 ──
  const lines: string[] = [];

  // 标题 + 元数据
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  lines.push(`# ${domainName} API 契约 — 前端/Agent 消费版`);
  lines.push("");
  lines.push(`> 自动生成（@tkwf/tsclient v1.0.6）｜生成时间：${timestamp}`);
  lines.push(`> 源：schema.graphql（禁止手改；缺失/过时报告补齐）`);
  lines.push("");

  // ── 一、操作概览 ──
  lines.push("## 一、操作概览（全部域）");
  lines.push("");
  lines.push("| 域 | Query 数 | Mutation 数 | 已暴露 | 未暴露 |");
  lines.push("|---|:---:|:---:|:---:|:---:|");
  for (const domain of sortedDomains) {
    const ops = domainMap.get(domain)!;
    let queryCount = 0;
    let mutationCount = 0;
    let exposedCount = 0;
    let unexposedCount = 0;
    for (const op of ops) {
      if (op.kind === "query") queryCount++;
      else mutationCount++;
      const status = formatStatus(op, exposureStatus);
      if (status.includes("✅")) exposedCount++;
      else unexposedCount++;
    }
    lines.push(`| ${domain} | ${queryCount} | ${mutationCount} | ${exposedCount} | ${unexposedCount} |`);
  }

  // 合计行
  const totalOps = parsed.operations.length;
  const totalQuery = parsed.operations.filter((o) => o.kind === "query").length;
  const totalMutation = parsed.operations.filter((o) => o.kind === "mutation").length;
  const totalExposed = parsed.operations.filter((o) => {
    const s = formatStatus(o, exposureStatus);
    return s.includes("✅");
  }).length;
  const totalUnexposed = totalOps - totalExposed;
  lines.push(`| **合计** | **${totalQuery}** | **${totalMutation}** | **${totalExposed}** | **${totalUnexposed}** |`);
  lines.push("");

  // ── 二、按域操作清单（含 DTO 字段展开） ──
  lines.push("## 二、按域操作清单");
  lines.push("");
  lines.push("| Domain | GraphQL 操作 | 分类 | 说明 | 参数 (TS) | 返回 | 状态 |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const domain of sortedDomains) {
    const ops = domainMap.get(domain)!;
    for (const op of ops) {
      const desc = descriptions?.[op.name] ?? op.description ?? "";
      const params = formatArgs(op.args, mergedScalarMap);
      const retType = mergedScalarMap[op.returnType] ? op.returnType : `\`${op.returnType}\``;
      const status = formatStatus(op, exposureStatus);
      lines.push(`| ${domain} | \`${op.name}\` | ${op.kind === "query" ? "Query" : "Mutation"} | ${desc} | ${params} | ${retType} | ${statusShort(status)} |`);
      // DTO 字段展开：非标量返回类型 → 展开 DTO 字段
      if (!mergedScalarMap[op.returnType]) {
        const fields = dtoFieldMap.get(op.returnType);
        if (fields) {
          for (const f of fields) {
            const tsType = toTsType(f.gqlType, f.isList, f.isNonNull, mergedScalarMap);
            const fieldRef = f.isScalar ? tsType : `\`${f.gqlType}\``;
            lines.push(`| | ⤷ \`${f.name}\`: ${fieldRef} | | | | | |`);
          }
        }
      }
    }
  }
  lines.push("");

  // ── 三、DTO 字段速查 ──
  lines.push("## 三、DTO 字段速查");
  lines.push("");
  if (dtoFieldMap.size === 0) {
    lines.push("（无 DTO 引用）");
  } else {
    lines.push("| DTO | 关键字段 |");
    lines.push("|-----|---------|");
    for (const [typeName, fields] of dtoFieldMap) {
      const fieldNames = fields.map((f) => {
        if (f.isScalar) return f.name;
        return `${f.name} → 见 \\\`${f.gqlType}\\\``;
      });
      lines.push(`| \`${typeName}\` | ${fieldNames.join(", ")} |`);
    }
  }
  lines.push("");

  // ── 四、暴露状态与缺口 ──
  lines.push("## 四、暴露状态与缺口");
  lines.push("");
  lines.push("| 操作 | 契约来源 | 问题 | 阻塞页面 |");
  lines.push("|------|---------|------|---------|");
  let hasGap = false;
  for (const op of parsed.operations) {
    const status = exposureStatus?.[op.name];
    if (status && status !== "exposed") {
      hasGap = true;
      const source = `schema（${op.kind}）`;
      const problem = status === "unexposed" ? "🔴 契约在未暴露" : status === "missing" ? "🔴 缺失" : "🟡 部分暴露";
      const blocked = blockingPages?.[op.name] ?? "—";
      lines.push(`| \`${op.name}\` | ${source} | ${problem} | ${blocked} |`);
    }
  }
  if (!hasGap) {
    lines.push("| — | — | ✅ 全部已注册 | — |");
  }
  lines.push("");

  // ── 五、页面→操作映射 ──
  lines.push("## 五、页面→操作映射");
  lines.push("");
  if (pageMapping && Object.keys(pageMapping).length > 0) {
    lines.push("| 页面路由 | 使用操作 |");
    lines.push("|---------|---------|");
    for (const [route, ops] of Object.entries(pageMapping)) {
      lines.push(`| \`${route}\` | ${ops.map((o) => `\`${o}\``).join(", ")} |`);
    }
  } else {
    lines.push("> 待补充（由消费端在 codegen-config.json 中配置 pageMapping）");
  }
  lines.push("");

  // ── 附录：变更记录 ──
  lines.push("---");
  lines.push("## 附录：变更记录");
  lines.push("");
  lines.push("| 版本 | 日期 | 修改内容 |");
  lines.push("|------|------|---------|");
  lines.push(`| v1.0.6 | ${pad(now.getMonth() + 1)}/${pad(now.getDate())}/${now.getFullYear()} | 自动生成初版 |`);
  lines.push("");

  return lines.join("\n");
}

function statusShort(full: string): string {
  if (full.includes("✅")) return "✅";
  if (full.includes("🟡")) return "🟡";
  return "🔴";
}