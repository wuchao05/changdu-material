# AI 编码规则

## 代码提交

每次修改代码后，必须自动提交并推送到远程仓库：

```bash
git add -A && git commit -m "提交信息" && git push
```

## 技术栈

- Electron + Vue 3 + TypeScript
- Naive UI 组件库
- Playwright（浏览器自动化）
- 飞书 API

## 目录结构

- `src/main/` - Electron 主进程
  - `services/` - 业务服务
  - `index.ts` - 主入口
- `src/renderer/` - Vue 前端
  - `views/` - 页面组件
- `src/preload/` - 预加载脚本

## 关联项目

- `juliang-upload` - 巨量上传独立项目，可作为参考实现
