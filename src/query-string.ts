/**
 * QueryString Parser/Binder — auto-parse URL query string parameters
 * into typed variables for API calls, and push state back to URL.
 *
 * Inspired by the original C# framework's QueryString Parser/Binder pattern.
 */

export interface QueryStringFieldOptions<T = unknown> {
  /** Field type for parsing */
  type?: StringConstructor | NumberConstructor | BooleanConstructor;
  /** Default value if param is missing */
  default?: T;
  /** Transform the raw string value */
  transform?: (raw: string) => T;
}

export interface QueryStringSchema {
  [key: string]: QueryStringFieldOptions;
}

export type ParsedResult<T extends QueryStringSchema> = {
  [K in keyof T]: T[K] extends { type: NumberConstructor }
    ? number
    : T[K] extends { type: BooleanConstructor }
      ? boolean
      : T[K] extends { default: infer D }
        ? D
        : string | null;
};

export class QueryString {
  /**
   * Parse current URL query string into typed variables.
   *
   * ```typescript
   * const filters = QueryString.parse({
   *   page:   { type: Number, default: 1 },
   *   status: { type: String, default: "active" },
   *   keyword: { type: String },
   * });
   * // URL: ?page=2&status=inactive&keyword=test
   * // → { page: 2, status: "inactive", keyword: "test" }
   * ```
   */
  static parse<T extends QueryStringSchema>(
    schema: T,
    searchString?: string,
  ): ParsedResult<T> {
    const params = new URLSearchParams(
      searchString ?? (typeof window !== "undefined" ? window.location.search : ""),
    );

    const result: Record<string, unknown> = {};
    for (const [key, options] of Object.entries(schema)) {
      const raw = params.get(key);
      if (raw === null) {
        result[key] = options.default ?? null;
        continue;
      }
      if (options.transform) {
        result[key] = options.transform(raw);
        continue;
      }
      if (options.type === Number) {
        result[key] = Number(raw);
        continue;
      }
      if (options.type === Boolean) {
        result[key] = raw === "true" || raw === "1";
        continue;
      }
      result[key] = raw;
    }

    return result as ParsedResult<T>;
  }

  /**
   * Push state to URL without page reload.
   * Merges with existing query params.
   *
   * ```typescript
   * QueryString.push({ page: 3, status: "active" });
   * // URL updates to: ?page=3&status=active&keyword=test
   * ```
   */
  static push(values: Record<string, unknown>): void {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === undefined || value === "") {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    }
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }

  /**
   * Create a bound getter that reads from URL and pushes on change.
   * Useful for React state that syncs with URL.
   *
   * ```typescript
   * const [filters, setFilters] = useState(
   *   QueryString.parse({ page: { type: Number, default: 1 } })
   * );
   * // When filters change:
   * QueryString.bind(filters);
   * ```
   */
  static bind(values: Record<string, unknown>): void {
    QueryString.push(values);
  }

  /**
   * Build a query string from values without modifying the URL.
   * Returns the query string (with `?` prefix) for the caller to use freely.
   *
   * ```typescript
   * const url = QueryString.composite({ page: 3, status: "active" });
   * // → "?page=3&status=active"
   * // Caller decides: fetch(url), <a href={url}>, navigator.clipboard.writeText(url + location.origin)
   * ```
   */
  static composite(values: Record<string, unknown>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value !== null && value !== undefined && value !== "") {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }
}
