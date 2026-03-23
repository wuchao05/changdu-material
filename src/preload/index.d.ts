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
  password?: string;
  feishuDramaStatusTableId?: string;
  enableUpload?: boolean;
  enableDownload?: boolean;
  enableJuliang?: boolean;
  enableUploadBuild?: boolean;
  enableMaterialClip?: boolean;
  changduConfigType?: "sanrou" | "meiri" | "custom";
  customChangduConfig?: {
    cookie: string;
    distributorId: string;
    changduAppId: string;
    changduAdUserId: string;
    changduRootAdUserId: string;
  };
  uploadBuildSettings?: UploadBuildSettings;
}

interface ApiConfig {
  sanrouChangdu: {
    cookie: string;
    distributorId: string;
    changduAppId: string;
    changduAdUserId: string;
    changduRootAdUserId: string;
  };
  meiriChangdu: {
    cookie: string;
    distributorId: string;
    changduAppId: string;
    changduAdUserId: string;
    changduRootAdUserId: string;
  };
  feishuAppId: string;
  feishuAppSecret: string;
  feishuAppToken: string;
  tosAccessKeyId: string;
  tosAccessKeySecret: string;
  tosBucket: string;
  tosRegion: string;
  xtToken: string;
}

interface UploadBuildParams {
  distributorId: string;
  secretKey: string;
  source: string;
  bid: number | string;
  productId: string;
  productPlatformId: string;
  landingUrl: string;
  microAppName: string;
  microAppId: string;
  ccId: string;
  rechargeTemplateId: string;
}

interface DouyinMaterialRule {
  id: string;
  douyinAccount: string;
  douyinAccountId: string;
  shortName: string;
  materialRange: string;
  createdAt?: string;
  updatedAt?: string;
}

interface UploadBuildSettings {
  buildParams: UploadBuildParams;
  darenName?: string;
  materialFilenameTemplate: string;
  materialDateValue?: string;
  douyinMaterialRules: DouyinMaterialRule[];
}

interface JuliangSchedulerResult {
  success: boolean;
  error?: string;
}

interface JuliangSchedulerFetchResult extends JuliangSchedulerResult {
  count: number;
}

interface JuliangSchedulerStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
}

interface JuliangCompletedTask {
  drama: string;
  date: string;
  fileCount: number;
  status: "completed" | "failed" | "skipped";
  error?: string;
  duration: string;
}

interface MaterialClipVideoConfig {
  hw_codec: string;
  sw_codec: string;
  bitrate: string;
  max_rate: string;
  buffer_size: string;
  soft_crf: string;
  preset: string;
  profile: string;
  level: string;
  hw_level: string;
  sw_level: string;
  tag: string;
  pixel_format: string;
  faststart: boolean;
}

interface MaterialClipAudioConfig {
  codec: string;
  bitrate: string;
  sample_rate: number;
}

interface MaterialClipBrandTextRange {
  range: string;
  text: string;
}

interface MaterialClipBrandTextMapping {
  mode: string;
  ranges: MaterialClipBrandTextRange[] | null;
  cycle_texts: string[] | null;
  default_text: string;
}

interface MaterialClipFeishuConfig {
  app_id: string;
  app_secret: string;
  app_token: string;
  table_id: string;
  base_url: string;
  field_names: string[];
  status_field_name: string;
  pending_status_value: string;
  completed_status_value: string;
  processing_status_value: string;
  missing_source_status_value: string;
  failed_status_value: string;
  remark_field_name: string;
  rating_field_name: string;
  priority_rating_value: string;
  upload_time_sort_desc: boolean;
  douyin_material_field_name: string;
  page_size: number;
  token_refresh_interval: number;
}

interface MaterialClipFeishuWatcherConfig {
  enabled: boolean;
  poll_interval: number;
  max_dates_per_cycle: number;
  settle_seconds: number;
  settle_rounds: number;
  idle_exit_minutes: number | null;
  state_dir: string;
  date_whitelist: string[];
  date_blacklist: string[];
  status_filter: string | null;
}

interface MaterialClipDateDeduplicationConfig {
  enabled: boolean;
  storage_dir: string;
  skip_processed_by_default: boolean;
}

