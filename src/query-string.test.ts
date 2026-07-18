import { describe, it, expect } from "vitest";
import { QueryString } from "./query-string";

// ---------------------------------------------------------------------------
// QueryString.composite
// ---------------------------------------------------------------------------
describe("QueryString.composite", () => {
  it("builds a simple query string", () => {
    const result = QueryString.composite({ page: 1, status: "active" });
    expect(result).toBe("?page=1&status=active");
  });

  it("omits null values", () => {
    const result = QueryString.composite({ page: 1, keyword: null });
    expect(result).toBe("?page=1");
  });

  it("omits undefined values", () => {
    const result = QueryString.composite({ a: 1, b: undefined });
    expect(result).toBe("?a=1");
  });

  it("omits empty string values", () => {
    const result = QueryString.composite({ a: 1, b: "" });
    expect(result).toBe("?a=1");
  });

  it("returns empty string for empty object", () => {
    expect(QueryString.composite({})).toBe("");
  });

  it("returns empty string when all values are null/undefined/empty", () => {
    expect(QueryString.composite({ a: null, b: undefined, c: "" })).toBe("");
  });

  it("converts booleans to strings", () => {
    const result = QueryString.composite({ active: true, archived: false });
    expect(result).toBe("?active=true&archived=false");
  });

  it("encodes special characters", () => {
    const result = QueryString.composite({ q: "hello world" });
    expect(result).toBe("?q=hello+world");
  });
});

// ---------------------------------------------------------------------------
// QueryString.parse
// ---------------------------------------------------------------------------
describe("QueryString.parse", () => {
  it("parses string fields from search string", () => {
    const result = QueryString.parse(
      { keyword: { type: String } },
      "?keyword=test",
    );
    expect(result.keyword).toBe("test");
  });

  it("parses number fields", () => {
    const result = QueryString.parse(
      { page: { type: Number, default: 1 } },
      "?page=3",
    );
    expect(result.page).toBe(3);
  });

  it("applies default when param is missing", () => {
    const result = QueryString.parse(
      { page: { type: Number, default: 1 } },
      "",
    );
    expect(result.page).toBe(1);
  });

  it("returns null when param is missing and no default", () => {
    const result = QueryString.parse(
      { keyword: { type: String } },
      "",
    );
    expect(result.keyword).toBeNull();
  });

  it("parses boolean fields (true)", () => {
    const result = QueryString.parse(
      { active: { type: Boolean, default: false } },
      "?active=true",
    );
    expect(result.active).toBe(true);
  });

  it("parses boolean fields (1)", () => {
    const result = QueryString.parse(
      { active: { type: Boolean, default: false } },
      "?active=1",
    );
    expect(result.active).toBe(true);
  });

  it("parses boolean fields (false)", () => {
    const result = QueryString.parse(
      { active: { type: Boolean, default: true } },
      "?active=false",
    );
    expect(result.active).toBe(false);
  });

  it("uses transform function when provided", () => {
    const result = QueryString.parse(
      {
        tags: {
          transform: (raw: string) => raw.split(",").map((s) => s.trim()),
        },
      },
      "?tags=a,b,c",
    );
    expect(result.tags).toEqual(["a", "b", "c"]);
  });

  it("handles mixed schema fields", () => {
    const result = QueryString.parse(
      {
        page: { type: Number, default: 1 },
        status: { type: String, default: "active" },
        keyword: { type: String },
      },
      "?page=2&status=inactive&keyword=hello",
    );
    expect(result).toEqual({
      page: 2,
      status: "inactive",
      keyword: "hello",
    });
  });

  it("handles search string without leading ?", () => {
    const result = QueryString.parse(
      { key: { type: String } },
      "key=value",
    );
    expect(result.key).toBe("value");
  });
});
