// V4.9.20: QueryBuilder 基类 + 谓词编译实现。
// codegen 为每个 Entity 生成继承 QueryBuilderBase 的子类（如 MerchantUserInfoQueryBuilder）。

import type { Transport } from "./transport";
import { PagedResponse, AggregateResponse, AggregateFieldsBuilder, GroupBuilder } from "./query-builder-types";
import type { PredicateNode, SortNode, StringFieldOperators, NumberFieldOperators, DateFieldOperators, BooleanFieldOperators } from "./query-builder-types";

// ── 操作符工厂（v1.0.5 从 codegen 产物迁移至 SDK） ──

export function dummyAsc(this: SortNode): SortNode { return { field: this.field, isDesc: false, asc: this.asc, desc: this.desc }; }
export function dummyDesc(this: SortNode): SortNode { return { field: this.field, isDesc: true, asc: this.asc, desc: this.desc }; }

export function createOperators<TFields>(field: string, gqlType: string, proxy: TFields): any {
  switch (gqlType) {
    case "String": case "ID": case "Url": case "UUID":
      return createStringOps(field, proxy);
    case "Int": case "Float": case "Decimal": case "Long": case "Byte": case "Short":
      return createNumberOps(field, proxy);
    case "DateTime": case "LocalDate":
      return createDateOps(field, proxy);
    case "Boolean":
      return createBooleanOps(field, proxy);
    default:
      return createStringOps(field, proxy);
  }
}

export function createStringOps<TFields>(field: string, proxy: TFields): StringFieldOperators<TFields> {
  return {
    eq: (v: string) => new LeafNode<TFields>(field, "eq", v, proxy),
    neq: (v: string) => new LeafNode<TFields>(field, "neq", v, proxy),
    contains: (v: string) => new LeafNode<TFields>(field, "contains", v, proxy),
    startsWith: (v: string) => new LeafNode<TFields>(field, "startsWith", v, proxy),
    endsWith: (v: string) => new LeafNode<TFields>(field, "endsWith", v, proxy),
    in: (v: string[]) => new LeafNode<TFields>(field, "in", v, proxy),
    nin: (v: string[]) => new LeafNode<TFields>(field, "nin", v, proxy),
    // v1.0.7: 空值操作符
    isNull: () => new LeafNode<TFields>(field, "eq", null, proxy),
    isNotNull: () => new LeafNode<TFields>(field, "neq", null, proxy),
    // v1.0.7: 字符串取反
    ncontains: (v: string) => new LeafNode<TFields>(field, "ncontains", v, proxy),
    nstartsWith: (v: string) => new LeafNode<TFields>(field, "nstartsWith", v, proxy),
    nendsWith: (v: string) => new LeafNode<TFields>(field, "nendsWith", v, proxy),
  };
}

export function createNumberOps<TFields>(field: string, proxy: TFields): NumberFieldOperators<TFields> {
  return {
    eq: (v: number) => new LeafNode<TFields>(field, "eq", v, proxy),
    neq: (v: number) => new LeafNode<TFields>(field, "neq", v, proxy),
    gt: (v: number) => new LeafNode<TFields>(field, "gt", v, proxy),
    gte: (v: number) => new LeafNode<TFields>(field, "gte", v, proxy),
    lt: (v: number) => new LeafNode<TFields>(field, "lt", v, proxy),
    lte: (v: number) => new LeafNode<TFields>(field, "lte", v, proxy),
    in: (v: number[]) => new LeafNode<TFields>(field, "in", v, proxy),
    nin: (v: number[]) => new LeafNode<TFields>(field, "nin", v, proxy),
    // v1.0.7: 空值操作符
    isNull: () => new LeafNode<TFields>(field, "eq", null, proxy),
    isNotNull: () => new LeafNode<TFields>(field, "neq", null, proxy),
  };
}

export function createDateOps<TFields>(field: string, proxy: TFields): DateFieldOperators<TFields> {
  return {
    eq: (v: string) => new LeafNode<TFields>(field, "eq", v, proxy),
    neq: (v: string) => new LeafNode<TFields>(field, "neq", v, proxy),
    gt: (v: string) => new LeafNode<TFields>(field, "gt", v, proxy),
    gte: (v: string) => new LeafNode<TFields>(field, "gte", v, proxy),
    lt: (v: string) => new LeafNode<TFields>(field, "lt", v, proxy),
    lte: (v: string) => new LeafNode<TFields>(field, "lte", v, proxy),
    // v1.0.7: 空值操作符
    isNull: () => new LeafNode<TFields>(field, "eq", null, proxy),
    isNotNull: () => new LeafNode<TFields>(field, "neq", null, proxy),
  };
}

