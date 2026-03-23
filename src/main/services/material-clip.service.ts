import { app, BrowserWindow, dialog } from "electron";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { spawn, type ChildProcessByStdio } from "child_process";
import type { Readable } from "stream";
import type { ApiService } from "./api.service";
import type { ConfigService } from "./config.service";
import {
  importRuntimeCandidate,
  resolveRuntime,
  type MaterialClipRuntimeSource,
} from "./material-clip-runtime";

export interface MaterialClipVideoConfig {
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

export interface MaterialClipAudioConfig {
  codec: string;
  bitrate: string;
  sample_rate: number;
}

export interface MaterialClipBrandTextRange {
  range: string;
  text: string;
}

export interface MaterialClipBrandTextMapping {
  mode: string;
  ranges: MaterialClipBrandTextRange[] | null;
  cycle_texts: string[] | null;
  default_text: string;
}

export interface MaterialClipFeishuConfig {
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

export interface MaterialClipFeishuWatcherConfig {
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

export interface MaterialClipDateDeduplicationConfig {
  enabled: boolean;
  storage_dir: string;
  skip_processed_by_default: boolean;
}

export interface MaterialClipConfig {
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

export interface MaterialClipLogEntry {
  time: string;
  message: string;
}

export interface MaterialClipRunResult {
  success: boolean;
  error?: string;
  pid?: number;
}

export interface MaterialClipEnvironmentStatus {
  ready: boolean;
  installSupported: boolean;
  platform: NodeJS.Platform;
  processorRoot: string | null;
  pythonCommand: string | null;
  activeUser: string | null;
  runtimeSource: MaterialClipRuntimeSource;
  checks: Array<{
    key: string;
    label: string;
    passed: boolean;
    detail: string;
  }>;
  error?: string;
}

export interface MaterialClipInstallResult {
  success: boolean;
  error?: string;
}

export interface MaterialClipRuntimeImportResult {
  success: boolean;
  error?: string;
  runtimeRoot?: string;
}

export type MaterialClipProcessMode = "idle" | "auto" | "manual";

export interface MaterialClipPendingDrama {
  order: number;
  dramaName: string;
  recordId: string;
  date: string;
  fullDate: string | null;
  rating: string | null;
  uploadTime: number | null;
  plannedMaterials: number | null;
}

export interface MaterialClipProcessedDrama {
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

export interface MaterialClipRunState {
  running: boolean;
  mode: MaterialClipProcessMode;
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

interface MaterialClipFeishuRecordFieldValue {
  text?: string;
}

interface MaterialClipFeishuRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

interface MaterialClipFeishuSearchResponse {
  code: number;
  msg?: string;
  data?: {
    items?: MaterialClipFeishuRecord[];
  };
}

type PythonCommand = {
  command: string;
  prefixArgs: string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "number")
  );
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMerge(current, value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

export class MaterialClipService {
  private configPath: string;
  private runtimeRunConfigPath: string;
  private runtimeStatePath: string;
  private managedRuntimeRootDir: string;
  private logs: MaterialClipLogEntry[] = [];
  private maxLogs = 500;
  private mainWindow: BrowserWindow | null = null;
  private runningProcess: ChildProcessByStdio<null, Readable, Readable> | null =
    null;
  private installingProcess: ChildProcessByStdio<
    null,
    Readable,
    Readable
  > | null = null;
  private readonly configService: ConfigService;
  private readonly apiService: ApiService;
  private runState: MaterialClipRunState = this.createEmptyRunState();
  private pendingRefreshTimer: NodeJS.Timeout | null = null;
  private pendingRefreshInFlight = false;

  constructor(configService: ConfigService, apiService: ApiService) {
    const userDataPath = app.getPath("userData");
    this.configPath = path.join(userDataPath, "material-clip-config.json");
    this.runtimeRunConfigPath = path.join(
      userDataPath,
      "material-clip-run-config.json",
    );
    this.runtimeStatePath = path.join(
      userDataPath,
      "material-clip-runtime-state.json",
    );
    this.managedRuntimeRootDir = path.join(
      userDataPath,
      "material-clip-runtime",
    );
    this.configService = configService;
    this.apiService = apiService;
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  async getRunState(): Promise<MaterialClipRunState> {
    if (!this.runState.running && this.runState.mode === "idle") {
      await this.refreshPendingDramas();
    }
    return this.getRunStateSnapshot();
  }

  async stopAutoRun(): Promise<{ success: boolean; error?: string }> {
    if (!this.runningProcess || this.runState.mode !== "auto") {
      return { success: false, error: "当前没有自动剪辑任务在运行" };
    }

    if (this.runState.status === "stopping") {
      return { success: false, error: "正在停止自动剪辑，请稍候" };
    }

    this.runState.status = "stopping";
    this.runState.message = `正在停止《${this.runState.currentDramaName || "当前剧目"}》...`;
    this.touchRunState();
    this.emitRunState();

    const processToStop = this.runningProcess;
    const currentRecordId =
      this.runState.currentRecordId ??
      this.findPendingDramaCandidate(
        this.runState.currentDramaName || "",
        this.runState.currentDramaDate,
      )?.recordId ??
      null;

    try {
      await this.terminateProcess(processToStop);
      if (currentRecordId) {
        await this.revertRecordToPending(currentRecordId);
      }
      await this.refreshPendingDramas();
      this.runState.running = false;
      this.runState.mode = "idle";
      this.runState.status = "stopped";
      this.runState.pid = null;
      this.runState.currentDramaName = null;
      this.runState.currentDramaDate = null;
      this.runState.currentDramaRating = null;
      this.runState.currentRecordId = null;
      this.runState.currentDramaStartedAt = null;
      this.runState.totalMaterials = 0;
      this.runState.completedMaterials = 0;
      this.runState.remainingMaterials = 0;
      this.runState.message = "飞书轮询已停止，当前剧目已回退为待剪辑";
      this.touchRunState();
      this.emitRunState();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.runState.status = "running";
      this.runState.message = `停止自动剪辑失败：${message}`;
      this.touchRunState();
      this.emitRunState();
      return { success: false, error: message };
    }
  }

  private createEmptyRunState(): MaterialClipRunState {
    return {
      running: false,
      mode: "idle",
      status: "idle",
      pid: null,
      pendingDramas: [],
      processedDramas: [],
      currentDramaName: null,
      currentDramaDate: null,
      currentDramaRating: null,
      currentRecordId: null,
      currentDramaStartedAt: null,
      totalMaterials: 0,
      completedMaterials: 0,
      remainingMaterials: 0,
      startedAt: null,
      lastUpdatedAt: null,
      message: "等待开始剪辑",
    };
  }

  private getRunStateSnapshot(): MaterialClipRunState {
    return {
      ...this.runState,
      pendingDramas: this.runState.pendingDramas.map((item) => ({ ...item })),
      processedDramas: this.runState.processedDramas.map((item) => ({
        ...item,
      })),
    };
  }

  private touchRunState() {
    this.runState.lastUpdatedAt = new Date().toISOString();
  }

  private emitRunState() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(
        "material-clip:state",
        this.getRunStateSnapshot(),
      );
    }
  }

  async getConfig(): Promise<MaterialClipConfig> {
    const saved = await this.readSavedConfig();
    let config = this.createDefaultConfig();

    if (saved) {
      try {
        config = this.prepareConfigInput(saved);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`检测到无效的素材剪辑配置，已回退默认值：${message}`);
      }
    }

    return this.applyApiConfig(config);
  }

