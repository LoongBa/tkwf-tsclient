// V4.9.20: QueryBuilder 操作符类型与响应类型。
// 本文件定义 SDK 基础类型，不依赖 codegen 产物。
// 字段代理接口（如 MerchantUserInfoFields）由 codegen 生成在 domain-client.g.ts 中。

// ── 谓词节点 ──

/**
 * 谓词节点：用户链式调用后生成，最终编译为 GraphQL filter 对象。
 * 泛型 TFields 携带字段代理类型，使 and/or 嵌套回调保持类型安全。
 */
export interface PredicateNode<TFields = any> {
  /** 编译为 HC filter 字典片段 */
  toFilter(): object;
  /** AND 组合 */
  and(other: PredicateNode<TFields> | ((fields: TFields) => PredicateNode<TFields>)): PredicateNode<TFields>;
  /** OR 组合 */
  or(other: PredicateNode<TFields> | ((fields: TFields) => PredicateNode<TFields>)): PredicateNode<TFields>;
}

// ── 操作符接口（按字段类型） ──

export interface StringFieldOperators<TFields = any> {
  eq(val: string): PredicateNode<TFields>;
  neq(val: string): PredicateNode<TFields>;
  contains(val: string): PredicateNode<TFields>;
  startsWith(val: string): PredicateNode<TFields>;
  endsWith(val: string): PredicateNode<TFields>;
  in(val: string[]): PredicateNode<TFields>;
  nin(val: string[]): PredicateNode<TFields>;
  // v1.0.7: 空值操作符
  isNull(): PredicateNode<TFields>;
  isNotNull(): PredicateNode<TFields>;
  // v1.0.7: 字符串取反
  ncontains(val: string): PredicateNode<TFields>;
  nstartsWith(val: string): PredicateNode<TFields>;
  nendsWith(val: string): PredicateNode<TFields>;
}

export interface NumberFieldOperators<TFields = any> {
  eq(val: number): PredicateNode<TFields>;
  neq(val: number): PredicateNode<TFields>;
  gt(val: number): PredicateNode<TFields>;
  gte(val: number): PredicateNode<TFields>;
  lt(val: number): PredicateNode<TFields>;
  lte(val: number): PredicateNode<TFields>;
  in(val: number[]): PredicateNode<TFields>;
  nin(val: number[]): PredicateNode<TFields>;
  // v1.0.7: 空值操作符
  isNull(): PredicateNode<TFields>;
  isNotNull(): PredicateNode<TFields>;
}

export interface DateFieldOperators<TFields = any> {
  eq(val: string): PredicateNode<TFields>;
  neq(val: string): PredicateNode<TFields>;
  gt(val: string): PredicateNode<TFields>;
  gte(val: string): PredicateNode<TFields>;
  lt(val: string): PredicateNode<TFields>;
  lte(val: string): PredicateNode<TFields>;
  // v1.0.7: 空值操作符
  isNull(): PredicateNode<TFields>;
  isNotNull(): PredicateNode<TFields>;
}

export interface BooleanFieldOperators<TFields = any> {
  eq(val: boolean): PredicateNode<TFields>;
  neq(val: boolean): PredicateNode<TFields>;
  isTrue(): PredicateNode<TFields>;   // 等价 eq(true)
  isFalse(): PredicateNode<TFields>;  // 等价 eq(false)，语义 ≈ !x.IsDeleted
}

// ── 排序 ──

export interface SortNode {
  field: string;
  isDesc: boolean;
  asc(): SortNode;
  desc(): SortNode;
}

// ── 分页响应 ──

export class PageInfoData {
  hasNextPage = false;
  endCursor?: string;
}

export class PagedResponse<T> {
  nodes?: T[];
  totalCount = 0;
  pageNumber = 1;
  pageSize = 20;
  pageInfo?: PageInfoData;

  get items(): T[] { return this.nodes ?? []; }
}

// ── 过滤输入类型（v1.0.5 分族泛型化） ──

/** HC Connection 分页信息（schema PageInfo 类型）。 */
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

/** 数值/日期族操作符过滤器（12 操作符；in/nin 沿用现有单值语义）。 */
export interface OperationFilterInput<T> {
  eq?: T | null; neq?: T | null; in?: T | null; nin?: T | null;
  gt?: T | null; ngt?: T | null; gte?: T | null; ngte?: T | null;
  lt?: T | null; nlt?: T | null; lte?: T | null; nlte?: T | null;
}

