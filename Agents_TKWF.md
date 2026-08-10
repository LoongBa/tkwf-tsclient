# Agents_TKWF — tkwf-tsclient 开发规则

> 本仓库的**开发规则**。所有 Agent（AI）与人工开发者在本仓库内执行任何开发、文档、版本操作时，必须遵守本文件。

---

## 1. 仓库定位

TypeScript Domain 客户端 SDK，为 TKWF 框架提供 GraphQL/REST 双协议前端客户端。

- **上游框架**：https://github.com/LoongBa/TKW.Framework
- **npm 包名**：`@tkwf/tsclient`
- **发布地址**：https://www.npmjs.com/package/@tkwf/tsclient

## 2. 版本体系

- **语义化版本**：手动管理，`package.json` 中 `version` 字段 + `git tag` 确认。
- **标签前缀**：`v`（如 `v1.0.0`、`v1.0.1`）。

## 3. 迭代开发流程

1. 开发 → 测试（`npm test`）→ 构建（`npm run build`）→ 提交
2. **推送（push）但不打 tag** → **tag 和发布必须征求同意**（见 §4）
3. 发布流程：用户确认后 → `git tag v{version}` → `git push origin v{version}` → GitHub Actions 自动发布到 npm

### 提交纪律

- **不频繁提交**：每个逻辑单元（feature/fix/docs）完成后才提交，避免逐补丁高频提交。
- **提交语义完整**：同一主题的探索性/失败尝试改动应合并为单条有意义的提交，而非保留中间过程。
- **禁止提交调试噪音**：无关的临时修改、未验证的半成品不入提交。

## 4. Tag 与发布纪律

- **任何 `git tag` 操作（创建/推送）和 `npm publish` 必须事先征求用户同意**。tag = 版本发布确认（触发 npm publish）。
- 日常开发、迭代完成 → 只 `push` 提交，**不自动打 tag**。
- 用户明确同意后，使用 `v` 前缀（如 `v1.0.2`），版本号与 `package.json` 一致。
- 发布 workflow 由 tag 推送自动触发（`.github/workflows/publish.yml`），包含 Sigstore 签名（`--provenance`）。

## 5. CI 与测试

- CI：`npm ci` → `npm run build` → `npx vitest run`
- 发布前必须确保 160+ 测试全部通过
- 构建产物 `dist/` 由 CI 生成，不提交到仓库

## 6. 代码纪律

- 所有 `transport.execute()` 调用必须显式提供 `selection` 参数（GraphQL 子字段选择），避免 `Field must have a selection of subfields` 错误
- 禁止使用 `as any`、`@ts-ignore`、`@ts-expect-error` 绕过程序员检查
- 修改源文件后必须运行 `npm run build` 确保编译通过

## 7. 文档

- 仓库文档（README.md）随功能变更同步更新
- 不主动创建额外文档文件（除非被明确要求）