  async saveConfig(config: unknown): Promise<MaterialClipConfig> {
    const normalized = this.prepareConfigInput(config);
    await fsp.writeFile(
      this.configPath,
      JSON.stringify(normalized, null, 2),
      "utf-8",
    );
    this.log("素材剪辑配置已保存");
    return this.applyApiConfig(normalized);
  }

  getLogs(): MaterialClipLogEntry[] {
    return [...this.logs];
  }

  clearLogs(): { success: boolean } {
    this.logs = [];
    return { success: true };
  }

  async runAutoClip(): Promise<MaterialClipRunResult> {
    const config = await this.getConfig();
    if (!config.feishu.table_id.trim()) {
      return { success: false, error: "请先配置飞书 table_id" };
    }

    const autoConfig: MaterialClipConfig = {
      ...config,
      output_dir: "",
    };

    return this.startProcess({
      mode: "auto",
      config: autoConfig,
      extraArgs: ["feishu", "watch"],
    });
  }

  async runManualClip(dramaNames: string): Promise<MaterialClipRunResult> {
    const normalizedDramaNames = dramaNames
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (normalizedDramaNames.length === 0) {
      return { success: false, error: "请输入至少一个剧名" };
    }

    const config = await this.getConfig();
    return this.startProcess({
      mode: "manual",
      config,
      extraArgs: [
        "process",
        config.default_source_dir,
        "--include",
        normalizedDramaNames.join(","),
        "--no-interactive",
      ],
    });
  }