/** 字符串族操作符过滤器（and/or + contains/startsWith/endsWith 族，无数值比较）。 */
export interface StringOperationFilterInput {
  and?: StringOperationFilterInput | null;
  or?: StringOperationFilterInput | null;
  eq?: string | null; neq?: string | null;
  contains?: string | null; ncontains?: string | null;
  in?: string | null; nin?: string | null;
  startsWith?: string | null; nstartsWith?: string | null;
  endsWith?: string | null; nendsWith?: string | null;
}

/** 布尔族操作符过滤器（仅 eq/neq）。 */
export interface BooleanOperationFilterInput {
  eq?: boolean | null;
  neq?: boolean | null;
}

/** 枚举族操作符过滤器（eq/neq/in/nin）。 */
export interface EnumOperationFilterInput<T extends string> {
  eq?: T | null; neq?: T | null; in?: T | null; nin?: T | null;
}

/** HC Connection 泛型（pageInfo/edges/nodes/totalCount）。 */
export interface Connection<TNode, TEdge> {
  pageInfo: PageInfo;
  edges: Array<TEdge>;
  nodes: Array<TNode>;
  totalCount: number;
}

/** HC Edge 泛型（cursor/node）。 */
export interface Edge<TNode> {
  cursor: string;
  node: TNode | null;
}

/** SelectFields 映射派生：Partial<Record<keyof TFields, true>>。 */
export type SelectFieldsOf<TFields> = Partial<Record<keyof TFields, true>>;

/** OrderByFields 映射派生：Record<keyof TFields, SortNode>。 */
export type OrderByFieldsOf<TFields> = Record<keyof TFields, SortNode>;

// ── v1.0.7: 条件分组 ──

/**
 * 条件分组构建器。通过 and() 添加谓词回调，build(proxy) 传入字段代理执行。
 * P1 仅支持 AND 模式，OR 模式待后续扩展。
 * @template TFields - 字段代理类型
 */
export class GroupBuilder<TFields> {
  private _predicateFns: ((fields: TFields) => PredicateNode<TFields>)[] = [];

  and(predicate: (fields: TFields) => PredicateNode<TFields>): this {
    this._predicateFns.push(predicate);
    return this;
  }

  build(proxy: TFields): object {
    if (this._predicateFns.length === 0) return {};
    const nodes = this._predicateFns.map(fn => fn(proxy));
    if (nodes.length === 1) return nodes[0].toFilter();
    return { and: nodes.map(n => n.toFilter()) };
  }
}

// ── v1.0.7: 聚合查询 ──

/** 聚合查询响应 DTO。对应服务端生成的 `{Entity}Aggregate` 类型。 */
export class AggregateResponse {
  _count = 0;
  _sum?: Record<string, number>;
  _avg?: Record<string, number>;
  /** 最小值（数值或日期字符串）。 */
  _min?: Record<string, number | string>;
  /** 最大值（数值或日期字符串）。 */
  _max?: Record<string, number | string>;
}

/**
 * 聚合字段声明构建器。链式声明 sum/count/avg/min/max，字段名通过 Proxy 提取。
 * @template TFields - 字段代理类型
 */
export class AggregateFieldsBuilder<TFields> {
  private _sumFields: string[] = [];
  private _count = false;
  private _avgFields: string[] = [];
  private _minFields: string[] = [];
  private _maxFields: string[] = [];

  /** 已声明的 sum 字段列表（只读快照）。 */
  get sumFields(): readonly string[] { return this._sumFields; }
  /** 是否已声明 count。 */
  get hasCount(): boolean { return this._count; }
  /** 已声明的 avg 字段列表。 */
  get avgFields(): readonly string[] { return this._avgFields; }
  /** 已声明的 min 字段列表。 */
  get minFields(): readonly string[] { return this._minFields; }
  /** 已声明的 max 字段列表。 */
  get maxFields(): readonly string[] { return this._maxFields; }

  private _createFieldProxy(): TFields {
    return new Proxy({} as TFields, {
      get: (_t: any, prop: string | symbol) => {
        return typeof prop === "string" ? prop : "";
      },
    });
  }

  sum(selector: (fields: TFields) => any): this {
    const fieldName = selector(this._createFieldProxy()) as string;
    if (fieldName) this._sumFields.push(fieldName);
    return this;
  }

  count(): this {
    this._count = true;
    return this;
  }

  avg(selector: (fields: TFields) => any): this {
    const fieldName = selector(this._createFieldProxy()) as string;
    if (fieldName) this._avgFields.push(fieldName);
    return this;
  }

  min(selector: (fields: TFields) => any): this {
    const fieldName = selector(this._createFieldProxy()) as string;
    if (fieldName) this._minFields.push(fieldName);
    return this;
  }

  max(selector: (fields: TFields) => any): this {
    const fieldName = selector(this._createFieldProxy()) as string;
    if (fieldName) this._maxFields.push(fieldName);
    return this;
  }
}