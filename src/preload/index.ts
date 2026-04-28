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

interface ExtractQueueStatus {
  taskId?: string;
  dramaName?: string;
  status: "queued" | "extracting" | "completed" | "failed";
  queueLength: number;
  activeCount: number;
  error?: string;
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

interface MaterialClipLog {
  time: string;
  message: string;
}

interface MaterialClipEnvironmentStatus {
  ready: boolean;
  installSupported: boolean;
  platform: NodeJS.Platform;
  processorRoot: string | null;
  pythonCommand: string | null;
  activeUser: string | null;
  runtimeSource: "managed" | "dev-fallback" | "missing";
  checks: Array<{
    key: string;
    label: string;
    passed: boolean;
    detail: string;
  }>;
  error?: string;
}

interface MaterialClipInstallResult {
  success: boolean;
  error?: string;
}

interface MaterialClipRuntimeImportResult {
  success: boolean;
  error?: string;
  runtimeRoot?: string;
}

interface MaterialClipPendingDrama {
  order: number;
  dramaName: string;
  recordId: string;
  date: string;
  fullDate: string | null;
  rating: string | null;
  uploadTime: number | null;
  plannedMaterials: number | null;
  highlightStartPoints: string | null;
}

interface MaterialClipProcessedDrama {
  order: number;
  dramaName: string;
  recordId: string;
  date: string;
  fullDate: string | null;
  rating: string | null;
  plannedMaterials: number | null;
  completedMaterials: number;
  completedAt: string;
  elapsedSeconds: number | null;
}

interface MaterialClipRunState {
  running: boolean;
  mode: "idle" | "auto" | "manual";
  status: "idle" | "running" | "stopping" | "stopped" | "completed" | "failed";
  pid: number | null;
  pendingDramas: MaterialClipPendingDrama[];
  processedDramas: MaterialClipProcessedDrama[];
  currentDramaName: string | null;
  currentDramaDate: string | null;
  currentDramaRating: string | null;
  currentRecordId: string | null;
  currentDramaStartedAt: string | null;
  totalMaterials: number;
  completedMaterials: number;
  remainingMaterials: number;
  startedAt: string | null;
  lastUpdatedAt: string | null;
  message: string;
}

interface MaterialClipAiHighlightDrama {
  order: number;
  dramaName: string;
  recordId: string;
  date: string;
  fullDate: string | null;
  rating: string | null;
  sourceDir: string | null;
  sourceMatched: boolean;
  highlightStartPoints: string | null;
  status: "pending" | "running" | "success" | "failed" | "unmatched";
  message: string;
  highlightCount: number;
  updatedAt: string | null;
}

interface MaterialClipAiHighlightState {
  running: boolean;
  status: "idle" | "running" | "completed" | "failed";
  message: string;
  totalPending: number;
  matchedCount: number;
  unmatchedCount: number;
  dramas: MaterialClipAiHighlightDrama[];
  startedAt: string | null;
  lastUpdatedAt: string | null;
}

// Custom APIs for renderer
const api = {
  // ==================== Web 会话 ====================
  sessionLogin: (account: string, password: string) =>
    ipcRenderer.invoke("session:login", account, password),
  sessionGet: () => ipcRenderer.invoke("session:get"),
  changduSearchSeries: (query: string) =>
    ipcRenderer.invoke("changdu:searchSeries", query),
  sessionSwitchChannel: (channelId: string) =>
    ipcRenderer.invoke("session:switchChannel", channelId),
  sessionLogout: () => ipcRenderer.invoke("session:logout"),
  adminListUsers: () => ipcRenderer.invoke("admin:listUsers"),
  adminUpdateUser: (id: string, payload: unknown) =>
    ipcRenderer.invoke("admin:updateUser", id, payload),

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

  getClipConfig: (config?: unknown) =>
    ipcRenderer.invoke("clip:getConfig", config),
  getClipEnvironmentStatus: (): Promise<MaterialClipEnvironmentStatus> =>
    ipcRenderer.invoke("clip:getEnvironmentStatus"),
  installClipEnvironment: (): Promise<MaterialClipInstallResult> =>
    ipcRenderer.invoke("clip:installEnvironment"),
  importClipRuntime: (): Promise<MaterialClipRuntimeImportResult> =>
    ipcRenderer.invoke("clip:importRuntime"),
  clipRefreshPending: (config: unknown) =>
    ipcRenderer.invoke("clip:refreshPending", config),
  clipGetAiHighlightState: (): Promise<MaterialClipAiHighlightState> =>
    ipcRenderer.invoke("clip:getAiHighlightState"),
  clipRefreshAiHighlight: (config: unknown) =>
    ipcRenderer.invoke("clip:refreshAiHighlight", config),
  clipRunAiHighlight: (config: unknown) =>
    ipcRenderer.invoke("clip:runAiHighlight", config),
  clipAutoRun: (config: unknown) => ipcRenderer.invoke("clip:autoRun", config),
  clipTriggerPollNow: () => ipcRenderer.invoke("clip:triggerPollNow"),
  clipManualRun: (dramaNames: string, config: unknown) =>
    ipcRenderer.invoke("clip:manualRun", dramaNames, config),
  clipGetRunState: (): Promise<MaterialClipRunState> =>
    ipcRenderer.invoke("clip:getRunState"),
  clipStopAutoRun: () => ipcRenderer.invoke("clip:stopAutoRun"),
  clipGetLogs: () => ipcRenderer.invoke("clip:getLogs"),
  clipClearLogs: () => ipcRenderer.invoke("clip:clearLogs"),
  clipClearProcessedDramas: () =>
    ipcRenderer.invoke("clip:clearProcessedDramas"),
  onClipLog: (callback: (log: MaterialClipLog) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, log: MaterialClipLog) =>
      callback(log);
    ipcRenderer.on("material-clip:log", handler);
    return () => ipcRenderer.removeListener("material-clip:log", handler);
  },
  onClipState: (callback: (state: MaterialClipRunState) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: MaterialClipRunState,
    ) => callback(state);
    ipcRenderer.on("material-clip:state", handler);
    return () => ipcRenderer.removeListener("material-clip:state", handler);
  },
  onClipAiHighlightState: (
    callback: (state: MaterialClipAiHighlightState) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: MaterialClipAiHighlightState,
    ) => callback(state);
    ipcRenderer.on("material-clip:ai-highlight-state", handler);
    return () =>
      ipcRenderer.removeListener("material-clip:ai-highlight-state", handler);
  },

  // ==================== 文件系统 ====================
  scanVideos: (basePath: string) =>
    ipcRenderer.invoke("file:scanVideos", basePath),
  listExportDirs: (rootPath: string) =>
    ipcRenderer.invoke("file:listExportDirs", rootPath),
  getVideoInfo: (filePath: string) =>
    ipcRenderer.invoke("file:getVideoInfo", filePath),
  deleteFolder: (folderPath: string) =>
    ipcRenderer.invoke("file:deleteFolder", folderPath),
  countMp4Files: (dirPath: string) =>
    ipcRenderer.invoke("file:countMp4Files", dirPath),
  checkZipFile: (zipPath: string) =>
    ipcRenderer.invoke("file:checkZipFile", zipPath),
  renameVideosByTemplate: (
    basePath: string,
    template: string,
    dateValue?: string,
  ) =>
    ipcRenderer.invoke(
      "file:renameVideosByTemplate",
      basePath,
      template,
      dateValue,
    ),
  selectFolder: () => ipcRenderer.invoke("file:selectFolder"),
  extractZip: (
    zipPath: string,
    targetDir?: string,
    deleteAfterExtract?: boolean,
    taskId?: string,
    dramaName?: string,
  ) =>
    ipcRenderer.invoke(
      "file:extractZip",
      zipPath,
      targetDir,
      deleteAfterExtract,
      taskId,
      dramaName,
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
      progress: DownloadProgress,
    ) => callback(progress);
    ipcRenderer.on("download:progress", handler);
    return () => ipcRenderer.removeListener("download:progress", handler);
  },
  onExtractStatus: (callback: (status: ExtractQueueStatus) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: ExtractQueueStatus,
    ) => callback(status);
    ipcRenderer.on("file:extractStatus", handler);
    return () => ipcRenderer.removeListener("file:extractStatus", handler);
  },

  // ==================== API 代理 ====================
  feishuRequest: (endpoint: string, data: unknown, method?: string) =>
    ipcRenderer.invoke("api:feishu", endpoint, data, method),
  feishuGetPendingUpload: (tableId?: string) =>
    ipcRenderer.invoke("api:feishuPendingUpload", tableId),
  feishuGetPendingUploadByDate: (
    tableId: string | undefined,
    dateTimestamp: number,
  ) =>
    ipcRenderer.invoke("api:feishuPendingUploadByDate", tableId, dateTimestamp),
  changduRequest: (
    endpoint: string,
    params: unknown,
    headers?: unknown,
    configType?: "sanrou" | "meiri" | "custom",
    customConfig?: {
      cookie: string;
      distributorId: string;
      changduAppId: string;
      changduAdUserId: string;
      changduRootAdUserId: string;
    },
  ) =>
    ipcRenderer.invoke(
      "api:changdu",
      endpoint,
      params,
      headers,
      configType,
      customConfig,
    ),
  uploadToTos: (filePath: string, options: unknown) =>
    ipcRenderer.invoke("api:upload", filePath, options),
  submitMaterial: (materials: unknown) =>
    ipcRenderer.invoke("api:submitMaterial", materials),
  pushDramaMaterials: (params: {
    dramaName: string;
    materialNames: string[];
    adAccountIds: string;
    channelId?: string;
  }) => ipcRenderer.invoke("api:pushDramaMaterials", params),
  onUploadProgress: (callback: (progress: UploadProgress) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: UploadProgress,
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
      progress: TosUploadProgress,
    ) => callback(progress);
    ipcRenderer.on("tos:uploadProgress", handler);
    return () => ipcRenderer.removeListener("tos:uploadProgress", handler);
  },
  onTosUploadComplete: (callback: (result: TosUploadResult) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      result: TosUploadResult,
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

  // ==================== 窗口控制 ====================
  hideWindow: () => ipcRenderer.invoke("window:hide"),
  showWindow: () => ipcRenderer.invoke("window:show"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),

  // ==================== 巨量上传 ====================
  juliangInitialize: () => ipcRenderer.invoke("juliang:initialize"),
  juliangClose: () => ipcRenderer.invoke("juliang:close"),
  juliangIsReady: () => ipcRenderer.invoke("juliang:isReady"),
  juliangNavigate: (accountId: string) =>
    ipcRenderer.invoke("juliang:navigate", accountId),
  juliangCheckLogin: () => ipcRenderer.invoke("juliang:checkLogin"),
  juliangUploadTask: (task: unknown) =>
    ipcRenderer.invoke("juliang:uploadTask", task),
  juliangClearExistingProjects: (accountId: string) =>
    ipcRenderer.invoke("juliang:clearExistingProjects", accountId),
  juliangGetConfig: () => ipcRenderer.invoke("juliang:getConfig"),
  juliangUpdateConfig: (config: unknown) =>
    ipcRenderer.invoke("juliang:updateConfig", config),
  juliangGetScreenshot: () => ipcRenderer.invoke("juliang:getScreenshot"),
  juliangGetLogs: () => ipcRenderer.invoke("juliang:getLogs"),
  juliangGetTaskStates: () => ipcRenderer.invoke("juliang:getTaskStates"),
  juliangClearLogs: () => ipcRenderer.invoke("juliang:clearLogs"),
  juliangExportLoginState: () => ipcRenderer.invoke("juliang:exportLoginState"),
  juliangImportLoginState: () => ipcRenderer.invoke("juliang:importLoginState"),
  juliangBuildGetPendingDramas: (tableId?: string) =>
    ipcRenderer.invoke("juliang-build:getPendingDramas", tableId),
  juliangBuildGetSchedulerStatus: (tableId?: string) =>
    ipcRenderer.invoke("juliang-build:getSchedulerStatus", tableId),
  juliangBuildStartScheduler: (intervalMinutes: number, tableId?: string) =>
    ipcRenderer.invoke(
      "juliang-build:startScheduler",
      intervalMinutes,
      tableId,
    ),
  juliangBuildStopScheduler: (tableId?: string) =>
    ipcRenderer.invoke("juliang-build:stopScheduler", tableId),
  juliangBuildTriggerScheduler: (dramaId?: string, tableId?: string) =>
    ipcRenderer.invoke("juliang-build:triggerScheduler", dramaId, tableId),

  // ==================== 上传搭建 ====================
  dailyBuildStartTask: (task: unknown) =>
    ipcRenderer.invoke("daily-build:startTask", task),
  dailyBuildCancelTask: (taskId: string) =>
    ipcRenderer.invoke("daily-build:cancelTask", taskId),
  dailyBuildGetLogs: () => ipcRenderer.invoke("daily-build:getLogs"),
  dailyBuildGetTaskStates: () =>
    ipcRenderer.invoke("daily-build:getTaskStates"),
  dailyBuildClearLogs: () => ipcRenderer.invoke("daily-build:clearLogs"),
  materialPreviewGetLogs: () => ipcRenderer.invoke("material-preview:getLogs"),
  materialPreviewClearLogs: () =>
    ipcRenderer.invoke("material-preview:clearLogs"),

  // ==================== 巨量调度器 ====================
  juliangSchedulerStart: (darenId?: string, tableId?: string) =>
    ipcRenderer.invoke("juliang:scheduler:start", darenId, tableId),
  juliangSchedulerStop: () => ipcRenderer.invoke("juliang:scheduler:stop"),
  juliangSchedulerGetStatus: () =>
    ipcRenderer.invoke("juliang:scheduler:getStatus"),
  juliangSchedulerGetConfig: () =>
    ipcRenderer.invoke("juliang:scheduler:getConfig"),
  juliangSchedulerUpdateConfig: (config: unknown) =>
    ipcRenderer.invoke("juliang:scheduler:updateConfig", config),
  juliangSchedulerGetLogs: () =>
    ipcRenderer.invoke("juliang:scheduler:getLogs"),
  juliangSchedulerClearLogs: () =>
    ipcRenderer.invoke("juliang:scheduler:clearLogs"),
  juliangSchedulerFetchNow: (darenId?: string, tableId?: string) =>
    ipcRenderer.invoke("juliang:scheduler:fetchNow", darenId, tableId),
  juliangSchedulerCancelAll: () =>
    ipcRenderer.invoke("juliang:scheduler:cancelAll"),
  juliangSchedulerGetCompletedTasks: () =>
    ipcRenderer.invoke("juliang:scheduler:getCompletedTasks"),
  juliangSchedulerClearCompletedTasks: () =>
    ipcRenderer.invoke("juliang:scheduler:clearCompletedTasks"),
  onJuliangSchedulerLog: (
    callback: (log: { time: string; message: string }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      log: { time: string; message: string },
    ) => callback(log);
    ipcRenderer.on("juliang:scheduler-log", handler);
    return () => ipcRenderer.removeListener("juliang:scheduler-log", handler);
  },

  onJuliangLog: (
    callback: (log: { time: string; message: string }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      log: { time: string; message: string },
    ) => callback(log);
    ipcRenderer.on("juliang:log", handler);
    return () => ipcRenderer.removeListener("juliang:log", handler);
  },
  onJuliangUploadProgress: (
    callback: (progress: {
      taskId: string;
      drama: string;
      status: string;
      currentBatch: number;
      totalBatches: number;
      successCount: number;
      totalFiles: number;
      message: string;
    }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: {
        taskId: string;
        drama: string;
        status: string;
        currentBatch: number;
        totalBatches: number;
        successCount: number;
        totalFiles: number;
        message: string;
      },
    ) => callback(progress);
    ipcRenderer.on("juliang:upload-progress", handler);
    return () => ipcRenderer.removeListener("juliang:upload-progress", handler);
  },
  onDailyBuildProgress: (
    callback: (progress: {
      taskId: string;
      drama: string;
      status: string;
      message: string;
      currentRuleIndex: number;
      totalRules: number;
      successRuleCount: number;
      failedRuleCount: number;
    }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: {
        taskId: string;
        drama: string;
        status: string;
        message: string;
        currentRuleIndex: number;
        totalRules: number;
        successRuleCount: number;
        failedRuleCount: number;
      },
    ) => callback(progress);
    ipcRenderer.on("daily-build:progress", handler);
    return () => ipcRenderer.removeListener("daily-build:progress", handler);
  },
  onDailyBuildLog: (
    callback: (log: { time: string; message: string }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      log: { time: string; message: string },
    ) => callback(log);
    ipcRenderer.on("daily-build:log", handler);
    return () => ipcRenderer.removeListener("daily-build:log", handler);
  },
  onMaterialPreviewLog: (
    callback: (log: { time: string; message: string }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      log: { time: string; message: string },
    ) => callback(log);
    ipcRenderer.on("material-preview:log", handler);
    return () => ipcRenderer.removeListener("material-preview:log", handler);
  },
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