  async importRuntime(): Promise<MaterialClipRuntimeImportResult> {
    if (this.installingProcess) {
      return { success: false, error: "环境安装进行中，暂时不能导入运行时" };
    }

    if (this.runningProcess) {
      return {
        success: false,
        error: "素材剪辑任务运行中，暂时不能导入运行时",
      };
    }

    const result = await dialog.showOpenDialog({
      title: "选择素材剪辑运行时包",
      properties: ["openFile", "openDirectory"],
      filters: [
        { name: "运行时压缩包", extensions: ["zip"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "已取消导入" };
    }

    try {
      const state = await importRuntimeCandidate({
        sourcePath: result.filePaths[0],
        managedRootDir: this.managedRuntimeRootDir,
        statePath: this.runtimeStatePath,
      });
      this.log(`素材剪辑运行时导入完成：${state.runtimeRoot}`);
      return {
        success: true,
        runtimeRoot: state.runtimeRoot,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`素材剪辑运行时导入失败：${message}`);
      return {
        success: false,
        error: message,
      };
    }
  }

  async getEnvironmentStatus(): Promise<MaterialClipEnvironmentStatus> {
    const runtime = await this.resolveProcessorRuntime();
    const processorRoot = runtime.runtimeRoot;
    const activeUser = await this.readActiveUser(processorRoot);

    if (!processorRoot) {
      return {
        ready: false,
        installSupported: false,
        platform: process.platform,
        processorRoot: null,
        pythonCommand: null,
        activeUser,
        runtimeSource: runtime.source,
        checks: [
          {
            key: "runtime-root",
            label: "素材剪辑运行时",
            passed: false,
            detail: app.isPackaged
              ? "未导入素材剪辑运行时包"
              : "未找到受管运行时，且开发态同级 dramas_processor 也不存在",
          },
        ],
        error: "未找到素材剪辑运行时",
      };
    }

    const pythonCommand = this.resolvePythonCommand(processorRoot);
    const ffmpegCheck = await this.checkFfmpeg(processorRoot);
    const pythonCheck = await this.checkPythonAvailability(
      pythonCommand,
      processorRoot,
    );
    const packageCheck = pythonCheck.passed
      ? await this.checkProcessorCommand(processorRoot, pythonCommand)
      : {
          key: "processor-command",
          label: "drama_processor 命令",
          passed: false,
          detail: "Python 尚未就绪，跳过模块检查",
        };

    const checks = [
      {
        key: "runtime-root",
        label: "素材剪辑运行时",
        passed: true,
        detail: `${runtime.source === "managed" ? "受管运行时" : "开发回退"}：${processorRoot}`,
      },
      ffmpegCheck,
      pythonCheck,
      packageCheck,
    ];

    return {
      ready: checks.every((item) => item.passed),
      installSupported: this.isInstallSupported(processorRoot),
      platform: process.platform,
      processorRoot,
      pythonCommand: pythonCommand.command,
      activeUser,
      runtimeSource: runtime.source,
      checks,
    };
  }

  async installEnvironment(): Promise<MaterialClipInstallResult> {
    if (this.runningProcess) {
      return {
        success: false,
        error: "当前有素材剪辑任务正在运行，暂时不能安装环境",
      };
    }

    if (this.installingProcess) {
      return { success: false, error: "环境安装正在进行中" };
    }

    const runtime = await this.resolveProcessorRuntime();
    const processorRoot = runtime.runtimeRoot;
    if (!processorRoot) {
      return { success: false, error: "未找到素材剪辑运行时" };
    }

    this.log("开始检测并安装素材剪辑运行环境...");

    if (process.platform === "win32") {
      const installScript = path.join(processorRoot, "install.ps1");
      if (!fs.existsSync(installScript)) {
        return { success: false, error: "未找到 install.ps1 安装脚本" };
      }

      return this.spawnInstaller({
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          installScript,
        ],
        cwd: processorRoot,
      });
    }

    if (process.platform === "darwin") {
      const shellScript = [
        "set -e",
        "if ! command -v python3 >/dev/null 2>&1; then",
        '  echo "未找到 python3，请先安装 Python 3"',
        "  exit 1",
        "fi",
        "if ! command -v ffmpeg >/dev/null 2>&1; then",
        "  if command -v brew >/dev/null 2>&1; then",
        '    echo "正在通过 Homebrew 安装 ffmpeg..."',
        "    brew install ffmpeg",
        "  else",
        '    echo "未找到 ffmpeg，且系统没有 brew，无法自动安装"',
        "    exit 1",
        "  fi",
        "fi",
        'if [ ! -x ".venv/bin/python" ]; then',
        '  echo "创建 .venv 虚拟环境..."',
        "  python3 -m venv .venv",
        "fi",
        'echo "升级 pip..."',
        '".venv/bin/python" -m pip install --upgrade pip',
        'echo "安装 requirements.txt..."',
        '".venv/bin/python" -m pip install -r requirements.txt',
        'echo "安装 drama_processor 本地包..."',
        '".venv/bin/python" -m pip install -e .',
      ].join(" && ");

      return this.spawnInstaller({
        command: "/bin/bash",
        args: ["-lc", shellScript],
        cwd: processorRoot,
      });
    }

    return {
      success: false,
      error: `当前平台 ${process.platform} 暂不支持自动安装，请手动安装环境`,
    };
  }

  private async readSavedConfig(): Promise<MaterialClipConfig | null> {
    try {
      const raw = await fsp.readFile(this.configPath, "utf-8");
      return JSON.parse(raw) as MaterialClipConfig;
    } catch {
      return null;
    }
  }

  private async applyApiConfig(
    config: MaterialClipConfig,
  ): Promise<MaterialClipConfig> {
    const apiConfig = await this.configService.getApiConfig();
    const hasDisclaimerText = Boolean(config.disclaimer_text.trim());
    return {
      ...config,
      enable_disclaimer_text:
        config.enable_disclaimer_text || hasDisclaimerText,
      feishu: {
        ...config.feishu,
        app_id: apiConfig.feishuAppId,
        app_secret: apiConfig.feishuAppSecret,
        app_token: apiConfig.feishuAppToken,
      },
    };
  }

  private prepareConfigInput(config: unknown): MaterialClipConfig {
    if (!isPlainObject(config)) {
      throw new Error("配置必须是 JSON 对象");
    }

    const raw = config as Record<string, unknown>;
    const objectFields = [
      "video",
      "audio",
      "feishu",
      "feishu_watcher",
      "date_deduplication",
    ];

    for (const field of objectFields) {
      const value = raw[field];
      if (value !== undefined && !isPlainObject(value)) {
        throw new Error(`${field} 必须是对象`);
      }
    }

    if (
      raw.brand_text_mapping !== undefined &&
      raw.brand_text_mapping !== null &&
      !isPlainObject(raw.brand_text_mapping)
    ) {
      throw new Error("brand_text_mapping 必须是对象或 null");
    }

    if (
      raw.reference_resolution !== undefined &&
      raw.reference_resolution !== null &&
      (!Array.isArray(raw.reference_resolution) ||
        raw.reference_resolution.length !== 2 ||
        !raw.reference_resolution.every((item) => typeof item === "number"))
    ) {
      throw new Error("reference_resolution 必须是两个数字组成的数组或 null");
    }

    const stringArrayFields = [
      "title_colors",
      "hook_texts",
      "include",
      "exclude",
    ];
    for (const field of stringArrayFields) {
      const value = raw[field];
      if (value !== undefined && value !== null && !isStringArray(value)) {
        throw new Error(`${field} 必须是字符串数组或 null`);
      }
    }

    if (
      raw.floating_watermark_speed_range !== undefined &&
      raw.floating_watermark_speed_range !== null &&
      !isNumberArray(raw.floating_watermark_speed_range)
    ) {
      throw new Error("floating_watermark_speed_range 必须是数字数组");
    }

    return deepMerge(this.createDefaultConfig(), raw);
  }

  private createDefaultConfig(): MaterialClipConfig {
    return {
      active_user: "xh-daily",
      target_fps: 60,
      smart_fps: true,
      fast_mode: true,
      filter_threads: 2,
      verbose: false,
      min_duration: 480,
      max_duration: 900,
      count: 1,
      material_code: "xl",
      date_str: null,
      exclude_last_episodes: 8,
      title_font_size: 36,
      brand_font_size: 28,
      disclaimer_font_size: 28,
      disclaimer_text: "剧情纯属虚构 请勿模仿",
      enable_brand_text: true,
      enable_disclaimer_text: false,
      title_opacity: 0.9,
      bottom_opacity: 0.85,
      title_position: "top",
      title_colors: [
        "#00CED1",
        "#20B2AA",
        "#48D1CC",
        "#40E0D0",
        "#5F9EA0",
        "#00BFFF",
        "#1E90FF",
        "#4169E1",
        "#32CD32",
        "#00FA9A",
        "#7CFC00",
        "#98FB98",
        "#3CB371",
        "#00FF7F",
        "#90EE90",
        "#00FF00",
        "#FFA500",
        "#FFB347",
        "#FF8C00",
        "#FFD700",
        "#FFA07A",
        "#FF7F50",
        "#FFAE42",
        "#FF69B4",
        "#FFB6C1",
        "#FF1493",
        "#FF00FF",
        "#DA70D6",
        "#EE82EE",
        "#BA55D3",
        "#9370DB",
        "#8A2BE2",
        "#9932CC",
        "#9400D3",
        "#FFFF00",
        "#FFE600",
        "#FFD580",
        "#F0E68C",
        "#FF6347",
        "#FF4500",
        "#DC143C",
        "#FF0000",
      ],
      enable_hook_text: false,
      hook_texts: ["完结撒花", "独家首发", "追剧必看", "热播推荐", "火爆全网"],
      hook_font_size: 180,
      hook_duration: 3,
      hook_text_color: "#FFE600",
      random_start: true,
      seed: null,
      use_hardware: true,
      keep_temp: false,
      jobs: 1,
      canvas: null,
      reference_resolution: null,
      default_source_dir: "",
      backup_source_dir: "",
      temp_dir: null,
      output_dir: "",
      tail_cache_dir: null,
      tail_file: "assets/tail.mp4",
      refresh_tail_cache: false,
      font_file: null,
      brand_text: "热门短剧",
      brand_text_mapping: null,
      enable_floating_watermark: false,
      floating_watermark_font_size: 32,
      floating_watermark_alpha: 0.6,
      floating_watermark_speed_range: [80, 150],
      include: null,
      exclude: null,
      full: false,
      no_interactive: true,
      enable_deduplication: false,
      auto_delete_source_after_completion: false,
      video: {
        hw_codec: "auto",
        sw_codec: "libx264",
        bitrate: "6500k",
        max_rate: "6500k",
        buffer_size: "8000k",
        soft_crf: "24",
        preset: "veryfast",
        profile: "high",
        level: "4.2",
        hw_level: "4.2",
        sw_level: "4.1",
        tag: "avc1",
        pixel_format: "yuv420p",
        faststart: false,
      },
      audio: {
        codec: "aac",
        bitrate: "128k",
        sample_rate: 48000,
      },
      enable_feishu_features: true,
      feishu: {
        app_id: "",
        app_secret: "",
        app_token: "",
        table_id: "",
        base_url: "https://open.feishu.cn/open-apis/bitable/v1",
        field_names: ["剧名", "账户", "日期", "搭建时间", "主体"],
        status_field_name: "当前状态",
        pending_status_value: "待剪辑",
        completed_status_value: "待上传",
        processing_status_value: "剪辑中",
        missing_source_status_value: "无源视频",
        failed_status_value: "剪辑失败",
        remark_field_name: "备注",
        rating_field_name: "评级",
        priority_rating_value: "红标",
        upload_time_sort_desc: true,
        douyin_material_field_name: "抖音素材",
        page_size: 200,
        token_refresh_interval: 7200000,
      },
      feishu_watcher: {
        enabled: true,
        poll_interval: 1200,
        max_dates_per_cycle: 1,
        settle_seconds: 0,
        settle_rounds: 0,
        idle_exit_minutes: null,
        state_dir: "history/feishu_watcher",
        date_whitelist: [],
        date_blacklist: [],
        status_filter: null,
      },
      feishu_webhook_url: null,
      enable_feishu_notification: false,
      date_deduplication: {
        enabled: true,
        storage_dir: "history/date_dedup",
        skip_processed_by_default: false,
      },
    };
  }

  private async refreshPendingDramas(
    config?: MaterialClipConfig,
  ): Promise<void> {
    const resolvedConfig = config ?? (await this.getConfig());
    const pendingDramas = await this.fetchPendingDramas(resolvedConfig);
    const excludedRecordIds = new Set<string>();
    const excludedDramaNames = new Set<string>();

    if (this.runState.currentRecordId) {
      excludedRecordIds.add(this.runState.currentRecordId);
    }
    if (this.runState.currentDramaName) {
      excludedDramaNames.add(this.runState.currentDramaName);
    }

    for (const item of this.runState.processedDramas) {
      if (item.recordId) {
        excludedRecordIds.add(item.recordId);
      }
      if (item.dramaName) {
        excludedDramaNames.add(item.dramaName);
      }
    }

    this.runState.pendingDramas = pendingDramas.filter(
      (item) =>
        !excludedRecordIds.has(item.recordId) &&
        !excludedDramaNames.has(item.dramaName),
    );
    this.touchRunState();
    this.emitRunState();
  }

  private schedulePendingRefresh(delayMs = 600) {
    if (this.pendingRefreshTimer) {
      clearTimeout(this.pendingRefreshTimer);
    }

    this.pendingRefreshTimer = setTimeout(() => {
      this.pendingRefreshTimer = null;
      void this.refreshPendingDramasDuringWatch();
    }, delayMs);
  }

  private async refreshPendingDramasDuringWatch(): Promise<void> {
    if (this.pendingRefreshInFlight || !this.runState.running) {
      return;
    }

    this.pendingRefreshInFlight = true;
    try {
      await this.refreshPendingDramas();
    } catch (error) {
      console.error("[MaterialClip] 刷新待处理剧目失败:", error);
    } finally {
      this.pendingRefreshInFlight = false;
    }
  }

  private async fetchPendingDramas(
    config: MaterialClipConfig,
  ): Promise<MaterialClipPendingDrama[]> {
    if (!config.feishu.table_id.trim()) {
      return [];
    }

    const ratingField = config.feishu.rating_field_name || "评级";
    const douyinField =
      config.feishu.douyin_material_field_name || "抖音素材";
    const endpoint = `/open-apis/bitable/v1/apps/${config.feishu.app_token}/tables/${config.feishu.table_id}/records/search`;
    const payload = {
      field_names: ["剧名", "日期", "上架时间", ratingField, douyinField],
      page_size: config.feishu.page_size || 200,
      filter: {
        conjunction: "and",
        conditions: [
          {
            field_name: config.feishu.status_field_name,
            operator: "is",
            value: [config.feishu.pending_status_value],
          },
        ],
      },
      sort: [
        {
          field_name: "日期",
          desc: false,
        },
      ],
    };

    try {
      const response = (await this.apiService.feishuRequest(
        endpoint,
        payload,
        "POST",
        this.configService,
      )) as MaterialClipFeishuSearchResponse;

      if (response.code !== 0 || !response.data?.items) {
        return [];
      }

      return response.data.items
        .map((record, index) =>
          this.normalizePendingDrama(record, ratingField, douyinField, index),
        )
        .filter((item): item is MaterialClipPendingDrama => item !== null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`获取待剪辑列表失败：${message}`);
      return [];
    }
  }

  private normalizePendingDrama(
    record: MaterialClipFeishuRecord,
    ratingField: string,
    douyinField: string,
    index: number,
  ): MaterialClipPendingDrama | null {
    const dramaName = this.extractFieldText(record.fields["剧名"]);
    if (!dramaName) {
      return null;
    }

    const { date, fullDate } = this.parseFeishuDate(record.fields["日期"]);
    const uploadTime = this.parseFeishuTimestamp(record.fields["上架时间"]);

    return {
      order: index + 1,
      dramaName,
      recordId: record.record_id,
      date,
      fullDate,
      rating: this.extractFieldText(record.fields[ratingField]),
      uploadTime,
      plannedMaterials: this.parseDouyinMaterialCount(record.fields[douyinField]),
    };
  }

  private findPendingDramaCandidate(
    dramaName: string,
    dramaDate?: string | null,
  ): MaterialClipPendingDrama | undefined {
    const matchedByDate = this.runState.pendingDramas.find(
      (item) =>
        item.dramaName === dramaName && (!dramaDate || item.date === dramaDate),
    );
    if (matchedByDate) {
      return matchedByDate;
    }

    return this.runState.pendingDramas.find(
      (item) => item.dramaName === dramaName,
    );
  }

  private reindexPendingDramas() {
    this.runState.pendingDramas = this.runState.pendingDramas.map(
      (item, index) => ({
        ...item,
        order: index + 1,
      }),
    );
  }

  private parseDouyinMaterialCount(value: unknown): number | null {
    const configText = this.extractFieldText(value);
    if (!configText) {
      return null;
    }

    let maxNumber = 0;
    const lines = configText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) {
        continue;
      }

      const rangeText = parts[parts.length - 1];
      if (!/^\d+(?:-\d+|,\d+)*$/.test(rangeText)) {
        continue;
      }

      const numbers = rangeText
        .split(",")
        .flatMap((segment) => segment.split("-"))
        .map((segment) => Number(segment.trim()))
        .filter((segment) => Number.isFinite(segment));

      if (numbers.length === 0) {
        continue;
      }

      maxNumber = Math.max(maxNumber, ...numbers);
    }

    return maxNumber > 0 ? maxNumber : null;
  }

