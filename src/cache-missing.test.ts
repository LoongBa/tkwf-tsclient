// V1.0.9: enableRpcCache 缺包引导错误测试（Oracle M4）
// 独立文件：顶层 vi.mock 模拟 @tanstack/query-core 加载失败（未安装场景），
// 验证 enableRpcCache() 抛引导错误而非静默降级。
// 独立文件的必要性与风险：整个测试文件中的 cache 模块 import 均使用此 mock，
// 因此本文件只测缺包路径，不测正常路径（正常路径在 cache.test.ts）。

import { describe, it, expect } from "vitest";
import { enableRpcCache } from "./cache";

vi.mock("@tanstack/query-core", () => {
  throw new Error("Cannot find module '@tanstack/query-core'");
});

describe("enableRpcCache — 缺包引导错误（M4）", () => {
  it("query-core 未安装时抛安装指引错误", async () => {
    await expect(enableRpcCache()).rejects.toThrow(
      'The "@tanstack/query-core" package is required for the RPC cache. Install it: npm install @tanstack/query-core',
    );
  });
});
