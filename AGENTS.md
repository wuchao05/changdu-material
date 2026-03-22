# AGENTS Guide

本文件是仓库内唯一保留的代理工作说明；原 `CLAUDE.md` 已合并到这里。
如果运行时的 system / developer / user 指令与本文冲突，以更高优先级指令为准。

## 项目概览

- 这是一个 Electron 31 桌面应用，不是普通 Web 项目。
- 技术栈以 `electron-vite`、Vue 3、TypeScript、Pinia、Naive UI 为主。
- 代码分成三个边界：`src/main/` 主进程、`src/preload/` IPC 桥、`src/renderer/src/` 渲染进程。
- 打包由 `electron-builder` 负责，配置在 `electron-builder.yml`。
- 根目录存在 `dist/`、`out/` 等构建产物，除非构建流程要求，否则不要手动编辑。

## 目录约定

- `src/main/index.ts` 是 Electron 主入口，负责窗口、托盘、快捷键、IPC 注册和服务初始化。
- `src/main/services/` 放文件系统、下载、配置、TOS、巨量、搭建等核心业务服务。
- `src/preload/index.ts` 用 `contextBridge` 暴露 `window.api`，这里是主进程能力给渲染层的唯一正式入口。
- `src/renderer/src/views/` 放页面级 Vue SFC；`stores/` 放 Pinia store；`router/` 放路由。
- `scripts/` 放开发辅助脚本，当前包括 `dev.js` 和 `install-electron.js`。
- `build/` 和 `resources/` 是构建资源目录，不要随意移动文件名或目录结构。

## 环境与安装

- 包管理器使用 `pnpm`，锁文件以 `pnpm-lock.yaml` 为准。
- README 写的是 Node >= 18，但当前依赖组合更适合 Node 20+；优先使用较新的 LTS。
- `.npmrc` 启用了 `node-linker=hoisted` 与 Electron 镜像，不要随意改回默认 linker。
- 初次安装用 `pnpm install`。
- 如果 Electron 依赖损坏，可运行 `pnpm run install:electron` 重新补装。

## 常用命令

### 开发

- `pnpm dev`：启动 Electron 开发环境，实际执行 `node scripts/dev.js`。
- `node scripts/dev.js`：和 `pnpm dev` 等价；Windows 下专门处理控制台中文乱码。

### 质量检查

- `pnpm lint`：运行 ESLint，并带 `--fix` 自动修复可修复问题。
- `pnpm type-check`：运行 `vue-tsc --noEmit`。
- 当前仓库没有独立的 `format` 脚本；不要在文档里假设存在 `pnpm format`。

### 构建与打包

- `pnpm build`：执行 `electron-vite build`。
- `pnpm build:unpack`：先 `build`，再生成 unpacked 包。
- `pnpm build:win`：构建 Windows 安装包。
- `pnpm build:mac`：构建 macOS 安装包。
- `pnpm build:linux`：构建 Linux 安装包。

### 测试

- 当前没有 `pnpm test`、`vitest`、`jest`、`playwright test` 等自动化测试命令。
- 仓库里也没有 `*.test.*` 或 `*.spec.*` 文件。
- 因此“运行单个测试”目前没有对应命令，不要臆造单测脚本。
- 当前最小验证闭环通常是：`pnpm lint` + `pnpm type-check` + 按需 `pnpm build`。
- 涉及 UI / IPC / 文件系统流程时，还应实际启动 `pnpm dev` 做人工验证。

## 修改前先判断边界

- 涉及文件系统、下载、配置落盘、托盘、窗口控制、外部 API、Playwright / 巨量逻辑时，优先看 `src/main/`。
- 涉及前端页面、表单、表格、筛选、路由、权限显示时，优先看 `src/renderer/src/`。
- 渲染层需要新能力时，先改 `src/preload/index.ts` 暴露桥接，再接入 `src/main/index.ts` 的 IPC handler。
- 不要在渲染层直接引入 Node API；这类能力应通过 preload + IPC 暴露。

## 代码风格：总体判断

- 这个仓库不是完全统一风格，属于“有约定但存在混合格式”的状态。
- `src/main/` 与 `src/preload/` 很多文件使用双引号和分号。
- `src/renderer/src/stores/`、`router/`、部分 service 文件使用单引号且通常不写分号。
- 修改现有文件时，优先跟随该文件已有风格，不要顺手重排整个文件。
- 新文件优先沿用同目录多数文件的写法，而不是强行全仓统一。

## 导入与模块规范

- 导入顺序通常是：第三方依赖 -> 本地模块 -> 类型导入 / 样式导入，尽量贴近现有文件。
- 纯类型请使用 `import type`，例如路由和 service 类型导入已有示例。
- 渲染层常见相对路径导入，如 `../stores/auth`；主进程也主要用相对路径。
- 只有在配置中定义过 alias 的位置才使用 alias：`@main`、`@preload`、`@`、`@renderer`。
- 不要为了“更现代”而批量改成另一套 import 风格。