interface MaterialClipConfig {
  active_user: string | null;
  target_fps: number;
  smart_fps: boolean;
  fast_mode: boolean;
  filter_threads: number;
  verbose: boolean;
  min_duration: number;
  max_duration: number;
  count: number;
  material_code: string;
  date_str: string | null;
  exclude_last_episodes: number;
  title_font_size: number;
  brand_font_size: number;
  disclaimer_font_size: number;
  disclaimer_text: string;
  enable_brand_text: boolean;
  enable_disclaimer_text: boolean;
  title_opacity: number;
  bottom_opacity: number;
  title_position: string;
  title_colors: string[];
  enable_hook_text: boolean;
  hook_texts: string[];
  hook_font_size: number;
  hook_duration: number;
  hook_text_color: string;
  random_start: boolean;
  seed: number | null;
  use_hardware: boolean;
  keep_temp: boolean;
  jobs: number;
  canvas: string | null;
  reference_resolution: [number, number] | null;
  default_source_dir: string;
  backup_source_dir: string;
  temp_dir: string | null;
  output_dir: string;
  tail_cache_dir: string | null;
  tail_file: string | null;
  refresh_tail_cache: boolean;
  font_file: string | null;
  brand_text: string;
  brand_text_mapping: MaterialClipBrandTextMapping | null;
  enable_floating_watermark: boolean;
  floating_watermark_font_size: number;
  floating_watermark_alpha: number;
  floating_watermark_speed_range: number[];
  include: string[] | null;
  exclude: string[] | null;
  full: boolean;
  no_interactive: boolean;
  enable_deduplication: boolean;
  auto_delete_source_after_completion: boolean;
  video: MaterialClipVideoConfig;
  audio: MaterialClipAudioConfig;
  enable_feishu_features: boolean;
  feishu: MaterialClipFeishuConfig;
  feishu_watcher: MaterialClipFeishuWatcherConfig;
  feishu_webhook_url: string | null;
  enable_feishu_notification: boolean;
  date_deduplication: MaterialClipDateDeduplicationConfig;
}

interface MaterialClipLogEntry {
  time: string;
  message: string;
}

interface MaterialClipRunResult {
  success: boolean;
  error?: string;
  pid?: number;
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
}

interface MaterialClipRunState {
  running: boolean;
  mode: "idle" | "auto" | "manual";
  status: "idle" | "running" | "stopping" | "stopped" | "completed" | "failed";
  pid: number | null;
  pendingDramas: MaterialClipPendingDrama[];
  currentDramaName: string | null;
  currentDramaDate: string | null;
  currentDramaRating: string | null;
  currentRecordId: string | null;
  totalMaterials: number;
  completedMaterials: number;
  remainingMaterials: number;
  startedAt: string | null;
  lastUpdatedAt: string | null;
  message: string;
}

interface Api {
  // 配置管理
  getDarenConfig: () => Promise<{ darenList: DarenInfo[] }>;
  addDaren: (daren: DarenInfo) => Promise<DarenInfo>;
  updateDaren: (id: string, updates: Partial<DarenInfo>) => Promise<DarenInfo>;
  deleteDaren: (id: string) => Promise<void>;
  getApiConfig: () => Promise<ApiConfig>;
  saveApiConfig: (config: ApiConfig) => Promise<void>;
  fetchAuthConfig: () => Promise<{ success: boolean; error?: string }>;
  syncRemoteConfig: () => Promise<{
    synced: boolean;
    version?: number;
    error?: string;
  }>;
  pushRemoteConfig: () => Promise<{ success: boolean; error?: string }>;
  getClipConfig: () => Promise<MaterialClipConfig>;
  getClipEnvironmentStatus: () => Promise<MaterialClipEnvironmentStatus>;
  installClipEnvironment: () => Promise<MaterialClipInstallResult>;
  importClipRuntime: () => Promise<MaterialClipRuntimeImportResult>;
  saveClipConfig: (config: MaterialClipConfig) => Promise<MaterialClipConfig>;
  clipAutoRun: () => Promise<MaterialClipRunResult>;
  clipManualRun: (dramaNames: string) => Promise<MaterialClipRunResult>;
  clipGetRunState: () => Promise<MaterialClipRunState>;
  clipStopAutoRun: () => Promise<{ success: boolean; error?: string }>;
  clipGetLogs: () => Promise<MaterialClipLogEntry[]>;
  clipClearLogs: () => Promise<{ success: boolean }>;
  onClipLog: (callback: (log: MaterialClipLogEntry) => void) => () => void;
  onClipState: (callback: (state: MaterialClipRunState) => void) => () => void;

  // 文件系统
  scanVideos: (basePath: string) => Promise<VideoMaterial[]>;
  listExportDirs: (rootPath: string) => Promise<string[]>;
  getVideoInfo: (filePath: string) => Promise<VideoInfo>;
  renameVideosByTemplate: (
    basePath: string,
    template: string,
    dateValue?: string,
  ) => Promise<RenameVideosResult>;
  deleteFolder: (
    folderPath: string,
  ) => Promise<{ success: boolean; error?: string }>;
  selectFolder: () => Promise<string | null>;

  // 下载
  downloadVideo: (
    url: string,
    savePath: string,
    dramaName: string,
  ) => Promise<{ success: boolean; filePath: string }>;
  cancelDownload: (dramaName: string) => Promise<void>;
  pauseDownload: (dramaName: string) => Promise<boolean>;
  resumeDownload: (
    dramaName: string,
  ) => Promise<{ success: boolean; filePath: string }>;
  isDownloadPaused: (dramaName: string) => Promise<boolean>;
  getDownloadState: (dramaName: string) => Promise<any>;
  onDownloadProgress: (
    callback: (progress: DownloadProgress) => void,
  ) => () => void;

