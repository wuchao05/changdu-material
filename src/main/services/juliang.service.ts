/**
 * 巨量创意上传服务
 * 基于 Playwright 自动化上传素材到巨量创意后台
 */

import { chromium, BrowserContext, Page } from "playwright";
import { app, BrowserWindow } from "electron";
import { basename, dirname, join } from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { JuliangProgressManager } from "./juliang-progress.service";

// 上传任务状态
export type JuliangTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

// 上传进度回调
export interface JuliangUploadProgress {
  taskId: string;
  drama: string;
  status: JuliangTaskStatus;
  currentBatch: number;
  totalBatches: number;
  successCount: number;
  totalFiles: number;
  message: string;
}

export interface JuliangTaskState extends JuliangUploadProgress {
  updatedAt: string;
}

// 上传任务
export interface JuliangTask {
  id: string;
  drama: string;
  date: string;
  account: string;
  accountId: string;
  files: string[];
  recordId: string;
  status: JuliangTaskStatus;
}

// 上传结果
export interface JuliangUploadResult {
  success: boolean;
  taskId: string;
  drama: string;
  successCount: number;
  totalFiles: number;
  skipped?: boolean;
  error?: string;
  remark?: string;
}

interface JuliangBatchResult {
  success: boolean;
  successCount: number;
  observedSuccessCount?: number;
  failureType?: "no-progress-timeout";
  skipped?: boolean;
  error?: string;
  abandonedFiles?: string[];
  remainingFiles?: string[];
}

interface JuliangUploadRowSnapshot {
  fileName: string;
  rowText: string;
  isSuccess: boolean;
  hasError: boolean;
}

interface JuliangLoginStateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

interface JuliangLoginStateOrigin {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

interface JuliangLoginStateStorage {
  cookies: JuliangLoginStateCookie[];
  origins: JuliangLoginStateOrigin[];
}

interface JuliangLoginStateFile {
  type: "juliang-login-state";
  version: 1;
  exportedAt: string;
  storageState: JuliangLoginStateStorage;
}

// 巨量配置
export interface JuliangConfig {
  baseUploadUrl: string;
  batchSize: number;
  batchUploadTimeoutMinutes: number;
  maxBatchRetries: number;
  timeoutPartialRetryRounds: number;
  batchDelayMin: number;
  batchDelayMax: number;
  headless: boolean;
  slowMo: number;
  allowedMissingCount: number; // 最终允许缺失的进度条个数，如 2 表示 10 个文件允许最终只剩 8 个进度条
  abandonedRetryTimeoutMinutes: number; // 兜底重传超时时间（分钟）
  selectors: {
    uploadButton: string;
    uploadPanel: string;
    fileInput: string;
    confirmButton: string;
    cancelButton: string;
  };
}

interface JuliangProjectListResponse {
  code?: number;
  msg?: string;
  message?: string;
  data?: {
    projects?: Array<{
      project_id?: string | number;
    }>;
    pagination?: {
      total_page?: number;
    };
  };
}

interface JuliangProjectDeleteResponse {
  code?: number;
  msg?: string;
  message?: string;
}

// 默认配置
const DEFAULT_CONFIG: JuliangConfig = {
  baseUploadUrl:
    "https://ad.oceanengine.com/material_center/management/video?aadvid={accountId}#source=ad_navigator",
  batchSize: 10, // 巨量后台每次最多上传 10 个视频
  batchUploadTimeoutMinutes: 5,
  maxBatchRetries: 1,
  timeoutPartialRetryRounds: 5,
  batchDelayMin: 3000,
  batchDelayMax: 5000,
  headless: false,
  slowMo: 50,
  allowedMissingCount: 0, // 默认不允许缺失进度条
  abandonedRetryTimeoutMinutes: 3, // 兜底重传默认3分钟超时
  selectors: {
    uploadButton: "button:has(span:text('上传视频'))",
    uploadPanel: ".material-center-v2-oc-create-upload-select-wrapper",
    fileInput: 'input[type="file"]',
    confirmButton:
      ".material-center-v2-oc-create-material-submit-bar-btn-group button:has-text('确定')",
    cancelButton:
      ".material-center-v2-oc-create-material-submit-bar-btn-group button:has-text('取消')",
  },
};

export class JuliangService {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: JuliangConfig = DEFAULT_CONFIG;
  private isInitialized = false;
  private mainWindow: BrowserWindow | null = null;
  private progressCallback: ((progress: JuliangUploadProgress) => void) | null =
    null;
  private logs: Array<{ time: string; message: string }> = [];
  private maxLogs = 500; // 最多保存 500 条日志
  private recentTaskStates = new Map<string, JuliangTaskState>();
  private maxRecentTaskStates = 200;
  private progressManager: JuliangProgressManager =
    new JuliangProgressManager();
  private isCancelled = false; // 取消标志
  private readonly nonRetryableUploadErrors = [
    "获取大视频封面失败",
    "获取视频封面失败",
    "上传失败",
    "上传出错",
    "处理失败",
    "视频处理失败",
    "文件处理失败",
  ];
  private readonly uploadErrorKeywords =
    /(失败|错误|异常|不支持|无效|损坏|封面)/;
  private readonly ignoredUploadErrorTexts = [
    "点击上传",
    "拖拽到此处",
    "模板视频",
    "竖版视频",
    "横版视频",
  ];

  private async parseJsonResponse<T>(
    response: Response,
    actionName: string,
  ): Promise<T> {
    const responseText = await response.text();
    let result: T;
    try {
      result = JSON.parse(responseText) as T;
    } catch {
      const snippet = responseText.slice(0, 200).replace(/\s+/g, " ").trim();
      throw new Error(
        `${actionName}返回非 JSON 响应：HTTP ${response.status} ${response.statusText}，响应片段：${snippet || "empty"}`,
      );
    }

    if (!response.ok) {
      const message =
        typeof result === "object" && result
          ? String(
              (result as { message?: string; msg?: string; error?: string })
                .message ||
                (result as { message?: string; msg?: string; error?: string })
                  .msg ||
                (result as { message?: string; msg?: string; error?: string })
                  .error ||
                `${response.status} ${response.statusText}`,
            )
          : `${response.status} ${response.statusText}`;
      throw new Error(`${actionName}失败：${message}`);
    }

    return result;
  }

  /**
   * 获取用户数据目录
   */
  private getUserDataDir(): string {
    return join(app.getPath("userData"), "juliang-browser-data");
  }

  /**
   * 记录日志并发送到前端
   */
  private log(message: string) {
    const time = new Date().toLocaleTimeString();
    const logEntry = { time, message };

    // 保存到日志数组
    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // 打印到控制台
    console.log(`[Juliang] ${message}`);

    // 发送到前端
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("juliang:log", logEntry);
    }
  }

  /**
   * 获取所有日志
   */
  getLogs(): Array<{ time: string; message: string }> {
    return [...this.logs];
  }

  getTaskStates(): JuliangTaskState[] {
    return Array.from(this.recentTaskStates.values());
  }

  /**
   * 清空日志
   */
  clearLogs() {
    this.logs = [];
  }

  /**
   * 检测系统已安装的 Chrome 或 Edge 浏览器路径
   */
  private findSystemBrowser(): string | undefined {
    const platform = process.platform;

    // Windows 常见路径
    if (platform === "win32") {
      const windowsPaths = [
        // Chrome
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        // Edge
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      ];

      for (const browserPath of windowsPaths) {
        if (fs.existsSync(browserPath)) {
          this.log(`找到系统浏览器: ${browserPath}`);
          return browserPath;
        }
      }

      // 尝试通过注册表查找
      try {
        const regQuery = execSync(
          'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve',
          { encoding: "utf-8" },
        );
        const match = regQuery.match(/REG_SZ\s+(.+)/);
        if (match && match[1] && fs.existsSync(match[1].trim())) {
          this.log(`通过注册表找到 Chrome: ${match[1].trim()}`);
          return match[1].trim();
        }
      } catch {
        // 注册表查询失败，忽略
      }
    }

    // macOS 常见路径
    if (platform === "darwin") {
      const macPaths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      ];

      for (const browserPath of macPaths) {
        if (fs.existsSync(browserPath)) {
          this.log(`找到系统浏览器: ${browserPath}`);
          return browserPath;
        }
      }
    }

