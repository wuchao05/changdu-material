/**
 * 巨量上传调度器服务
 * 负责从飞书拉取待上传任务、执行上传、更新状态、删除本地目录
 */

import { app, BrowserWindow } from "electron";
import { join } from "path";
import * as fs from "fs";
import { juliangService, JuliangTask } from "./juliang.service";
import { ApiService } from "./api.service";
import { FileService } from "./file.service";
import { ConfigService, DarenInfo } from "./config.service";

// 调度器状态
export type SchedulerStatus = "idle" | "running" | "stopped";

// 任务状态
export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

// 已完成任务记录
export interface CompletedTask {
  drama: string;
  date: string;
  fileCount: number;
  status: "completed" | "failed" | "skipped";
  error?: string;
  remark?: string;
  completedAt: string;
  duration: string;
}

export interface PendingTaskSnapshot {
  order: number;
  drama: string;
  date: string;
  account: string;
  status: "pending" | "running";
}

// 内部任务
export interface InternalTask {
  id: string;
  recordId: string;
  drama: string;
  date: string;
  account: string;
  accountId: string;
  tableId: string;
  localPath?: string;
  mp4Files?: string[];
  status: TaskStatus;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

// 调度器配置
export interface SchedulerConfig {
  fetchIntervalMinutes: number; // 查询间隔（分钟）
  localRootDir: string; // 本地素材根目录
}

export class JuliangSchedulerService {
  private status: SchedulerStatus = "idle";
  private queue: InternalTask[] = [];
  private taskMap: Map<string, InternalTask> = new Map();
  private scopedDarenId: string | null = null;
  private fetchTimer: NodeJS.Timeout | null = null;
  private isTaskProcessing = false;
  private isCancelled = false; // 取消标志
  private currentTask: InternalTask | null = null; // 当前正在执行的任务
  private mainWindow: BrowserWindow | null = null;
  private logs: Array<{ time: string; message: string }> = [];
  private maxLogs = 500;
  private completedTasks: CompletedTask[] = [];
  private maxCompletedTasks = 100;
  private lastFetchAt: string | null = null;
  private nextFetchAt: string | null = null;

  private config: SchedulerConfig = {
    fetchIntervalMinutes: 20,
    localRootDir: "",
  };

  private apiService: ApiService;
  private fileService: FileService;
  private configService: ConfigService;
  private configFilePath: string;

  constructor(
    apiService: ApiService,
    fileService: FileService,
    configService: ConfigService,
  ) {
    this.apiService = apiService;
    this.fileService = fileService;
    this.configService = configService;
    this.configFilePath = join(
      app.getPath("userData"),
      "juliang-scheduler-config.json",
    );
    this.loadConfig();
  }

  /**
   * 从文件加载配置
   */
  private loadConfig() {
    try {
      if (fs.existsSync(this.configFilePath)) {
        const data = fs.readFileSync(this.configFilePath, "utf-8");
        const savedConfig = JSON.parse(data) as Partial<SchedulerConfig>;
        const nextConfig: SchedulerConfig = { ...this.config };

        if (typeof savedConfig.fetchIntervalMinutes === "number") {
          nextConfig.fetchIntervalMinutes = savedConfig.fetchIntervalMinutes;
        }

        if (typeof savedConfig.localRootDir === "string") {
          nextConfig.localRootDir = savedConfig.localRootDir;
        }

        this.config = nextConfig;
        console.log(
          `[JuliangScheduler] 已加载配置: localRootDir=${this.config.localRootDir}`,
        );
      }
    } catch (error) {
      console.error(`[JuliangScheduler] 加载配置失败:`, error);
    }
  }

  /**
   * 保存配置到文件
   */
  private saveConfig() {
    try {
      fs.writeFileSync(
        this.configFilePath,
        JSON.stringify(this.config, null, 2),
        "utf-8",
      );
      console.log(
        `[JuliangScheduler] 配置已保存: localRootDir=${this.config.localRootDir}`,
      );
    } catch (error) {
      console.error(`[JuliangScheduler] 保存配置失败:`, error);
    }
  }

  /**
   * 记录日志并发送到前端
   */
  private log(message: string) {
    const time = new Date().toLocaleTimeString();
    const logEntry = { time, message };

    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    console.log(`[JuliangScheduler] ${message}`);

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("juliang:scheduler-log", logEntry);
    }
  }