  private ensureCurrentDramaStarted(dramaName: string) {
    if (this.runState.currentDramaName !== dramaName) {
      this.runState.currentDramaStartedAt = new Date().toISOString();
      return;
    }

    if (!this.runState.currentDramaStartedAt) {
      this.runState.currentDramaStartedAt = new Date().toISOString();
    }
  }

  private upsertProcessedDrama(
    dramaName: string,
    completedMaterials: number,
    plannedMaterials: number,
  ) {
    const matched = this.findPendingDramaCandidate(
      dramaName,
      this.runState.currentDramaDate,
    );
    const startedAt = this.runState.currentDramaStartedAt;
    const elapsedSeconds = startedAt
      ? Math.max(
          0,
          Math.round((Date.now() - new Date(startedAt).getTime()) / 1000),
        )
      : null;
    const nextItem: MaterialClipProcessedDrama = {
      order: 0,
      dramaName,
      recordId: matched?.recordId || this.runState.currentRecordId || dramaName,
      date: matched?.date || this.runState.currentDramaDate || "未知",
      fullDate: matched?.fullDate || null,
      rating: matched?.rating || this.runState.currentDramaRating || null,
      plannedMaterials:
        matched?.plannedMaterials || plannedMaterials || completedMaterials || null,
      completedMaterials,
      completedAt: new Date().toISOString(),
      elapsedSeconds,
    };

    const existingIndex = this.runState.processedDramas.findIndex(
      (item) => item.recordId === nextItem.recordId,
    );
    if (existingIndex >= 0) {
      this.runState.processedDramas[existingIndex] = {
        ...this.runState.processedDramas[existingIndex],
        ...nextItem,
      };
    } else {
      this.runState.processedDramas.push(nextItem);
    }

    this.runState.processedDramas = this.runState.processedDramas.map(
      (item, index) => ({
        ...item,
        order: index + 1,
      }),
    );
  }

