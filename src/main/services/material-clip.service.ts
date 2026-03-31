import { app, BrowserWindow, dialog } from "electron";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { spawn, type ChildProcessByStdio } from "child_process";
import type { Readable } from "stream";
import { load } from "js-yaml";
import type { ApiService } from "./api.service";
import type { ConfigService } from "./config.service";
import {
  FIXED_FEISHU_APP_ID,
  FIXED_FEISHU_APP_SECRET,
  FIXED_FEISHU_APP_TOKEN,
} from "../constants/fixed-config";
import {
  importRuntimeCandidate,
  resolveRuntime,
  type MaterialClipRuntimeSource,
} from "./material-clip-runtime";

const DEFAULT_CLIP_CANVAS = "720x1280";
const DEFAULT_CLIP_REFERENCE_RESOLUTION: [number, number] = [720, 1280];

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
  highlight_start_field_name: string;
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

export interface MaterialClipAiHighlightConfig {
  enabled: boolean;
  script_path: string;
  only_priority_rating: boolean;
  dashscope_api_key: string;
  model_name: string;
  group_count: number;
  target_highlights_per_drama: number;
  group_highlight_buffer: number;
  video_fps: number;
  analyze_first_portion_only: boolean;
  analyze_portion_ratio: number;
  auto_retry_insufficient_groups: boolean;
  max_auto_retry_rounds: number;
  use_dashscope_proxy: boolean;
}

export interface MaterialClipConfig {
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
  ai_highlight: MaterialClipAiHighlightConfig;
  highlight_start_points_by_drama: Record<string, string> | null;
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
  highlightStartPoints: string | null;
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
  pollIntervalSeconds: number | null;
  lastPollAt: string | null;
  nextPollAt: string | null;
  message: string;
}

export interface MaterialClipAiHighlightDrama {
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

export interface MaterialClipAiHighlightState {
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
  private runtimeRunConfigPath: string;
  private runtimeStatePath: string;
  private managedRuntimeRootDir: string;
  private logs: MaterialClipLogEntry[] = [];
  private maxLogs = 500;
  private mainWindow: BrowserWindow | null = null;
  private runningProcess: ChildProcessByStdio<null, Readable, Readable> | null =
    null;
  private aiHighlightProcess: ChildProcessByStdio<null, Readable, Readable> | null =
    null;
  private installingProcess: ChildProcessByStdio<
    null,
    Readable,
    Readable
  > | null = null;
  private readonly configService: ConfigService;
  private readonly apiService: ApiService;
  private runState: MaterialClipRunState = this.createEmptyRunState();
  private aiHighlightState: MaterialClipAiHighlightState =
    this.createEmptyAiHighlightState();
  private activeRunConfig: MaterialClipConfig | null = null;
  private pendingRefreshTimer: NodeJS.Timeout | null = null;
  private pendingRefreshInFlight = false;