export function createBooleanOps<TFields>(field: string, proxy: TFields): BooleanFieldOperators<TFields> {
  return {
    eq: (v: boolean) => new LeafNode<TFields>(field, "eq", v, proxy),
    neq: (v: boolean) => new LeafNode<TFields>(field, "neq", v, proxy),
    isTrue: () => new LeafNode<TFields>(field, "eq", true, proxy),
    isFalse: () => new LeafNode<TFields>(field, "eq", false, proxy),
  };
}

// ── 工具函数 ──

/** 从实体名推导 GraphQL resolver 字段名（首字母小写）。 */
export function deriveResolverField(entityName: string): string {
  if (!entityName || entityName.length === 0) return "unknown";
  return entityName[0].toLowerCase() + entityName.slice(1);
}

// ── QueryBuilder 注册表 ──

/**
 * QueryBuilder 工厂类型：根据 transport/field/sessionKey 创建实体专属 QueryBuilder。
 * codegen 生成的 domain-client.g.ts 通过 registerQueryBuilder 注册各实体工厂。
 */
export type QueryBuilderFactory<TEntity = any, TFields = any, TOrderBy = any, TSelect = any> =
  (transport: Transport, field: string, sessionKey?: string) => QueryBuilderBase<TEntity, TFields, TOrderBy, TSelect>;

const queryBuilderRegistry = new Map<string, QueryBuilderFactory>();

/** V4.9.20: 注册实体 QueryBuilder 工厂（由 codegen 在 domain-client.g.ts 调用）。重复注册会抛出警告。 */
export function registerQueryBuilder(entityName: string, factory: QueryBuilderFactory): void {
  if (queryBuilderRegistry.has(entityName)) {
    console.warn(`[QueryBuilder] Duplicate registration for entity '${entityName}'. The previous factory will be overwritten.`);
  }
  queryBuilderRegistry.set(entityName, factory);
}

/** 获取已注册的 QueryBuilder 工厂。 */
export function getQueryBuilderFactory(entityName: string): QueryBuilderFactory | undefined {
  return queryBuilderRegistry.get(entityName);
}

/** 创建实体 QueryBuilder（resolverField 由实体名推导，可覆盖）。 */
export function createQueryBuilder<TEntity = any>(
  entityName: string,
  transport: Transport,
  sessionKey?: string,
  resolverField?: string,
): QueryBuilderBase<TEntity, any, any, any> {
  const field = resolverField ?? deriveResolverField(entityName);
  const factory = queryBuilderRegistry.get(entityName);
  if (!factory) {
    throw new Error(`No QueryBuilder registered for entity: '${entityName}'. Run codegen first.`);
  }
  return factory(transport, field, sessionKey) as QueryBuilderBase<TEntity, any, any, any>;
}

/** 重置注册表（仅测试使用）。 */
export function resetQueryBuilderRegistry(): void {
  queryBuilderRegistry.clear();
}

// ── 谓词编译实现 ──

export class LeafNode<TFields> implements PredicateNode<TFields> {
  private _field: string;
  private _operator: string;
  private _value: unknown;
  private _fieldsProxy: TFields;

  constructor(field: string, operator: string, value: unknown, fieldsProxy: TFields) {
    this._field = field;
    this._operator = operator;
    this._value = value;
    this._fieldsProxy = fieldsProxy;
  }

  toFilter(): object {
    return { [this._field]: { [this._operator]: this._value } };
  }

  and(other: PredicateNode<TFields> | ((fields: TFields) => PredicateNode<TFields>)): PredicateNode<TFields> {
    const otherNode = typeof other === "function" ? other(this._fieldsProxy) : other;
    return new CompoundNode<TFields>("and", [this, otherNode]);
  }

  or(other: PredicateNode<TFields> | ((fields: TFields) => PredicateNode<TFields>)): PredicateNode<TFields> {
    const otherNode = typeof other === "function" ? other(this._fieldsProxy) : other;
    return new CompoundNode<TFields>("or", [this, otherNode]);
  }
}