  private normalizeDisplayText(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    if (!normalized || normalized === "未知" || normalized === "未知日期") {
      return null;
    }
    return normalized;
  }

  private extractFieldTexts(value: unknown): string[] {
    if (value === null || value === undefined) {
      return [];
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return [String(value)];
    }

    if (Array.isArray(value)) {
      return value.flatMap((item) => this.extractFieldTexts(item));
    }

    if (!isPlainObject(value)) {
      return [];
    }

    const textCandidates = ["text", "name", "label"];
    for (const field of textCandidates) {
      const candidate = value[field];
      if (typeof candidate === "string" && candidate.trim()) {
        return [candidate];
      }
    }

    const nestedCandidates = ["value", "values"];
    for (const field of nestedCandidates) {
      const candidate = value[field];
      if (candidate !== undefined && candidate !== null) {
        const texts = this.extractFieldTexts(candidate);
        if (texts.length > 0) {
          return texts;
        }
      }
    }

    return [];
  }

  private extractFieldText(value: unknown): string | null {
    const text = this.extractFieldTexts(value)
      .map((item) => item.trim())
      .find(Boolean);
    return text || null;
  }

  private parseFeishuTimestamp(value: unknown): number | null {
    const raw = this.extractFieldText(value);
    if (!raw) {
      return null;
    }

    if (/^\d+$/.test(raw)) {
      return Number(raw);
    }

    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) {
      return null;
    }

    return parsed;
  }

  private parseFeishuDate(value: unknown): {
    date: string;
    fullDate: string | null;
  } {
    const raw = this.extractFieldText(value);
    if (!raw) {
      return { date: "未知", fullDate: null };
    }

    if (/^\d+$/.test(raw)) {
      const date = new Date(Number(raw));
      return {
        date: `${date.getMonth() + 1}.${date.getDate()}`,
        fullDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      };
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [, month, day] = raw.split("-");
      return {
        date: `${Number(month)}.${Number(day)}`,
        fullDate: raw,
      };
    }

    if (/^\d{1,2}\.\d{1,2}$/.test(raw)) {
      const [month, day] = raw.split(".");
      return {
        date: `${Number(month)}.${Number(day)}`,
        fullDate: null,
      };
    }

    if (/^\d{1,2}-\d{1,2}$/.test(raw)) {
      const [month, day] = raw.split("-");
      return {
        date: `${Number(month)}.${Number(day)}`,
        fullDate: null,
      };
    }

    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      const date = new Date(parsed);
      return {
        date: `${date.getMonth() + 1}.${date.getDate()}`,
        fullDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      };
    }

    return {
      date: raw,
      fullDate: null,
    };
  }

