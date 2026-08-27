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

**完整闭环**（每轮迭代必须按此顺序执行，缺失任一环节视为未完成）：

1. **编写开发方案** → `docs/迭代开发过程/V{主版本}/v{version}-{feat}-开发方案.md`
2. **Oracle 审核方案** → 由 Sisyphus 发起 Oracle 审核，必修项（M#）必须全部纳入方案后修订，建议项（S#）评估后纳入或明确放弃
3. **实施编码** → 方案经审核通过后，按方案执行开发
4. **编写审核报告** → 开发完成 → Sisyphus 审查代码 → 编写 `docs/迭代开发过程/V{主版本}/v{version}-{feat}-审核报告.md`
5. **Oracle 审核代码** → 由 Sisyphus 发起 Oracle 审核实现代码（复杂设计/实现必做）
6. **根据审核建议调整** → Oracle 审核意见落地：必修项修订实现 + 更新审核报告；若调整涉及方案范围/设计决策变更 → 同步修订开发方案
7. **Sisyphus 亲自复审** → 对调整后的代码逐项复核（验证清单 + 全量测试 + 构建），更新审核报告结论
8. **测试 + 构建**（`npm test` → `npm run build`）→ **提交**
9. **推送（push）但不打 tag** → **tag 和发布必须征求同意**（见 §4）
10. 发布流程：用户确认后 → `git tag v{version}` → `git push origin v{version}` → GitHub Actions 自动发布到 npm

### 代码审查

- **默认**：由 Sisyphus 审查代码
- **复杂设计/实现**：必须经 Oracle 审核（环节 5）；由 Sisyphus 判断并发起
- **方案审核**：Oracle 审核开发方案（环节 2）；Momus 仅审核 `.sisyphus/plans/*.md` 的开发方案，**拒绝审查代码**
- **闭环原则**：Oracle 审核意见未落地前，不得进入提交环节；提交前 Sisyphus 必须亲自复审

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
- 发布前必须确保全量测试通过（当前 283 条，随迭代增长）
- 构建产物 `dist/` 由 CI 生成，不提交到仓库

## 6. 代码纪律

- 所有 `transport.execute()` 调用必须显式提供 `selection` 参数（GraphQL 子字段选择），避免 `Field must have a selection of subfields` 错误
- 禁止使用 `as any`、`@ts-ignore`、`@ts-expect-error` 绕过程序员检查
- 修改源文件后必须运行 `npm run build` 确保编译通过

## 7. 文档

- 仓库文档（README.md）随功能变更同步更新
- 迭代文档：
  - 开发方案：`v{version}-{feat}-开发方案.md`，存放于 `docs/迭代开发过程/V{主版本}/`
  - 审核报告：`v{version}-{feat}-审核报告.md`，存放于同一目录
- 开发方案必须在开发前编写并审核，审核报告在开发完成后审查代码时编写
- 审核报告随 Oracle 审核意见落地持续更新（必修项修订后需反映在报告中）
- 若代码调整涉及方案范围/设计决策变更 → 同步修订开发方案
- 不主动创建其他额外文档文件（除非被明确要求）