export class CompoundNode<TFields> implements PredicateNode<TFields> {
  private _combinator: "and" | "or";
  private _children: PredicateNode<TFields>[];

  constructor(combinator: "and" | "or", children: PredicateNode<TFields>[]) {
    this._combinator = combinator;
    this._children = children;
  }

  toFilter(): object {
    return { [this._combinator]: this._children.map(c => c.toFilter()) };
  }

  and(other: PredicateNode<TFields> | ((fields: TFields) => PredicateNode<TFields>)): PredicateNode<TFields> {
    const otherNode = typeof other === "function" ? other(this.requireFieldsProxy()) : other;
    return new CompoundNode<TFields>("and", [...this._children, otherNode]);
  }

  or(other: PredicateNode<TFields> | ((fields: TFields) => PredicateNode<TFields>)): PredicateNode<TFields> {
    const otherNode = typeof other === "function" ? other(this.requireFieldsProxy()) : other;
    return new CompoundNode<TFields>("or", [...this._children, otherNode]);
  }

  private requireFieldsProxy(): TFields {
    if (this._children.length === 0) {
      throw new Error("Cannot chain and/or on an empty compound predicate node.");
    }
    const first = this._children[0];
    if (first instanceof LeafNode || first instanceof CompoundNode) {
      return (first as any)._fieldsProxy as TFields;
    }
    throw new Error("Cannot extract fields proxy from compound predicate node.");
  }
}

// ── QueryBuilder 基类 ──

/**
 * QueryBuilder 基类，抽象链式查询构建器的全部通用逻辑。
 *
 * @template TEntity          - 查询目标实体类型（数据接口，如 MerchantUserInfo）
 * @template TFields          - 字段代理类型（如 MerchantUserInfoFields，每个属性返回操作符）
 * @template TOrderByFields   - 排序字段代理类型（如 MerchantUserInfoOrderByFields）
 * @template TSelectFields    - 字段选择类型（如 MerchantUserInfoSelectFields）
 */
export abstract class QueryBuilderBase<
  TEntity,
  TFields,
  TOrderByFields,
  TSelectFields,