  private async revertRecordToPending(recordId: string): Promise<void> {
    const config = await this.getConfig();
    const updated = await this.apiService.updateFeishuRecordStatus(
      recordId,
      config.feishu.pending_status_value,
      this.configService,
      config.feishu.table_id,
    );

    if (!updated) {
      throw new Error("飞书状态回退失败");
    }
  }

  private async terminateProcess(
    child: ChildProcessByStdio<null, Readable, Readable>,
  ): Promise<void> {
    if (child.killed) {
      return;
    }

    if (process.platform === "win32" && child.pid) {
      await new Promise<void>((resolve, reject) => {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/t", "/f"],
          {
            stdio: ["ignore", "pipe", "pipe"],
          },
        );

        let stderr = "";
        killer.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        killer.once("error", reject);
        killer.once("close", (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(stderr.trim() || `taskkill 退出码 ${code ?? -1}`));
        });
      });
      return;
    }

    child.kill("SIGTERM");
  }

  private log(message: string) {
    const entry = {
      time: new Date().toLocaleTimeString(),
      message,
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    console.log(`[MaterialClip] ${message}`);
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("material-clip:log", entry);
    }
  }

  private updateRunStateFromLine(line: string) {
    if (!this.runState.running) {
      return;
    }

    let shouldRefreshPending = false;

    const selectedDramaMatch = line.match(/🎯 选择处理：\[(.+?)\]\s+(.+)$/);
    if (selectedDramaMatch) {
      const [, rawDate, dramaName] = selectedDramaMatch;
      const date = this.normalizeDisplayText(rawDate);
      this.ensureCurrentDramaStarted(dramaName);
      this.runState.currentDramaName = dramaName;
      this.runState.currentDramaDate = date;
      this.runState.message = `正在处理《${dramaName}》`;
      const matched = this.findPendingDramaCandidate(dramaName, date ?? null);
      if (matched) {
        this.runState.currentDramaRating = matched.rating;
        this.runState.currentRecordId = matched.recordId;
        if (
          this.runState.totalMaterials <= 0 &&
          matched.plannedMaterials &&
          matched.plannedMaterials > 0
        ) {
          this.runState.totalMaterials = matched.plannedMaterials;
          this.runState.completedMaterials = 0;
          this.runState.remainingMaterials = matched.plannedMaterials;
        }
      }
      shouldRefreshPending = true;
    }

    const statusMatch = line.match(/已更新 '(.+)' 状态为 ?'(.+)'/);
    if (statusMatch) {
      const [, dramaName, nextStatus] = statusMatch;
      if (nextStatus === "剪辑中") {
        this.markDramaAsCurrent(dramaName);
        shouldRefreshPending = true;
      } else if (nextStatus === "待上传") {
        this.completeCurrentDrama(dramaName);
        shouldRefreshPending = true;
      }
    }

    const planTotalMatch = line.match(/计划生成：(\d+)\s*条/);
    if (planTotalMatch) {
      const dramaName =
        line.match(/===\s*(.+?)\s+\|/)?.[1] ?? this.runState.currentDramaName;
      const total = Number(planTotalMatch[1]);
      if (!dramaName) {
        this.touchRunState();
        this.emitRunState();
        return;
      }
      this.markDramaAsCurrent(dramaName);
      this.runState.totalMaterials = total;
      this.runState.completedMaterials = 0;
      this.runState.remainingMaterials = total;
      this.runState.message = `正在处理《${dramaName}》，共 ${total} 条素材`;
    }

    if (line.includes("素材完成")) {
      const dramaName =
        line.match(/剧：(.+?)\s+\|/)?.[1] ?? this.runState.currentDramaName;
      const completed = line.match(/第 (\d+) 条/)?.[1];
      const remaining = line.match(/该剧剩余素材：(\d+) 条/)?.[1];
      if (!dramaName || !completed) {
        this.touchRunState();
        this.emitRunState();
        return;
      }

      const completedCount = Number(completed);
      const remainingCount =
        remaining !== undefined
          ? Number(remaining)
          : Math.max(this.runState.totalMaterials - completedCount, 0);
      this.markDramaAsCurrent(dramaName);
      this.runState.completedMaterials = completedCount;
      this.runState.remainingMaterials = remainingCount;
      this.runState.totalMaterials = Math.max(
        this.runState.totalMaterials,
        completedCount + remainingCount,
      );
      if (this.runState.totalMaterials > 0) {
        this.runState.message = `正在处理《${dramaName}》，已完成 ${completedCount}/${this.runState.totalMaterials}`;
      }
    }

    const dramaDoneMatch = line.match(
      /本剧完成 \| (.+?) \| 本轮生成 (\d+)\/(\d+) 条/,
    );
    if (dramaDoneMatch) {
      const [, dramaName, completed, total] = dramaDoneMatch;
      this.markDramaAsCurrent(dramaName);
      this.runState.completedMaterials = Number(completed);
      this.runState.totalMaterials = Number(total);
      this.runState.remainingMaterials = 0;
      this.upsertProcessedDrama(
        dramaName,
        Number(completed),
        Number(total),
      );
      this.runState.message = `《${dramaName}》已完成，生成 ${completed}/${total} 条素材`;
      shouldRefreshPending = true;
    }

    if (
      line.includes("启动飞书轮询") ||
      line.includes("查询飞书") ||
      line.includes("当前没有待剪辑的剧") ||
      line.includes("所有待剪辑的剧已处理完成") ||
      line.includes("日期任务完成，立即查找其他日期的待剪辑剧")
    ) {
      shouldRefreshPending = true;
    }

    if (shouldRefreshPending && this.runState.mode === "auto") {
      this.schedulePendingRefresh();
    }

    this.touchRunState();
    this.emitRunState();
  }

  private markDramaAsCurrent(dramaName: string, dramaDate?: string | null) {
    this.ensureCurrentDramaStarted(dramaName);
    this.runState.currentDramaName = dramaName;
    this.runState.currentDramaDate =
      this.normalizeDisplayText(dramaDate) ?? this.runState.currentDramaDate;
    const matched = this.findPendingDramaCandidate(
      dramaName,
      this.runState.currentDramaDate,
    );
    if (!matched) {
      return;
    }

    this.runState.currentDramaDate = this.normalizeDisplayText(matched.date);
    this.runState.currentDramaRating = matched.rating;
    this.runState.currentRecordId = matched.recordId;
    if (
      this.runState.totalMaterials <= 0 &&
      matched.plannedMaterials &&
      matched.plannedMaterials > 0
    ) {
      this.runState.totalMaterials = matched.plannedMaterials;
      this.runState.completedMaterials = 0;
      this.runState.remainingMaterials = matched.plannedMaterials;
    }
    this.runState.pendingDramas = this.runState.pendingDramas.filter(
      (item) => item.recordId !== matched.recordId,
    );
    this.reindexPendingDramas();
  }

