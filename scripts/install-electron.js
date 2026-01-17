#!/usr/bin/env node

/**
 * 手动安装 Electron 的脚本
 * 用于解决在某些文件系统（如 exFAT）上 Electron 安装失败的问题
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('正在检查 Electron 安装...');

const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
const electronPath = path.join(nodeModulesPath, 'electron');

try {
  // 检查 electron 目录是否存在
  if (!fs.existsSync(electronPath)) {
    console.error('❌ Electron 目录不存在');
    process.exit(1);
  }

  // 尝试安装 Electron
  console.log('正在安装 Electron...');
  execSync('node node_modules/electron/install.js', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/'
    }
  });

  console.log('✅ Electron 安装成功！');
} catch (error) {
  console.error('❌ Electron 安装失败:', error.message);
  console.log('\n请尝试手动执行以下命令：');
  console.log('  node node_modules/electron/install.js');
  process.exit(1);
}
