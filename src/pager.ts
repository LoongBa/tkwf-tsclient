import { QueryString } from "./query-string";

export interface PagerOptions {
  /** Current page number (1-based) */
  page: number;
  /** Items per page */
  pageSize: number;
  /** Total number of items */
  total: number;
  /** Base URL path. If provided, builds full paths (e.g. "/products?page=2"). */
  baseUrl?: string;
  /** Additional query params to carry through */
  extraParams?: Record<string, unknown>;
  /** Available page sizes (default: [10, 20, 50, 100]) */
  pageSizes?: number[];
}

export class Pager {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly pageSizes: number[];
  private baseUrl?: string;
  private extraParams: Record<string, unknown>;

  constructor(options: PagerOptions) {
    this.page = Math.max(1, options.page);
    this.pageSize = Math.max(1, options.pageSize);
    this.total = Math.max(0, options.total);
    this.totalPages = this.total > 0 ? Math.ceil(this.total / this.pageSize) : 1;
    this.pageSizes = options.pageSizes ?? [10, 20, 50, 100];
    this.baseUrl = options.baseUrl;
    this.extraParams = options.extraParams ?? {};
  }

  /** Is the current page the first page? */
  get isFirst(): boolean {
    return this.page <= 1;
  }

  /** Is the current page the last page? */
  get isLast(): boolean {
    return this.page >= this.totalPages;
  }

  /** URL for the first page */
  get firstPage(): string {
    return this.buildUrl(1);
  }

  /** URL for the previous page (null if on first page) */
  get prevPage(): string | null {
    return this.isFirst ? null : this.buildUrl(this.page - 1);
  }

  /** URL for the next page (null if on last page) */
  get nextPage(): string | null {
    return this.isLast ? null : this.buildUrl(this.page + 1);
  }

  /** URL for the last page */
  get lastPage(): string {
    return this.buildUrl(this.totalPages);
  }

  /** Page number list (for rendering page links, capped at 100 pages) */
  get pages(): number[] {
    const max = Math.min(this.totalPages, 100);
    return Array.from({ length: max }, (_, i) => i + 1);
  }

  /** Build URL for a specific page */
  goToPage(page: number): string {
    return this.buildUrl(Math.max(1, Math.min(page, this.totalPages)));
  }

  /** Build URL with a different page size (resets to page 1) */
  withPageSize(pageSize: number): string {
    const params: Record<string, unknown> = {
      ...this.extraParams,
      page: 1,
      pageSize,
    };
    const qs = QueryString.composite(params);
    return this.baseUrl ? `${this.baseUrl}${qs}` : qs;
  }

  private buildUrl(page: number): string {
    const params: Record<string, unknown> = {
      ...this.extraParams,
      page,
      pageSize: this.pageSize,
    };
    const qs = QueryString.composite(params);
    return this.baseUrl ? `${this.baseUrl}${qs}` : qs;
  }
}