  constructor(configService: ConfigService, apiService: ApiService) {
    const userDataPath = app.getPath("userData");
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

  async getAiHighlightState(): Promise<MaterialClipAiHighlightState> {
    if (!this.aiHighlightState.running && this.aiHighlightState.status === "idle") {
      await this.refreshAiHighlightQueue();
    }
    return this.getAiHighlightStateSnapshot();
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
    const currentDramaCandidate = this.findPendingDramaCandidate(
      this.runState.currentDramaName || "",
      this.runState.currentDramaDate,
    );
    const currentRecordId =
      this.runState.currentRecordId ??
      currentDramaCandidate?.recordId ??
      null;
    const currentDramaName =
      this.runState.currentDramaName ?? currentDramaCandidate?.dramaName ?? null;
    const currentDramaDate =
      this.runState.currentDramaDate ?? currentDramaCandidate?.date ?? null;

    try {
      const config = this.activeRunConfig ?? (await this.getConfig());
      await this.terminateProcess(processToStop);

      const cleanupErrors: string[] = [];
      let removedExportDir: string | null = null;

      if (currentRecordId) {
        try {
          await this.revertRecordToPending(currentRecordId, config);
        } catch (error) {
          cleanupErrors.push(
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      if (currentDramaName) {
        try {
          removedExportDir = await this.removeDramaExportDir(
            config,
            currentDramaName,
            currentDramaDate,
          );
        } catch (error) {
          cleanupErrors.push(
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      await this.refreshPendingDramas(config);
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
      if (cleanupErrors.length > 0) {
        this.runState.message =
          "轮询剪辑已停止，但部分收尾操作失败，请查看日志";
      } else {
        this.runState.message = removedExportDir
          ? "轮询剪辑已停止，当前剧目已回退为待剪辑并清理导出目录"
          : "轮询剪辑已停止，当前剧目已回退为待剪辑";
      }
      this.touchRunState();
      this.emitRunState();
      return cleanupErrors.length > 0
        ? { success: false, error: cleanupErrors.join("；") }
        : { success: true };
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
      pollIntervalSeconds: null,
      lastPollAt: null,
      nextPollAt: null,
      message: "等待开始剪辑",
    };
  }

  private createEmptyAiHighlightState(): MaterialClipAiHighlightState {
    return {
      running: false,
      status: "idle",
      message: "等待开始高光识别",
      totalPending: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      dramas: [],
      startedAt: null,
      lastUpdatedAt: null,
    };
  }

  private getRunStateSnapshot(): MaterialClipRunState {
    return {
      ...this.runState,
      pendingDramas: this.runState.pendingDramas.map((item) => ({ ...item })),
      processedDramas: this.sortAndReindexProcessedDramas(
        this.runState.processedDramas,
      ),
    };
  }

  private getAiHighlightStateSnapshot(): MaterialClipAiHighlightState {
    return {
      ...this.aiHighlightState,
      dramas: this.aiHighlightState.dramas.map((item) => ({ ...item })),
    };
  }

  private touchRunState() {
    this.runState.lastUpdatedAt = new Date().toISOString();
  }

  private touchAiHighlightState() {
    this.aiHighlightState.lastUpdatedAt = new Date().toISOString();
  }

  private markPollCycleStarted(at = new Date()) {
    if (this.runState.mode !== "auto") {
      return;
    }

    this.runState.lastPollAt = at.toISOString();
    if (
      this.runState.pollIntervalSeconds &&
      this.runState.pollIntervalSeconds > 0
    ) {
      this.runState.nextPollAt = new Date(
        at.getTime() + this.runState.pollIntervalSeconds * 1000,
      ).toISOString();
      return;
    }

    this.runState.nextPollAt = null;
  }

  private scheduleNextPoll(at = new Date()) {
    if (
      this.runState.mode !== "auto" ||
      !this.runState.pollIntervalSeconds ||
      this.runState.pollIntervalSeconds <= 0
    ) {
      this.runState.nextPollAt = null;
      return;
    }

    this.runState.nextPollAt = new Date(
      at.getTime() + this.runState.pollIntervalSeconds * 1000,
    ).toISOString();
  }

  private clearPollingSchedule() {
    this.runState.nextPollAt = null;
  }

  private emitRunState() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(
        "material-clip:state",
        this.getRunStateSnapshot(),
      );
    }
  }

  private emitAiHighlightState() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(
        "material-clip:ai-highlight-state",
        this.getAiHighlightStateSnapshot(),
      );
    }
  }

  async getConfig(configOverride?: unknown): Promise<MaterialClipConfig> {
    const config =
      configOverride === undefined
        ? await this.createDefaultConfig()
        : await this.prepareConfigInput(configOverride);
    return this.applyApiConfig(config);
  }

  getLogs(): MaterialClipLogEntry[] {
    return [...this.logs];
  }

  clearLogs(): { success: boolean } {
    this.logs = [];
    return { success: true };
  }

  clearProcessedDramas(): { success: boolean } {
    this.runState.processedDramas = [];
    this.touchRunState();
    this.emitRunState();
    return { success: true };
  }

  async refreshPendingQueue(configOverride?: unknown): Promise<MaterialClipRunState> {
    const config = await this.getConfig(configOverride);
    await this.refreshPendingDramas(config);
    return this.getRunStateSnapshot();
  }

  async refreshAiHighlightQueue(
    configOverride?: unknown,
  ): Promise<MaterialClipAiHighlightState> {
    const config = await this.getConfig(configOverride);
    const dramas = await this.buildAiHighlightDramaList(config);
    this.aiHighlightState = {
      running: false,
      status: "idle",
      message:
        dramas.length > 0
          ? `已匹配 ${dramas.filter((item) => item.sourceMatched).length} 部可识别剧目`
          : "当前没有可识别的待剪辑剧",
      totalPending: dramas.length,
      matchedCount: dramas.filter((item) => item.sourceMatched).length,
      unmatchedCount: dramas.filter((item) => !item.sourceMatched).length,
      dramas,
      startedAt: null,
      lastUpdatedAt: new Date().toISOString(),
    };
    this.emitAiHighlightState();
    return this.getAiHighlightStateSnapshot();
  }

  async runAiHighlightRecognition(
    configOverride?: unknown,
  ): Promise<{ success: boolean; error?: string }> {
    const config = await this.getConfig(configOverride);
    if (!config.ai_highlight.enabled) {
      return { success: false, error: "请先开启 AI 智能高光" };
    }

    if (!config.ai_highlight.dashscope_api_key.trim()) {
      return { success: false, error: "请先填写 DASHSCOPE API Key" };
    }

    const environmentStatus = await this.getEnvironmentStatus();
    if (!environmentStatus.ready) {
      return { success: false, error: "素材剪辑环境未就绪，请先完成运行时导入和环境安装" };
    }

    if (this.runningProcess) {
      return { success: false, error: "素材剪辑运行中，暂时不能执行 AI 高光识别" };
    }

    if (this.aiHighlightProcess) {
      return { success: false, error: "AI 高光识别任务已在运行中" };
    }

    const dramas = await this.buildAiHighlightDramaList(config);
    const matchedDramas = dramas.filter((item) => item.sourceMatched);
    if (matchedDramas.length === 0) {
      this.aiHighlightState = {
        running: false,
        status: "failed",
        message: "没有匹配到本地源素材目录中的待剪辑剧",
        totalPending: dramas.length,
        matchedCount: 0,
        unmatchedCount: dramas.length,
        dramas,
        startedAt: null,
        lastUpdatedAt: new Date().toISOString(),
      };
      this.emitAiHighlightState();
      return { success: false, error: this.aiHighlightState.message };
    }

    this.aiHighlightState = {
      running: true,
      status: "running",
      message: `开始识别 ${matchedDramas.length} 部剧的 AI 高光`,
      totalPending: dramas.length,
      matchedCount: matchedDramas.length,
      unmatchedCount: dramas.length - matchedDramas.length,
      dramas,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
    this.emitAiHighlightState();

    try {
      for (const drama of matchedDramas) {
        await this.runSingleAiHighlightDrama(drama, config);
      }

      const failedCount = this.aiHighlightState.dramas.filter(
        (item) => item.status === "failed",
      ).length;
      this.aiHighlightState.running = false;
      this.aiHighlightState.status = failedCount > 0 ? "failed" : "completed";
      this.aiHighlightState.message =
        failedCount > 0
          ? `AI 高光识别完成，其中 ${failedCount} 部失败`
          : "AI 高光识别已全部完成";
      this.touchAiHighlightState();
      this.emitAiHighlightState();
      return failedCount > 0
        ? { success: false, error: this.aiHighlightState.message }
        : { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.aiHighlightState.running = false;
      this.aiHighlightState.status = "failed";
      this.aiHighlightState.message = `AI 高光识别失败：${message}`;
      this.touchAiHighlightState();
      this.emitAiHighlightState();
      return { success: false, error: this.aiHighlightState.message };
    }
  }

  async runAutoClip(configOverride?: unknown): Promise<MaterialClipRunResult> {
    const config = await this.getConfig(configOverride);
    if (!config.feishu.table_id.trim()) {
      return { success: false, error: "请先配置飞书 table_id" };
    }

    const autoConfig: MaterialClipConfig = {
      ...config,
      enable_feishu_features: true,
      output_dir: "",
    };

    return this.startProcess({
      mode: "auto",
      config: autoConfig,
      extraArgs: ["feishu", "watch"],
    });
  }

  async runManualClip(
    dramaNames: string,
    configOverride?: unknown,
  ): Promise<MaterialClipRunResult> {
    const normalizedDramaNames = dramaNames
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (normalizedDramaNames.length === 0) {
      return { success: false, error: "请输入至少一个剧名" };
    }

    const config = await this.getConfig(configOverride);
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

  private async prepareConfigInput(config: unknown): Promise<MaterialClipConfig> {
    if (!isPlainObject(config)) {
      throw new Error("配置必须是 JSON 对象");
    }

    const raw = { ...(config as Record<string, unknown>) };
    delete raw.active_user;
    const objectFields = [
      "video",
      "audio",
      "feishu",
      "feishu_watcher",
      "date_deduplication",
      "ai_highlight",
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

    if (
      raw.highlight_start_points_by_drama !== undefined &&
      raw.highlight_start_points_by_drama !== null &&
      !isPlainObject(raw.highlight_start_points_by_drama)
    ) {
      throw new Error("highlight_start_points_by_drama 必须是对象或 null");
    }

    const baseConfig = await this.createDefaultConfig();
    return this.normalizeMaterialClipConfig(deepMerge(baseConfig, raw));
  }

  private async createDefaultConfig(): Promise<MaterialClipConfig> {
    const fallbackConfig = this.createFallbackDefaultConfig();
    const yamlConfig = await this.loadDefaultConfigFromYaml();
    if (!yamlConfig) {
      return fallbackConfig;
    }

    const mergedConfig = deepMerge(fallbackConfig, yamlConfig);
    mergedConfig.enable_feishu_features = true;
    return this.normalizeMaterialClipConfig(mergedConfig);
  }

  private async loadDefaultConfigFromYaml(): Promise<unknown | null> {
    const configPath = await this.resolveDefaultConfigPath();
    if (!configPath) {
      return null;
    }

    try {
      const content = await fsp.readFile(configPath, "utf-8");
      const parsed = load(content, { json: true });
      return isPlainObject(parsed) ? parsed : null;
    } catch (error) {
      console.error("[MaterialClip] 读取 default.yaml 失败:", error);
      return null;
    }
  }

  private async resolveDefaultConfigPath(): Promise<string | null> {
    const runtime = await this.resolveProcessorRuntime();
    if (!runtime.runtimeRoot) {
      return null;
    }

    const configPath = path.join(runtime.runtimeRoot, "configs", "default.yaml");
    return fs.existsSync(configPath) ? configPath : null;
  }

  private normalizeMaterialClipConfig(
    config: MaterialClipConfig,
  ): MaterialClipConfig {
    const normalized = JSON.parse(JSON.stringify(config)) as MaterialClipConfig;

    normalized.default_source_dir =
      typeof normalized.default_source_dir === "string"
        ? normalized.default_source_dir
        : "";
    normalized.backup_source_dir =
      typeof normalized.backup_source_dir === "string"
        ? normalized.backup_source_dir
        : "";
    normalized.output_dir =
      typeof normalized.output_dir === "string" ? normalized.output_dir : "";
    normalized.canvas =
      typeof normalized.canvas === "string" && normalized.canvas.trim()
        ? normalized.canvas.trim()
        : null;
    normalized.tail_file =
      typeof normalized.tail_file === "string" ? normalized.tail_file : null;

    if (
      !Array.isArray(normalized.reference_resolution) ||
      normalized.reference_resolution.length !== 2 ||
      !normalized.reference_resolution.every((item) => typeof item === "number")
    ) {
      normalized.reference_resolution = null;
    }

    if (!normalized.canvas && !normalized.reference_resolution) {
      normalized.canvas = DEFAULT_CLIP_CANVAS;
      normalized.reference_resolution = [...DEFAULT_CLIP_REFERENCE_RESOLUTION];
    } else if (!normalized.canvas && normalized.reference_resolution) {
      normalized.canvas = `${normalized.reference_resolution[0]}x${normalized.reference_resolution[1]}`;
    } else if (normalized.canvas && !normalized.reference_resolution) {
      const matchedResolution = normalized.canvas.match(/^(\d+)x(\d+)$/);
      if (matchedResolution) {
        normalized.reference_resolution = [
          Number(matchedResolution[1]),
          Number(matchedResolution[2]),
        ];
      } else {
        normalized.canvas = DEFAULT_CLIP_CANVAS;
        normalized.reference_resolution = [...DEFAULT_CLIP_REFERENCE_RESOLUTION];
      }
    }

    normalized.feishu.app_id =
      typeof normalized.feishu.app_id === "string"
        ? normalized.feishu.app_id
        : "";
    normalized.feishu.app_secret =
      typeof normalized.feishu.app_secret === "string"
        ? normalized.feishu.app_secret
        : "";
    normalized.feishu.app_token =
      typeof normalized.feishu.app_token === "string"
        ? normalized.feishu.app_token
        : "";
    normalized.feishu.table_id =
      typeof normalized.feishu.table_id === "string"
        ? normalized.feishu.table_id
        : "";
    normalized.feishu.base_url =
      typeof normalized.feishu.base_url === "string"
        ? normalized.feishu.base_url
        : "https://open.feishu.cn/open-apis/bitable/v1";
    normalized.feishu.highlight_start_field_name = "高光起始点";

    normalized.ai_highlight.script_path =
      typeof normalized.ai_highlight.script_path === "string"
        ? normalized.ai_highlight.script_path
        : "";
    normalized.ai_highlight.dashscope_api_key =
      typeof normalized.ai_highlight.dashscope_api_key === "string"
        ? normalized.ai_highlight.dashscope_api_key
        : "";
    normalized.ai_highlight.model_name =
      typeof normalized.ai_highlight.model_name === "string" &&
      normalized.ai_highlight.model_name.trim()
        ? normalized.ai_highlight.model_name.trim()
        : "qwen3-vl-plus";

    if (
      !isPlainObject(normalized.highlight_start_points_by_drama) ||
      Object.keys(normalized.highlight_start_points_by_drama).length === 0
    ) {
      normalized.highlight_start_points_by_drama = null;
    } else {
      normalized.highlight_start_points_by_drama = Object.fromEntries(
        Object.entries(normalized.highlight_start_points_by_drama)
          .map(([key, value]) => [key.trim(), typeof value === "string" ? value : ""])
          .filter(([key, value]) => Boolean(key) && Boolean(value.trim())),
      );
    }

    return normalized;
  }

  private createFallbackDefaultConfig(): MaterialClipConfig {
    return {
      target_fps: 30,
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
      title_font_size: 24,
      brand_font_size: 16,
      disclaimer_font_size: 16,
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
      canvas: DEFAULT_CLIP_CANVAS,
      reference_resolution: [...DEFAULT_CLIP_REFERENCE_RESOLUTION],
      default_source_dir: "D:\\短剧剪辑\\源素材视频",
      backup_source_dir: "E:\\短剧剪辑\\源素材视频",
      temp_dir: null,
      output_dir: "D:\\短剧剪辑\\输出素材",
      tail_cache_dir: null,
      tail_file: "assets\\tail.mp4",
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
      no_interactive: false,
      enable_deduplication: false,
      auto_delete_source_after_completion: true,
      video: {
        hw_codec: "auto",
        sw_codec: "libx264",
        bitrate: "1104k",
        max_rate: "1104k",
        buffer_size: "2208k",
        soft_crf: "24",
        preset: "veryfast",
        profile: "high",
        level: "3.1",
        hw_level: "3.1",
        sw_level: "3.1",
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
        app_id: FIXED_FEISHU_APP_ID,
        app_secret: FIXED_FEISHU_APP_SECRET,
        app_token: FIXED_FEISHU_APP_TOKEN,
        table_id: "",
        base_url: "https://open.feishu.cn/open-apis/bitable/v1",
        field_names: ["剧名", "账户", "日期", "搭建时间"],
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
        highlight_start_field_name: "高光起始点",
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
      ai_highlight: {
        enabled: false,
        script_path: "src/drama_processor/integrations/video_highlight_ai.py",
        only_priority_rating: false,
        dashscope_api_key: "",
        model_name: "qwen3-vl-plus",
        group_count: 10,
        target_highlights_per_drama: 60,
        group_highlight_buffer: 4,
        video_fps: 1,
        analyze_first_portion_only: true,
        analyze_portion_ratio: 0.3,
        auto_retry_insufficient_groups: true,
        max_auto_retry_rounds: 2,
        use_dashscope_proxy: false,
      },
      highlight_start_points_by_drama: null,
    };
  }

  private async refreshPendingDramas(
    config?: MaterialClipConfig,
  ): Promise<void> {
    const resolvedConfig = config ?? this.activeRunConfig ?? (await this.getConfig());
    const pendingDramas = await this.fetchPendingDramas(resolvedConfig);
    const excludedRecordIds = new Set<string>();
    const excludedDramaNames = new Set<string>();
    const shouldExcludeCurrentDrama =
      this.runState.running && Boolean(this.runningProcess);

    // 只有剪辑进程仍在运行时，才排除当前剧目；停止后回退为待剪辑的剧需要重新出现在列表中。
    if (shouldExcludeCurrentDrama && this.runState.currentRecordId) {
      excludedRecordIds.add(this.runState.currentRecordId);
    }
    if (shouldExcludeCurrentDrama && this.runState.currentDramaName) {
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

    this.runState.pendingDramas = this.sortPendingDramas(
      pendingDramas.filter(
        (item) =>
          !excludedRecordIds.has(item.recordId) &&
          !excludedDramaNames.has(item.dramaName),
      ),
      resolvedConfig,
    );
    this.reindexPendingDramas();
    this.touchRunState();
    this.emitRunState();
  }

  private async buildHighlightStartPointMapping(
    config: MaterialClipConfig,
  ): Promise<Record<string, string> | null> {
    const pendingDramas = await this.fetchPendingDramas(config);
    const entries = pendingDramas
      .map((item) => [item.dramaName, item.highlightStartPoints || ""] as const)
      .filter(([, value]) => Boolean(value.trim()));

    return entries.length > 0 ? Object.fromEntries(entries) : null;
  }

  private async buildAiHighlightDramaList(
    config: MaterialClipConfig,
  ): Promise<MaterialClipAiHighlightDrama[]> {
    const pendingDramas = await this.fetchPendingDramas(config);
    const onlyPriorityRating = Boolean(config.ai_highlight.only_priority_rating);
    const targetRating = config.feishu.priority_rating_value?.trim() || "红标";
    const filteredPendingDramas = onlyPriorityRating
      ? pendingDramas.filter((item) => item.rating?.trim() === targetRating)
      : pendingDramas;
    const sourceRoot = await this.resolveAvailableSourceRoot(config);
    const localDramaMap = sourceRoot
      ? await this.scanLocalDramaDirectories(sourceRoot)
      : new Map<string, string>();

    return filteredPendingDramas.map((item, index) => {
      const sourceDir = localDramaMap.get(item.dramaName) || null;
      const sourceMatched = Boolean(sourceDir);
      return {
        order: index + 1,
        dramaName: item.dramaName,
        recordId: item.recordId,
        date: item.date,
        fullDate: item.fullDate,
        rating: item.rating,
        sourceDir,
        sourceMatched,
        highlightStartPoints: item.highlightStartPoints,
        status: sourceMatched ? "pending" : "unmatched",
        message: sourceMatched ? "等待识别" : "未匹配到本地源素材目录",
        highlightCount: item.highlightStartPoints
          ? item.highlightStartPoints.split(/\r?\n/).filter(Boolean).length
          : 0,
        updatedAt: null,
      };
    });
  }

  private async resolveAvailableSourceRoot(
    config: MaterialClipConfig,
  ): Promise<string | null> {
    const candidates = [
      config.default_source_dir,
      config.backup_source_dir,
    ].filter((item, index, array) => item.trim() && array.indexOf(item) === index);

    for (const candidate of candidates) {
      try {
        const stat = await fsp.stat(candidate);
        if (stat.isDirectory()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async scanLocalDramaDirectories(
    sourceRoot: string,
  ): Promise<Map<string, string>> {
    const entries = await fsp.readdir(sourceRoot, { withFileTypes: true });
    const dramaMap = new Map<string, string>();

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name.startsWith(".") || entry.name.startsWith("__")) {
        continue;
      }

      const dramaDir = path.join(sourceRoot, entry.name);
      try {
        const files = await fsp.readdir(dramaDir);
        const hasEpisode = files.some((fileName) => fileName.toLowerCase().endsWith(".mp4"));
        if (hasEpisode) {
          dramaMap.set(entry.name, dramaDir);
        }
      } catch {
        continue;
      }
    }

    return dramaMap;
  }

  private updateAiHighlightDrama(
    recordId: string,
    updater: (item: MaterialClipAiHighlightDrama) => MaterialClipAiHighlightDrama,
  ) {
    const index = this.aiHighlightState.dramas.findIndex(
      (item) => item.recordId === recordId,
    );
    if (index < 0) {
      return;
    }

    this.aiHighlightState.dramas[index] = updater(this.aiHighlightState.dramas[index]);
    this.touchAiHighlightState();
    this.emitAiHighlightState();
  }

  private async runSingleAiHighlightDrama(
    drama: MaterialClipAiHighlightDrama,
    config: MaterialClipConfig,
  ): Promise<void> {
    if (!drama.sourceDir) {
      this.updateAiHighlightDrama(drama.recordId, (item) => ({
        ...item,
        status: "unmatched",
        message: "未匹配到本地源素材目录",
        updatedAt: new Date().toISOString(),
      }));
      return;
    }

    this.updateAiHighlightDrama(drama.recordId, (item) => ({
      ...item,
      status: "running",
      message: "正在执行 AI 高光识别",
      updatedAt: new Date().toISOString(),
    }));

    const scriptPath = await this.resolveAiHighlightScriptPath(config);
    const pythonCommand = await this.resolveAiHighlightPythonCommand();
    const workRoot = path.join(
      app.getPath("userData"),
      "material-clip-ai-highlight",
      `${Date.now()}-${this.sanitizePathSegment(drama.dramaName)}`,
    );
    const sourceRoot = path.join(workRoot, "source");
    const linkedDramaPath = path.join(sourceRoot, drama.dramaName);
    const outputJsonPath = path.join(workRoot, "result.json");
    const analysisClipDir = path.join(workRoot, ".analysis_clips");

    await fsp.mkdir(sourceRoot, { recursive: true });
    await this.createDramaSymlink(drama.sourceDir, linkedDramaPath);

    const env = {
      ...process.env,
      SOURCE_VIDEO_ROOT: sourceRoot,
      OUTPUT_JSON_PATH: outputJsonPath,
      ANALYSIS_CLIP_DIR: analysisClipDir,
      DASHSCOPE_API_KEY: config.ai_highlight.dashscope_api_key,
      QWEN_MODEL: config.ai_highlight.model_name,
      GROUP_COUNT: String(config.ai_highlight.group_count),
      TARGET_HIGHLIGHTS_PER_DRAMA: String(
        config.ai_highlight.target_highlights_per_drama,
      ),
      GROUP_HIGHLIGHT_BUFFER: String(config.ai_highlight.group_highlight_buffer),
      VIDEO_FPS: String(config.ai_highlight.video_fps),
      ANALYZE_FIRST_PORTION_ONLY: String(
        config.ai_highlight.analyze_first_portion_only,
      ),
      ANALYZE_PORTION_RATIO: String(config.ai_highlight.analyze_portion_ratio),
      AUTO_RETRY_INSUFFICIENT_GROUPS: String(
        config.ai_highlight.auto_retry_insufficient_groups,
      ),
      MAX_AUTO_RETRY_ROUNDS: String(
        config.ai_highlight.max_auto_retry_rounds,
      ),
      ENABLE_POLLING: "false",
      DASHSCOPE_USE_PROXY: "false",
    };

    this.log(
      `[AI高光] 开始识别《${drama.dramaName}》：${pythonCommand.command} ${scriptPath}`,
    );

    try {
      await this.executeAiHighlightScript(
        drama.dramaName,
        pythonCommand.command,
        [...pythonCommand.prefixArgs, scriptPath],
        env,
      );
      const highlights = await this.readAiHighlightResult(
        outputJsonPath,
        drama.dramaName,
      );
      if (highlights.length === 0) {
        throw new Error("脚本未返回有效高光起始点");
      }

      const highlightText = this.formatHighlightStartPointLines(highlights);
      if (!highlightText.trim()) {
        throw new Error("高光起始点格式化失败");
      }
      await this.updateFeishuRecordFields(
        drama.recordId,
        {
          [config.feishu.highlight_start_field_name || "高光起始点"]: highlightText,
        },
        config,
      );

      this.updateAiHighlightDrama(drama.recordId, (item) => ({
        ...item,
        status: "success",
        message: `识别完成，已写回 ${highlights.length} 个起始点`,
        highlightCount: highlights.length,
        highlightStartPoints: highlightText,
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`[AI高光] 《${drama.dramaName}》识别失败：${message}`);
      this.updateAiHighlightDrama(drama.recordId, (item) => ({
        ...item,
        status: "failed",
        message,
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      await fsp.rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
    }
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
    const highlightField =
      config.feishu.highlight_start_field_name || "高光起始点";
    const endpoint = `/open-apis/bitable/v1/apps/${config.feishu.app_token}/tables/${config.feishu.table_id}/records/search`;
    const payload = {
      field_names: [
        "剧名",
        "日期",
        "上架时间",
        ratingField,
        douyinField,
        highlightField,
      ],
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
          this.normalizePendingDrama(
            record,
            ratingField,
            douyinField,
            highlightField,
            index,
          ),
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
    highlightField: string,
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
      highlightStartPoints: this.extractFieldMultilineText(
        record.fields[highlightField],
      ),
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

  private sortAndReindexProcessedDramas(
    dramas: MaterialClipProcessedDrama[],
  ): MaterialClipProcessedDrama[] {
    return [...dramas]
      .sort((a, b) => {
        const aTimestamp = new Date(a.completedAt).getTime();
        const bTimestamp = new Date(b.completedAt).getTime();
        const aValid = Number.isFinite(aTimestamp);
        const bValid = Number.isFinite(bTimestamp);

        if (aValid && bValid && aTimestamp !== bTimestamp) {
          return bTimestamp - aTimestamp;
        }
        if (aValid && !bValid) {
          return -1;
        }
        if (!aValid && bValid) {
          return 1;
        }

        return a.order - b.order;
      })
      .map((item, index) => ({
        ...item,
        order: index + 1,
      }));
  }

  private sortPendingDramas(
    dramas: MaterialClipPendingDrama[],
    config: MaterialClipConfig,
  ): MaterialClipPendingDrama[] {
    const priorityRating = config.feishu.priority_rating_value?.trim();

    return [...dramas].sort((a, b) => {
      const aPriority = priorityRating && a.rating === priorityRating ? 1 : 0;
      const bPriority = priorityRating && b.rating === priorityRating ? 1 : 0;
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }

      if (aPriority === 1 && bPriority === 1) {
        if (a.uploadTime !== null && b.uploadTime !== null && a.uploadTime !== b.uploadTime) {
          return b.uploadTime - a.uploadTime;
        }
        if (a.uploadTime !== null && b.uploadTime === null) {
          return -1;
        }
        if (a.uploadTime === null && b.uploadTime !== null) {
          return 1;
        }

        const aDate = this.parsePendingDramaDateToTimestamp(a);
        const bDate = this.parsePendingDramaDateToTimestamp(b);
        if (aDate !== null && bDate !== null && aDate !== bDate) {
          return aDate - bDate;
        }
        if (aDate !== null && bDate === null) {
          return -1;
        }
        if (aDate === null && bDate !== null) {
          return 1;
        }

        return a.dramaName.localeCompare(b.dramaName, "zh-Hans-CN");
      }

      const aDate = this.parsePendingDramaDateToTimestamp(a);
      const bDate = this.parsePendingDramaDateToTimestamp(b);
      if (aDate !== null && bDate !== null && aDate !== bDate) {
        return aDate - bDate;
      }
      if (aDate !== null && bDate === null) {
        return -1;
      }
      if (aDate === null && bDate !== null) {
        return 1;
      }

      const aSecondaryPriority = this.getPendingDramaSecondaryRatingPriority(
        a.rating,
        priorityRating,
      );
      const bSecondaryPriority = this.getPendingDramaSecondaryRatingPriority(
        b.rating,
        priorityRating,
      );
      if (aSecondaryPriority !== bSecondaryPriority) {
        return aSecondaryPriority - bSecondaryPriority;
      }

      if (a.uploadTime !== null && b.uploadTime !== null && a.uploadTime !== b.uploadTime) {
        return b.uploadTime - a.uploadTime;
      }
      if (a.uploadTime !== null && b.uploadTime === null) {
        return -1;
      }
      if (a.uploadTime === null && b.uploadTime !== null) {
        return 1;
      }

      return a.dramaName.localeCompare(b.dramaName, "zh-Hans-CN");
    });
  }

  private getPendingDramaSecondaryRatingPriority(
    rating: string | null,
    priorityRating: string | null,
  ): number {
    const normalizedRating = rating?.trim();
    if (!normalizedRating) {
      return 99;
    }

    if (priorityRating && normalizedRating === priorityRating) {
      return 0;
    }

    if (normalizedRating === "绿标") {
      return 1;
    }

    if (normalizedRating === "黄标") {
      return 2;
    }

    return 99;
  }

  private parsePendingDramaDateToTimestamp(
    drama: MaterialClipPendingDrama,
  ): number | null {
    if (drama.fullDate) {
      const parsed = Date.parse(`${drama.fullDate}T00:00:00`);
      return Number.isNaN(parsed) ? null : parsed;
    }

    const normalized = drama.date.trim();
    const monthDayMatch = normalized.match(/^(\d{1,2})\.(\d{1,2})$/);
    if (monthDayMatch) {
      const [, monthText, dayText] = monthDayMatch;
      const now = new Date();
      const parsed = new Date(
        now.getFullYear(),
        Number(monthText) - 1,
        Number(dayText),
      ).getTime();
      return Number.isNaN(parsed) ? null : parsed;
    }

    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : parsed;
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

  private resetCurrentDramaProgress(plannedMaterials?: number | null) {
    const total =
      plannedMaterials && plannedMaterials > 0 ? plannedMaterials : 0;
    this.runState.totalMaterials = total;
    this.runState.completedMaterials = 0;
    this.runState.remainingMaterials = total;
  }

  private ensureCurrentDramaStarted(dramaName: string): boolean {
    if (this.runState.currentDramaName !== dramaName) {
      this.runState.currentDramaStartedAt = new Date().toISOString();
      return true;
    }

    if (!this.runState.currentDramaStartedAt) {
      this.runState.currentDramaStartedAt = new Date().toISOString();
    }

    return false;
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

    this.runState.processedDramas = this.sortAndReindexProcessedDramas(
      this.runState.processedDramas,
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

  private extractFieldMultilineText(value: unknown): string | null {
    const texts = this.extractFieldTexts(value)
      .map((item) => item.trim())
      .filter(Boolean);
    if (texts.length === 0) {
      return null;
    }

    return texts.join("\n");
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

  private selectPathModule(pathValue: string): typeof path.win32 | typeof path.posix {
    const normalized = (pathValue || "").trim();
    if (/^[A-Za-z]:[\\/]/.test(normalized) || normalized.includes("\\")) {
      return path.win32;
    }
    return path.posix;
  }

  private normalizeDirPath(pathValue: string): string {
    const normalized = (pathValue || "").trim();
    if (!normalized) {
      return "";
    }

    if (/^[A-Za-z]:[\\/]*$/.test(normalized)) {
      return `${normalized[0]}:\\`;
    }

    if (normalized === "/" || normalized === "\\") {
      return normalized;
    }

    return normalized.replace(/[\\/]+$/, "");
  }

  private getActualSourceDir(config: MaterialClipConfig): string {
    const defaultSourceDir = this.normalizeDirPath(config.default_source_dir);
    const backupSourceDir = this.normalizeDirPath(config.backup_source_dir);

    if (defaultSourceDir && fs.existsSync(defaultSourceDir)) {
      return defaultSourceDir;
    }

    if (backupSourceDir && fs.existsSync(backupSourceDir)) {
      return backupSourceDir;
    }

    return defaultSourceDir || backupSourceDir;
  }

  private getExportBaseDir(sourceDir: string): string {
    const normalizedSourceDir = this.normalizeDirPath(sourceDir);
    if (!normalizedSourceDir) {
      return "";
    }

    const pathModule = this.selectPathModule(normalizedSourceDir);
    const parentDir = pathModule.dirname(normalizedSourceDir);
    if (!parentDir || parentDir === ".") {
      return normalizedSourceDir;
    }

    return parentDir;
  }

  private resolveOutputDir(config: MaterialClipConfig): string {
    const candidate = this.normalizeDirPath(config.output_dir);
    if (!candidate) {
      return "";
    }

    const actualSourceDir = this.getActualSourceDir(config);
    const exportBaseDir = this.getExportBaseDir(actualSourceDir);
    const pathModule = this.selectPathModule(actualSourceDir || candidate);

    if (actualSourceDir) {
      const candidateNorm = pathModule.normalize(candidate).toLowerCase();
      const sourceNorm = pathModule.normalize(actualSourceDir).toLowerCase();
      if (candidateNorm === sourceNorm) {
        return exportBaseDir;
      }
    }

    if (exportBaseDir && !pathModule.isAbsolute(candidate)) {
      const targetName = pathModule.basename(candidate) || "导出素材";
      return pathModule.join(exportBaseDir, targetName);
    }

    return candidate;
  }

  private async findLatestDramaExportDir(
    exportsRoot: string,
    dramaName: string,
    dramaDate?: string | null,
  ): Promise<string | null> {
    const normalizedExportsRoot = this.normalizeDirPath(exportsRoot);
    if (!normalizedExportsRoot) {
      return null;
    }

    const pathModule = this.selectPathModule(normalizedExportsRoot);
    const normalizedDramaDate = this.normalizeDisplayText(dramaDate);
    const searchRoot = normalizedDramaDate
      ? pathModule.join(normalizedExportsRoot, `${normalizedDramaDate}导出`)
      : normalizedExportsRoot;

    try {
      const stat = await fsp.stat(searchRoot);
      if (!stat.isDirectory()) {
        return null;
      }
    } catch {
      return null;
    }

    const entries = await fsp.readdir(searchRoot, { withFileTypes: true });
    let bestDir: string | null = null;
    let maxSuffix = -999;

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === dramaName) {
        bestDir = pathModule.join(searchRoot, entry.name);
        maxSuffix = Math.max(maxSuffix, -1);
        continue;
      }

      const prefix = `${dramaName}-`;
      if (!entry.name.startsWith(prefix)) {
        continue;
      }

      const suffix = entry.name.slice(prefix.length);
      if (!/^\d{3}$/.test(suffix)) {
        continue;
      }

      const suffixValue = Number(suffix);
      if (suffixValue > maxSuffix) {
        maxSuffix = suffixValue;
        bestDir = pathModule.join(searchRoot, entry.name);
      }
    }

    return bestDir;
  }

  private async removeDramaExportDir(
    config: MaterialClipConfig,
    dramaName: string,
    dramaDate?: string | null,
  ): Promise<string | null> {
    const actualSourceDir = this.getActualSourceDir(config);
    const exportBaseDir = this.getExportBaseDir(actualSourceDir);
    const resolvedOutputDir = this.resolveOutputDir(config);
    const candidateRoots = Array.from(
      new Set(
        [resolvedOutputDir, exportBaseDir]
          .map((item) => this.normalizeDirPath(item))
          .filter((item) => Boolean(item)),
      ),
    );

    for (const candidateRoot of candidateRoots) {
      const latestExportDir = await this.findLatestDramaExportDir(
        candidateRoot,
        dramaName,
        dramaDate,
      );
      if (!latestExportDir) {
        continue;
      }

      await fsp.rm(latestExportDir, { recursive: true, force: true });
      this.log(`已删除导出目录：${latestExportDir}`);
      return latestExportDir;
    }

    this.log(
      `未找到需要删除的导出目录：${dramaName} (${this.normalizeDisplayText(dramaDate) || "未知日期"})`,
    );
    return null;
  }

  private async revertRecordToPending(
    recordId: string,
    config?: MaterialClipConfig,
  ): Promise<void> {
    const resolvedConfig = config ?? this.activeRunConfig ?? (await this.getConfig());
    const updated = await this.apiService.updateFeishuRecordStatus(
      recordId,
      resolvedConfig.feishu.pending_status_value,
      this.configService,
      resolvedConfig.feishu.table_id,
    );

    if (!updated) {
      throw new Error("飞书状态回退失败");
    }
  }

  private async terminateProcess(
    child: ChildProcessByStdio<null, Readable, Readable>,
  ): Promise<void> {
    if (child.killed || child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    const waitForExit = async (timeoutMs: number): Promise<boolean> =>
      await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve(true);
          return;
        }

        let settled = false;
        const cleanup = () => {
          child.off("exit", handleExit);
          child.off("close", handleClose);
        };
        const finish = (value: boolean) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve(value);
        };
        const handleExit = () => finish(true);
        const handleClose = () => finish(true);

        const timer = setTimeout(() => {
          clearTimeout(timer);
          finish(false);
        }, timeoutMs);

        child.once("exit", handleExit);
        child.once("close", handleClose);
      });

    try {
      child.kill("SIGTERM");
    } catch {
      // 忽略，继续走 Windows/兜底终止逻辑
    }

    if (await waitForExit(1500)) {
      return;
    }

    if (process.platform === "win32" && child.pid) {
      const taskkillResult = await new Promise<{
        success: boolean;
        error?: string;
      }>((resolve) => {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/t", "/f"],
          {
            stdio: ["ignore", "pipe", "pipe"],
          },
        );

        let stdout = "";
        let stderr = "";
        killer.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        killer.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        killer.once("error", (error) => {
          resolve({ success: false, error: error.message });
        });
        killer.once("close", (code) => {
          if (code === 0) {
            resolve({ success: true });
            return;
          }
          resolve({
            success: false,
            error: `${stderr || stdout}`.trim() || `taskkill 退出码 ${code ?? -1}`,
          });
        });
      });

      if (await waitForExit(6000)) {
        if (!taskkillResult.success) {
          this.log(
            `终止素材剪辑进程时 taskkill 返回异常，但进程已退出：${taskkillResult.error || "未知错误"}`,
          );
        }
        return;
      }

      this.log(
        `终止素材剪辑进程失败：${taskkillResult.error || "taskkill 未能结束进程"}`,
      );
      throw new Error("停止轮询剪辑失败，请稍后重试；如仍失败，请手动关闭相关 Python/FFmpeg 进程");
    }

    try {
      child.kill("SIGKILL");
    } catch {
      // 忽略，继续等待退出
    }

    if (await waitForExit(3000)) {
      return;
    }

    throw new Error("停止轮询剪辑失败，进程未能在预期时间内退出");
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
      const switchedDrama = this.ensureCurrentDramaStarted(dramaName);
      this.runState.currentDramaName = dramaName;
      this.runState.currentDramaDate = date;
      if (switchedDrama) {
        this.runState.currentDramaRating = null;
        this.runState.currentRecordId = null;
        this.resetCurrentDramaProgress();
      }
      this.runState.message = `正在处理《${dramaName}》`;
      const matched = this.findPendingDramaCandidate(dramaName, date ?? null);
      if (matched) {
        this.runState.currentDramaRating = matched.rating;
        this.runState.currentRecordId = matched.recordId;
        if (
          (switchedDrama || this.runState.totalMaterials <= 0) &&
          matched.plannedMaterials &&
          matched.plannedMaterials > 0
        ) {
          this.resetCurrentDramaProgress(matched.plannedMaterials);
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
      if (line.includes("查询飞书")) {
        this.markPollCycleStarted();
      } else if (
        line.includes("当前没有待剪辑的剧") ||
        line.includes("所有待剪辑的剧已处理完成")
      ) {
        this.clearCurrentDramaDisplay("轮询中，等待下一部待剪辑剧");
        this.scheduleNextPoll();
      } else if (line.includes("日期任务完成，立即查找其他日期的待剪辑剧")) {
        this.clearCurrentDramaDisplay("正在查找下一部待剪辑剧");
      }
      shouldRefreshPending = true;
    }

    if (shouldRefreshPending && this.runState.mode === "auto") {
      this.schedulePendingRefresh();
    }

    this.touchRunState();
    this.emitRunState();
  }

  private markDramaAsCurrent(dramaName: string, dramaDate?: string | null) {
    const switchedDrama = this.ensureCurrentDramaStarted(dramaName);
    this.clearPollingSchedule();
    this.runState.currentDramaName = dramaName;
    this.runState.currentDramaDate =
      this.normalizeDisplayText(dramaDate) ?? this.runState.currentDramaDate;
    if (switchedDrama) {
      this.runState.currentDramaRating = null;
      this.runState.currentRecordId = null;
      this.resetCurrentDramaProgress();
    }
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
      (switchedDrama || this.runState.totalMaterials <= 0) &&
      matched.plannedMaterials &&
      matched.plannedMaterials > 0
    ) {
      this.resetCurrentDramaProgress(matched.plannedMaterials);
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

  private clearCurrentDramaDisplay(message?: string) {
    this.runState.currentDramaName = null;
    this.runState.currentDramaDate = null;
    this.runState.currentDramaRating = null;
    this.runState.currentRecordId = null;
    this.runState.currentDramaStartedAt = null;
    this.runState.totalMaterials = 0;
    this.runState.completedMaterials = 0;
    this.runState.remainingMaterials = 0;
    if (message) {
      this.runState.message = message;
    }
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

  private async resolveAiHighlightPythonCommand(): Promise<PythonCommand> {
    const runtime = await this.resolveProcessorRuntime();
    if (runtime.runtimeRoot) {
      return this.resolvePythonCommand(runtime.runtimeRoot);
    }
    throw new Error("未找到素材剪辑运行时 Python 环境");
  }

  private async resolveAiHighlightScriptPath(
    config: MaterialClipConfig,
  ): Promise<string> {
    const runtime = await this.resolveProcessorRuntime();
    const processorRoot = runtime.runtimeRoot;
    if (!processorRoot) {
      throw new Error("未找到素材剪辑运行时，无法定位内置 AI 高光脚本");
    }

    const relativeCandidates = [
      config.ai_highlight.script_path.trim(),
      "src/drama_processor/integrations/video_highlight_ai.py",
    ].filter((item, index, array) => item && array.indexOf(item) === index);

    for (const candidate of relativeCandidates) {
      if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
        return candidate;
      }

      const resolvedPath = path.join(processorRoot, candidate);
      if (fs.existsSync(resolvedPath)) {
        return resolvedPath;
      }
    }

    throw new Error("运行时内未找到 AI 高光脚本，请重新导入包含完整脚本的运行时包");
  }

  private sanitizePathSegment(value: string): string {
    return value.replace(/[\\/:*?"<>|]+/g, "_").trim() || "drama";
  }

  private async createDramaSymlink(sourceDir: string, targetPath: string) {
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    const symlinkType =
      process.platform === "win32" ? ("junction" as fs.symlink.Type) : "dir";
    await fsp.symlink(sourceDir, targetPath, symlinkType);
  }

  private async executeAiHighlightScript(
    dramaName: string,
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: path.dirname(args[args.length - 1] || command),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.aiHighlightProcess = child;
      const flushBuffer = (buffer: string, isError: boolean) => {
        const trimmed = buffer.trim();
        if (trimmed) {
          this.log(
            `[AI高光][${dramaName}] ${isError ? "[stderr] " : ""}${trimmed}`,
          );
        }
      };
      const bindStream = (stream: NodeJS.ReadableStream, isError: boolean) => {
        let buffer = "";
        stream.on("data", (chunk: Buffer | string) => {
          buffer += chunk.toString();
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              this.log(
                `[AI高光][${dramaName}] ${isError ? "[stderr] " : ""}${trimmed}`,
              );
            }
          }
        });
        stream.on("end", () => flushBuffer(buffer, isError));
      };

      bindStream(child.stdout, false);
      bindStream(child.stderr, true);

      child.once("error", (error) => {
        this.aiHighlightProcess = null;
        reject(error);
      });

      child.once("close", (code) => {
        this.aiHighlightProcess = null;
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`AI 脚本退出异常，exitCode=${code ?? -1}`));
      });
    });
  }

  private async readAiHighlightResult(
    outputJsonPath: string,
    dramaName: string,
  ): Promise<Array<{ episode: number; start_time: string }>> {
    let raw: unknown;
    try {
      raw = JSON.parse(await fsp.readFile(outputJsonPath, "utf-8")) as unknown;
    } catch (error) {
      throw new Error(
        `读取 AI 高光结果失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!isPlainObject(raw)) {
      throw new Error("AI 高光结果文件缺少当前剧目数据");
    }

    const dramaResult = raw[dramaName];
    if (!isPlainObject(dramaResult)) {
      throw new Error("AI 高光结果文件缺少当前剧目数据");
    }

    const highlights = dramaResult.highlights;
    if (!Array.isArray(highlights)) {
      throw new Error("AI 高光结果格式不正确");
    }

    return highlights
      .map((item) => {
        if (!isPlainObject(item)) {
          return null;
        }
        const episode = Number(item.episode);
        const startTime =
          typeof item.start_time === "string" ? item.start_time.trim() : "";
        if (!Number.isInteger(episode) || episode <= 0 || !startTime) {
          return null;
        }
        return {
          episode,
          start_time: startTime,
        };
      })
      .filter(
        (
          item,
        ): item is {
          episode: number;
          start_time: string;
        } => item !== null,
      );
  }

  private formatHighlightStartPointLines(
    highlights: Array<{ episode: number; start_time: string }>,
  ): string {
    return highlights
      .map((item) => {
        const totalSeconds = this.parseTimeTextToSeconds(item.start_time);
        if (totalSeconds === null) {
          return null;
        }
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${item.episode} ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      })
      .filter((item): item is string => Boolean(item))
      .join("\n");
  }

  private parseTimeTextToSeconds(value: string): number | null {
    const parts = value.split(":").map((item) => item.trim());
    if (parts.length < 2 || parts.length > 3) {
      return null;
    }

    if (!parts.every((item) => /^\d+$/.test(item))) {
      return null;
    }

    const numbers = parts.map((item) => Number(item));
    if (numbers.some((item) => Number.isNaN(item))) {
      return null;
    }

    if (numbers.length === 2) {
      return numbers[0] * 60 + numbers[1];
    }

    return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
  }

  private async updateFeishuRecordFields(
    recordId: string,
    fields: Record<string, string>,
    config: MaterialClipConfig,
  ): Promise<void> {
    const endpoint = `/open-apis/bitable/v1/apps/${config.feishu.app_token}/tables/${config.feishu.table_id}/records/${recordId}`;
    const response = (await this.apiService.feishuRequest(
      endpoint,
      { fields },
      "PUT",
      this.configService,
    )) as { code?: number; msg?: string };

    if (response.code !== 0) {
      throw new Error(response.msg || "飞书字段更新失败");
    }
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

  private decodeCommandBuffer(buffer: Buffer): string {
    if (buffer.length === 0) {
      return "";
    }

    const utf8Text = buffer.toString("utf8");
    if (process.platform !== "win32" || !utf8Text.includes("�")) {
      return utf8Text;
    }

    try {
      const gbkText = new TextDecoder("gbk").decode(buffer);
      return gbkText || utf8Text;
    } catch {
      return utf8Text;
    }
  }

  private formatCommandSpawnError(command: string, error: NodeJS.ErrnoException) {
    if (error.code === "ENOENT") {
      return `未找到命令：${command}`;
    }

    return error.message;
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

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on("data", (chunk) => {
        stdoutChunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        );
      });

      child.stderr.on("data", (chunk) => {
        stderrChunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        );
      });

      child.once("error", (error) => {
        const stdout = this.decodeCommandBuffer(Buffer.concat(stdoutChunks));
        resolve({
          success: false,
          output: stdout.trim(),
          error: this.formatCommandSpawnError(command, error),
        });
      });

      child.once("close", (code) => {
        const stdout = this.decodeCommandBuffer(Buffer.concat(stdoutChunks));
        const stderr = this.decodeCommandBuffer(Buffer.concat(stderrChunks));
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

    if (this.aiHighlightProcess) {
      return { success: false, error: "AI 高光识别运行中，请稍后再开始剪辑" };
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
        ? this.sortPendingDramas(
            await this.fetchPendingDramas(params.config),
            params.config,
          )
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
      pollIntervalSeconds:
        params.mode === "auto" ? params.config.feishu_watcher.poll_interval : null,
      lastPollAt: null,
      nextPollAt: null,
      message:
        params.mode === "auto"
          ? `轮询剪辑准备启动，当前待处理 ${pendingDramas.length} 部剧`
          : "手动剪辑准备开始",
    };
    this.emitRunState();

    const runtimeConfig = await this.applyApiConfig(params.config);
    runtimeConfig.highlight_start_points_by_drama =
      await this.buildHighlightStartPointMapping(runtimeConfig);
    this.activeRunConfig = runtimeConfig;
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
    const activeConfig = this.activeRunConfig;
    this.runState.running = false;
    this.runState.pid = null;
    this.runState.currentDramaStartedAt = null;
    this.clearPollingSchedule();

    if (wasStopping) {
      this.runState.mode = "idle";
      this.runState.status = "stopped";
      this.runState.message = "轮询剪辑已停止";
    } else if (code === 0) {
      this.runState.mode = "idle";
      this.runState.status = "completed";
      this.runState.message = "轮询剪辑已结束";
    } else {
      this.runState.mode = "idle";
      this.runState.status = "failed";
      this.runState.message = signal
        ? `素材剪辑被中断（${signal}）`
        : `素材剪辑异常结束，退出码 ${code ?? -1}`;
    }

    if (this.runState.mode === "idle") {
      await this.refreshPendingDramas(activeConfig ?? undefined);
    }

    this.activeRunConfig = null;
    this.touchRunState();
    this.emitRunState();
  }
}