> {
  protected _filters: object[] = [];
  protected _sorts: { field: string; desc: boolean }[] = [];
  protected _fields: string[] = [];
  protected _page = 1;
  protected _pageSize = 100;
  protected _afterCursor?: string;
  protected _latestCursor?: string;
  protected _cursorCache = new Map<number, string>();
  // v1.0.7: 聚合模式
  protected _aggregateMode = false;
  protected _aggregateFields?: AggregateFieldsBuilder<TFields>;

  constructor(
    protected transport: Transport,
    protected resolverField: string,
    protected _sessionKey?: string,
  ) {}

  // ── 过滤 ──

  where(predicate: (fields: TFields) => PredicateNode<TFields>): this {
    const node = predicate(this.createFieldsProxy());
    this._filters.push(node.toFilter());
    this.invalidateCursor();
    return this;
  }

  // ── 排序 ──

  orderBy(sort: (fields: TOrderByFields) => SortNode): this {
    const result = sort(this.createOrderByProxy());
    this._sorts = [{ field: result.field, desc: result.isDesc }];
    this.invalidateCursor();
    return this;
  }

  thenBy(sort: (fields: TOrderByFields) => SortNode): this {
    const result = sort(this.createOrderByProxy());
    this._sorts.push({ field: result.field, desc: result.isDesc });
    this.invalidateCursor();
    return this;
  }

  // ── 字段选择 ──

  select(fields: TSelectFields): this {
    this._fields = Object.keys(fields as Record<string, unknown>).filter(k => (fields as Record<string, unknown>)[k] === true);
    this.invalidateCursor();
    return this;
  }

  // ── 分页 ──

  page(page: number, pageSize = 20): this {
    this._page = Math.max(1, page);
    this._pageSize = Math.min(Math.max(1, pageSize), 100);
    if (this._page > 1 && this._cursorCache.has(this._page - 1)) {
      this._afterCursor = this._cursorCache.get(this._page - 1);
    } else {
      this._afterCursor = undefined;
    }
    return this;
  }

  take(count: number): this {
    this._pageSize = Math.min(Math.max(1, count), 100);
    return this;
  }

  nextPage(pageSize?: number): this {
    this._page++;
    if (pageSize) this._pageSize = Math.min(Math.max(1, pageSize), 100);
    this._afterCursor = this._latestCursor;
    return this;
  }

  prevPage(pageSize?: number): this {
    if (this._page > 1) this._page--;
    if (pageSize) this._pageSize = Math.min(Math.max(1, pageSize), 100);
    this._afterCursor = this._page > 0 && this._cursorCache.has(this._page - 1)
      ? this._cursorCache.get(this._page - 1)
      : undefined;
    return this;
  }

  // ── 执行 ──

  async toListAsync(): Promise<TEntity[]> {
    const result = await this.executeAsync<{ nodes?: TEntity[] }>();
    if (result && !Array.isArray(result.nodes)) {
      throw new Error(`QueryBuilder: expected 'nodes' array in GraphQL response for '${this.resolverField}'.`);
    }
    return result?.nodes ?? [];
  }

  async toPageAsync(): Promise<PagedResponse<TEntity>> {
    const raw = await this.executeAsync<Partial<PagedResponse<TEntity>>>();
    if (!raw) {
      throw new Error(`QueryBuilder: GraphQL response missing resolver field '${this.resolverField}'.`);
    }
    const result = new PagedResponse<TEntity>();
    result.nodes = raw.nodes;
    result.totalCount = raw.totalCount ?? 0;
    result.pageInfo = raw.pageInfo;
    result.pageNumber = this._page;
    result.pageSize = this._pageSize;
    this.cacheCursor(result);
    return result;
  }

  // ── v1.0.7: 仅计数查询 ──

  /**
   * 仅获取记录数，不请求 nodes 字段。
   * 编译为 `query { resolver(first: 1, where: ...) { totalCount } }`。
   */
  async countAsync(): Promise<number> {
    const query = this.compileGraphQLCountMode();
    const raw = await this.transport.executeRawGraphQL<Record<string, { totalCount: number }>>(query, this._sessionKey);
    const result = raw?.[this.resolverField];
    if (result === undefined) {
      throw new Error(`QueryBuilder: GraphQL response missing resolver field '${this.resolverField}'. Available fields: ${raw ? Object.keys(raw).join(", ") : "none"}.`);
    }
    return result.totalCount ?? 0;
  }

  // ── v1.0.7: 条件分组 ──

  /**
   * 显式条件分组。默认 AND 分组，GroupBuilder 可链式调用 and()/or()。
   */
  whereGroup(builder: (g: GroupBuilder<TFields>) => void): this {
    const group = new GroupBuilder<TFields>();
    builder(group);
    const filter = group.build(this.createFieldsProxy());
    if (Object.keys(filter).length > 0) {
      this._filters.push(filter);
    }
    this.invalidateCursor();
    return this;
  }

  // ── v1.0.7: 查询克隆 ──

  /** 深拷贝查询构建状态，返回独立副本。修改副本不影响原查询。 */
  clone(): this {
    const cloned = Object.create(Object.getPrototypeOf(this)) as this;
    cloned.transport = this.transport;
    cloned.resolverField = this.resolverField;
    cloned._sessionKey = this._sessionKey;
    cloned._filters = this._filters.map(f => ({ ...f }));
    cloned._sorts = this._sorts.map(s => ({ ...s }));
    cloned._fields = [...this._fields];
    cloned._page = this._page;
    cloned._pageSize = this._pageSize;
    cloned._afterCursor = this._afterCursor;
    cloned._latestCursor = this._latestCursor;
    cloned._cursorCache = new Map(this._cursorCache);
    cloned._aggregateMode = this._aggregateMode;
    // aggregate() 每次调用都新建 AggregateFieldsBuilder（替换引用），
    // 因此 clone 与原文指向同一 builder 实例不会导致交叉污染。
    // 若后续改为就地 mutate，需同步改为深拷贝。
    cloned._aggregateFields = this._aggregateFields;
    return cloned;
  }

  // ── v1.0.7: 动态排序 ──

  /**
   * 按字段名动态排序（运行时）。覆盖已有排序条件。
   * @param field - 字段名（通过 keyof TOrderByFields 编译期校验）
   * @param direction - ASC 或 DESC（默认 ASC）
   */
  orderByField<K extends keyof TOrderByFields>(field: K, direction: "ASC" | "DESC" = "ASC"): this {
    this._sorts = [{ field: String(field), desc: direction === "DESC" }];
    this.invalidateCursor();
    return this;
  }

  /**
   * 追加动态排序条件。
   * @param field - 字段名（通过 keyof TOrderByFields 编译期校验）
   * @param direction - ASC 或 DESC（默认 ASC）
   */
  thenByField<K extends keyof TOrderByFields>(field: K, direction: "ASC" | "DESC" = "ASC"): this {
    this._sorts.push({ field: String(field), desc: direction === "DESC" });
    this.invalidateCursor();
    return this;
  }

  // ── v1.0.7: 聚合查询 ──

  /**
   * 进入聚合模式，声明聚合字段。
   * @param builder - 聚合字段声明回调（sum/count/avg/min/max）
   */
  aggregate(builder: (a: AggregateFieldsBuilder<TFields>) => void): this {
    this._aggregateMode = true;
    this._aggregateFields = new AggregateFieldsBuilder<TFields>();
    builder(this._aggregateFields);
    this.invalidateCursor();
    return this;
  }

  /** 执行聚合查询，返回 AggregateResponse。必须在 aggregate() 之后调用。 */
  async toAggregateAsync(): Promise<AggregateResponse> {
    if (!this._aggregateMode || !this._aggregateFields) {
      throw new Error("QueryBuilder: aggregate() must be called before toAggregateAsync().");
    }
    const query = this.compileGraphQLAggregateMode();
    const raw = await this.transport.executeRawGraphQL<Record<string, AggregateResponse>>(query, this._sessionKey);
    const result = raw?.[`${this.resolverField}_aggregate`];
    if (result === undefined) {
      throw new Error(`QueryBuilder: GraphQL response missing aggregate resolver field '${this.resolverField}_aggregate'. Available fields: ${raw ? Object.keys(raw).join(", ") : "none"}.`);
    }
    const resp = new AggregateResponse();
    resp._count = result._count ?? 0;
    resp._sum = result._sum ?? undefined;
    resp._avg = result._avg ?? undefined;
    resp._min = result._min ?? undefined;
    resp._max = result._max ?? undefined;
    return resp;
  }

  // ── 内部方法 ──

  protected async executeAsync<T>(ct?: AbortSignal): Promise<T> {
    const query = this.compileGraphQL();
    const raw = await this.transport.executeRawGraphQL<Record<string, T>>(query, this._sessionKey, ct);
    const result = raw?.[this.resolverField];
    if (result === undefined) {
      throw new Error(`QueryBuilder: GraphQL response missing resolver field '${this.resolverField}'. Available fields: ${raw ? Object.keys(raw).join(", ") : "none"}.`);
    }
    return result as T;
  }

  protected cacheCursor(result: PagedResponse<TEntity>): void {
    if (result.pageInfo?.endCursor) {
      this._cursorCache.set(this._page, result.pageInfo.endCursor);
      this._latestCursor = result.pageInfo.endCursor;
      for (const key of this._cursorCache.keys()) {
        if (key > this._page) this._cursorCache.delete(key);
      }
    }
  }

  protected invalidateCursor(): void {
    this._cursorCache.clear();
    this._afterCursor = undefined;
    this._latestCursor = undefined;
  }

  // ── GraphQL 编译器辅助方法（基类默认实现，子类可覆写） ──

  protected buildWhereClause(): string {
    if (this._filters.length === 0) return "";
    const conditions = this._filters.map(f => QueryBuilderBase.toHCWhereCondition(f));
    return this._filters.length === 1
      ? ` where: ${conditions[0]}`
      : ` where: { and: [${conditions.join(", ")}] }`;
  }

  protected buildOrderClause(): string {
    if (this._sorts.length === 0) return "";
    const entries = this._sorts.map(s => `${s.field}: ${s.desc ? "DESC" : "ASC"}`);
    return ` order: { ${entries.join(" ")} }`;
  }

  /** 将 filter 对象序列化为 HC where 的 GraphQL 片段。 */
  protected static toHCWhereCondition(condition: object): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(condition)) {
      if (value === undefined) continue;
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        parts.push(`${key}: ${QueryBuilderBase.toHCWhereCondition(value as object)}`);
      } else if (Array.isArray(value)) {
        const items = value.map(v =>
          v !== null && typeof v === "object" ? QueryBuilderBase.toHCWhereCondition(v as object) : QueryBuilderBase.formatScalar(v),
        );
        parts.push(`${key}: [${items.join(", ")}]`);
      } else {
        parts.push(`${key}: ${QueryBuilderBase.formatScalar(value)}`);
      }
    }
    return `{ ${parts.join(", ")} }`;
  }

  protected static formatScalar(value: unknown): string {
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
      if (!isFinite(value)) {
        throw new Error(`QueryBuilder: unsupported filter value ${value}. NaN, Infinity, and -0 are not valid GraphQL values.`);
      }
      return String(value);
    }
    if (typeof value === "symbol") {
      throw new Error(`QueryBuilder: unsupported filter value type Symbol.`);
    }
    if (typeof value === "bigint") {
      throw new Error(`QueryBuilder: unsupported filter value type BigInt.`);
    }
    return String(value);
  }

  // ── GraphQL 编译器（基类默认实现，子类可选择性覆写） ──

  /** 默认分页查询编译。 */
  protected compileGraphQL(): string {
    const fields = this._fields.length > 0
      ? this._fields.join(" ")
      : this.defaultFields().join(" ");
    const whereClause = this.buildWhereClause();
    const orderClause = this.buildOrderClause();
    const afterClause = this._afterCursor ? `, after: "${this._afterCursor}"` : "";
    const pageInfo = this._cursorCache.size > 0 || this._afterCursor
      ? " pageInfo { endCursor hasNextPage }" : "";
    return `query { ${this.resolverField}(first: ${this._pageSize}${afterClause}${whereClause}${orderClause}) { totalCount nodes { ${fields} }${pageInfo} } }`;
  }

  // ── v1.0.7: 仅计数模式编译 ──

  /** 编译仅计数查询（不请求 nodes/pageInfo）。 */
  protected compileGraphQLCountMode(): string {
    const whereClause = this.buildWhereClause();
    return `query { ${this.resolverField}(first: 1${whereClause}) { totalCount } }`;
  }

  // ── v1.0.7: 聚合模式编译 ──

  /** 编译聚合查询。聚合 resolver 通常无分页参数，故不传 first。 */
  protected compileGraphQLAggregateMode(): string {
    const whereClause = this.buildWhereClause();
    const aggFields = this._aggregateFields;
    if (!aggFields) {
      throw new Error("QueryBuilder: aggregate() must be called before compiling aggregate query.");
    }
    const parts: string[] = [];
    if (aggFields.hasCount) parts.push("_count");
    if (aggFields.sumFields.length > 0) parts.push(`_sum { ${aggFields.sumFields.join(" ")} }`);
    if (aggFields.avgFields.length > 0) parts.push(`_avg { ${aggFields.avgFields.join(" ")} }`);
    if (aggFields.minFields.length > 0) parts.push(`_min { ${aggFields.minFields.join(" ")} }`);
    if (aggFields.maxFields.length > 0) parts.push(`_max { ${aggFields.maxFields.join(" ")} }`);
    const args = whereClause ? whereClause.trimStart() : "";
    return args
      ? `query { ${this.resolverField}_aggregate(${args}) { ${parts.join(" ")} } }`
      : `query { ${this.resolverField}_aggregate { ${parts.join(" ")} } }`;
  }

  protected createOrderByProxy(): TOrderByFields {
    return new Proxy({} as TOrderByFields, {
      get: (_t: any, prop: string | symbol) => {
        const field = typeof prop === "string" ? prop : "";
        const self: SortNode = { field, isDesc: false, asc: dummyAsc, desc: dummyDesc };
        return self;
      },
    });
  }

  /** v1.0.5: 元数据驱动的字段代理外壳（字段名 → gqlType 映射表）。 */
  protected createFieldsProxyFrom<T>(meta: Record<string, string>): T {
    const proxy = new Proxy({} as T, {
      get: (_t: any, prop: string | symbol) => {
        const fieldName = typeof prop === "string" ? prop : "";
        const gqlType = meta[fieldName];
        if (!gqlType) throw new Error(`Unknown field '${fieldName}'`);
        return createOperators(fieldName, gqlType, proxy);
      },
    });
    return proxy;
  }

  // ── 抽象成员（codegen 子类实现） ──

  protected abstract createFieldsProxy(): TFields;
  /** 未调用 select 时的默认字段列表（由子类实现，供 compileGraphQL 内部使用）。 */
  protected abstract defaultFields(): string[];
}