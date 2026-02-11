// Windows 控制台编码修复：在所有导入之前设置
if (process.platform === 'win32') {
  // 方法1：强制 stdout 和 stderr 使用 UTF-8 编码
  if (process.stdout && typeof process.stdout.setDefaultEncoding === 'function') {
    process.stdout.setDefaultEncoding('utf8');
  }
  if (process.stderr && typeof process.stderr.setDefaultEncoding === 'function') {
    process.stderr.setDefaultEncoding('utf8');
  }

  // 方法2：重写 console.log 以确保使用 UTF-8（带错误处理）
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  // 安全写入函数，捕获 EPIPE 错误
  const safeWrite = (stream: NodeJS.WriteStream, message: string) => {
    try {
      if (stream && stream.writable && !stream.destroyed) {
        stream.write(message + '\n', 'utf8');
      }
    } catch {
      // 忽略 EPIPE 等写入错误
    }
  };

  console.log = function (...args) {
    const message = args
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2)))
      .join(' ');
    safeWrite(process.stdout, message);
  };

  console.error = function (...args) {
    const message = args
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2)))
      .join(' ');
    safeWrite(process.stderr, message);
  };

  console.warn = function (...args) {
    const message = args
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2)))
      .join(' ');
    safeWrite(process.stderr, message);
  };
}

import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
} from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';

// 扩展 Electron App 类型以支持 isQuitting 属性
declare module 'electron' {
  interface App {
    isQuitting?: boolean;
  }
}

// Windows 网络优化：禁用代理，避免代理检测导致的延迟
app.commandLine.appendSwitch('no-proxy-server');
// 禁用自动代理检测
app.commandLine.appendSwitch('winhttp-proxy-resolver');

// 服务导入
import { ConfigService } from './services/config.service';
import { FileService } from './services/file.service';
import { DownloadService } from './services/download.service';
import { ApiService } from './services/api.service';
import { TosService } from './services/tos.service';
import { juliangService } from './services/juliang.service';
import { getJuliangScheduler } from './services/juliang-scheduler.service';

// 初始化服务
const configService = new ConfigService();
const fileService = new FileService();
const downloadService = new DownloadService();
const apiService = new ApiService();
const tosService = new TosService();
const juliangScheduler = getJuliangScheduler(apiService, fileService, configService);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: '常读素材管理工具',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
    // 开发模式下自动打开 DevTools
    if (is.dev) {
      mainWindow?.webContents.openDevTools();
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // 关闭窗口时最小化到托盘
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function createTray(): void {
  // 创建托盘图标
  const iconPath = join(__dirname, '../../resources/icon.png');
  let icon: Electron.NativeImage;

  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // 如果图标不存在，创建一个简单的图标
      icon = nativeImage.createEmpty();
    }
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        mainWindow?.show();
      },
    },
    {
      label: '开发者工具',
      click: () => {
        mainWindow?.webContents.toggleDevTools();
      },
    },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('常读素材管理工具');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow?.show();
  });
}

