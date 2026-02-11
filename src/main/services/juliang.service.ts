/**
 * 巨量创意上传服务
 * 基于 Playwright 自动化上传素材到巨量创意后台
 */

import { chromium, BrowserContext, Page } from "playwright";
import { app, BrowserWindow } from "electron";
import { join } from "path";
import * as fs from "fs";

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
  baseUploadUrl: "https://chuangyi.oceanengine.com/material/video?accountId={accountId}",
  batchSize: 20,
  batchDelayMin: 3000,
  batchDelayMax: 5000,
  headless: false,
  slowMo: 50,
  selectors: {
    uploadButton: 'button:has(span:text("上传视频"))',
    uploadPanel: ".upload-area, .oc-upload, .tos-upload, [class*='upload']",
    fileInput: 'input[type="file"]',
    confirmButton: 'button:has(span:text("确定"))',
    cancelButton: 'button:has(span:text("取消"))',
  },
};

export class JuliangService {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: JuliangConfig = DEFAULT_CONFIG;
  private isInitialized = false;
  private mainWindow: BrowserWindow | null = null;
  private progressCallback: ((progress: JuliangUploadProgress) => void) | null = null;

  /**
   * 获取用户数据目录
   */
  private getUserDataDir(): string {
    return join(app.getPath("userData"), "juliang-browser-data");
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
      if (this.isInitialized && this.context) {
        console.log("[Juliang] 浏览器已初始化，跳过");
        return { success: true };
      }

      const userDataDir = this.getUserDataDir();
      console.log(`[Juliang] 正在初始化 Playwright 浏览器，数据目录: ${userDataDir}`);

      // 确保目录存在
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }

      // 使用持久化上下文，保存登录状态
      this.context = await chromium.launchPersistentContext(userDataDir, {
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
      console.log("[Juliang] 浏览器初始化成功");

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
      if (this.page) {
        await this.page.close();
        this.page = null;
      }

      if (this.context) {
        await this.context.close();
        this.context = null;
      }

      this.isInitialized = false;
      console.log("[Juliang] 浏览器已关闭（登录状态已保存）");
    } catch (error) {
      console.error(`[Juliang] 关闭浏览器失败: ${error instanceof Error ? error.message : String(error)}`);
    }
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
      console.log(`[Juliang] 导航到上传页面: ${url}`);

      await this.page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      await this.randomDelay(1000, 2000);

      console.log("[Juliang] 页面加载完成");
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
      // 检查页面 URL 或特定元素判断是否已登录
      const currentUrl = this.page.url();

      // 如果在登录页面，说明未登录
      if (currentUrl.includes("login") || currentUrl.includes("sso")) {
        return { isLoggedIn: false, needLogin: true };
      }

      // 检查是否有上传按钮（已登录的标志）
      const uploadButton = this.page.locator(this.config.selectors.uploadButton).first();
      const isVisible = await uploadButton.isVisible().catch(() => false);

      return { isLoggedIn: isVisible, needLogin: !isVisible };
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
   * 上传单批文件
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

    const maxRetries = 3;

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        if (retry > 0) {
          console.log(`[Juliang] 第 ${batchIndex}/${totalBatches} 批重试第 ${retry} 次`);
          await this.page.reload({ waitUntil: "networkidle", timeout: 60000 });
          await this.randomDelay(3000, 5000);
        }

        // 1. 点击上传按钮
        console.log(`[Juliang] 第 ${batchIndex}/${totalBatches} 批：查找上传按钮`);
        const uploadButton = this.page.locator(this.config.selectors.uploadButton).first();
        await uploadButton.waitFor({ state: "visible", timeout: 10000 });
        await this.randomDelay(500, 1000);
        await uploadButton.click();

        console.log("[Juliang] 上传按钮点击成功，等待上传面板");

        // 2. 等待上传面板
        const uploadPanel = this.page.locator(this.config.selectors.uploadPanel).first();
        await uploadPanel.waitFor({ state: "visible", timeout: 10000 });
        await this.randomDelay(2000, 3000);

        // 3. 使用文件选择器上传
        console.log(`[Juliang] 设置 ${files.length} 个文件`);
        const fileChooserPromise = this.page.waitForEvent("filechooser", { timeout: 15000 });
        await uploadPanel.click();

        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(files);

        console.log("[Juliang] 文件设置成功，等待上传完成");
        await this.randomDelay(2000, 3000);

        // 4. 等待上传完成（简化版：等待固定时间 + 检查进度）
        const maxWaitTime = 600000; // 10分钟
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
          // 检查进度条
          const progressBars = this.page.locator(".material-center-v2-oc-upload-table-name-progress");
          const progressCount = await progressBars.count();

          if (progressCount > 0) {
            // 检查成功状态
            let successCount = 0;
            for (let i = 0; i < progressCount; i++) {
              const parent = progressBars.nth(i).locator("..");
              const successElement = parent.locator(".material-center-v2-oc-upload-table-name-progress-success");
              if ((await successElement.count()) > 0) {
                successCount++;
              }
            }

            console.log(`[Juliang] 上传进度: ${successCount}/${progressCount}`);

            if (successCount === progressCount && successCount >= files.length) {
              // 全部完成，点击确定
              console.log("[Juliang] 所有文件上传完成");
              await this.randomDelay(1000, 2000);

              const confirmButton = this.page.locator(this.config.selectors.confirmButton).first();
              await confirmButton.waitFor({ state: "visible", timeout: 10000 });
              await confirmButton.click();

              await this.randomDelay(this.config.batchDelayMin, this.config.batchDelayMax);
              return { success: true, successCount };
            }
          }

          await this.page.waitForTimeout(5000);
        }

        // 超时
        throw new Error("上传超时");
      } catch (error) {
        console.error(`[Juliang] 第 ${batchIndex}/${totalBatches} 批上传失败: ${error}`);
        if (retry === maxRetries - 1) {
          return { success: false, successCount: 0 };
        }
      }
    }

    return { success: false, successCount: 0 };
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
      console.log(`[Juliang] 开始上传任务: ${task.drama}，共 ${task.files.length} 个文件`);

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

      let totalSuccess = 0;
      const totalBatches = batches.length;

      for (let i = 0; i < batches.length; i++) {
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
        } else {
          console.error(`[Juliang] 第 ${i + 1}/${totalBatches} 批上传失败`);
        }
      }

      const success = totalSuccess >= task.files.length * 0.9; // 90% 成功即可

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