## TypeScript 规范

- `tsconfig.json` 开启了 `strict: true`，默认按严格模式写代码。
- 新增接口、返回结构、IPC 参数时，要补清晰类型，不要偷懒写宽泛对象。
- 不要使用 `as any`、`@ts-ignore`、`@ts-expect-error` 来压过类型问题。
- `catch` 参数优先写成 `unknown`，需要时再缩小类型。
- 共享数据结构尽量复用已有 interface，而不是在不同层重复发明近似类型。
- 涉及持久化配置、API 返回值、进度对象时，优先定义显式接口。

## Vue / Pinia 约定

- Vue 组件以 `<script setup lang="ts">` 为主。
- 页面文件放在 `views/`，文件名使用 `PascalCase`，如 `Upload.vue`、`UploadBuild.vue`。
- Store 使用 `defineStore`，命名采用 `useXStore`，例如 `useAuthStore`、`useDarenStore`。
- Store 内部常见模式是 `ref` + `computed` + 函数式 action。
- 需要缓存到浏览器端时，现有代码大量使用 `localStorage`；改动时要注意 key 名兼容。
- Naive UI 组件通常按需导入；保留现有页面的引入风格即可。

## Electron / IPC 约定

- 新增渲染层能力时，通常要同时更新 `src/preload/index.ts` 和 `src/main/index.ts`。
- IPC channel 命名已形成分组模式：`config:*`、`file:*`、`download:*`、`api:*`、`tos:*`、`juliang:*`、`daily-build:*`。
- 新 channel 尽量延续现有前缀，不要创建风格割裂的命名。
- preload 中返回取消监听函数是现有模式；订阅型事件接口尽量延续这种写法。
- `window.api` 是渲染层的公共契约，改动时要同时考虑调用方和类型声明。

## 错误处理与日志

- 网络、文件、IPC、配置读写通常包在 `try/catch` 中，并带上下文日志。
- 现有代码常用 `console.error('[Service] ...', error)` 或中文错误前缀，请保持可定位性。
- 业务失败常见两种模式：抛出 `Error`，或返回 `{ success: false, error }` 结构；沿用调用链已在用的那一套。
- 不要吞掉真正的业务异常；只有清理型逻辑才可以做 best-effort 处理。
- 对用户可见的失败，渲染层通常还会配合 `message.error` / `message.warning`。
- 如果只是记录失败并继续运行，要说明为什么允许继续，而不是静默忽略。

## 命名与实现细节

- 领域对象大量使用拼音/业务词，如 `daren`、`juliang`、`changdu`，不要擅自“英文化重命名”。
- 布尔量常用 `is*`、`can*`、`enable*`、`has*`。
- 进度和状态值偏好字符串联合类型，例如 `'pending' | 'uploading' | 'success' | 'error'`。
- 文件和目录处理逻辑很多，改动时要同时考虑 Windows 路径分隔符兼容。
- 当代码已经针对 Windows 编码或路径问题做兼容时，不要删掉这些看似啰嗦的保护逻辑。

## 编辑策略

- 只改完成任务所需的最小范围，不要把风格清理、重命名、重排 import 和业务修改混在一起。
- 不要手动编辑构建输出、安装产物或缓存目录。
- 如果某文件原本使用分号和双引号，就继续保持；如果原本是单引号无分号，也保持。
- 面对超大文件（例如部分 view / service）时，优先做局部补丁，避免全文件格式化。

## 验证策略

- 文档、配置类小改动至少检查命令名和路径是否真实存在。
- 代码改动默认先跑 `pnpm lint` 与 `pnpm type-check`。
- 涉及构建链路、打包配置、Electron 入口时，再补 `pnpm build`。
- 涉及页面交互、IPC、下载、上传、目录扫描、配置同步等流程时，要实际运行 `pnpm dev` 做手工验证。
- 当前没有单测体系，所以请在交付说明里明确你做了哪些人工验证。

## 代理规则整合情况

- 本仓库当前未发现 `.cursorrules`、`.cursor/rules/` 或 `.github/copilot-instructions.md`。
- 因此仓库级代理规则以本文件为准。
- 之前存在的 `CLAUDE.md` 已删除，避免规则重复和冲突。

## Communication

- 使用中文回复。

## Workflow

- 以下工作流来自仓库维护者要求；若与当前运行环境的更高优先级指令冲突，以更高优先级指令为准。
- **始终在 master 分支上进行代码修改**：所有代码变更必须直接在 master 分支上完成，不使用功能分支（除非用户明确要求）。
- **自动提交并推送**：每次修改代码后自动提交并推送到远程 master 分支；只有当用户明确说明需要 review 代码时，才不自动提交和推送。
- **工作流程**：
  1. 确认当前在 master 分支（`git branch --show-current`）
  2. 进行代码修改
  3. 运行 lint 和 type-check
  4. 提交代码到 master 分支
  5. 立即推送到远程：`git push origin master`
