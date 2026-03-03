#!/usr/bin/env node

/**
 * 开发服务器启动脚本
 * 解决 Windows 控制台中文乱码问题
 */

const { spawn } = require('child_process');

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
  // 注意：Windows 下必须在同一个 cmd 进程内执行 chcp 和 dev 命令，
  // 否则 chcp 不会影响后续子进程，中文日志仍可能乱码。
  const electronVite =
    process.platform === 'win32'
      ? spawn(
          process.env.ComSpec || 'cmd.exe',
          ['/d', '/s', '/c', 'chcp 65001>nul && pnpm electron-vite dev'],
          {
            stdio: 'inherit',
            env: commonEnv,
          }
        )
      : spawn('pnpm', ['electron-vite', 'dev'], {
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
