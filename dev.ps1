# 设置 PowerShell 编码为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 > $null

# 设置 Node.js 环境变量，确保使用 UTF-8
$env:NODE_OPTIONS = "--no-warnings"
$env:PYTHONIOENCODING = "utf-8"
# 关键：设置 Node.js 标准输出编码
$env:NODE_NO_WARNINGS = "1"

Write-Host "已设置 UTF-8 编码" -ForegroundColor Green
Write-Host "正在启动开发服务器..." -ForegroundColor Cyan

# 启动开发服务器
pnpm dev
