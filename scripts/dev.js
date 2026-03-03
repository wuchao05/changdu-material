#!/usr/bin/env node

/**
 * 开发服务器启动脚本
 * 解决 Windows 控制台中文乱码问题
 */

const { spawn } = require('child_process');
const path = require('path');

function startDevServer() {
  console.log('正在启动开发服务器...\n');

  const commonEnv = {
    ...process.env,
    // 设置 Node.js 相关环境变量
    NODE_OPTIONS: '--no-warnings',
    PYTHONIOENCODING: 'utf-8',
    FORCE_COLOR: '1',
  };

  // 启动 electron-vite
  // 注意：Windows 下使用 node 直接启动 electron-vite CLI，避免 pnpm 在控制台转码导致乱码。
  const electronVite =
    process.platform === 'win32'
      ? spawn(
          process.env.ComSpec || 'cmd.exe',
          [
            '/d',
            '/c',
            'chcp 65001>nul && node .\\node_modules\\electron-vite\\dist\\cli.mjs dev',
          ],
          {
            stdio: 'inherit',
            env: commonEnv,
          }
        )
      : spawn('node', [path.join('node_modules', 'electron-vite', 'dist', 'cli.mjs'), 'dev'], {
          stdio: 'inherit',
          env: commonEnv,
        });

  electronVite.on('close', (code) => {
    process.exit(code || 0);
  });

  electronVite.on('error', (err) => {
    console.error('启动失败:', err);
    process.exit(1);
  });
}

startDevServer();
