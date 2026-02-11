/**
 * 巨量创意上传服务
 * 基于 Playwright 自动化上传素材到巨量创意后台
 */

import { chromium, BrowserContext, Page } from "playwright";
import { app, BrowserWindow } from "electron";
import { join } from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { JuliangProgressManager } from "./juliang-progress.service";

// 上传任务状态
export type JuliangTaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

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
  error?: string;
}

// 巨量配置
export interface JuliangConfig {
  baseUploadUrl: string;
  batchSize: number;
  batchDelayMin: number;
  batchDelayMax: number;
  headless: boolean;
  slowMo: number;
  selectors: {
    uploadButton: string;
    uploadPanel: string;
    fileInput: string;
    confirmButton: string;
    cancelButton: string;
  };
}

// 默认配置
const DEFAULT_CONFIG: JuliangConfig = {
  baseUploadUrl: "https://ad.oceanengine.com/material_center/management/video?aadvid={accountId}#source=ad_navigator",
  batchSize: 10, // 巨量后台每次最多上传 10 个视频
  batchDelayMin: 3000,
  batchDelayMax: 5000,
  headless: false,
  slowMo: 50,
  selectors: {
    uploadButton: "button:has(span:text('上传视频'))",
    uploadPanel: ".material-center-v2-oc-create-upload-select-wrapper",
    fileInput: 'input[type="file"]',
    confirmButton: ".material-center-v2-oc-create-material-submit-bar-btn-group button:has-text('确定')",
    cancelButton: ".material-center-v2-oc-create-material-submit-bar-btn-group button:has-text('取消')",
  },
};

export class JuliangService {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: JuliangConfig = DEFAULT_CONFIG;
  private isInitialized = false;
  private mainWindow: BrowserWindow | null = null;
  private progressCallback: ((progress: JuliangUploadProgress) => void) | null = null;
  private logs: Array<{ time: string; message: string }> = [];
  private maxLogs = 500; // 最多保存 500 条日志
  private progressManager: JuliangProgressManager = new JuliangProgressManager();
  private isCancelled = false; // 取消标志

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
          { encoding: "utf-8" }
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
    this.config = { ...this.config, ...config };
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