  /**
   * 设置主窗口
   */
  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
    juliangService.setMainWindow(window);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SchedulerConfig>) {
    const nextConfig: SchedulerConfig = {
      fetchIntervalMinutes:
        typeof config.fetchIntervalMinutes === "number"
          ? config.fetchIntervalMinutes
          : this.config.fetchIntervalMinutes,
      localRootDir:
        typeof config.localRootDir === "string"
          ? config.localRootDir
          : this.config.localRootDir,
    };

    if (typeof nextConfig.fetchIntervalMinutes === "number") {
      nextConfig.fetchIntervalMinutes = Math.max(
        1,
        Math.floor(nextConfig.fetchIntervalMinutes),
      );
    }
    this.config = nextConfig;
    this.saveConfig();
  }

  /**
   * 获取配置
   */
  getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  private async updateTaskFeishuStatus(
    task: InternalTask,
    status: string,
    maxAttempts = 3,
    remark?: string,
  ): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      const updateSuccess = await this.apiService.updateFeishuRecordStatus(
        task.recordId,
        status,
        this.configService,
        task.tableId,
        remark,
      );
      if (updateSuccess) {
        this.log(`飞书状态更新成功: ${task.drama} -> ${status}`);
        return true;
      }

      this.log(
        `飞书状态更新失败，第${i + 1}/${maxAttempts}次尝试: ${task.drama} -> ${status}`,
      );

      if (i < maxAttempts - 1) {
        this.apiService.clearFeishuTokenCache();
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return false;
  }

  /**
   * 获取调度器状态
   */
  getStatus(): SchedulerStatus {
    return this.status;
  }

  getStatusSnapshot() {
    return {
      status: this.status,
      stats: this.getQueueStats(),
      pendingTasks: this.getPendingTasks(),
      fetchIntervalMinutes: this.config.fetchIntervalMinutes,
      lastFetchAt: this.lastFetchAt,
      nextFetchAt: this.nextFetchAt,
    };
  }

  /**
   * 获取队列统计
   */
  getQueueStats() {
    return {
      total: this.queue.length,
      pending: this.queue.filter((t) => t.status === "pending").length,
      running: this.queue.filter((t) => t.status === "running").length,
      completed: this.queue.filter((t) => t.status === "completed").length,
      failed: this.queue.filter((t) => t.status === "failed").length,
      skipped: this.queue.filter((t) => t.status === "skipped").length,
    };
  }

  /**
   * 获取日志
   */
  getLogs() {
    return [...this.logs];
  }

  /**
   * 清空日志
   */
  clearLogs() {
    this.logs = [];
  }

  private markFetchStarted(at = new Date()) {
    this.lastFetchAt = at.toISOString();
    this.nextFetchAt = null;
  }

  private scheduleNextFetch(at = new Date()) {
    const intervalMs = this.config.fetchIntervalMinutes * 60 * 1000;
    this.nextFetchAt = new Date(at.getTime() + intervalMs).toISOString();
  }

  private clearNextFetch() {
    this.nextFetchAt = null;
  }

  /**
   * 记录已完成任务
   */
  private addCompletedTask(
    task: InternalTask,
    status: "completed" | "failed" | "skipped",
    startTime: number,
    remark?: string,
  ) {
    const elapsed = Date.now() - startTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    const duration = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
    this.completedTasks.unshift({
      drama: task.drama,
      date: task.date,
      fileCount: task.mp4Files?.length || 0,
      status,
      error: task.error,
      remark,
      completedAt: new Date().toISOString(),
      duration,
    });
    if (this.completedTasks.length > this.maxCompletedTasks) {
      this.completedTasks.pop();
    }
  }

  private async deleteLocalMaterialDirectory(task: InternalTask) {
    if (!task.localPath) {
      return;
    }

    const deleteSuccess = await this.fileService.deleteFolder(task.localPath);
    if (deleteSuccess.success) {
      this.log(`本地目录已删除: ${task.localPath}`);
    } else {
      this.log(`删除本地目录失败: ${task.localPath}`);
    }
  }

  /**
   * 获取已完成任务列表
   */
  getCompletedTasks(): CompletedTask[] {
    return [...this.completedTasks];
  }

  clearCompletedTasks(): { success: boolean } {
    this.completedTasks = [];
    return { success: true };
  }

  getPendingTasks(): PendingTaskSnapshot[] {
    return this.getPrioritizedTasks(this.queue)
      .filter(
        (task): task is InternalTask & { status: "pending" | "running" } =>
          task.status === "pending" || task.status === "running",
      )
      .map((task, index) => ({
        order: index + 1,
        drama: task.drama,
        date: task.date,
        account: task.account,
        status: task.status,
      }));
  }

  /**
   * 启动调度器
   */
  async start(darenId?: string): Promise<{ success: boolean; error?: string }> {
    if (this.status === "running") {
      return { success: false, error: "调度器已在运行中" };
    }

    this.scopedDarenId = darenId?.trim() || null;

    // 重新加载配置，确保使用最新值
    this.loadConfig();
    this.log(`使用配置: localRootDir=${this.config.localRootDir}`);
    if (this.scopedDarenId) {
      this.log(`当前调度仅处理达人: ${this.scopedDarenId}`);
    } else {
      this.log("当前调度处理所有启用巨量上传的达人");
    }

    if (!this.config.localRootDir) {
      return { success: false, error: "请先设置素材根目录" };
    }

    // 初始化浏览器
    const initResult = await juliangService.initialize();
    if (!initResult.success) {
      return { success: false, error: initResult.error };
    }

    // 检查登录状态
    const loginStatus = await juliangService.checkLoginStatus();
    if (loginStatus.needLogin) {
      return { success: false, error: "请先登录巨量创意后台" };
    }

    this.status = "running";
    this.lastFetchAt = null;
    this.nextFetchAt = null;
    this.log("调度器已启动");

    // 立即查询一次
    const count = await this.fetchAndEnqueueTasks();

    // 如果初始查询不到任务，启动定时轮询
    if (count === 0) {
      this.startScheduledFetching();
    }

    // 启动队列处理
    this.processQueue();

    return { success: true };
  }

  /**
   * 停止调度器
   */
  async stop(): Promise<void> {
    if (this.status !== "running") {
      return;
    }

    this.log("正在停止调度器");

    this.status = "stopped";
    this.stopScheduledFetching();
    this.clearNextFetch();

    // 关闭浏览器
    await juliangService.close();

    this.log("调度器已停止");
    this.scopedDarenId = null;
  }

  /**
   * 立即执行一次查询
   */
  async fetchNow(
    darenId?: string,
  ): Promise<{ success: boolean; count: number; error?: string }> {
    if (this.status !== "running") {
      return { success: false, count: 0, error: "调度器未运行" };
    }

    if (this.isTaskProcessing) {
      return { success: false, count: 0, error: "当前有任务正在执行" };
    }

    try {
      // 如果浏览器未初始化，先初始化
      if (!juliangService.isReady()) {
        this.log("浏览器未初始化，正在初始化...");
        const initResult = await juliangService.initialize();
        if (!initResult.success) {
          return {
            success: false,
            count: 0,
            error: `浏览器初始化失败: ${initResult.error}`,
          };
        }
      }

      const requestDarenId = darenId?.trim() || null;
      if (
        requestDarenId &&
        this.scopedDarenId &&
        requestDarenId !== this.scopedDarenId
      ) {
        return {
          success: false,
          count: 0,
          error: `当前调度已绑定达人 ${this.scopedDarenId}，请停止后重新启动`,
        };
      }

      this.log("手动触发：立即查询飞书任务");
      const count = await this.fetchAndEnqueueTasks();
      return { success: true, count };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, count: 0, error: errorMsg };
    }
  }

  /**
   * 取消所有上传任务
   */
  async cancelAll(): Promise<{ success: boolean; error?: string }> {
    try {
      this.log("手动触发：取消所有上传任务");

      // 设置取消标志
      this.isCancelled = true;

      // 停止定时拉取
      this.stopScheduledFetching();

      // 清空整个队列
      const totalCount = this.queue.length;
      this.queue = [];
      this.taskMap.clear();

      this.log(`已清空队列（共 ${totalCount} 个任务）`);

      // 标记当前正在处理的任务为取消状态
      if (this.isTaskProcessing && this.currentTask) {
        const cancelledTask = this.currentTask;
        this.log(`正在取消当前上传任务: ${cancelledTask.drama}...`);

        // 通过关闭浏览器来强制取消当前上传
        await juliangService.close();
        this.isTaskProcessing = false;
        this.currentTask = null;

        // 从队列中移除被取消的任务
        this.queue = this.queue.filter(
          (t) => t.recordId !== cancelledTask.recordId,
        );
        this.taskMap.delete(cancelledTask.recordId);

        this.log("当前上传任务已取消");

        // 恢复飞书状态为"待上传"
        if (cancelledTask.recordId && cancelledTask.tableId) {
          const updateSuccess = await this.apiService.updateFeishuRecordStatus(
            cancelledTask.recordId,
            "待上传",
            this.configService,
            cancelledTask.tableId,
          );
          if (updateSuccess) {
            this.log(`已将飞书状态恢复为"待上传": ${cancelledTask.drama}`);
          } else {
            this.log(`恢复飞书状态失败: ${cancelledTask.drama}`);
          }
        }

        // 取消后不自动重新初始化浏览器，等待用户手动操作
        this.log("取消完成，调度器暂停，点击'立即查询'继续");
      } else {
        // 如果没有正在执行的任务，可以重置取消标志
        this.isCancelled = false;
      }

      // 注意：如果有任务正在执行，isCancelled 保持为 true
      // 让 onTaskComplete 检测到取消后不再查询

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(`取消任务失败: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 从飞书拉取任务并入队
   */
  private async fetchAndEnqueueTasks(): Promise<number> {
    try {
      this.markFetchStarted();
      this.log("开始从飞书拉取待上传任务");

      // 清理已完成和已跳过的任务
      this.cleanup();

      // 获取达人配置
      const darenConfig = await this.configService.getDarenConfig();
      this.log(
        `所有达人配置: ${JSON.stringify(darenConfig.darenList.map((d) => ({ id: d.id, label: d.label, enableJuliang: d.enableJuliang, feishuDramaStatusTableId: d.feishuDramaStatusTableId })))}`,
      );
      const enabledDarens = this.getTargetDarens(darenConfig.darenList);

      if (enabledDarens.length === 0) {
        if (this.scopedDarenId) {
          this.log(`达人 ${this.scopedDarenId} 未启用巨量上传或不存在`);
        } else {
          this.log("没有启用巨量上传的达人");
        }
        return 0;
      }

      let totalAdded = 0;

      for (const daren of enabledDarens) {
        this.log(`处理达人: ${daren.label} (${daren.id})`);
        this.log(
          `达人配置详情: ${JSON.stringify({ id: daren.id, label: daren.label, feishuDramaStatusTableId: daren.feishuDramaStatusTableId, changduConfigType: daren.changduConfigType })}`,
        );

        if (!daren.feishuDramaStatusTableId) {
          this.log(`达人 ${daren.label} 未配置飞书表格 ID，跳过`);
          continue;
        }

        this.log(
          `达人 ${daren.label} 飞书表格 ID: ${daren.feishuDramaStatusTableId}`,
        );

        try {
          // 查询所有待上传的剧
          const result = await this.apiService.getPendingUploadDramas(
            this.configService,
            daren.feishuDramaStatusTableId,
          );

          this.log(
            `达人 ${daren.label} 查询结果: code=${result.code}, items=${result.data?.items?.length || 0}`,
          );

          if (result.code !== 0) {
            this.log(`达人 ${daren.label} 查询失败: ${result.msg}`);
            continue;
          }

          if (!result.data?.items || result.data.items.length === 0) {
            this.log(`达人 ${daren.label} 没有待上传的任务`);
            continue;
          }

          // 先解析所有记录
          const tasks: InternalTask[] = [];
          for (const item of result.data.items) {
            this.log(
              `解析记录: ${item.record_id}, 剧名原始值=${JSON.stringify(item.fields["剧名"])}, 日期=${item.fields["日期"]}`,
            );
            const task = this.parseFeishuRecord(item, daren);
            if (task) {
              tasks.push(task);
            }
          }

          // 按优先级排序：正在处理/更早日期的任务优先
          tasks.sort((a, b) => this.compareTaskPriority(a, b));
          this.log(
            `达人 ${daren.label} 共 ${tasks.length} 个任务（已按优先级排序）`,
          );

          // 添加到队列
          for (const task of tasks) {
            if (this.addTask(task)) {
              totalAdded++;
            }
          }
        } catch (error) {
          this.log(
            `达人 ${daren.label} 查询异常: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (totalAdded > 0) {
        this.log(`成功入队 ${totalAdded} 个新任务`);
      } else {
        this.log("没有待上传的任务");
      }

      const stats = this.getQueueStats();
      this.log(
        `队列状态: 总计=${stats.total}, 待处理=${stats.pending}, 运行中=${stats.running}, 已完成=${stats.completed}, 失败=${stats.failed}, 跳过=${stats.skipped}`,
      );

      return totalAdded;
    } catch (error) {
      this.log(
        `拉取飞书任务失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * 获取当前调度目标达人
   */
  private getTargetDarens(darenList: DarenInfo[]): DarenInfo[] {
    const enabledDarens = darenList.filter((d) => d.enableJuliang);

    if (!this.scopedDarenId) {
      return enabledDarens;
    }

    return enabledDarens.filter((d) => d.id === this.scopedDarenId);
  }

  /**
   * 解析飞书字段值（飞书可能返回数组或对象格式）
   */
  private parseFieldValue(value: unknown): string | null {
    if (!value) return null;

    // 如果是数组，取第一个元素
    if (Array.isArray(value)) {
      value = value[0];
    }

    // 如果是对象，尝试获取 text 属性
    if (typeof value === "object" && value !== null) {
      const obj = value as Record<string, unknown>;
      if (obj.text) return String(obj.text);
      if (obj.value) return String(obj.value);
      return null;
    }

    // 如果是字符串或数字，直接转换
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }

    return null;
  }

  /**
   * 解析飞书记录
   */
  private parseFeishuRecord(
    record: { record_id: string; fields: Record<string, unknown> },
    daren: DarenInfo,
  ): InternalTask | null {
    try {
      const fields = record.fields;

      // 解析剧名
      const drama = this.parseFieldValue(fields["剧名"]);
      this.log(
        `parseFeishuRecord: 剧名解析结果="${drama}", 原始值类型=${typeof fields["剧名"]}, isArray=${Array.isArray(fields["剧名"])}`,
      );

      // 解析日期
      let date = fields["日期"];
      // 如果是数组，取第一个元素
      if (Array.isArray(date)) {
        date = date[0];
      }
      // 如果是时间戳，转换为日期字符串
      if (typeof date === "number") {
        const dateObj = new Date(date);
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, "0");
        const day = String(dateObj.getDate()).padStart(2, "0");
        date = `${year}-${month}-${day}`;
      } else if (typeof date === "object" && date !== null) {
        // 可能是对象格式
        const obj = date as Record<string, unknown>;
        if (obj.text) date = String(obj.text);
        else if (obj.value) date = String(obj.value);
      }

      // 解析账户（巨量账户 ID）
      const accountId = this.parseFieldValue(fields["账户"]);

      const account = daren.id; // 使用达人 ID 作为账户标识

      if (!drama || !date) {
        this.log(`记录 ${record.record_id} 缺少剧名或日期，跳过`);
        return null;
      }

      if (!accountId) {
        this.log(`记录 ${record.record_id} (${drama}) 缺少账户字段，跳过`);
        return null;
      }

      return {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        recordId: record.record_id,
        drama: String(drama),
        date: String(date),
        account,
        accountId: String(accountId), // 使用飞书表格中的账户字段
        tableId: daren.feishuDramaStatusTableId || "",
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      this.log(
        `解析记录 ${record.record_id} 失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * 添加任务到队列
   */
  private addTask(task: InternalTask): boolean {
    const existingTask = this.taskMap.get(task.recordId);

    // 防止重复入队；如果本地是失败任务且飞书仍然是待上传，则恢复为待处理
    if (existingTask) {
      if (existingTask.status === "failed") {
        existingTask.drama = task.drama;
        existingTask.date = task.date;
        existingTask.account = task.account;
        existingTask.accountId = task.accountId;
        existingTask.tableId = task.tableId;
        existingTask.status = "pending";
        existingTask.error = undefined;
        existingTask.updatedAt = new Date();
        this.log(`失败任务重新入队: ${task.drama} (${task.date})`);
        return true;
      }

      this.log(
        `任务已存在，跳过重复入队: ${task.drama} (${task.date}), 当前状态=${existingTask.status}`,
      );
      return false;
    }

    this.queue.push(task);
    this.queue = this.getPrioritizedTasks(this.queue);
    this.taskMap.set(task.recordId, task);
    this.log(`任务已入队: ${task.drama} (${task.date})`);

    return true;
  }

  /**
   * 清理已完成的任务
   */
  private cleanup() {
    const before = this.queue.length;

    this.queue = this.queue.filter((task) => {
      if (task.status === "completed" || task.status === "skipped") {
        this.taskMap.delete(task.recordId);
        return false;
      }
      return true;
    });

    const removed = before - this.queue.length;
    if (removed > 0) {
      this.log(`清理了 ${removed} 个已完成的任务`);
    }
  }

  /**
   * 启动定时拉取
   */
  private startScheduledFetching() {
    if (this.fetchTimer) {
      return;
    }

    const intervalMs = this.config.fetchIntervalMinutes * 60 * 1000;
    this.log(`定时拉取已启动，间隔: ${this.config.fetchIntervalMinutes} 分钟`);
    this.scheduleNextFetch();

    this.fetchTimer = setInterval(async () => {
      if (this.isTaskProcessing) {
        this.log("任务处理中，跳过本次轮询");
        return;
      }

      const count = await this.fetchAndEnqueueTasks();

      // 如果查询到新任务，停止定时轮询
      if (count > 0) {
        this.log("查询到新任务，停止定时轮询，转为事件驱动模式");
        this.stopScheduledFetching();
        this.clearNextFetch();
        return;
      }

      this.scheduleNextFetch();
    }, intervalMs);
  }

  /**
   * 停止定时拉取
   */
  private stopScheduledFetching() {
    if (this.fetchTimer) {
      clearInterval(this.fetchTimer);
      this.fetchTimer = null;
      this.log("定时拉取已停止");
    }
    this.clearNextFetch();
  }

  /**
   * 任务完成时调用
   * @param taskSkipped 任务是否被跳过（本地目录不存在等原因）
   * @param taskCancelled 任务是否被取消
   */
  private async onTaskComplete(taskSkipped = false, taskCancelled = false) {
    this.isTaskProcessing = false;

    // 如果任务被取消，不要查询新任务（cancelAll 已经处理了后续逻辑）
    if (taskCancelled || this.isCancelled) {
      this.log("任务已取消，不再查询新任务");
      return;
    }

    // 如果任务是被跳过的（比如本地目录不存在），不要立即再查询
    // 因为再查询还是会拿到同一条记录，会形成无限循环
    if (taskSkipped) {
      this.log("任务被跳过，启动定时轮询等待下次检查");
      this.startScheduledFetching();
      return;
    }

    this.log("任务完成，立即查询飞书获取新任务");

    const count = await this.fetchAndEnqueueTasks();

    // 如果查询不到新任务，启动定时轮询
    if (count === 0) {
      this.log("未查询到新任务，启动定时轮询模式");
      this.startScheduledFetching();
    }
  }

  /**
   * 处理队列
   */
  private async processQueue() {
    while (this.status === "running") {
      const task = this.getNextTask();

      if (!task) {
        // 没有待处理任务，等待一段时间
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }

      // 检查是否已取消
      if (this.isCancelled) {
        this.log("调度已取消，停止处理队列");
        break;
      }

      this.isTaskProcessing = true;
      this.currentTask = task; // 记录当前任务
      let taskSkipped = false;

      try {
        taskSkipped = await this.processTask(task);
      } finally {
        this.currentTask = null;
        // 在 finally 中检查取消状态，确保即使异常也能正确处理
        const taskCancelled = this.isCancelled;
        if (taskCancelled) {
          // 取消后重置标志，但不继续查询
          this.isCancelled = false;
        }
        await this.onTaskComplete(taskSkipped, taskCancelled);
      }

      // 任务间延迟
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  /**
   * 获取下一个待处理任务
   */
  private getNextTask(): InternalTask | null {
    for (const task of this.getPrioritizedTasks(this.queue)) {
      if (task.status === "pending") {
        return task;
      }
    }
    return null;
  }

  private getPrioritizedTasks(tasks: InternalTask[]): InternalTask[] {
    return [...tasks].sort((a, b) => this.compareTaskPriority(a, b));
  }

  private compareTaskPriority(a: InternalTask, b: InternalTask): number {
    if (a.status === "running" && b.status !== "running") {
      return -1;
    }
    if (b.status === "running" && a.status !== "running") {
      return 1;
    }

    const aDate = this.parseTaskDateToTimestamp(a.date);
    const bDate = this.parseTaskDateToTimestamp(b.date);
    if (aDate !== null && bDate !== null && aDate !== bDate) {
      return aDate - bDate;
    }
    if (aDate !== null && bDate === null) {
      return -1;
    }
    if (aDate === null && bDate !== null) {
      return 1;
    }

    const updatedDiff = a.updatedAt.getTime() - b.updatedAt.getTime();
    if (updatedDiff !== 0) {
      return updatedDiff;
    }

    const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (createdDiff !== 0) {
      return createdDiff;
    }

    return a.drama.localeCompare(b.drama, "zh-Hans-CN");
  }

  private parseTaskDateToTimestamp(dateText: string): number | null {
    const normalized = dateText.trim();
    if (!normalized) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      const parsed = Date.parse(`${normalized}T00:00:00`);
      return Number.isNaN(parsed) ? null : parsed;
    }

    const monthDayMatch = normalized.match(/^(\d{1,2})[.-](\d{1,2})$/);
    if (monthDayMatch) {
      const [, monthText, dayText] = monthDayMatch;
      const now = new Date();
      const year = now.getFullYear();
      const parsed = new Date(
        year,
        Number(monthText) - 1,
        Number(dayText),
      ).getTime();
      return Number.isNaN(parsed) ? null : parsed;
    }

    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : parsed;
  }

  /**
   * 处理单个任务
   * @returns 是否被跳过（true = 跳过，false = 正常完成或失败）
   */
  private async processTask(task: InternalTask): Promise<boolean> {
    // 检查是否已取消
    if (this.isCancelled) {
      this.log(`任务被取消: ${task.drama}`);
      return false;
    }

    const taskStartTime = Date.now();

    try {
      // 标记为运行中
      task.status = "running";
      task.updatedAt = new Date();
      this.log(`开始处理任务: ${task.drama} (${task.date})`);

      // 1. 确保浏览器可用（可能在上一个任务中被关闭或崩溃）
      if (!juliangService.isReady()) {
        this.log("浏览器不可用，正在重新初始化...");
        const initResult = await juliangService.initialize();
        if (!initResult.success) {
          task.status = "failed";
          task.error = `浏览器初始化失败: ${initResult.error}`;
          this.log(`任务失败: ${task.drama} - ${task.error}`);
          this.addCompletedTask(task, "failed", taskStartTime);
          return false;
        }
        // 重新检查登录状态
        const loginStatus = await juliangService.checkLoginStatus();
        if (loginStatus.needLogin) {
          task.status = "failed";
          task.error = "巨量创意后台未登录";
          this.log(`任务失败: ${task.drama} - ${task.error}`);
          this.addCompletedTask(task, "failed", taskStartTime);
          return false;
        }
      }

      // 2. 扫描本地目录
      const dateDir = this.formatDateDir(task.date);
      const basePath = `${this.config.localRootDir}/${dateDir}`;
      const dramaPath = `${basePath}/${task.drama}`;

      this.log(`扫描本地目录: ${dramaPath}`);

      const materials = await this.fileService.scanVideos(basePath);
      const dramaFiles = materials
        .filter((m) => m.dramaName === task.drama)
        .map((m) => m.filePath);

      if (dramaFiles.length === 0) {
        task.status = "skipped";
        task.error = "本地目录不存在或没有视频文件";
        this.log(`任务跳过: ${task.drama} - ${task.error}`);

        // 更新飞书状态为"跳过上传"，备注写明跳过原因
        await this.updateTaskFeishuStatus(task, "跳过上传", 1, task.error);

        this.addCompletedTask(task, "skipped", taskStartTime, task.error);
        return true; // 返回 true 表示被跳过
      }

      task.localPath = dramaPath;
      task.mp4Files = dramaFiles;
      this.log(`找到 ${dramaFiles.length} 个视频文件`);

      // 3. 更新飞书状态为"上传中"
      const updateToUploading = await this.apiService.updateFeishuRecordStatus(
        task.recordId,
        "上传中",
        this.configService,
        task.tableId,
      );

      if (!updateToUploading) {
        this.log(`更新飞书状态为"上传中"失败，但继续上传`);
      }

      // 检查是否已取消
      if (this.isCancelled) {
        this.log(`任务被取消: ${task.drama}`);
        return false;
      }

      // 4. 执行上传
      const uploadTask: JuliangTask = {
        id: task.id,
        drama: task.drama,
        date: task.date,
        account: task.account,
        accountId: task.accountId,
        files: dramaFiles,
        recordId: task.recordId,
        status: "pending",
      };

      const uploadResult = await juliangService.uploadTask(uploadTask);

      // 检查是否已取消（上传过程中可能被取消）
      if (this.isCancelled) {
        this.log(`任务被取消: ${task.drama}`);
        return false;
      }

      if (!uploadResult.success) {
        if (uploadResult.skipped) {
          task.status = "skipped";
          task.error = uploadResult.error || "命中不可重试错误，已跳过";
          task.updatedAt = new Date();
          this.log(`任务跳过: ${task.drama} - ${task.error}`);

          // 更新飞书状态为"跳过上传"，备注写明跳过原因
          await this.updateTaskFeishuStatus(task, "跳过上传", 1, task.error);

          this.addCompletedTask(task, "skipped", taskStartTime, task.error);
          return true;
        }

        const hasUploadedFiles = uploadResult.successCount > 0;

        task.status = hasUploadedFiles ? "completed" : "failed";
        task.error = hasUploadedFiles
          ? `成功 ${uploadResult.successCount}/${uploadResult.totalFiles}，已改为待搭建`
          : `上传失败: ${uploadResult.error || "未知错误"}`;
        task.updatedAt = new Date();

        if (hasUploadedFiles) {
          this.log(`任务部分完成: ${task.drama} - ${task.error}`);

          const promoteSuccess = await this.updateTaskFeishuStatus(
            task,
            "待搭建",
            3,
            uploadResult.remark,
          );
          if (!promoteSuccess) {
            this.log(`飞书状态更新最终失败，但任务已部分上传: ${task.drama}`);
          }

          await this.deleteLocalMaterialDirectory(task);

          this.addCompletedTask(
            task,
            "completed",
            taskStartTime,
            uploadResult.remark,
          );
          return false;
        }

        this.log(`任务最终失败: ${task.drama} - ${task.error}`);

        const revertSuccess = await this.updateTaskFeishuStatus(
          task,
          "上传失败",
          1,
        );

        if (!revertSuccess) {
          this.log(`更新飞书状态为"上传失败"失败: ${task.drama}`);
        }

        // 不删除本地素材目录
        this.addCompletedTask(task, "failed", taskStartTime);
        return false;
      }

      this.log(
        `上传完成: ${uploadResult.successCount}/${uploadResult.totalFiles} 个文件成功`,
      );

      // 5. 更新飞书状态为"待搭建"
      const statusUpdated = await this.updateTaskFeishuStatus(
        task,
        "待搭建",
        3,
      );
      if (!statusUpdated) {
        this.log(
          `飞书状态更新最终失败（共尝试3次），但上传已成功: ${task.drama}`,
        );
      }

      // 6. 删除本地素材目录（无论飞书更新是否成功）
      await this.deleteLocalMaterialDirectory(task);

      task.status = "completed";
      task.updatedAt = new Date();
      this.log(`任务完成: ${task.drama}`);
      this.addCompletedTask(task, "completed", taskStartTime);
      return false; // 正常完成
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(`任务异常: ${task.drama} - ${errorMsg}`);

      task.status = "failed";
      task.error = `异常: ${errorMsg}`;
      task.updatedAt = new Date();

      // 异常情况，将飞书状态改为"上传失败"
      await this.updateTaskFeishuStatus(task, "上传失败", 1);
      this.addCompletedTask(task, "failed", taskStartTime);
      return false; // 失败但不是跳过
    }
  }

  /**
   * 格式化日期目录（M.D导出 格式）
   */
  private formatDateDir(dateStr: string): string {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}.${day}导出`;
  }
}

// 单例导出
let schedulerInstance: JuliangSchedulerService | null = null;

export function getJuliangScheduler(
  apiService: ApiService,
  fileService: FileService,
  configService: ConfigService,
): JuliangSchedulerService {
  if (!schedulerInstance) {
    schedulerInstance = new JuliangSchedulerService(
      apiService,
      fileService,
      configService,
    );
  }
  return schedulerInstance;
}
