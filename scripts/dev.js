#!/usr/bin/env node

/**
 * 开发服务器启动脚本
 * 解决 Windows 控制台中文乱码问题
 */

const { spawn } = require('child_process');
const path = require('path');

// Windows 平台特殊处理
if (process.platform === 'win32') {
  // 设置控制台代码页为 UTF-8
  const chcp = spawn('chcp', ['65001'], { shell: true, stdio: 'inherit' });
  
  chcp.on('close', (code) => {
    console.log('✓ 已设置 UTF-8 编码');
    startDevServer();
  });
  
  chcp.on('error', () => {
    console.log('⚠ 无法设置编码，继续启动...');
    startDevServer();
  });
} else {
  startDevServer();
}

function startDevServer() {
  console.log('正在启动开发服务器...\n');
  
  // 启动 electron-vite
  const electronVite = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['electron-vite', 'dev'],
    {
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        // 设置 Node.js 相关环境变量
        NODE_OPTIONS: '--no-warnings',
        PYTHONIOENCODING: 'utf-8',
        FORCE_COLOR: '1',
      },
    }
  );

  electronVite.on('close', (code) => {
    process.exit(code || 0);
  });

  electronVite.on('error', (err) => {
    console.error('启动失败:', err);
    process.exit(1);
  });
}
