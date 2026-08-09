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