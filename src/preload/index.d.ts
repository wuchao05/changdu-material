import { ElectronAPI } from "@electron-toolkit/preload";

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

// TOS 队列状态
interface TosQueueStatus {
  total: number;
  active: number;
  pending: number;
  maxConcurrent: number;
}

interface DarenInfo {
  id: string;
  label: string;
  shortName: string;
  douyinAccounts: string[];
  feishuDramaStatusTableId?: string;
  feishuDramaListTableId?: string;
  feishuAccountTableId?: string;
  enableDramaClipEntry?: boolean;
  enableAutoUpload?: boolean;
  enableAutoDownload?: boolean;
  videoBasePath?: string;
}

interface ApiConfig {
  cookie: string;
  userId: string;
  distributorId?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
}

interface Api {
  // 配置管理
  getDarenConfig: () => Promise<{ darenList: DarenInfo[] }>;
  addDaren: (daren: DarenInfo) => Promise<DarenInfo>;
  updateDaren: (id: string, updates: Partial<DarenInfo>) => Promise<DarenInfo>;
  deleteDaren: (id: string) => Promise<void>;
  getApiConfig: () => Promise<ApiConfig>;
  saveApiConfig: (config: ApiConfig) => Promise<void>;

  // 文件系统
  scanVideos: (date: string, userId: string) => Promise<VideoMaterial[]>;
  getVideoInfo: (filePath: string) => Promise<VideoInfo>;
  deleteFolder: (
    folderPath: string
  ) => Promise<{ success: boolean; error?: string }>;
  selectFolder: () => Promise<string | null>;

  // 下载
  downloadVideo: (
    url: string,
    savePath: string,
    dramaName: string
  ) => Promise<{ success: boolean; filePath: string }>;
  cancelDownload: (dramaName: string) => Promise<void>;
  pauseDownload: (dramaName: string) => Promise<boolean>;
  resumeDownload: (
    dramaName: string
  ) => Promise<{ success: boolean; filePath: string }>;
  isDownloadPaused: (dramaName: string) => Promise<boolean>;
  getDownloadState: (dramaName: string) => Promise<any>;
  onDownloadProgress: (
    callback: (progress: DownloadProgress) => void
  ) => () => void;

  // API 代理
  feishuRequest: (
    endpoint: string,
    data: unknown,
    method?: string
  ) => Promise<unknown>;
  feishuGetPendingUpload: (tableId?: string) => Promise<{
    code: number;
    msg?: string;
    data?: {
      items: Array<{
        record_id: string;
        fields: Record<string, unknown>;
      }>;
    };
  }>;
  feishuGetPendingUploadByDate: (
    tableId: string | undefined,
    dateTimestamp: number
  ) => Promise<{
    code: number;
    msg?: string;
    data?: {
      items: Array<{
        record_id: string;
        fields: Record<string, unknown>;
      }>;
    };
  }>;
  changduRequest: (
    endpoint: string,
    params: unknown,
    headers?: unknown,
    configType?: 'sanrou' | 'meiri'
  ) => Promise<unknown>;
  uploadToTos: (
    filePath: string,
    options: unknown
  ) => Promise<{ success: boolean; url: string }>;
  submitMaterial: (materials: unknown) => Promise<unknown>;
  onUploadProgress: (
    callback: (progress: UploadProgress) => void
  ) => () => void;

  // TOS 上传
  tosUploadFile: (filePath: string) => Promise<TosUploadResult>;
  tosUploadBatch: (
    filePaths: string[],
    maxConcurrent?: number
  ) => Promise<void>;
  tosCancelUpload: (fileName: string) => Promise<boolean>;
  tosCancelAllUploads: () => Promise<void>;
  tosGetQueueStatus: () => Promise<TosQueueStatus>;
  tosInitClient: () => Promise<{ success: boolean }>;
  onTosUploadProgress: (
    callback: (progress: TosUploadProgress) => void
  ) => () => void;
  onTosUploadComplete: (
    callback: (result: TosUploadResult) => void
  ) => () => void;

  // 应用控制
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  quit: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  showInFolder: (path: string) => Promise<void>;

  // 窗口控制
  hideWindow: () => Promise<{ success: boolean }>;
  showWindow: () => Promise<{ success: boolean }>;
  minimizeWindow: () => Promise<{ success: boolean }>;
}

interface VideoMaterial {
  fileName: string;
  filePath: string;
  size: number;
  sizeFormatted?: string;
  dramaName: string;
  date?: string;
  status: "pending" | "uploading" | "success" | "error";
  progress?: number;
  error?: string;
  url?: string;
  width?: number;
  height?: number;
  duration?: number;
  retryCount?: number;
  isSubmitted?: boolean;
  lastError?: {
    error: string;
    message: string;
    timestamp: string;
  };
}

interface VideoInfo {
  width: number;
  height: number;
  duration: number;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: Api;
  }
}
