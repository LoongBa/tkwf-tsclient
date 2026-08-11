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
}

export interface DateFieldOperators<TFields = any> {
  eq(val: string): PredicateNode<TFields>;
  neq(val: string): PredicateNode<TFields>;
  gt(val: string): PredicateNode<TFields>;
  gte(val: string): PredicateNode<TFields>;
  lt(val: string): PredicateNode<TFields>;
  lte(val: string): PredicateNode<TFields>;
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