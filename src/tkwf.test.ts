import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Tkwf } from "./tkwf";

describe("Tkwf", () => {
  const DEFAULT = "default"; // Tkwf.User / Tkwf.Guest 固定访问 default 场景

  beforeEach(() => {
    Tkwf.reset(); // 清空所有已配置的场景，隔离测试
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 约束测试 ──

  it("throws on User access before configure()", () => {
    expect(() => Tkwf.User).toThrow(/not configured/i);
  });

  it("throws on Guest access before configure()", () => {
    expect(() => Tkwf.Guest).toThrow(/not configured/i);
  });

  it("throws on GetUser with unknown scenario before configure()", () => {
    expect(() => Tkwf.GetUser("unknown")).toThrow(/not configured/i);
  });

  it("throws on GetGuest with unknown scenario", () => {
    expect(() => Tkwf.GetGuest("unknown")).toThrow(/not configured/i);
  });

  // ── 基本功能 ──

  it("configure() stores the scenario and Guest returns successfully", () => {
    Tkwf.configure(DEFAULT, { endpoint: "/graphql" });

    const guest = Tkwf.Guest;
    expect(guest).toBeDefined();
    expect(guest.isAuthenticated).toBe(false);
    expect(guest.sessionKey).toBeNull();
  });

  it("User throws when no session in storage", () => {
    Tkwf.configure(DEFAULT, { endpoint: "/graphql" });

    // 没有预先设置 sessionKey，所以 GetUser() 应抛 AUTH_REQUIRED
    expect(() => Tkwf.User).toThrow();
  });

  it("User triggers onUnauthorized when no session", () => {
    const onUnauthorized = vi.fn();

    Tkwf.configure(DEFAULT, {
      endpoint: "/graphql",
      onUnauthorized,
    });

    expect(() => Tkwf.User).toThrow();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  // ── 多场景 ──

  it("GetGuest(scenario) works for multiple scenarios", () => {
    Tkwf.configure("scenario-a", { endpoint: "/graphql" });
    Tkwf.configure("scenario-b", { endpoint: "/graphql" });

    const guestA = Tkwf.GetGuest("scenario-a");
    const guestB = Tkwf.GetGuest("scenario-b");

    expect(guestA).toBeDefined();
    expect(guestB).toBeDefined();
    expect(guestA).not.toBe(guestB);
  });

  it("GetUser(scenario) throws for unknown scenario", () => {
    Tkwf.configure(DEFAULT, { endpoint: "/graphql" });

    expect(() => Tkwf.GetUser("nonexistent")).toThrow(/not configured/i);
  });

  it("multiple scenarios' onUnauthorized are isolated", () => {
    const onUnauthorizedA = vi.fn();
    const onUnauthorizedB = vi.fn();

    Tkwf.configure("scenario-a", {
      endpoint: "/graphql-a",
      onUnauthorized: onUnauthorizedA,
    });
    Tkwf.configure("scenario-b", {
      endpoint: "/graphql-b",
      onUnauthorized: onUnauthorizedB,
    });

    // Scenario A 无 session → 触发 A 的钩子（不触发 B）
    expect(() => Tkwf.GetUser("scenario-a")).toThrow();
    expect(onUnauthorizedA).toHaveBeenCalledOnce();
    expect(onUnauthorizedB).not.toHaveBeenCalled();
  });
});