    // Linux 常见路径
    if (platform === "linux") {
      const linuxPaths = [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
      ];

      for (const browserPath of linuxPaths) {
        if (fs.existsSync(browserPath)) {
          this.log(`找到系统浏览器: ${browserPath}`);
          return browserPath;
        }
      }
    }

    console.warn("[Juliang] 未找到系统浏览器");
    return undefined;
  }

  /**
   * 设置主窗口引用（用于发送进度事件）
   */
  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  /**
   * 设置进度回调
   */
  setProgressCallback(callback: (progress: JuliangUploadProgress) => void) {
    this.progressCallback = callback;
  }

  /**
   * 发送进度更新
   */
  private emitProgress(progress: JuliangUploadProgress) {
    this.recentTaskStates.set(progress.taskId, {
      ...progress,
      updatedAt: new Date().toISOString(),
    });
    if (this.recentTaskStates.size > this.maxRecentTaskStates) {
      const oldestTaskId = this.recentTaskStates.keys().next().value;
      if (oldestTaskId) {
        this.recentTaskStates.delete(oldestTaskId);
      }
    }
    if (this.progressCallback) {
      this.progressCallback(progress);
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("juliang:upload-progress", progress);
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<JuliangConfig>) {
    const nextConfig = { ...this.config, ...config };
    if (typeof nextConfig.batchSize === "number") {
      nextConfig.batchSize = Math.max(1, Math.floor(nextConfig.batchSize));
    }
    if (typeof nextConfig.batchUploadTimeoutMinutes === "number") {
      nextConfig.batchUploadTimeoutMinutes = Math.max(
        1,
        Math.floor(nextConfig.batchUploadTimeoutMinutes),
      );
    }
    if (typeof nextConfig.maxBatchRetries === "number") {
      nextConfig.maxBatchRetries = Math.max(
        0,
        Math.min(10, Math.floor(nextConfig.maxBatchRetries)),
      );
    }
    if (typeof nextConfig.timeoutPartialRetryRounds === "number") {
      nextConfig.timeoutPartialRetryRounds = Math.max(
        0,
        Math.min(10, Math.floor(nextConfig.timeoutPartialRetryRounds)),
      );
    }
    if (typeof nextConfig.batchDelayMin === "number") {
      nextConfig.batchDelayMin = Math.max(
        0,
        Math.floor(nextConfig.batchDelayMin),
      );
    }
    if (typeof nextConfig.batchDelayMax === "number") {
      nextConfig.batchDelayMax = Math.max(
        0,
        Math.floor(nextConfig.batchDelayMax),
      );
    }
    if (nextConfig.batchDelayMax < nextConfig.batchDelayMin) {
      nextConfig.batchDelayMax = nextConfig.batchDelayMin;
    }
    if (typeof nextConfig.slowMo === "number") {
      nextConfig.slowMo = Math.max(0, Math.floor(nextConfig.slowMo));
    }
    if (typeof nextConfig.allowedMissingCount === "number") {
      nextConfig.allowedMissingCount = Math.max(
        0,
        Math.floor(nextConfig.allowedMissingCount),
      );
    }
    if (typeof nextConfig.abandonedRetryTimeoutMinutes === "number") {
      nextConfig.abandonedRetryTimeoutMinutes = Math.max(
        1,
        Math.min(30, Math.floor(nextConfig.abandonedRetryTimeoutMinutes)),
      );
    }
    this.config = nextConfig;
  }

  /**
   * 获取当前配置
   */
  getConfig(): JuliangConfig {
    return { ...this.config };
  }

  /**
   * 初始化浏览器
   */
  async initialize(): Promise<{ success: boolean; error?: string }> {
    try {
      // 重置取消标志
      this.isCancelled = false;

      // 如果已初始化且页面仍然可用，跳过
      if (
        this.isInitialized &&
        this.context &&
        this.page &&
        !this.page.isClosed()
      ) {
        this.log("浏览器已初始化，跳过");
        return { success: true };
      }

      // 如果之前的 context 还在但 page 已关闭，先清理
      if (this.context) {
        this.log("检测到浏览器上下文残留，先清理...");
        try {
          if (this.page && !this.page.isClosed()) {
            await this.page.close();
          }
          await this.context.close();
        } catch {
          // 忽略清理错误
        }
        this.page = null;
        this.context = null;
        this.isInitialized = false;
      }

      const userDataDir = this.getUserDataDir();
      this.log(`正在初始化浏览器，数据目录: ${userDataDir}`);

      // 确保目录存在
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }

      // 查找系统已安装的浏览器
      const executablePath = this.findSystemBrowser();
      if (!executablePath) {
        return {
          success: false,
          error:
            "未找到 Chrome 或 Edge 浏览器，请先安装 Google Chrome 或 Microsoft Edge",
        };
      }

      this.log(`使用系统浏览器: ${executablePath}`);

      // 使用持久化上下文，保存登录状态
      this.context = await chromium.launchPersistentContext(userDataDir, {
        executablePath, // 使用系统浏览器
        headless: this.config.headless,
        slowMo: this.config.slowMo,
        viewport: null,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        args: ["--start-maximized"],
      });

      // 创建固定页面实例
      this.page = await this.context.newPage();
      await this.page.bringToFront();

      this.isInitialized = true;
      this.log("浏览器初始化成功");

      // 初始化后导航到巨量主页，用于检查登录状态
      this.log("导航到巨量主页检查登录状态...");
      await this.page.goto("https://ad.oceanengine.com/", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      // 等待可能的重定向完成
      await this.page.waitForTimeout(2000);

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[Juliang] 初始化浏览器失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  private parseLoginStateFile(content: string): JuliangLoginStateStorage {
    const parsed = JSON.parse(content) as
      | JuliangLoginStateFile
      | JuliangLoginStateStorage
      | null;

    const storageState = (
      parsed &&
      typeof parsed === "object" &&
      "storageState" in parsed &&
      parsed.storageState
        ? parsed.storageState
        : parsed
    ) as JuliangLoginStateStorage | null;

    if (
      !storageState ||
      typeof storageState !== "object" ||
      !Array.isArray(storageState.cookies) ||
      !Array.isArray(storageState.origins)
    ) {
      throw new Error("登录态文件格式无效");
    }

    return {
      cookies: storageState.cookies,
      origins: storageState.origins,
    };
  }

  private async ensureInitializedForLoginState(): Promise<void> {
    if (this.isReady()) {
      return;
    }

    const result = await this.initialize();
    if (!result.success) {
      throw new Error(result.error || "浏览器初始化失败");
    }
  }

  async exportLoginState(filePath: string): Promise<{
    success: boolean;
    cancelled?: boolean;
    filePath?: string;
    error?: string;
  }> {
    try {
      await this.ensureInitializedForLoginState();

      if (!this.context) {
        throw new Error("巨量浏览器未初始化");
      }

      const loginStatus = await this.checkLoginStatus();
      if (loginStatus.needLogin) {
        throw new Error("当前巨量后台未登录，请先登录后再导出登录态");
      }

      const storageState = await this.context.storageState();
      const hasLocalStorage = storageState.origins.some(
        (item) => item.localStorage.length > 0,
      );
      if (!storageState.cookies.length && !hasLocalStorage) {
        throw new Error("未读取到有效登录态，请先完成登录后再导出");
      }

      const payload: JuliangLoginStateFile = {
        type: "juliang-login-state",
        version: 1,
        exportedAt: new Date().toISOString(),
        storageState: {
          cookies: storageState.cookies as JuliangLoginStateCookie[],
          origins: storageState.origins,
        },
      };

      fs.mkdirSync(dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
      this.log(`登录态已导出: ${filePath}`);

      return { success: true, filePath };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[Juliang] 导出登录态失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  async importLoginState(filePath: string): Promise<{
    success: boolean;
    cancelled?: boolean;
    filePath?: string;
    error?: string;
    needLogin?: boolean;
  }> {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error("登录态文件不存在");
      }

      const storageState = this.parseLoginStateFile(
        fs.readFileSync(filePath, "utf-8"),
      );
      const hasLocalStorage = storageState.origins.some(
        (item) => item.localStorage.length > 0,
      );
      if (!storageState.cookies.length && !hasLocalStorage) {
        throw new Error("登录态文件内容为空");
      }

      await this.close();

      const userDataDir = this.getUserDataDir();
      if (fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }

      await this.ensureInitializedForLoginState();

      if (!this.context || !this.page) {
        throw new Error("浏览器上下文初始化失败");
      }

      await this.context.clearCookies();

      if (storageState.cookies.length > 0) {
        await this.context.addCookies(storageState.cookies);
      }

      for (const originState of storageState.origins) {
        if (!originState.origin) {
          continue;
        }

        await this.page.goto(originState.origin, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await this.page.evaluate((entries) => {
          window.localStorage.clear();
          for (const entry of entries) {
            window.localStorage.setItem(entry.name, entry.value);
          }
        }, originState.localStorage);
      }

      await this.page.goto("https://ad.oceanengine.com/", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await this.page.waitForTimeout(2000);

      const loginStatus = await this.checkLoginStatus();
      this.log(
        `登录态已导入: ${filePath}，当前状态: ${loginStatus.needLogin ? "需要重新登录" : "已登录"}`,
      );

      return {
        success: true,
        filePath,
        needLogin: loginStatus.needLogin,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[Juliang] 导入登录态失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 检查是否已初始化且页面可用
   */
  isReady(): boolean {
    return (
      this.isInitialized &&
      this.context !== null &&
      this.page !== null &&
      !this.page.isClosed()
    );
  }

  /**
   * 导出当前登录态的 Cookie 字符串，供非页面自动化接口复用
   */
  async getCookieHeader(): Promise<string> {
    if (!this.context) {
      throw new Error("巨量浏览器未初始化");
    }

    const cookies = await this.context.cookies();
    if (!cookies.length) {
      throw new Error("未读取到巨量 Cookie，请先登录巨量后台");
    }

    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  async clearExistingProjects(accountId: string): Promise<{
    queriedCount: number;
    deletedCount: number;
    projectIds: string[];
  }> {
    const normalizedAccountId = String(accountId || "").trim();
    if (!normalizedAccountId) {
      throw new Error("缺少账户 ID");
    }

    const cookieHeader = await this.getCookieHeader();
    const dateString = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const projectIds: string[] = [];
    let page = 1;
    let totalPages = 1;

    this.log(`开始清理账户 ${normalizedAccountId} 的历史项目`);

    while (page <= totalPages) {
      const response = await fetch(
        `https://ad.oceanengine.com/ad/api/promotion/projects/list?aadvid=${normalizedAccountId}`,
        {
          method: "POST",
          headers: {
            Cookie: cookieHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            project_status: [-1],
            search_type: "8",
            promotion_status: [-1],
            st: dateString,
            et: dateString,
            campaign_type: [1],
            page,
            limit: 30,
            fields: [
              "stat_cost",
              "show_cnt",
              "cpm_platform",
              "click_cnt",
              "ctr",
              "cpc_platform",
              "convert_cnt",
              "conversion_rate",
              "conversion_cost",
            ],
            cascade_fields: ["support_cost_rate_7d", "budget_optimize_switch"],
            sort_stat: "create_time",
            sort_order: 1,
            need_trans_toLocal: true,
            isSophonx: 1,
          }),
        },
      );

      const result = await this.parseJsonResponse<JuliangProjectListResponse>(
        response,
        "查询项目列表",
      );
      if (result.code !== 0) {
        throw new Error(result.msg || result.message || "查询项目列表失败");
      }

      const projects = Array.isArray(result.data?.projects)
        ? result.data.projects
        : [];
      projectIds.push(
        ...projects
          .map((project) => String(project?.project_id || "").trim())
          .filter(Boolean),
      );

      totalPages = Math.max(
        1,
        Number(result.data?.pagination?.total_page || 1),
      );
      page += 1;
    }

    const uniqueProjectIds = [...new Set(projectIds)];
    if (!uniqueProjectIds.length) {
      this.log(`账户 ${normalizedAccountId} 没有可删除的历史项目`);
      return {
        queriedCount: 0,
        deletedCount: 0,
        projectIds: [],
      };
    }

    for (let index = 0; index < uniqueProjectIds.length; index += 20) {
      const chunk = uniqueProjectIds.slice(index, index + 20);
      const response = await fetch(
        `https://ad.oceanengine.com/ad/api/promotion/projects/delete?aadvid=${normalizedAccountId}`,
        {
          method: "POST",
          headers: {
            Cookie: cookieHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ProjectIds: chunk,
            ForceAsync: false,
          }),
        },
      );

      const result = await this.parseJsonResponse<JuliangProjectDeleteResponse>(
        response,
        "删除项目",
      );
      if (result.code !== 0) {
        throw new Error(result.msg || result.message || "删除项目失败");
      }
    }

    this.log(
      `账户 ${normalizedAccountId} 历史项目清理完成，共删除 ${uniqueProjectIds.length} 个项目`,
    );
    return {
      queriedCount: uniqueProjectIds.length,
      deletedCount: uniqueProjectIds.length,
      projectIds: uniqueProjectIds,
    };
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    try {
      // 设置取消标志，让正在执行的上传任务退出
      this.isCancelled = true;

      if (this.page) {
        try {
          if (!this.page.isClosed()) {
            await this.page.close();
          }
        } catch {
          // 页面可能已经关闭，忽略
        }
        this.page = null;
      }

      if (this.context) {
        try {
          await this.context.close();
        } catch {
          // context 可能已经关闭，忽略
        }
        this.context = null;
      }

      this.isInitialized = false;
      this.log("浏览器已关闭（登录状态已保存）");
    } catch (error) {
      console.error(
        `[Juliang] 关闭浏览器失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      // 即使关闭失败，也要重置状态，避免后续无法重新初始化
      this.page = null;
      this.context = null;
      this.isInitialized = false;
    }
  }

  /**
   * 重置取消标志（初始化时调用）
   */
  resetCancelFlag(): void {
    this.isCancelled = false;
  }

  /**
   * 检查是否已取消
   */
  checkCancelled(): boolean {
    return this.isCancelled;
  }

  /**
   * 导航到上传页面
   */
  async navigateToUploadPage(
    accountId: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.page || this.page.isClosed()) {
      return { success: false, error: "浏览器页面已关闭" };
    }

    try {
      const url = this.config.baseUploadUrl.replace("{accountId}", accountId);
      this.log(`导航到上传页面: ${url}`);

      await this.page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      await this.randomDelay(1000, 2000);

      this.log("页面加载完成");
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[Juliang] 导航失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 检查登录状态
   */
  async checkLoginStatus(): Promise<{
    isLoggedIn: boolean;
    needLogin: boolean;
  }> {
    if (!this.page && !this.context) {
      return { isLoggedIn: false, needLogin: true };
    }

    try {
      const currentUrl =
        this.page && !this.page.isClosed() ? this.page.url() : "";
      if (currentUrl) {
        this.log(`当前页面 URL: ${currentUrl}`);
      }

      let needLogin = this.isJuliangLoginUrl(currentUrl);
      let isLoggedIn = !needLogin;

      if (needLogin && this.context) {
        const sessionUrl = await this.resolveSessionStatusUrl();
        if (sessionUrl) {
          this.log(`后台会话检测 URL: ${sessionUrl}`);
          needLogin = this.isJuliangLoginUrl(sessionUrl);
          isLoggedIn = !needLogin;
        }
      }

      this.log(`登录状态: ${isLoggedIn ? "已登录" : "需要登录"}`);
      return { isLoggedIn, needLogin };
    } catch (error) {
      console.error(`[Juliang] 检查登录状态失败: ${error}`);
      return { isLoggedIn: false, needLogin: true };
    }
  }

  private isJuliangLoginUrl(url: string): boolean {
    const normalizedUrl = String(url || "").toLowerCase();
    if (!normalizedUrl) {
      return true;
    }

    return normalizedUrl.includes("login") || normalizedUrl.includes("sso");
  }

  private async resolveSessionStatusUrl(): Promise<string | null> {
    if (!this.context) {
      return null;
    }

    try {
      const response = await this.context.request.get(
        "https://ad.oceanengine.com/",
        {
          failOnStatusCode: false,
          timeout: 15000,
        },
      );
      return response.url();
    } catch (error) {
      console.warn("[Juliang] 后台会话检测失败:", error);
      return null;
    }
  }

  /**
   * 导出当前浏览器上下文中的 Cookie 字符串，供搭建流程复用登录态
   */
  async getCookieString(): Promise<string> {
    if (!this.context) {
      return "";
    }

    const cookies = await this.context.cookies([
      "https://ad.oceanengine.com",
      "https://business.oceanengine.com",
      "https://aadv.oceanengine.com",
    ]);

    if (!cookies.length) {
      return "";
    }

    const cookieMap = new Map<string, string>();
    for (const cookie of cookies) {
      cookieMap.set(cookie.name, cookie.value);
    }

    return Array.from(cookieMap.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  /**
   * 随机延迟
   */
  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * 检测上传面板中是否出现不可重试的错误提示
   */
  private async detectNonRetryableUploadError(): Promise<string | null> {
    if (!this.page || this.page.isClosed()) {
      return null;
    }

    const uploadPanel = this.page
      .locator(this.config.selectors.uploadPanel)
      .first();

    for (const errorText of this.nonRetryableUploadErrors) {
      try {
        const locator = uploadPanel
          .getByText(errorText, { exact: false })
          .first();
        if (await locator.isVisible({ timeout: 200 })) {
          return errorText;
        }
      } catch {
        // 未找到该错误提示，继续检测下一个
      }
    }

    try {
      const errorCandidates = uploadPanel.locator(
        '[class*="error"], [class*="fail"], [class*="danger"], [class*="warn"]',
      );
      const candidateCount = Math.min(await errorCandidates.count(), 10);

      for (let i = 0; i < candidateCount; i++) {
        const candidate = errorCandidates.nth(i);
        if (!(await candidate.isVisible())) {
          continue;
        }
        const text = (await candidate.innerText()).trim().replace(/\s+/g, " ");
        if (
          text &&
          this.uploadErrorKeywords.test(text) &&
          !this.ignoredUploadErrorTexts.some((ignoredText) =>
            text.includes(ignoredText),
          )
        ) {
          return text.slice(0, 100);
        }
      }
    } catch {
      // 通用错误元素检测失败时忽略，继续走后续逻辑
    }

    return null;
  }

  /**
   * 读取当前上传列表的文件名和状态
   */
  private async getUploadRowSnapshots(): Promise<{
    progressCount: number;
    rows: JuliangUploadRowSnapshot[];
  }> {
    if (!this.page || this.page.isClosed()) {
      return { progressCount: 0, rows: [] };
    }

    // 使用 page.evaluate 在浏览器端一次性提取所有行数据，
    // 避免多次异步 Playwright 调用之间 DOM 变化导致的竞态超时
    const errorKeywordsSource = this.uploadErrorKeywords.source;
    const ignoredTexts = this.ignoredUploadErrorTexts;

    const result = await this.page.evaluate(
      ({
        errorKeywords,
        ignored,
      }: {
        errorKeywords: string;
        ignored: string[];
      }) => {
        const errorRegex = new RegExp(errorKeywords);

        // 在整个页面查找所有进度条元素（与原逻辑一致，不限定在 uploadPanel 内）
        const progressBars = document.querySelectorAll(
          ".material-center-v2-oc-upload-table-name-progress",
        );

        // 收集所有进度条行的父元素，用于去重
        const progressRowParents = new Set<Element>();
        let progressCount = 0;
        const rows: Array<{
          fileName: string;
          rowText: string;
          isSuccess: boolean;
          hasError: boolean;
        }> = [];

        // 先遍历有进度条的行
        for (const progressBar of progressBars) {
          const row = progressBar.parentElement;
          if (!row) continue;
          progressRowParents.add(row);
          progressCount++;

          const rowText = (row.innerText || "").trim().replace(/\s+/g, " ");

          const fileNameEl = row.querySelector(
            ".material-center-v2-oc-upload-table-name-text .material-center-v2-oc-typography-value-int",
          );
          const fileName = fileNameEl
            ? (fileNameEl as HTMLElement).innerText?.trim() || ""
            : "";

          const isSuccess = !!row.querySelector(
            ".material-center-v2-oc-upload-table-name-progress-success",
          );

          const hasErrorElement = !!row.querySelector(
            '.material-center-v2-oc-upload-table-name-progress-error, [class*="error"], [class*="fail"], [class*="danger"]',
          );
          const hasError = hasErrorElement;

          rows.push({ fileName, rowText, isSuccess, hasError });
        }

        // 再查找没有进度条但有 name-text 的行（报错后进度条消失的行）
        const nameTextElements = document.querySelectorAll(
          ".material-center-v2-oc-upload-table-name-text",
        );
        for (const nameText of nameTextElements) {
          const row = nameText.parentElement;
          if (!row || progressRowParents.has(row)) continue;

          // 检查这个行是否在上传区域内（有进度相关的兄弟元素或错误提示）
          const rowText = (row.innerText || "").trim().replace(/\s+/g, " ");

          const fileNameEl = nameText.querySelector(
            ".material-center-v2-oc-typography-value-int",
          );
          const fileName = fileNameEl
            ? (fileNameEl as HTMLElement).innerText?.trim() || ""
            : "";

          // 只有当行文本包含错误关键词时才认为是报错的上传行
          const hasErrorElement = !!row.querySelector(
            '.material-center-v2-oc-upload-table-name-progress-error, [class*="error"], [class*="fail"], [class*="danger"]',
          );
          const hasErrorKeyword =
            errorRegex.test(rowText) &&
            !ignored.some((t) => rowText.includes(t));

          if (hasErrorElement || hasErrorKeyword) {
            rows.push({
              fileName,
              rowText,
              isSuccess: false,
              hasError: true,
            });
          }
        }

        return { progressCount, rows };
      },
      {
        errorKeywords: errorKeywordsSource,
        ignored: ignoredTexts,
      },
    );

    return result;
  }

  /**
   * 根据文件名把当前批次拆分成已成功和未完成文件
   */
  private splitFilesByUploadedNames(
    files: string[],
    successNames: string[],
  ): {
    completedFiles: string[];
    remainingFiles: string[];
  } {
    const remainingSuccessCounts = new Map<string, number>();
    for (const successName of successNames) {
      remainingSuccessCounts.set(
        successName,
        (remainingSuccessCounts.get(successName) || 0) + 1,
      );
    }

    const completedFiles: string[] = [];
    const remainingFiles: string[] = [];

    for (const file of files) {
      const fileName = basename(file);
      const remainingCount = remainingSuccessCounts.get(fileName) || 0;
      if (remainingCount > 0) {
        completedFiles.push(file);
        remainingSuccessCounts.set(fileName, remainingCount - 1);
      } else {
        remainingFiles.push(file);
      }
    }

    return { completedFiles, remainingFiles };
  }

  /**
   * 格式化文件名列表日志
   */
  private formatFileNamesForLog(fileNames: string[]): string {
    if (fileNames.length === 0) {
      return "无";
    }

    const uniqueNames = Array.from(new Set(fileNames.filter(Boolean)));
    if (uniqueNames.length <= 8) {
      return uniqueNames.join("、");
    }

    return `${uniqueNames.slice(0, 8).join("、")} 等 ${uniqueNames.length} 个`;
  }

  /**
   * 点击确定按钮
   */
  private async clickConfirmButton(): Promise<void> {
    if (!this.page) return;

    const confirmButton = this.page
      .locator(this.config.selectors.confirmButton)
      .first();
    await confirmButton.waitFor({ state: "visible", timeout: 10000 });
    await this.randomDelay(500, 1000);
    await confirmButton.click();
    this.log("确定按钮点击成功");
  }

  /**
   * 上传单批文件（支持重试）
   * 策略：必须所有素材都上传成功才算成功，不足额就重试
   */
  private async uploadBatch(
    files: string[],
    batchIndex: number,
    totalBatches: number,
  ): Promise<JuliangBatchResult> {
    if (!this.page) {
      return { success: false, successCount: 0 };
    }

    const maxRetries = this.config.maxBatchRetries;
    const maxAttempts = maxRetries + 1;
    const maxPartialRounds = this.config.timeoutPartialRetryRounds;
    let currentFiles = [...files];
    let committedSuccessCount = 0;
    let partialRound = 0;

    while (currentFiles.length > 0) {
      let shouldContinuePartialRound = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const retry = attempt - 1;
        // 检查是否已取消或页面已关闭
        if (this.isCancelled || !this.page || this.page.isClosed()) {
          this.log("上传已取消");
          return { success: false, successCount: committedSuccessCount };
        }

        try {
          if (retry > 0 || partialRound > 0) {
            // 再次检查页面状态
            if (!this.page || this.page.isClosed()) {
              this.log("页面已关闭，上传取消");
              return { success: false, successCount: committedSuccessCount };
            }

            const retryMessage =
              retry > 0
                ? `第 ${batchIndex}/${totalBatches} 批开始第 ${retry} 次重试（本次为第 ${attempt}/${maxAttempts} 次尝试，最多重试 ${maxRetries} 次）`
                : `第 ${batchIndex}/${totalBatches} 批开始超时轮回第 ${partialRound}/${maxPartialRounds} 次，仅重传剩余 ${currentFiles.length} 个素材`;
            this.log(retryMessage);

            if (retry > 0) {
              // 批次重试：刷新页面，确保页面状态干净
              this.log("刷新页面以清理状态...");
              await this.page.reload({
                waitUntil: "networkidle",
                timeout: 60000,
              });
              this.log("页面刷新完成，等待 5 秒后重试");
              await this.page.waitForTimeout(5000);
            } else if (partialRound > 0) {
              // 超时轮回：不刷新页面，只短暂等待让页面稳定
              this.log("等待页面稳定后重新上传...");
              await this.page.waitForTimeout(2000);
            }
          }

          const result = await this.uploadBatchInternal(
            currentFiles,
            batchIndex,
            totalBatches,
            retry,
          );

          if (result.success) {
            return {
              success: true,
              successCount: committedSuccessCount + result.successCount,
            };
          }

          if (result.remainingFiles) {
            committedSuccessCount += result.successCount;
            partialRound++;

            if (result.remainingFiles.length === 0) {
              this.log(
                `第 ${batchIndex}/${totalBatches} 批超时后已提交全部已成功素材，作为同一批完成`,
              );
              return { success: true, successCount: committedSuccessCount };
            }

            if (partialRound > maxPartialRounds) {
              this.log(
                `第 ${batchIndex}/${totalBatches} 批超时轮回已达到上限 ${maxPartialRounds} 次，放弃剩余 ${result.remainingFiles.length} 个未完成素材，继续下一批`,
              );
              return {
                success: true,
                successCount: committedSuccessCount,
                abandonedFiles: result.remainingFiles,
              };
            }

            currentFiles = result.remainingFiles;
            const partialMsg =
              result.successCount > 0
                ? `第 ${batchIndex}/${totalBatches} 批已提交 ${result.successCount} 个已完成素材，剩余 ${currentFiles.length} 个未完成素材将进行超时轮回重传`
                : `第 ${batchIndex}/${totalBatches} 批超时后无素材成功，${currentFiles.length} 个素材将进行超时轮回重传`;
            this.log(
              `${partialMsg}: ${this.formatFileNamesForLog(
                currentFiles.map((file) => basename(file)),
              )}`,
            );
            shouldContinuePartialRound = true;
            break;
          }

          if (result.failureType === "no-progress-timeout") {
            const stallError = result.error || "上传卡死：30 秒内未出现进度条";

            if (attempt < maxAttempts) {
              this.log(
                `第 ${batchIndex}/${totalBatches} 批上传卡死（剩余 ${currentFiles.length} 个素材 ${stallError}），准备进行第 ${retry + 1} 次重试（最多重试 ${maxRetries} 次）...`,
              );
              continue;
            }

            const exhaustedError =
              maxRetries > 0
                ? `${stallError}，重试 ${maxRetries} 次后仍未恢复`
                : `${stallError}，当前未配置批次重试，已跳过当前任务`;
            this.log(
              `第 ${batchIndex}/${totalBatches} 批上传卡死，${maxRetries > 0 ? `重试 ${maxRetries} 次后仍未恢复，` : ""}跳过当前任务`,
            );
            return {
              success: false,
              skipped: true,
              successCount: committedSuccessCount + result.successCount,
              error: exhaustedError,
            };
          }

          if (result.skipped) {
            this.log(
              `第 ${batchIndex}/${totalBatches} 批命中不可重试错误，跳过当前任务: ${result.error || "未知错误"}`,
            );
            return {
              ...result,
              successCount: committedSuccessCount + result.successCount,
            };
          }

          if (attempt < maxAttempts) {
            const observedSuccessCount =
              committedSuccessCount +
              (result.observedSuccessCount ?? result.successCount);
            const shortfall = files.length - observedSuccessCount;
            this.log(
              `第 ${batchIndex}/${totalBatches} 批上传不足额（${observedSuccessCount}/${files.length}，差 ${shortfall} 个），准备进行第 ${retry + 1} 次重试（最多重试 ${maxRetries} 次）...`,
            );
          } else {
            const observedSuccessCount =
              committedSuccessCount +
              (result.observedSuccessCount ?? result.successCount);
            const exhaustedMessage =
              maxRetries > 0
                ? `第 ${batchIndex}/${totalBatches} 批重试 ${maxRetries} 次后仍失败（${observedSuccessCount}/${files.length}）`
                : `第 ${batchIndex}/${totalBatches} 批首次尝试失败，且当前未配置重试（${observedSuccessCount}/${files.length}）`;
            this.log(exhaustedMessage);
          }
        } catch (error) {
          this.log(
            `上传第 ${batchIndex}/${totalBatches} 批失败（第 ${attempt}/${maxAttempts} 次尝试）: ${error instanceof Error ? error.message : String(error)}`,
          );

          if (attempt < maxAttempts) {
            this.log(
              `准备刷新页面，进行第 ${retry + 1} 次重试（最多重试 ${maxRetries} 次）...`,
            );
          } else {
            throw error;
          }
        }
      }

      if (shouldContinuePartialRound) {
        continue;
      }

      return { success: false, successCount: committedSuccessCount };
    }

    return { success: true, successCount: committedSuccessCount };
  }

  /**
   * 上传单批文件（内部实现）
   */
  private async uploadBatchInternal(
    files: string[],
    batchIndex: number,
    totalBatches: number,
    retryCount: number,
  ): Promise<JuliangBatchResult> {
    if (!this.page) {
      return { success: false, successCount: 0 };
    }

    try {
      // 1. 点击上传按钮
      this.log(`第 ${batchIndex}/${totalBatches} 批：查找上传按钮`);
      const uploadButton = this.page
        .locator(this.config.selectors.uploadButton)
        .first();

      // 等待按钮可见（对于非第一批或重试，可能需要更长时间）
      const waitTimeout = batchIndex === 1 && retryCount === 0 ? 10000 : 20000;
      await uploadButton.waitFor({ state: "visible", timeout: waitTimeout });
      await this.randomDelay(500, 1000);
      await uploadButton.click();

      this.log("上传按钮点击成功，等待上传面板");

      // 2. 等待上传面板完全加载
      this.log(`等待上传面板出现: ${this.config.selectors.uploadPanel}`);
      const uploadPanel = this.page
        .locator(this.config.selectors.uploadPanel)
        .first();
      await uploadPanel.waitFor({ state: "visible", timeout: 10000 });

      // 等待上传面板动画完成和完全准备好
      this.log("上传面板已出现，等待完全加载...");
      await this.randomDelay(3000, 4000);

      // 3. 使用文件选择器上传
      this.log("开始监听文件选择器事件...");
      const fileChooserPromise = this.page.waitForEvent("filechooser", {
        timeout: 15000,
      });

      this.log("点击上传面板触发文件选择");
      await uploadPanel.click();

      this.log("等待文件选择器弹出...");
      const fileChooser = await fileChooserPromise;
      this.log(`文件选择器已弹出，设置 ${files.length} 个文件`);
      await fileChooser.setFiles(files);

      this.log("文件设置成功，开始上传");
      await this.randomDelay(2000, 3000);

      // 4. 等待上传完成
      const maxWaitTime = this.config.batchUploadTimeoutMinutes * 60 * 1000;
      const noProgressBarTimeout = 30000; // 30秒没有任何进度条，视为卡死
      const startTime = Date.now();
      let finalSuccessCount = 0;
      let maxObservedProgressCount = 0;
      let consecutiveMissingSuccessRounds = 0;
      const allowedMissingCount = Math.max(
        0,
        Math.min(this.config.allowedMissingCount, files.length),
      );
      const minimumRequiredProgressCount = Math.max(
        files.length - allowedMissingCount,
        1,
      );

      // 先等待一下，让文件开始上传和进度条出现
      await this.randomDelay(5000, 6000);

      while (Date.now() - startTime < maxWaitTime) {
        // 检查是否已取消
        if (this.isCancelled) {
          this.log("上传已被取消");
          return { success: false, successCount: 0 };
        }

        try {
          // 检查页面是否还有效
          if (!this.page || this.page.isClosed()) {
            this.log("页面已关闭，上传取消");
            return { success: false, successCount: 0 };
          }

          const snapshot = await this.getUploadRowSnapshots();
          // totalRowCount: 所有可见的上传行（包括有进度条的和已报错无进度条的）
          // progressCount: 仅有进度条的行数
          const totalRowCount = snapshot.rows.length;
          const progressCount = snapshot.progressCount;
          if (totalRowCount > maxObservedProgressCount) {
            maxObservedProgressCount = totalRowCount;
            this.log(
              `本批次历史最大行数量更新为 ${maxObservedProgressCount}/${files.length}`,
            );
          }
          const hasSeenAllRows =
            maxObservedProgressCount >= files.length;

          if (totalRowCount === 0) {
            const nonRetryableError =
              await this.detectNonRetryableUploadError();
            if (nonRetryableError) {
              this.log(`检测到不可重试的上传错误: ${nonRetryableError}`);
              await this.clickCancelButton();
              return {
                success: false,
                successCount: 0,
                skipped: true,
                error: nonRetryableError,
              };
            }
            if (Date.now() - startTime >= noProgressBarTimeout) {
              const stallError = `上传卡死：${noProgressBarTimeout / 1000} 秒内未出现进度条`;
              this.log(stallError);
              await this.clickCancelButton();
              return {
                success: false,
                successCount: 0,
                failureType: "no-progress-timeout",
                error: stallError,
              };
            }
            this.log("上传行未找到，继续等待...");
            await this.randomDelay(5000, 6000);
            continue;
          }

          // 如果可见行数少于预期，判断是否达到最低要求
          const elapsedTime = Date.now() - startTime;
          if (
            totalRowCount < files.length &&
            elapsedTime > 10000 &&
            !hasSeenAllRows
          ) {
            if (maxObservedProgressCount < minimumRequiredProgressCount) {
              // 未达到最低要求，立即取消并重试
              this.log(
                `检测到上传行数量严重不足：当前 ${totalRowCount}/${files.length}，历史最大 ${maxObservedProgressCount}/${files.length}，最低要求 ${minimumRequiredProgressCount}/${files.length}，立即取消并准备重试`,
              );

              // 点击取消按钮
              await this.clickCancelButton();

              // 返回不足额状态，让外层重试
              return { success: false, successCount: maxObservedProgressCount };
            } else {
              // 已达到最低要求，允许继续上传，但记录差异
              this.log(
                `上传行数量略少：当前 ${totalRowCount}/${files.length}，历史最大 ${maxObservedProgressCount}/${files.length}，最低要求 ${minimumRequiredProgressCount}/${files.length}，继续等待上传完成`,
              );
            }
          } else if (totalRowCount < files.length && hasSeenAllRows) {
            this.log(
              `检测到巨量行回退：当前 ${totalRowCount}/${files.length}，但本批次已出现过完整 ${maxObservedProgressCount}/${files.length}，继续等待，不视为成功`,
            );
          }

          const successCount = snapshot.rows.filter(
            (row) => row.isSuccess,
          ).length;
          const errorCount = snapshot.rows.filter((row) => row.hasError).length;

          this.log(
            `找到 ${totalRowCount} 个上传行（期望 ${files.length} 个），进度条 ${progressCount} 个`,
          );
          this.log(
            `上传进度: 成功 ${successCount} 个，错误 ${errorCount} 个，上传中 ${totalRowCount - successCount - errorCount} 个`,
          );

          const terminalCount = successCount + errorCount;

          // 判断上传完成的条件：当前所有可见行都进入终态（成功或错误）
          if (terminalCount === totalRowCount && totalRowCount > 0) {
            if (totalRowCount < minimumRequiredProgressCount) {
              consecutiveMissingSuccessRounds++;
              this.log(
                `检测到终态行数量不足：当前 ${totalRowCount}/${files.length}，最低要求 ${minimumRequiredProgressCount}/${files.length}，第 ${consecutiveMissingSuccessRounds} 次确认`,
              );
              if (consecutiveMissingSuccessRounds < 2) {
                await this.page.waitForTimeout(5000);
                continue;
              }

              // 如果有成功的素材，先提交再轮回重传缺失的
              if (successCount > 0) {
                const successNames = snapshot.rows
                  .filter((row) => row.isSuccess && row.fileName)
                  .map((row) => row.fileName);
                const { remainingFiles } = this.splitFilesByUploadedNames(
                  files,
                  successNames,
                );

                this.log(
                  `进度条不足但有 ${successCount} 个素材已成功，先提交已成功素材，再轮回重传剩余 ${remainingFiles.length} 个`,
                );

                try {
                  await this.clickConfirmButton();
                } catch (confirmError) {
                  this.log(
                    `提交已成功素材失败: ${confirmError instanceof Error ? confirmError.message : String(confirmError)}`,
                  );
                  await this.clickCancelButton();
                  return {
                    success: false,
                    successCount: 0,
                    observedSuccessCount: successCount,
                    remainingFiles: files,
                  };
                }

                return {
                  success: false,
                  successCount,
                  observedSuccessCount: successCount,
                  remainingFiles,
                };
              }

              this.log(
                `上传异常：最终只剩 ${totalRowCount}/${files.length} 个上传行且无素材成功，取消本批并准备轮回重试`,
              );

              // 点击取消按钮
              await this.clickCancelButton();

              // 返回 remainingFiles 让外层走超时轮回路径
              return {
                success: false,
                successCount: 0,
                observedSuccessCount: 0,
                remainingFiles: files,
              };
            }

            if (successCount < minimumRequiredProgressCount) {
              const successNames = snapshot.rows
                .filter((row) => row.isSuccess && row.fileName)
                .map((row) => row.fileName);
              const { remainingFiles } = this.splitFilesByUploadedNames(
                files,
                successNames,
              );
              const failedNames = remainingFiles.map((file) => basename(file));

              this.log(
                `当前批次已结束，但成功数不足：成功 ${successCount}/${files.length}，最低要求 ${minimumRequiredProgressCount}/${files.length}，先提交已成功素材，再仅重传失败素材`,
              );
              this.log(
                `第 ${batchIndex}/${totalBatches} 批检测到失败素材 ${failedNames.length} 个: ${this.formatFileNamesForLog(
                  failedNames,
                )}`,
              );
              await this.randomDelay(1000, 2000);

              this.log("点击确定按钮");
              try {
                await this.clickConfirmButton();
              } catch (confirmError) {
                this.log(
                  `提交已成功素材失败: ${confirmError instanceof Error ? confirmError.message : String(confirmError)}`,
                );
                return {
                  success: false,
                  successCount: 0,
                  observedSuccessCount: successCount,
                };
              }

              return {
                success: false,
                successCount,
                observedSuccessCount: successCount,
                remainingFiles,
              };
            }

            consecutiveMissingSuccessRounds = 0;
            finalSuccessCount = successCount;

            if (errorCount > 0) {
              const successNames = snapshot.rows
                .filter((row) => row.isSuccess && row.fileName)
                .map((row) => row.fileName);
              const { remainingFiles } = this.splitFilesByUploadedNames(
                files,
                successNames,
              );

              this.log(
                `检测到 ${errorCount} 个素材报错，先提交 ${successCount} 个已成功素材，再轮回重传报错的 ${remainingFiles.length} 个`,
              );
              await this.randomDelay(1000, 2000);

              this.log("点击确定按钮");
              try {
                await this.clickConfirmButton();
              } catch (confirmError) {
                this.log(
                  `提交已成功素材失败: ${confirmError instanceof Error ? confirmError.message : String(confirmError)}`,
                );
                return {
                  success: false,
                  successCount: 0,
                  observedSuccessCount: successCount,
                  remainingFiles: files,
                };
              }

              return {
                success: false,
                successCount,
                observedSuccessCount: successCount,
                remainingFiles,
              };
            } else if (totalRowCount < files.length) {
              this.log(
                `按允许缺失配置视为成功：当前 ${totalRowCount}/${files.length} 个上传行全部成功，允许缺失 ${allowedMissingCount} 个`,
              );
            } else {
              this.log("所有素材上传完成（所有进度条显示成功状态）");
            }
            await this.randomDelay(1000, 2000);

            // 点击确定按钮
            this.log("点击确定按钮");
            await this.clickConfirmButton();

            // 批次间延迟
            if (batchIndex < totalBatches) {
              this.log("等待页面准备下一批上传...");
              await this.randomDelay(5000, 8000);
            } else {
              await this.randomDelay(
                this.config.batchDelayMin,
                this.config.batchDelayMax,
              );
            }

            return { success: true, successCount: finalSuccessCount };
          }

          consecutiveMissingSuccessRounds = 0;

          // 继续等待（5秒轮询间隔）
          await this.page.waitForTimeout(5000);
        } catch (error) {
          this.log(
            `检查上传状态时出错: ${error instanceof Error ? error.message : String(error)}`,
          );
          await this.randomDelay(5000, 6000);
        }
      }

      const timeoutSnapshot = await this.getUploadRowSnapshots();
      const successNames = timeoutSnapshot.rows
        .filter((row) => row.isSuccess && row.fileName)
        .map((row) => row.fileName);
      const { remainingFiles } = this.splitFilesByUploadedNames(
        files,
        successNames,
      );
      const unfinishedNames = remainingFiles.map((file) => basename(file));

      this.log(
        `上传第 ${batchIndex}/${totalBatches} 批失败: 等待文件上传超时（${this.config.batchUploadTimeoutMinutes}分钟）`,
      );
      this.log(
        `第 ${batchIndex}/${totalBatches} 批超时时已成功 ${successNames.length}/${files.length} 个，未完成素材: ${this.formatFileNamesForLog(
          unfinishedNames,
        )}`,
      );

      if (successNames.length === 0) {
        this.log("超时后没有任何素材成功，点击取消按钮关闭弹窗");
        await this.clickCancelButton();
        return {
          success: false,
          successCount: 0,
          observedSuccessCount: 0,
          remainingFiles: files,
        };
      }

      let confirmSubmitted = false;
      try {
        this.log("点击确定按钮，先提交当前已成功素材");
        await this.clickConfirmButton();
        confirmSubmitted = true;
      } catch (confirmError) {
        this.log(
          `超时后点击确定按钮失败: ${confirmError instanceof Error ? confirmError.message : String(confirmError)}`,
        );
      }

      if (!confirmSubmitted) {
        return {
          success: false,
          successCount: 0,
          observedSuccessCount: successNames.length,
        };
      }

      return {
        success: false,
        successCount: successNames.length,
        observedSuccessCount: successNames.length,
        remainingFiles,
      };
    } catch (error) {
      this.log(
        `上传第 ${batchIndex}/${totalBatches} 批失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { success: false, successCount: 0, observedSuccessCount: 0 };
    }
  }

  /**
   * 点击取消按钮
   */
  private async clickCancelButton(): Promise<void> {
    if (!this.page) return;

    try {
      const cancelButton = this.page
        .locator(this.config.selectors.cancelButton)
        .first();
      await cancelButton.waitFor({ state: "visible", timeout: 5000 });
      await this.randomDelay(500, 1000);
      await cancelButton.click();
      this.log("取消按钮点击成功");
      await this.randomDelay(2000, 3000);
    } catch (cancelError) {
      this.log(
        `点击取消按钮失败: ${cancelError instanceof Error ? cancelError.message : String(cancelError)}`,
      );
    }
  }

  /**
   * 执行上传任务
   */
  async uploadTask(task: JuliangTask): Promise<JuliangUploadResult> {
    if (!this.page || this.page.isClosed()) {
      return {
        success: false,
        taskId: task.id,
        drama: task.drama,
        successCount: 0,
        totalFiles: task.files.length,
        error: "浏览器页面已关闭",
      };
    }

    // 用于在 catch 中保存进度的变量
    let currentBatchIndex = 0;
    let batches: string[][] = [];
    let totalBatches = 0;
    let totalSuccess = 0;

    try {
      this.log(`开始上传任务: ${task.drama}，共 ${task.files.length} 个文件`);

      // 发送进度：开始
      this.emitProgress({
        taskId: task.id,
        drama: task.drama,
        status: "running",
        currentBatch: 0,
        totalBatches: Math.ceil(task.files.length / this.config.batchSize),
        successCount: 0,
        totalFiles: task.files.length,
        message: "开始上传",
      });

      // 导航到上传页面
      const navResult = await this.navigateToUploadPage(task.accountId);
      if (!navResult.success) {
        throw new Error(navResult.error);
      }

      // 分批上传
      const batchSize = this.config.batchSize;
      batches = [];
      for (let i = 0; i < task.files.length; i += batchSize) {
        batches.push(task.files.slice(i, i + batchSize));
      }

      totalBatches = batches.length;
      const ignoredBatchIndexes: number[] = [];
      const ignoredBatchErrors: string[] = [];
      const ignoredFileNames: string[] = [];

      // 检查是否有保存的进度（断点续传）
      const savedProgress = task.recordId
        ? this.progressManager.getProgress(task.recordId)
        : null;
      let startBatchIndex = 0;
      totalSuccess = 0;

      if (savedProgress && savedProgress.totalBatches === totalBatches) {
        startBatchIndex = savedProgress.completedBatches;
        // 计算已完成批次的成功文件数（考虑最后一批可能不足 batchSize）
        for (let j = 0; j < startBatchIndex; j++) {
          totalSuccess += batches[j].length;
        }
        if (startBatchIndex > 0) {
          this.log(
            `检测到上传进度，从第 ${startBatchIndex + 1}/${totalBatches} 批开始继续上传（已完成 ${totalSuccess} 个文件）`,
          );
        }
      } else {
        if (savedProgress && savedProgress.totalBatches !== totalBatches) {
          this.log(
            `文件数量已变化（${savedProgress.totalBatches} → ${totalBatches} 批），重新开始上传`,
          );
          if (task.recordId) {
            this.progressManager.clearProgress(task.recordId, task.drama);
          }
        }
        this.log(`文件分为 ${totalBatches} 批上传`);
      }

      // 从保存的进度开始上传
      const allAbandonedFiles: string[] = [];
      for (let i = startBatchIndex; i < batches.length; i++) {
        currentBatchIndex = i; // 记录当前批次，用于异常时保存进度
        const batch = batches[i];

        // 发送进度：当前批次
        this.emitProgress({
          taskId: task.id,
          drama: task.drama,
          status: "running",
          currentBatch: i + 1,
          totalBatches,
          successCount: totalSuccess,
          totalFiles: task.files.length,
          message: `正在上传第 ${i + 1}/${totalBatches} 批`,
        });

        const result = await this.uploadBatch(batch, i + 1, totalBatches);
        if (result.successCount > 0) {
          totalSuccess += result.successCount;
        }

        // 收集被放弃的文件
        if (result.abandonedFiles && result.abandonedFiles.length > 0) {
          allAbandonedFiles.push(...result.abandonedFiles);
          this.log(
            `第 ${i + 1}/${totalBatches} 批有 ${result.abandonedFiles.length} 个文件被放弃，将在所有批次结束后兜底重传`,
          );
        }

        if (result.success) {
          // 每批成功后更新进度
          if (task.recordId) {
            this.progressManager.updateProgress(
              task.recordId,
              task.drama,
              task.date,
              task.account,
              totalBatches,
              i + 1, // 已完成的批次数
            );
          }
        } else if (result.skipped) {
          if (task.recordId) {
            this.progressManager.clearProgress(task.recordId, task.drama);
          }

          this.log(
            `任务跳过: ${task.drama} - ${result.error || "命中不可重试错误"}`,
          );
          this.emitProgress({
            taskId: task.id,
            drama: task.drama,
            status: "skipped",
            currentBatch: i + 1,
            totalBatches,
            successCount: totalSuccess,
            totalFiles: task.files.length,
            message: result.error || "上传已跳过",
          });

          return {
            success: false,
            skipped: true,
            taskId: task.id,
            drama: task.drama,
            successCount: totalSuccess,
            totalFiles: task.files.length,
            error: result.error || "上传已跳过",
          };
        } else {
          // 检查是否是取消导致的失败
          if (this.isCancelled) {
            this.log(`上传已取消: ${task.drama}`);
            // 发送取消状态
            this.emitProgress({
              taskId: task.id,
              drama: task.drama,
              status: "skipped",
              currentBatch: i + 1,
              totalBatches,
              successCount: totalSuccess,
              totalFiles: task.files.length,
              message: "上传已取消",
            });
            return {
              success: false,
              taskId: task.id,
              drama: task.drama,
              successCount: totalSuccess,
              totalFiles: task.files.length,
              error: "上传已取消",
            };
          }

          // 当前批次的轮回与重试都已耗尽，跳过该批次并继续后续批次
          if (task.recordId) {
            this.progressManager.updateProgress(
              task.recordId,
              task.drama,
              task.date,
              task.account,
              totalBatches,
              i + 1,
            );
          }

          const batchError = result.error || `第 ${i + 1} 批上传失败`;
          ignoredBatchIndexes.push(i + 1);
          ignoredBatchErrors.push(batchError);
          ignoredFileNames.push(...batch.map((file) => basename(file)));
          console.error(
            `[Juliang] 第 ${i + 1}/${totalBatches} 批上传失败，已跳过`,
          );

          if (i < batches.length - 1) {
            this.log(
              `第 ${i + 1} 批已跳过，继续第 ${i + 2} 批上传（轮回重试和批次重试均已达上限）`,
            );
          } else {
            this.log(
              `第 ${i + 1} 批已跳过，当前已是最后一批，结束当前剧并继续下一部（轮回重试和批次重试均已达上限）`,
            );
          }

          continue;
        }
      }

      // 所有批次结束后，兜底重传之前放弃的文件（按 batchSize 分批，每批复用 uploadBatch 的超时轮回逻辑）
      if (allAbandonedFiles.length > 0 && !this.isCancelled && this.page && !this.page.isClosed()) {
        const retryTimeout = this.config.abandonedRetryTimeoutMinutes;
        const retryBatchSize = this.config.batchSize;
        const retryBatches: string[][] = [];
        for (let i = 0; i < allAbandonedFiles.length; i += retryBatchSize) {
          retryBatches.push(allAbandonedFiles.slice(i, i + retryBatchSize));
        }
        this.log(
          `所有批次完成后，尝试兜底重传 ${allAbandonedFiles.length} 个之前放弃的文件，分 ${retryBatches.length} 批（每批最多 ${retryBatchSize} 个，${retryTimeout}分钟超时）`,
        );

        // 临时调整超时为兜底重传超时
        const originalTimeout = this.config.batchUploadTimeoutMinutes;
        this.config.batchUploadTimeoutMinutes = retryTimeout;

        try {
          let retryTotalSuccess = 0;
          const retryStillFailed: string[] = [];

          for (let rb = 0; rb < retryBatches.length; rb++) {
            if (this.isCancelled || !this.page || this.page.isClosed()) break;

            const retryFiles = retryBatches[rb];
            const retryBatchIndex = totalBatches + rb + 1;
            const retryTotalBatches = totalBatches + retryBatches.length;
            this.log(
              `兜底重传第 ${rb + 1}/${retryBatches.length} 批（批次号 ${retryBatchIndex}/${retryTotalBatches}），${retryFiles.length} 个文件`,
            );

            // 复用 uploadBatch，自带超时轮回和重试逻辑
            const retryResult = await this.uploadBatch(
              retryFiles,
              retryBatchIndex,
              retryTotalBatches,
            );

            retryTotalSuccess += retryResult.successCount;

            if (retryResult.abandonedFiles && retryResult.abandonedFiles.length > 0) {
              retryStillFailed.push(...retryResult.abandonedFiles);
            } else if (!retryResult.success && retryResult.successCount < retryFiles.length) {
              // uploadBatch 返回失败且没有 abandonedFiles，说明整批失败
              retryStillFailed.push(...retryFiles);
            }

            // 批次间等待
            if (rb < retryBatches.length - 1) {
              await this.randomDelay(3000, 5000);
            }
          }

          totalSuccess += retryTotalSuccess;
          if (retryTotalSuccess > 0) {
            this.log(
              `兜底重传成功 ${retryTotalSuccess}/${allAbandonedFiles.length} 个文件`,
            );
          }

          if (retryStillFailed.length > 0) {
            ignoredFileNames.push(
              ...retryStillFailed.map((f) => basename(f)),
            );
            ignoredBatchErrors.push(
              `兜底重传失败 ${retryStillFailed.length} 个文件`,
            );
            this.log(
              `兜底重传仍有 ${retryStillFailed.length} 个文件失败，已计入忽略列表`,
            );
          } else if (retryTotalSuccess > 0) {
            this.log(`兜底重传全部成功`);
          }
        } catch (error) {
          this.log(
            `兜底重传出错: ${error instanceof Error ? error.message : String(error)}`,
          );
          ignoredFileNames.push(
            ...allAbandonedFiles.map((f) => basename(f)),
          );
          ignoredBatchErrors.push(
            `兜底重传出错: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          this.config.batchUploadTimeoutMinutes = originalTimeout;
        }
      }

      const allowedTotalMissing =
        this.config.allowedMissingCount * totalBatches;
      const minimumRequiredTotalSuccess = Math.max(
        task.files.length - allowedTotalMissing,
        0,
      );
      const hasIgnoredBatch = ignoredBatchIndexes.length > 0;
      const success =
        !hasIgnoredBatch && totalSuccess >= minimumRequiredTotalSuccess;
      const actualMissing = task.files.length - totalSuccess;
      const uniqueIgnoredFileNames = Array.from(new Set(ignoredFileNames));
      const partialRemark = hasIgnoredBatch
        ? `成功 ${totalSuccess} 个素材，失败 ${actualMissing} 个素材`
        : undefined;
      const partialErrorMessage = hasIgnoredBatch
        ? `少传 ${actualMissing} 个素材（跳过批次 ${ignoredBatchIndexes.join("、")}：${this.formatFileNamesForLog(uniqueIgnoredFileNames)}）；失败原因：${ignoredBatchErrors.join("；")}`
        : undefined;

      // 上传完成，清除进度记录
      this.progressManager.clearProgress(task.recordId, task.drama);

      // 发送进度：完成
      this.emitProgress({
        taskId: task.id,
        drama: task.drama,
        status: success ? "completed" : "failed",
        currentBatch: totalBatches,
        totalBatches,
        successCount: totalSuccess,
        totalFiles: task.files.length,
        message: success
          ? `上传完成（成功 ${totalSuccess}/${task.files.length}）`
          : hasIgnoredBatch
            ? `上传部分完成（成功 ${totalSuccess}/${task.files.length}，跳过批次 ${ignoredBatchIndexes.join("、")}）`
            : `上传失败（成功 ${totalSuccess}/${task.files.length}）`,
      });

      return {
        success,
        taskId: task.id,
        drama: task.drama,
        successCount: totalSuccess,
        totalFiles: task.files.length,
        error: partialErrorMessage,
        remark: partialRemark,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[Juliang] 上传任务失败: ${errorMessage}`);

      // 异常时保存进度（如果有 recordId 且已开始上传）
      if (task.recordId && totalBatches > 0 && currentBatchIndex > 0) {
        this.progressManager.updateProgress(
          task.recordId,
          task.drama,
          task.date,
          task.account,
          totalBatches,
          currentBatchIndex, // 保存当前批次之前的进度
        );
        this.log(
          `异常发生，已保存进度：${currentBatchIndex}/${totalBatches} 批`,
        );
      }

      // 发送进度：失败
      this.emitProgress({
        taskId: task.id,
        drama: task.drama,
        status: "failed",
        currentBatch: currentBatchIndex,
        totalBatches,
        successCount: totalSuccess,
        totalFiles: task.files.length,
        message: `上传失败: ${errorMessage}`,
      });

      return {
        success: false,
        taskId: task.id,
        drama: task.drama,
        successCount: totalSuccess,
        totalFiles: task.files.length,
        error: errorMessage,
      };
    }
  }

  /**
   * 获取当前页面截图（用于调试）
   */
  async getScreenshot(): Promise<Buffer | null> {
    if (!this.page) {
      return null;
    }

    try {
      return await this.page.screenshot();
    } catch (error) {
      console.error(`[Juliang] 截图失败: ${error}`);
      return null;
    }
  }
}

// 单例导出
export const juliangService = new JuliangService();