  // API 代理
  feishuRequest: (
    endpoint: string,
    data: unknown,
    method?: string,
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
    dateTimestamp: number,
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
    configType?: "sanrou" | "meiri" | "custom",
    customConfig?: {
      cookie: string;
      distributorId: string;
      changduAppId: string;
      changduAdUserId: string;
      changduRootAdUserId: string;
    },
  ) => Promise<unknown>;
  uploadToTos: (
    filePath: string,
    options: unknown,
  ) => Promise<{ success: boolean; url: string }>;
  submitMaterial: (materials: unknown) => Promise<unknown>;
  onUploadProgress: (
    callback: (progress: UploadProgress) => void,
  ) => () => void;

  // TOS 上传
  tosUploadFile: (filePath: string) => Promise<TosUploadResult>;
  tosUploadBatch: (
    filePaths: string[],
    maxConcurrent?: number,
  ) => Promise<void>;
  tosCancelUpload: (fileName: string) => Promise<boolean>;
  tosCancelAllUploads: () => Promise<void>;
  tosGetQueueStatus: () => Promise<TosQueueStatus>;
  tosInitClient: () => Promise<{ success: boolean }>;
  onTosUploadProgress: (
    callback: (progress: TosUploadProgress) => void,
  ) => () => void;
  onTosUploadComplete: (
    callback: (result: TosUploadResult) => void,
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

  // 巨量上传
  juliangInitialize: () => Promise<{ success: boolean; error?: string }>;
  juliangClose: () => Promise<{ success: boolean; error?: string }>;
  juliangIsReady: () => Promise<boolean>;
  juliangNavigate: (
    accountId: string,
  ) => Promise<{ success: boolean; error?: string }>;
  juliangCheckLogin: () => Promise<{ needLogin: boolean }>;
  juliangUploadTask: (task: unknown) => Promise<unknown>;
  juliangGetConfig: () => Promise<Record<string, unknown>>;
  juliangUpdateConfig: (config: unknown) => Promise<{ success: boolean }>;
  juliangGetScreenshot: () => Promise<string | null>;
  juliangGetLogs: () => Promise<Array<{ time: string; message: string }>>;
  juliangGetTaskStates: () => Promise<
    Array<{
      taskId: string;
      drama: string;
      status: "pending" | "running" | "completed" | "failed" | "skipped";
      currentBatch: number;
      totalBatches: number;
      successCount: number;
      totalFiles: number;
      message: string;
      updatedAt: string;
    }>
  >;
  juliangClearLogs: () => Promise<{ success: boolean }>;

  // 上传搭建
  dailyBuildStartTask: (task: unknown) => Promise<{
    success: boolean;
    cancelled?: boolean;
    taskId: string;
    drama: string;
    totalRules: number;
    successRuleCount: number;
    failedRuleCount: number;
    skippedRules: Array<{
      ruleId: string;
      douyinAccount: string;
      error: string;
    }>;
    error?: string;
  }>;
  dailyBuildCancelTask: (
    taskId: string,
  ) => Promise<{ success: boolean; error?: string }>;
  dailyBuildGetLogs: () => Promise<Array<{ time: string; message: string }>>;
  dailyBuildGetTaskStates: () => Promise<
    Array<{
      taskId: string;
      drama: string;
      status: "assetizing" | "building" | "completed" | "failed" | "cancelled";
      message: string;
      currentRuleIndex: number;
      totalRules: number;
      successRuleCount: number;
      failedRuleCount: number;
      updatedAt: string;
    }>
  >;
  dailyBuildClearLogs: () => Promise<{ success: boolean }>;

  // 巨量调度器
  juliangSchedulerStart: (darenId?: string) => Promise<JuliangSchedulerResult>;
  juliangSchedulerStop: () => Promise<{ success: boolean }>;
  juliangSchedulerGetStatus: () => Promise<{
    status: "idle" | "running" | "stopped";
    stats: JuliangSchedulerStats;
  }>;
  juliangSchedulerGetConfig: () => Promise<{
    fetchIntervalMinutes: number;
    localRootDir: string;
    maxTaskRetries: number;
  }>;
  juliangSchedulerUpdateConfig: (
    config: unknown,
  ) => Promise<{ success: boolean }>;
  juliangSchedulerGetLogs: () => Promise<
    Array<{ time: string; message: string }>
  >;
  juliangSchedulerClearLogs: () => Promise<{ success: boolean }>;
  juliangSchedulerFetchNow: (
    darenId?: string,
  ) => Promise<JuliangSchedulerFetchResult>;
  juliangSchedulerCancelAll: () => Promise<JuliangSchedulerResult>;
  juliangSchedulerGetCompletedTasks: () => Promise<JuliangCompletedTask[]>;
  onJuliangSchedulerLog: (
    callback: (log: { time: string; message: string }) => void,
  ) => () => void;
  onJuliangLog: (
    callback: (log: { time: string; message: string }) => void,
  ) => () => void;
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
  ) => () => void;
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
  ) => () => void;
  onDailyBuildLog: (
    callback: (log: { time: string; message: string }) => void,
  ) => () => void;
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

interface RenameVideosResult {
  success: boolean;
  dramaCount: number;
  renamedCount: number;
  skippedCount: number;
  error?: string;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: Api;
  }
}