  private completeCurrentDrama(dramaName: string) {
    if (
      this.runState.currentDramaName &&
      this.runState.currentDramaName !== dramaName
    ) {
      this.markDramaAsCurrent(dramaName);
    }
    this.runState.completedMaterials = this.runState.totalMaterials;
    this.runState.remainingMaterials = 0;
  }

  private async resolveProcessorRuntime(): Promise<{
    source: MaterialClipRuntimeSource;
    runtimeRoot: string | null;
  }> {
    return await resolveRuntime({
      appPath: app.getAppPath(),
      cwd: process.cwd(),
      userDataPath: app.getPath("userData"),
      isPackaged: app.isPackaged,
      statePath: this.runtimeStatePath,
    });
  }

  private resolvePythonCommand(processorRoot: string): PythonCommand {
    const candidates: PythonCommand[] =
      process.platform === "win32"
        ? [
            {
              command: path.join(
                processorRoot,
                ".venv",
                "Scripts",
                "python.exe",
              ),
              prefixArgs: [],
            },
            {
              command: path.join(
                processorRoot,
                "venv",
                "Scripts",
                "python.exe",
              ),
              prefixArgs: [],
            },
            { command: "py", prefixArgs: ["-3"] },
            { command: "python", prefixArgs: [] },
          ]
        : [
            {
              command: path.join(processorRoot, ".venv", "bin", "python"),
              prefixArgs: [],
            },
            {
              command: path.join(processorRoot, "venv", "bin", "python"),
              prefixArgs: [],
            },
            { command: "python3", prefixArgs: [] },
            { command: "python", prefixArgs: [] },
          ];

    for (const candidate of candidates) {
      if (
        !candidate.command.includes(path.sep) ||
        fs.existsSync(candidate.command)
      ) {
        return candidate;
      }
    }

    return {
      command: process.platform === "win32" ? "py" : "python3",
      prefixArgs: [],
    };
  }

