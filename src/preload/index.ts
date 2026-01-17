import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

// 定义进度类型
interface DownloadProgress {
  dramaName: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: string;
  speed?: number;
}

interface UploadProgress {
  fileName: string;
  uploadedBytes: number;
  totalBytes: number;
  percent: string;
}

// TOS 上传进度类型
interface TosUploadProgress {
  fileName: string;
  percent: number;
  uploadedBytes: number;
  totalBytes: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
}

// TOS 上传结果类型
interface TosUploadResult {
  success: boolean;
  fileName: string;
  url?: string;
  error?: string;
}

// Custom APIs for renderer
const api = {
  // ==================== 配置管理 ====================
  getDarenConfig: () => ipcRenderer.invoke("config:getDaren"),
  addDaren: (daren: unknown) => ipcRenderer.invoke("config:addDaren", daren),
  updateDaren: (id: string, updates: unknown) =>
    ipcRenderer.invoke("config:updateDaren", id, updates),
  deleteDaren: (id: string) => ipcRenderer.invoke("config:deleteDaren", id),
  getApiConfig: () => ipcRenderer.invoke("config:getApiConfig"),
  saveApiConfig: (config: unknown) =>
    ipcRenderer.invoke("config:saveApiConfig", config),

  // 远程配置同步
  syncRemoteConfig: () => ipcRenderer.invoke("config:syncFromRemote"),
  pushRemoteConfig: () => ipcRenderer.invoke("config:pushToRemote"),

  // ==================== 文件系统 ====================
  scanVideos: (basePath: string) =>
    ipcRenderer.invoke("file:scanVideos", basePath),
  getVideoInfo: (filePath: string) =>
    ipcRenderer.invoke("file:getVideoInfo", filePath),
  deleteFolder: (folderPath: string) =>
    ipcRenderer.invoke("file:deleteFolder", folderPath),
  selectFolder: () => ipcRenderer.invoke("file:selectFolder"),
  extractZip: (
    zipPath: string,
    targetDir?: string,
    deleteAfterExtract?: boolean
  ) =>
    ipcRenderer.invoke(
      "file:extractZip",
      zipPath,
      targetDir,
      deleteAfterExtract
    ),

  // ==================== 下载 ====================
  downloadVideo: (url: string, savePath: string, dramaName: string) =>
    ipcRenderer.invoke("download:video", url, savePath, dramaName),
  cancelDownload: (dramaName: string) =>
    ipcRenderer.invoke("download:cancel", dramaName),
  pauseDownload: (dramaName: string) =>
    ipcRenderer.invoke("download:pause", dramaName),
  resumeDownload: (dramaName: string) =>
    ipcRenderer.invoke("download:resume", dramaName),
  isDownloadPaused: (dramaName: string) =>
    ipcRenderer.invoke("download:isPaused", dramaName),
  getDownloadState: (dramaName: string) =>
    ipcRenderer.invoke("download:getState", dramaName),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: DownloadProgress
    ) => callback(progress);
    ipcRenderer.on("download:progress", handler);
    return () => ipcRenderer.removeListener("download:progress", handler);
  },

  // ==================== API 代理 ====================
  feishuRequest: (endpoint: string, data: unknown, method?: string) =>
    ipcRenderer.invoke("api:feishu", endpoint, data, method),
  feishuGetPendingUpload: (tableId?: string) =>
    ipcRenderer.invoke("api:feishuPendingUpload", tableId),
  feishuGetPendingUploadByDate: (tableId: string | undefined, dateTimestamp: number) =>
    ipcRenderer.invoke("api:feishuPendingUploadByDate", tableId, dateTimestamp),
  changduRequest: (endpoint: string, params: unknown, headers?: unknown) =>
    ipcRenderer.invoke("api:changdu", endpoint, params, headers),
  uploadToTos: (filePath: string, options: unknown) =>
    ipcRenderer.invoke("api:upload", filePath, options),
  submitMaterial: (materials: unknown) =>
    ipcRenderer.invoke("api:submitMaterial", materials),
  onUploadProgress: (callback: (progress: UploadProgress) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: UploadProgress
    ) => callback(progress);
    ipcRenderer.on("upload:progress", handler);
    return () => ipcRenderer.removeListener("upload:progress", handler);
  },

  // ==================== TOS 上传 ====================
  tosUploadFile: (filePath: string) =>
    ipcRenderer.invoke("tos:uploadFile", filePath),
  tosUploadBatch: (filePaths: string[], maxConcurrent?: number) =>
    ipcRenderer.invoke("tos:uploadBatch", filePaths, maxConcurrent),
  tosCancelUpload: (fileName: string) =>
    ipcRenderer.invoke("tos:cancelUpload", fileName),
  tosCancelAllUploads: () => ipcRenderer.invoke("tos:cancelAllUploads"),
  tosGetQueueStatus: () => ipcRenderer.invoke("tos:getQueueStatus"),
  tosInitClient: () => ipcRenderer.invoke("tos:initClient"),
  onTosUploadProgress: (callback: (progress: TosUploadProgress) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: TosUploadProgress
    ) => callback(progress);
    ipcRenderer.on("tos:uploadProgress", handler);
    return () => ipcRenderer.removeListener("tos:uploadProgress", handler);
  },
  onTosUploadComplete: (callback: (result: TosUploadResult) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      result: TosUploadResult
    ) => callback(result);
    ipcRenderer.on("tos:uploadComplete", handler);
    return () => ipcRenderer.removeListener("tos:uploadComplete", handler);
  },

  // ==================== 应用控制 ====================
  minimize: () => ipcRenderer.invoke("app:minimize"),
  maximize: () => ipcRenderer.invoke("app:maximize"),
  close: () => ipcRenderer.invoke("app:close"),
  quit: () => ipcRenderer.invoke("app:quit"),
  openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  showInFolder: (path: string) => ipcRenderer.invoke("app:showInFolder", path),
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