      if (this.isInitialized && this.context) {
        this.log("浏览器已初始化，跳过");
        return { success: true };
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
          error: "未找到 Chrome 或 Edge 浏览器，请先安装 Google Chrome 或 Microsoft Edge",
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
      await this.page.goto("https://ad.oceanengine.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
      // 等待可能的重定向完成
      await this.page.waitForTimeout(2000);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Juliang] 初始化浏览器失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 检查是否已初始化
   */
  isReady(): boolean {
    return this.isInitialized && this.context !== null && this.page !== null;
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    try {
      // 设置取消标志，让正在执行的上传任务退出
      this.isCancelled = true;

      if (this.page) {
        await this.page.close();
        this.page = null;
      }

      if (this.context) {
        await this.context.close();
        this.context = null;
      }

      this.isInitialized = false;
      this.log("浏览器已关闭（登录状态已保存）");
    } catch (error) {
      console.error(`[Juliang] 关闭浏览器失败: ${error instanceof Error ? error.message : String(error)}`);
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
  async navigateToUploadPage(accountId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.page) {
      return { success: false, error: "浏览器未初始化" };
    }

    try {
      const url = this.config.baseUploadUrl.replace("{accountId}", accountId);
      this.log(`导航到上传页面: ${url}`);

      await this.page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      await this.randomDelay(1000, 2000);

      this.log("页面加载完成");
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Juliang] 导航失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 检查登录状态
   */
  async checkLoginStatus(): Promise<{ isLoggedIn: boolean; needLogin: boolean }> {
    if (!this.page) {
      return { isLoggedIn: false, needLogin: true };
    }

    try {
      // 获取当前页面 URL
      const currentUrl = this.page.url();
      this.log(`当前页面 URL: ${currentUrl}`);

      // 如果 URL 包含 login 或 sso，说明未登录（被重定向到登录页）
      const needLogin = currentUrl.includes("login") || currentUrl.includes("sso");
      const isLoggedIn = !needLogin;

      this.log(`登录状态: ${isLoggedIn ? "已登录" : "需要登录"}`);
      return { isLoggedIn, needLogin };
    } catch (error) {
      console.error(`[Juliang] 检查登录状态失败: ${error}`);
      return { isLoggedIn: false, needLogin: true };
    }
  }

  /**
   * 随机延迟
   */
  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * 上传单批文件（支持重试）
   * 策略：必须所有素材都上传成功才算成功，不足额就重试
   */
  private async uploadBatch(
    files: string[],
    batchIndex: number,
    totalBatches: number,
    taskId: string,
    drama: string
  ): Promise<{ success: boolean; successCount: number }> {
    if (!this.page) {
      return { success: false, successCount: 0 };
    }

    const maxRetries = 10; // 最多重试10次

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        if (retry > 0) {
          this.log(`第 ${batchIndex}/${totalBatches} 批重试第 ${retry} 次`);

          // 重试前刷新页面，确保页面状态干净
          this.log("刷新页面以清理状态...");
          await this.page.reload({ waitUntil: "networkidle", timeout: 60000 });
          this.log("页面刷新完成，等待 5 秒后重试");
          await this.page.waitForTimeout(5000);
        }

        const result = await this.uploadBatchInternal(files, batchIndex, totalBatches, taskId, drama, retry);

        // 完全成功
        if (result.success) {
          return result;
        }

        // 不足额，需要重试
        if (retry < maxRetries - 1) {
          const shortfall = files.length - result.successCount;
          this.log(
            `第 ${batchIndex}/${totalBatches} 批上传不足额（${result.successCount}/${files.length}，差 ${shortfall} 个），准备刷新页面后重试...`
          );
        } else {
          // 最后一次重试仍失败
          this.log(
            `第 ${batchIndex}/${totalBatches} 批重试 ${maxRetries} 次后仍失败（${result.successCount}/${files.length}）`
          );
        }
      } catch (error) {
        this.log(
          `上传第 ${batchIndex}/${totalBatches} 批失败（第 ${retry + 1} 次尝试）: ${error instanceof Error ? error.message : String(error)}`
        );

        if (retry < maxRetries - 1) {
          this.log("准备刷新页面后重试...");
        } else {
          throw error;
        }
      }
    }

    return { success: false, successCount: 0 };
  }

  /**
   * 上传单批文件（内部实现）
   */
  private async uploadBatchInternal(
    files: string[],
    batchIndex: number,
    totalBatches: number,
    taskId: string,
    drama: string,
    retryCount: number
  ): Promise<{ success: boolean; successCount: number }> {
    if (!this.page) {
      return { success: false, successCount: 0 };
    }

    try {
      // 1. 点击上传按钮
      this.log(`第 ${batchIndex}/${totalBatches} 批：查找上传按钮`);
      const uploadButton = this.page.locator(this.config.selectors.uploadButton).first();

      // 等待按钮可见（对于非第一批或重试，可能需要更长时间）
      const waitTimeout = batchIndex === 1 && retryCount === 0 ? 10000 : 20000;
      await uploadButton.waitFor({ state: "visible", timeout: waitTimeout });
      await this.randomDelay(500, 1000);
      await uploadButton.click();

      this.log("上传按钮点击成功，等待上传面板");

      // 2. 等待上传面板完全加载
      this.log(`等待上传面板出现: ${this.config.selectors.uploadPanel}`);
      const uploadPanel = this.page.locator(this.config.selectors.uploadPanel).first();
      await uploadPanel.waitFor({ state: "visible", timeout: 10000 });

      // 等待上传面板动画完成和完全准备好
      this.log("上传面板已出现，等待完全加载...");
      await this.randomDelay(3000, 4000);

      // 3. 使用文件选择器上传
      this.log("开始监听文件选择器事件...");
      const fileChooserPromise = this.page.waitForEvent("filechooser", { timeout: 15000 });

      this.log("点击上传面板触发文件选择");
      await uploadPanel.click();

      this.log("等待文件选择器弹出...");
      const fileChooser = await fileChooserPromise;
      this.log(`文件选择器已弹出，设置 ${files.length} 个文件`);
      await fileChooser.setFiles(files);

      this.log("文件设置成功，开始上传");
      await this.randomDelay(2000, 3000);

      // 4. 等待上传完成
      const maxWaitTime = 600000; // 10分钟
      const startTime = Date.now();
      let finalSuccessCount = 0;

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

          // 查找所有进度条元素
          const progressBars = this.page.locator(".material-center-v2-oc-upload-table-name-progress");
          const progressCount = await progressBars.count();

          if (progressCount === 0) {
            this.log("进度条未找到，继续等待...");
            await this.randomDelay(5000, 6000);
            continue;
          }

          // 如果进度条数量少于预期，且不是刚开始就少（说明有文件上传失败），立即取消并重试
          const elapsedTime = Date.now() - startTime;
          if (progressCount < files.length && elapsedTime > 20000) {
            this.log(
              `检测到进度条数量不足：${progressCount}/${files.length}，立即取消并准备重试`
            );

            // 点击取消按钮
            await this.clickCancelButton();

            // 返回不足额状态，让外层重试
            return { success: false, successCount: progressCount };
          }

          this.log(`找到 ${progressCount} 个进度条（期望 ${files.length} 个）`);

          // 检查每个进度条是否有成功标识
          let successCount = 0;
          for (let i = 0; i < progressCount; i++) {
            const progressBar = progressBars.nth(i);
            const parent = progressBar.locator("..");
            const successElement = parent.locator(".material-center-v2-oc-upload-table-name-progress-success");
            if ((await successElement.count()) > 0) {
              successCount++;
            }
          }

          this.log(`上传进度: ${successCount}/${progressCount} 个素材已完成`);

          // 判断上传完成的条件：所有找到的进度条都显示成功状态
          if (successCount === progressCount && successCount > 0) {
            finalSuccessCount = successCount;

            if (progressCount < files.length) {
              // 进度条数量少于预期，说明有文件上传失败
              this.log(
                `上传完成但数量不足：${progressCount}/${files.length}（第 ${retryCount + 1} 次尝试）`
              );

              // 点击取消按钮
              await this.clickCancelButton();

              // 返回不足额状态，让外层决定
              return { success: false, successCount: finalSuccessCount };
            } else {
              // 进度条数量符合预期，全部上传成功
              this.log("所有素材上传完成（所有进度条显示成功状态）");
              await this.randomDelay(1000, 2000);

              // 点击确定按钮
              this.log("点击确定按钮");
              const confirmButton = this.page.locator(this.config.selectors.confirmButton).first();
              await confirmButton.waitFor({ state: "visible", timeout: 10000 });
              await this.randomDelay(500, 1000);
              await confirmButton.click();

              this.log("确定按钮点击成功");

              // 批次间延迟
              if (batchIndex < totalBatches) {
                this.log("等待页面准备下一批上传...");
                await this.randomDelay(5000, 8000);
              } else {
                await this.randomDelay(this.config.batchDelayMin, this.config.batchDelayMax);
              }

              return { success: true, successCount: finalSuccessCount };
            }
          }

          // 继续等待（30秒轮询间隔）
          await this.page.waitForTimeout(30000);
        } catch (error) {
          this.log(`检查上传状态时出错: ${error instanceof Error ? error.message : String(error)}`);
          await this.randomDelay(5000, 6000);
        }
      }

      // 超时
      throw new Error("等待文件上传超时（10分钟）");
    } catch (error) {
      this.log(
        `上传第 ${batchIndex}/${totalBatches} 批失败: ${error instanceof Error ? error.message : String(error)}`
      );
      return { success: false, successCount: 0 };
    }
  }

  /**
   * 点击取消按钮
   */
  private async clickCancelButton(): Promise<void> {
    if (!this.page) return;

    try {
      const cancelButton = this.page.locator(this.config.selectors.cancelButton).first();
      await cancelButton.waitFor({ state: "visible", timeout: 5000 });
      await this.randomDelay(500, 1000);
      await cancelButton.click();
      this.log("取消按钮点击成功");
      await this.randomDelay(2000, 3000);
    } catch (cancelError) {
      this.log(`点击取消按钮失败: ${cancelError instanceof Error ? cancelError.message : String(cancelError)}`);
    }
  }

  /**
   * 执行上传任务
   */
  async uploadTask(task: JuliangTask): Promise<JuliangUploadResult> {
    if (!this.page) {
      return {
        success: false,
        taskId: task.id,
        drama: task.drama,
        successCount: 0,
        totalFiles: task.files.length,
        error: "浏览器未初始化",
      };
    }

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
      const batches: string[][] = [];
      for (let i = 0; i < task.files.length; i += batchSize) {
        batches.push(task.files.slice(i, i + batchSize));
      }

      const totalBatches = batches.length;

      // 检查是否有保存的进度（断点续传）
      const savedProgress = this.progressManager.getProgress(task.recordId);
      let startBatchIndex = 0;
      let totalSuccess = 0;

      if (savedProgress && savedProgress.totalBatches === totalBatches) {
        startBatchIndex = savedProgress.completedBatches;
        // 计算已完成批次的成功文件数
        totalSuccess = startBatchIndex * batchSize;
        if (startBatchIndex > 0) {
          this.log(
            `检测到上传进度，从第 ${startBatchIndex + 1}/${totalBatches} 批开始继续上传`
          );
        }
      } else {
        this.log(`文件分为 ${totalBatches} 批上传`);
      }

      // 从保存的进度开始上传
      for (let i = startBatchIndex; i < batches.length; i++) {
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

        const result = await this.uploadBatch(batch, i + 1, totalBatches, task.id, task.drama);

        if (result.success) {
          totalSuccess += result.successCount;
          // 每批成功后更新进度
          this.progressManager.updateProgress(
            task.recordId,
            task.drama,
            task.date,
            task.account,
            totalBatches,
            i + 1 // 已完成的批次数
          );
        } else {
          // 上传失败，保存进度
          this.progressManager.updateProgress(
            task.recordId,
            task.drama,
            task.date,
            task.account,
            totalBatches,
            i // 保存已完成的批次数
          );
          console.error(`[Juliang] 第 ${i + 1}/${totalBatches} 批上传失败`);

          // 发送进度：失败
          this.emitProgress({
            taskId: task.id,
            drama: task.drama,
            status: "failed",
            currentBatch: i + 1,
            totalBatches,
            successCount: totalSuccess,
            totalFiles: task.files.length,
            message: `第 ${i + 1} 批上传失败，进度已保存`,
          });

          return {
            success: false,
            taskId: task.id,
            drama: task.drama,
            successCount: totalSuccess,
            totalFiles: task.files.length,
            error: `第 ${i + 1} 批上传失败`,
          };
        }
      }

      const success = totalSuccess >= task.files.length * 0.9; // 90% 成功即可

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
        message: success ? "上传完成" : "上传失败",
      });

      return {
        success,
        taskId: task.id,
        drama: task.drama,
        successCount: totalSuccess,
        totalFiles: task.files.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Juliang] 上传任务失败: ${errorMessage}`);

      // 发送进度：失败
      this.emitProgress({
        taskId: task.id,
        drama: task.drama,
        status: "failed",
        currentBatch: 0,
        totalBatches: 0,
        successCount: 0,
        totalFiles: task.files.length,
        message: `上传失败: ${errorMessage}`,
      });

      return {
        success: false,
        taskId: task.id,
        drama: task.drama,
        successCount: 0,
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