// 注册 IPC 处理程序
function registerIpcHandlers(): void {
  // ==================== 窗口控制 ====================
  ipcMain.handle('window:hide', async () => {
    mainWindow?.hide();
    return { success: true };
  });

  ipcMain.handle('window:show', async () => {
    mainWindow?.show();
    return { success: true };
  });

  ipcMain.handle('window:minimize', async () => {
    mainWindow?.minimize();
    return { success: true };
  });

  // ==================== 配置管理 ====================
  ipcMain.handle('config:getDaren', async () => {
    return await configService.getDarenConfig();
  });

  ipcMain.handle('config:addDaren', async (_event, daren) => {
    return await configService.addDaren(daren);
  });

  ipcMain.handle('config:updateDaren', async (_event, id, updates) => {
    return await configService.updateDaren(id, updates);
  });

  ipcMain.handle('config:deleteDaren', async (_event, id) => {
    return await configService.deleteDaren(id);
  });

  ipcMain.handle('config:getApiConfig', async () => {
    return await configService.getApiConfig();
  });

  ipcMain.handle('config:saveApiConfig', async (_event, config) => {
    return await configService.saveApiConfig(config);
  });

  // 远程配置同步
  ipcMain.handle('config:syncFromRemote', async () => {
    return await configService.syncFromRemote();
  });

  ipcMain.handle('config:pushToRemote', async () => {
    return await configService.pushToRemote();
  });

  // ==================== 文件系统 ====================
  ipcMain.handle('file:scanVideos', async (_event, basePath) => {
    return await fileService.scanVideos(basePath);
  });

  ipcMain.handle('file:getVideoInfo', async (_event, filePath) => {
    return await fileService.getVideoInfo(filePath);
  });

  ipcMain.handle('file:deleteFolder', async (_event, folderPath) => {
    return await fileService.deleteFolder(folderPath);
  });

  ipcMain.handle('file:countMp4Files', async (_event, dirPath) => {
    return fileService.countMp4Files(dirPath);
  });

  ipcMain.handle('file:checkZipFile', async (_event, zipPath) => {
    return fileService.checkZipFile(zipPath);
  });

  ipcMain.handle('file:selectFolder', async () => {
    const { dialog } = await import('electron');
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('file:extractZip', async (_event, zipPath, targetDir, deleteAfterExtract) => {
    return await fileService.extractZip(zipPath, targetDir, deleteAfterExtract);
  });

  // ==================== 下载 ====================
  ipcMain.handle('download:video', async (event, url, savePath, dramaName) => {
    try {
      return await downloadService.downloadFile(url, savePath, dramaName, (progress) => {
        event.sender.send('download:progress', progress);
      });
    } catch (error) {
      // 确保错误能正确传递到渲染进程
      console.error('[IPC] download:video 错误:', error);
      // 返回一个包含错误信息的对象，而不是抛出异常
      return {
        success: false,
        filePath: savePath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('download:cancel', async (_event, dramaName) => {
    return downloadService.cancelDownload(dramaName);
  });

  ipcMain.handle('download:pause', async (_event, dramaName) => {
    return downloadService.pauseDownload(dramaName);
  });

  ipcMain.handle('download:resume', async (event, dramaName) => {
    try {
      return await downloadService.resumeDownload(dramaName, (progress) => {
        event.sender.send('download:progress', progress);
      });
    } catch (error) {
      // 确保错误能正确传递到渲染进程
      console.error('[IPC] download:resume 错误:', error);
      return {
        success: false,
        filePath: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('download:isPaused', async (_event, dramaName) => {
    return downloadService.isPaused(dramaName);
  });

  ipcMain.handle('download:getState', async (_event, dramaName) => {
    return downloadService.getDownloadState(dramaName);
  });

  // ==================== API 代理 ====================
  ipcMain.handle('api:feishu', async (_event, endpoint, data, method = 'POST') => {
    return await apiService.feishuRequest(endpoint, data, method, configService);
  });

  ipcMain.handle('api:feishuPendingUpload', async (_event, tableId?: string) => {
    return await apiService.getPendingUploadDramas(configService, tableId);
  });

  ipcMain.handle(
    'api:feishuPendingUploadByDate',
    async (_event, tableId: string | undefined, dateTimestamp: number) => {
      return await apiService.getPendingUploadDramasByDate(configService, tableId, dateTimestamp);
    },
  );

  ipcMain.handle('api:changdu', async (_event, endpoint, params, headers, configType) => {
    return await apiService.changduRequest(
      endpoint,
      params,
      headers,
      configService,
      configType || 'sanrou', // 默认使用散柔配置
    );
  });

  ipcMain.handle('api:upload', async (event, filePath, options) => {
    return await apiService.uploadToTos(filePath, options, configService, (progress) => {
      event.sender.send('upload:progress', progress);
    });
  });

  ipcMain.handle('api:submitMaterial', async (_event, materials) => {
    return await apiService.submitToMaterialLibrary(materials, configService);
  });

  // ==================== TOS 上传 ====================
  ipcMain.handle('tos:uploadFile', async (event, filePath) => {
    return await tosService.uploadFile(filePath, configService, (progress) => {
      event.sender.send('tos:uploadProgress', progress);
    });
  });

  ipcMain.handle('tos:uploadBatch', async (event, filePaths, maxConcurrent = 5) => {
    return new Promise<void>((resolve) => {
      tosService
        .uploadBatch(
          filePaths,
          configService,
          maxConcurrent,
          (fileName, progress) => {
            event.sender.send('tos:uploadProgress', {
              fileName,
              ...progress,
            });
          },
          (fileName, result) => {
            event.sender.send('tos:uploadComplete', { fileName, ...result });
          },
        )
        .then(() => {
          resolve();
        });
    });
  });

  ipcMain.handle('tos:cancelUpload', async (_event, fileName) => {
    return tosService.cancelUpload(fileName);
  });

  ipcMain.handle('tos:cancelAllUploads', async () => {
    tosService.cancelAllUploads();
  });

  ipcMain.handle('tos:getQueueStatus', async () => {
    return tosService.getQueueStatus();
  });

  ipcMain.handle('tos:initClient', async () => {
    await tosService.initTosClient(configService, true);
    return { success: true };
  });

  // ==================== 巨量上传 ====================
  ipcMain.handle('juliang:initialize', async () => {
    // 设置主窗口引用
    if (mainWindow) {
      juliangService.setMainWindow(mainWindow);
    }
    return await juliangService.initialize();
  });

  ipcMain.handle('juliang:close', async () => {
    await juliangService.close();
    return { success: true };
  });

  ipcMain.handle('juliang:isReady', async () => {
    return juliangService.isReady();
  });

  ipcMain.handle('juliang:navigate', async (_event, accountId) => {
    return await juliangService.navigateToUploadPage(accountId);
  });

  ipcMain.handle('juliang:checkLogin', async () => {
    return await juliangService.checkLoginStatus();
  });

  ipcMain.handle('juliang:uploadTask', async (_event, task) => {
    return await juliangService.uploadTask(task);
  });

  ipcMain.handle('juliang:getConfig', async () => {
    return juliangService.getConfig();
  });

  ipcMain.handle('juliang:updateConfig', async (_event, config) => {
    juliangService.updateConfig(config);
    return { success: true };
  });

  ipcMain.handle('juliang:getScreenshot', async () => {
    const buffer = await juliangService.getScreenshot();
    return buffer ? buffer.toString('base64') : null;
  });

  ipcMain.handle('juliang:getLogs', async () => {
    return juliangService.getLogs();
  });

  ipcMain.handle('juliang:clearLogs', async () => {
    juliangService.clearLogs();
    return { success: true };
  });

  // ==================== 巨量调度器 ====================
  ipcMain.handle('juliang:scheduler:start', async () => {
    if (mainWindow) {
      juliangScheduler.setMainWindow(mainWindow);
    }
    return await juliangScheduler.start();
  });

  ipcMain.handle('juliang:scheduler:stop', async () => {
    await juliangScheduler.stop();
    return { success: true };
  });

  ipcMain.handle('juliang:scheduler:getStatus', async () => {
    return {
      status: juliangScheduler.getStatus(),
      stats: juliangScheduler.getQueueStats(),
    };
  });

  ipcMain.handle('juliang:scheduler:getConfig', async () => {
    return juliangScheduler.getConfig();
  });

  ipcMain.handle('juliang:scheduler:updateConfig', async (_event, config) => {
    juliangScheduler.updateConfig(config);
    return { success: true };
  });

  ipcMain.handle('juliang:scheduler:getLogs', async () => {
    return juliangScheduler.getLogs();
  });

  ipcMain.handle('juliang:scheduler:clearLogs', async () => {
    juliangScheduler.clearLogs();
    return { success: true };
  });

  // ==================== 应用控制 ====================
  ipcMain.handle('app:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('app:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle('app:close', () => {
    mainWindow?.hide();
  });

  ipcMain.handle('app:quit', () => {
    app.isQuitting = true;
    app.quit();
  });

  ipcMain.handle('app:openExternal', async (_event, url) => {
    await shell.openExternal(url);
  });

  ipcMain.handle('app:showInFolder', async (_event, path) => {
    shell.showItemInFolder(path);
  });
}

// 扩展 app 类型
declare module 'electron' {
  interface App {
    isQuitting: boolean;
  }
}

app.isQuitting = false;

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.guazai.changdu-material');

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 注册 IPC 处理程序
  registerIpcHandlers();

  createWindow();
  createTray();

  // 全局快捷键：F12 打开开发者工具（用于调试打包后的应用）
  globalShortcut.register('F12', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.webContents.toggleDevTools();
    }
  });

  // Ctrl+Shift+I 也打开开发者工具
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.webContents.toggleDevTools();
    }
  });

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 在退出前清理
app.on('before-quit', () => {
  app.isQuitting = true;
});
