# 常读素材管理工具

一个基于 Electron 的桌面应用，用于管理短剧视频素材的上传和下载。

## 功能特点

- **素材上传**：扫描本地视频文件，批量上传到 TOS 存储，并提交到素材库
- **素材下载**：查询待下载任务，获取下载链接，真正下载视频文件到本地
- **自动轮询**：支持自动轮询上传和下载功能
- **配置管理**：支持达人配置、API 配置等管理功能
- **系统托盘**：支持最小化到系统托盘，后台运行

## 技术栈

- **前端**：Vue 3 + TypeScript + Naive UI + Pinia
- **桌面**：Electron 31
- **构建**：Vite + electron-vite
- **打包**：electron-builder

## 开发

### 环境要求

- Node.js >= 18
- pnpm >= 8

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

**Windows 用户注意**：如果遇到中文乱码问题，使用以下方式启动：

```powershell
# PowerShell
.\dev.ps1

# 或 CMD
dev.bat
```

### 构建

```bash
# 构建但不打包
pnpm build

# 构建并打包 Windows 版本
pnpm build:win

# 构建并打包 Mac 版本
pnpm build:mac
```

## 项目结构

```
changdu-material/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts            # 主进程入口
│   │   └── services/           # 主进程服务
│   │       ├── config.service.ts   # 配置管理
│   │       ├── file.service.ts     # 文件系统
│   │       ├── download.service.ts # 下载服务
│   │       └── api.service.ts      # API 代理
│   │
│   ├── preload/                 # 预加载脚本
│   │   └── index.ts            # IPC 通信桥接
│   │
│   └── renderer/                # 渲染进程 (Vue 应用)
│       └── src/
│           ├── views/          # 页面组件
│           ├── stores/         # Pinia 状态管理
│           ├── router/         # 路由配置
│           └── assets/         # 静态资源
│
├── resources/                   # 应用资源
├── build/                       # 构建资源
├── electron.vite.config.ts     # Electron Vite 配置
├── electron-builder.yml        # 打包配置
└── package.json
```

## 配置说明

### 达人配置

达人配置存储在应用数据目录下的 `daren-config.json` 文件中：

```json
{
  "darenList": [
    {
      "id": "用户ID",
      "label": "达人名称",
      "shortName": "简称",
      "douyinAccounts": ["抖音号1", "抖音号2"],
      "feishuDramaStatusTableId": "飞书状态表ID",
      "feishuDramaListTableId": "飞书清单表ID",
      "enableAutoUpload": true,
      "enableAutoDownload": true,
      "videoBasePath": "D:\\短剧剪辑\\"
    }
  ]
}
```

### API 配置

API 配置存储在应用数据目录下的 `api-config.json` 文件中：

```json
{
  "cookie": "常读平台 Cookie",
  "userId": "用户 ID",
  "distributorId": "分销商 ID",
  "feishuAppId": "飞书应用 App ID",
  "feishuAppSecret": "飞书应用 App Secret",
  "changduSecretKey": "API 签名密钥"
}
```

## 使用说明

### 管理员登录

1. 选择"管理员登录"模式
2. 输入管理员账号和密码
3. 登录后可以管理达人配置和 API 配置

### 达人登录

1. 选择"达人登录"模式
2. 从下拉列表中选择达人账号
3. 登录后可以进行素材上传和下载操作

### 素材上传

1. 选择日期
2. 点击"扫描视频"按钮
3. 点击"开始上传"按钮
4. 可开启"自动上传"进行轮询上传

### 素材下载

1. 点击"查询待下载"按钮
2. 设置保存路径
3. 点击"开始下载"按钮
4. 可开启"自动下载"进行轮询下载

## 常见问题

### Windows exFAT 文件系统安装失败

如果在 Windows 的 exFAT 磁盘上运行 `pnpm install` 遇到符号链接错误，项目已配置 `node-linker=hoisted` 解决此问题。如果仍有问题：

```powershell
# 设置环境变量
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

# 删除 node_modules 重装
Remove-Item -Recurse -Force node_modules
pnpm install

# 手动安装 Electron
node node_modules/electron/install.js
```

### Windows 控制台中文乱码

使用项目提供的启动脚本：

```powershell
# PowerShell
.\dev.ps1

# 或 CMD
dev.bat
```

或手动设置编码后再运行：

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001
pnpm dev
```

## License

MIT
