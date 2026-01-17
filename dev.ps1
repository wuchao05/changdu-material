# 设置 PowerShell 编码为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 > $null

Write-Host "已设置 UTF-8 编码" -ForegroundColor Green
Write-Host "正在启动开发服务器..." -ForegroundColor Cyan

# 启动开发服务器
pnpm dev
