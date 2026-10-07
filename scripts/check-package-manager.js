#!/usr/bin/env node

/**
 * 安装前检查包管理器
 * 本项目依赖 pnpm-lock.yaml 和 .npmrc 中的 node-linker=hoisted，禁止使用 npm / yarn 安装
 */

const userAgent = process.env.npm_config_user_agent || '';

if (!userAgent.startsWith('pnpm/')) {
  const current = userAgent.split(' ')[0] || '未知';
  console.error(`\n本项目只能使用 pnpm 安装依赖（当前：${current}）`);
  console.error('请改用：pnpm install\n');
  process.exit(1);
}