  private async writeRuntimeConfig(config: MaterialClipConfig): Promise<void> {
    await fsp.writeFile(
      this.runtimeRunConfigPath,
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  }

  private attachLineLogger(stream: NodeJS.ReadableStream, isError = false) {
    let buffer = "";
    stream.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        this.log(isError ? `[stderr] ${trimmed}` : trimmed);
        this.updateRunStateFromLine(trimmed);
      }
    });
    stream.on("end", () => {
      const trimmed = buffer.trim();
      if (trimmed) {
        this.log(isError ? `[stderr] ${trimmed}` : trimmed);
        this.updateRunStateFromLine(trimmed);
      }
    });
  }

  private isInstallSupported(processorRoot: string): boolean {
    if (process.platform === "win32") {
      return fs.existsSync(path.join(processorRoot, "install.ps1"));
    }

    if (process.platform === "darwin") {
      return true;
    }

    return false;
  }

  private async readActiveUser(
    processorRoot: string | null,
  ): Promise<string | null> {
    if (!processorRoot) {
      return null;
    }

    try {
      const configPath = path.join(processorRoot, "configs", "default.yaml");
      const content = await fsp.readFile(configPath, "utf-8");
      const matched = content.match(/active_user:\s*(\S+)/);
      return matched?.[1] || null;
    } catch {
      return null;
    }
  }

  private async checkFfmpeg(processorRoot: string): Promise<{
    key: string;
    label: string;
    passed: boolean;
    detail: string;
  }> {
    const bundledPath =
      process.platform === "win32"
        ? path.join(processorRoot, "bin", "ffmpeg.exe")
        : path.join(processorRoot, "bin", "ffmpeg");

    if (fs.existsSync(bundledPath)) {
      return {
        key: "ffmpeg",
        label: "FFmpeg",
        passed: true,
        detail: `检测到内置 FFmpeg：${bundledPath}`,
      };
    }

    const command = process.platform === "win32" ? "where" : "which";
    const args = process.platform === "win32" ? ["ffmpeg"] : ["ffmpeg"];
    const result = await this.runCommand(command, args, processorRoot);
    return {
      key: "ffmpeg",
      label: "FFmpeg",
      passed: result.success,
      detail: result.success
        ? result.output || "已在系统 PATH 中找到 FFmpeg"
        : result.error || "未检测到 FFmpeg",
    };
  }

  private async checkPythonAvailability(
    pythonCommand: PythonCommand,
    processorRoot: string,
  ): Promise<{
    key: string;
    label: string;
    passed: boolean;
    detail: string;
  }> {
    const result = await this.runCommand(
      pythonCommand.command,
      [...pythonCommand.prefixArgs, "--version"],
      processorRoot,
    );
    return {
      key: "python",
      label: "Python",
      passed: result.success,
      detail: result.success
        ? `${pythonCommand.command} ${result.output}`.trim()
        : result.error || `无法执行 ${pythonCommand.command}`,
    };
  }

  private async checkProcessorCommand(
    processorRoot: string,
    pythonCommand: PythonCommand,
  ): Promise<{
    key: string;
    label: string;
    passed: boolean;
    detail: string;
  }> {
    const result = await this.runCommand(
      pythonCommand.command,
      [...pythonCommand.prefixArgs, "-m", "drama_processor", "--help"],
      processorRoot,
      {
        PYTHONPATH: path.join(processorRoot, "src"),
        DRAMA_PROCESSOR_DEV_BYPASS: "1",
      },
    );

    return {
      key: "processor-command",
      label: "drama_processor 命令",
      passed: result.success,
      detail: result.success
        ? "可以正常执行 `python -m drama_processor --help`"
        : result.error || "无法执行 drama_processor 命令",
    };
  }

  private async runCommand(
    command: string,
    args: string[],
    cwd: string,
    extraEnv?: Record<string, string>,
  ): Promise<{ success: boolean; output: string; error?: string }> {
    return await new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          ...extraEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.once("error", (error) => {
        resolve({
          success: false,
          output: stdout.trim(),
          error: error.message,
        });
      });

      child.once("close", (code) => {
        if (code === 0) {
          resolve({
            success: true,
            output: `${stdout}\n${stderr}`.trim(),
          });
          return;
        }

        resolve({
          success: false,
          output: stdout.trim(),
          error: `${stderr || stdout}`.trim() || `命令退出码 ${code ?? -1}`,
        });
      });
    });
  }

  private async spawnInstaller(params: {
    command: string;
    args: string[];
    cwd: string;
  }): Promise<MaterialClipInstallResult> {
    this.log(`开始执行环境安装：${params.command} ${params.args.join(" ")}`);

    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.installingProcess = child;
    this.attachLineLogger(child.stdout, false);
    this.attachLineLogger(child.stderr, true);

    return await new Promise<MaterialClipInstallResult>((resolve) => {
      let settled = false;

      child.once("error", (error) => {
        this.installingProcess = null;
        if (settled) {
          return;
        }
        settled = true;
        resolve({
          success: false,
          error: `环境安装启动失败：${error.message}`,
        });
      });

      child.once("close", (code) => {
        this.installingProcess = null;
        if (settled) {
          return;
        }
        settled = true;
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: `环境安装失败，退出码 ${code ?? -1}`,
          });
        }
      });
    });
  }

  private async startProcess(params: {
    mode: "auto" | "manual";
    config: MaterialClipConfig;
    extraArgs: string[];
  }): Promise<MaterialClipRunResult> {
    const environmentStatus = await this.getEnvironmentStatus();
    if (!environmentStatus.ready) {
      return {
        success: false,
        error: "素材剪辑环境未就绪，请先完成环境安装",
      };
    }

    if (this.runningProcess) {
      return { success: false, error: "当前已有素材剪辑任务正在运行" };
    }

    if (!params.config.default_source_dir.trim()) {
      return { success: false, error: "请先配置本地源目录" };
    }

    if (!fs.existsSync(params.config.default_source_dir)) {
      return { success: false, error: "本地源目录不存在" };
    }

    const runtime = await this.resolveProcessorRuntime();
    const processorRoot = runtime.runtimeRoot;
    if (!processorRoot) {
      return { success: false, error: "未找到素材剪辑运行时" };
    }

    const pendingDramas =
      params.mode === "auto"
        ? await this.fetchPendingDramas(params.config)
        : [];

    this.runState = {
      running: true,
      mode: params.mode,
      status: "running",
      pid: null,
      pendingDramas,
      processedDramas: [],
      currentDramaName: null,
      currentDramaDate: null,
      currentDramaRating: null,
      currentRecordId: null,
      currentDramaStartedAt: null,
      totalMaterials: 0,
      completedMaterials: 0,
      remainingMaterials: 0,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      message:
        params.mode === "auto"
          ? `飞书轮询准备启动，当前待处理 ${pendingDramas.length} 部剧`
          : "手动剪辑准备开始",
    };
    this.emitRunState();

    const runtimeConfig = await this.applyApiConfig(params.config);
    await this.writeRuntimeConfig(runtimeConfig);

    const pythonCommand = this.resolvePythonCommand(processorRoot);
    const args = [
      ...pythonCommand.prefixArgs,
      "-m",
      "drama_processor",
      "-c",
      this.runtimeRunConfigPath,
      ...params.extraArgs,
    ];
    const pythonPath = path.join(processorRoot, "src");
    const env = {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH
        ? `${pythonPath}${path.delimiter}${process.env.PYTHONPATH}`
        : pythonPath,
      DRAMA_PROCESSOR_DEV_BYPASS: "1",
    };

    this.log(
      `${params.mode === "auto" ? "自动剪辑" : "手动剪辑"}启动：${pythonCommand.command} ${args.join(" ")}`,
    );

    const child = spawn(pythonCommand.command, args, {
      cwd: processorRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.runningProcess = child;
    this.attachLineLogger(child.stdout, false);
    this.attachLineLogger(child.stderr, true);

    child.on("close", (code, signal) => {
      if (signal) {
        this.log(`素材剪辑进程已结束，signal=${signal}`);
      } else {
        this.log(`素材剪辑进程已结束，exitCode=${code ?? -1}`);
      }
      this.runningProcess = null;
      void this.handleProcessExit(code, signal);
    });

    return await new Promise<MaterialClipRunResult>((resolve) => {
      let settled = false;

      child.once("spawn", () => {
        if (settled) {
          return;
        }
        this.runState.pid = child.pid ?? null;
        this.touchRunState();
        this.emitRunState();
        settled = true;
        resolve({
          success: true,
          pid: child.pid,
        });
      });

      child.once("error", (error) => {
        this.log(`素材剪辑进程启动失败：${error.message}`);
        this.runningProcess = null;
        this.runState.running = false;
        this.runState.mode = "idle";
        this.runState.status = "failed";
        this.runState.pid = null;
        this.runState.message = `素材剪辑进程启动失败：${error.message}`;
        this.touchRunState();
        this.emitRunState();
        if (settled) {
          return;
        }
        settled = true;
        resolve({
          success: false,
          error: `素材剪辑进程启动失败：${error.message}`,
        });
      });
    });
  }

  private async handleProcessExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ) {
    if (this.pendingRefreshTimer) {
      clearTimeout(this.pendingRefreshTimer);
      this.pendingRefreshTimer = null;
    }
    this.pendingRefreshInFlight = false;

    const wasStopping = this.runState.status === "stopping";
    this.runState.running = false;
    this.runState.pid = null;
    this.runState.currentDramaStartedAt = null;

    if (wasStopping) {
      this.runState.mode = "idle";
      this.runState.status = "stopped";
      this.runState.message = "飞书轮询已停止";
    } else if (code === 0) {
      this.runState.mode = "idle";
      this.runState.status = "completed";
      this.runState.message = "飞书轮询已结束";
    } else {
      this.runState.mode = "idle";
      this.runState.status = "failed";
      this.runState.message = signal
        ? `素材剪辑被中断（${signal}）`
        : `素材剪辑异常结束，退出码 ${code ?? -1}`;
    }

    if (this.runState.mode === "idle") {
      await this.refreshPendingDramas();
    }

    this.touchRunState();
    this.emitRunState();
  }
}
