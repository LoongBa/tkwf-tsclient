import { describe, expect, it } from "vitest";
import { OAUTH_CALLBACK_FIELDS, QueryString, resolveOAuthCallback } from "./query-string";

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

// ---------------------------------------------------------------------------
// V1.0.12 OAuth 回调解析（OAUTH_CALLBACK_FIELDS 预设 + resolveOAuthCallback）
// ---------------------------------------------------------------------------
describe("resolveOAuthCallback", () => {
  it("正路径：code + state 均解析", () => {
    expect(resolveOAuthCallback("https://app.tld/cb?code=abc&state=csrf-xyz")).toEqual({
      code: "abc",
      state: "csrf-xyz",
    });
  });

  it("仅 code → 只返回 code", () => {
    expect(resolveOAuthCallback("https://app.tld/cb?code=abc")).toEqual({ code: "abc" });
  });

  it("无参数 → {}", () => {
    expect(resolveOAuthCallback("https://app.tld/cb")).toEqual({});
  });

  it("错误分支：error + error_description → error/errorDescription", () => {
    expect(resolveOAuthCallback("?error=access_denied&error_description=user_canceled")).toEqual({
      error: "access_denied",
      errorDescription: "user_canceled",
    });
  });

  it("无 code 无 error（仅非预设参数）→ {}", () => {
    expect(resolveOAuthCallback("https://app.tld/cb?foo=bar")).toEqual({});
  });

  it("malformed URL（不含 ? / 纯 search 无 ? 前缀）→ 不抛错返回 {}", () => {
    expect(() => resolveOAuthCallback("https://app.tld/cb")).not.toThrow();
    expect(() => resolveOAuthCallback("code=abc")).not.toThrow();
    expect(resolveOAuthCallback("code=abc")).toEqual({});
  });
});

describe("OAUTH_CALLBACK_FIELDS 预设", () => {
  it("可与 QueryString.parse 组合（缺失字段回落 null）", () => {
    const parsed = QueryString.parse(OAUTH_CALLBACK_FIELDS, "?code=x&error=y");
    expect(parsed).toEqual({
      code: "x",
      state: null,
      error: "y",
      error_description: null,
    });
  });
});
