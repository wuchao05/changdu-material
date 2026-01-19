@echo off
chcp 65001 >nul

REM 设置 Node.js 环境变量
set NODE_OPTIONS=--no-warnings
set PYTHONIOENCODING=utf-8
set NODE_NO_WARNINGS=1

echo 已设置 UTF-8 编码
echo 正在启动开发服务器...
pnpm dev
