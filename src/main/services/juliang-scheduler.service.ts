/**
 * 巨量上传调度器服务
 * 负责从飞书拉取待上传任务、执行上传、更新状态、删除本地目录
 */

import { app, BrowserWindow } from "electron";
import { join } from "path";
import * as fs from "fs";
import { juliangService, JuliangTask, JuliangUploadResult } from "./juliang.service";
import { ApiService } from "./api.service";
import { FileService } from "./file.service";
import { ConfigService, DarenInfo } from "./config.service";

// 调度器状态
export type SchedulerStatus = "idle" | "running" | "stopped";

// 任务状态
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

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
  private fetchTimer: NodeJS.Timeout | null = null;
  private isTaskProcessing = false;
  private mainWindow: BrowserWindow | null = null;
  private logs: Array<{ time: string; message: string }> = [];
  private maxLogs = 500;

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
    configService: ConfigService
  ) {
    this.apiService = apiService;
    this.fileService = fileService;
    this.configService = configService;
    this.configFilePath = join(app.getPath("userData"), "juliang-scheduler-config.json");
    this.loadConfig();
  }

  /**
   * 从文件加载配置
   */
  private loadConfig() {
    try {
      if (fs.existsSync(this.configFilePath)) {
        const data = fs.readFileSync(this.configFilePath, "utf-8");
        const savedConfig = JSON.parse(data);
        this.config = { ...this.config, ...savedConfig };
        console.log(`[JuliangScheduler] 已加载配置: localRootDir=${this.config.localRootDir}`);
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
      fs.writeFileSync(this.configFilePath, JSON.stringify(this.config, null, 2), "utf-8");
      console.log(`[JuliangScheduler] 配置已保存: localRootDir=${this.config.localRootDir}`);
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
    this.config = { ...this.config, ...config };
    this.saveConfig();
  }

  /**
   * 获取配置
   */
  getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  /**
   * 获取调度器状态
   */
  getStatus(): SchedulerStatus {
    return this.status;
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

  /**
   * 启动调度器
   */
  async start(): Promise<{ success: boolean; error?: string }> {
    if (this.status === "running") {
      return { success: false, error: "调度器已在运行中" };
    }

    // 重新加载配置，确保使用最新值
    this.loadConfig();
    this.log(`使用配置: localRootDir=${this.config.localRootDir}`);

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

    // 关闭浏览器
    await juliangService.close();

    this.log("调度器已停止");
  }

  /**
   * 从飞书拉取任务并入队
   */
  private async fetchAndEnqueueTasks(): Promise<number> {
    try {
      this.log("开始从飞书拉取待上传任务");

      // 清理已完成和已跳过的任务
      this.cleanup();

      // 获取达人配置
      const darenConfig = await this.configService.getDarenConfig();
      const enabledDarens = darenConfig.darenList.filter((d) => d.enableJuliang);

      if (enabledDarens.length === 0) {
        this.log("没有启用巨量上传的达人");
        return 0;
      }

      let totalAdded = 0;

      for (const daren of enabledDarens) {
        this.log(`处理达人: ${daren.label} (${daren.id})`);

        if (!daren.feishuDramaStatusTableId) {
          this.log(`达人 ${daren.label} 未配置飞书表格 ID，跳过`);
          continue;
        }

        this.log(`达人 ${daren.label} 飞书表格 ID: ${daren.feishuDramaStatusTableId}`);

        try {
          // 巨量上传不过滤每日主体，所有待上传的剧都要处理
          const result = await this.apiService.getPendingUploadDramas(
            this.configService,
            daren.feishuDramaStatusTableId,
            { filterMeiri: false }
          );

          this.log(`达人 ${daren.label} 查询结果: code=${result.code}, items=${result.data?.items?.length || 0}`);

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
            this.log(`解析记录: ${item.record_id}, 剧名=${item.fields['剧名']}, 日期=${item.fields['日期']}`);
            const task = this.parseFeishuRecord(item, daren);
            if (task) {
              tasks.push(task);
            }
          }

          // 按日期升序排序（最早的日期优先上传）
          tasks.sort((a, b) => a.date.localeCompare(b.date));
          this.log(`达人 ${daren.label} 共 ${tasks.length} 个任务（已按日期升序排序）`);

          // 添加到队列
          for (const task of tasks) {
            if (this.addTask(task)) {
              totalAdded++;
            }
          }
        } catch (error) {
          this.log(`达人 ${daren.label} 查询异常: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (totalAdded > 0) {
        this.log(`成功入队 ${totalAdded} 个新任务`);
      } else {
        this.log("没有待上传的任务");
      }

      const stats = this.getQueueStats();
      this.log(`队列状态: 总计=${stats.total}, 待处理=${stats.pending}, 运行中=${stats.running}, 已完成=${stats.completed}`);

      return totalAdded;
    } catch (error) {
      this.log(`拉取飞书任务失败: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
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
    daren: DarenInfo
  ): InternalTask | null {
    try {
      const fields = record.fields;

      // 解析剧名
      const drama = this.parseFieldValue(fields["剧名"]);

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

      const account = daren.id; // 使用达人 ID 作为账户

      if (!drama || !date) {
        this.log(`记录 ${record.record_id} 缺少剧名或日期，跳过`);
        return null;
      }

      return {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        recordId: record.record_id,
        drama: String(drama),
        date: String(date),
        account,
        accountId: account, // TODO: 从配置中获取巨量账户 ID
        tableId: daren.feishuDramaStatusTableId || "",
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      this.log(`解析记录 ${record.record_id} 失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * 添加任务到队列
   */
  private addTask(task: InternalTask): boolean {
    // 防止重复入队
    if (this.taskMap.has(task.recordId)) {
      return false;
    }

    this.queue.push(task);
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
      }
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
  }

  /**
   * 任务完成时调用
   * @param taskSkipped 任务是否被跳过（本地目录不存在等原因）
   */
  private async onTaskComplete(taskSkipped = false) {
    this.isTaskProcessing = false;

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

      this.isTaskProcessing = true;
      let taskSkipped = false;

      try {
        taskSkipped = await this.processTask(task);
      } finally {
        await this.onTaskComplete(taskSkipped);
      }

      // 任务间延迟
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  /**
   * 获取下一个待处理任务
   */
  private getNextTask(): InternalTask | null {
    for (const task of this.queue) {
      if (task.status === "pending") {
        return task;
      }
    }
    return null;
  }

  /**
   * 处理单个任务
   * @returns 是否被跳过（true = 跳过，false = 正常完成或失败）
   */
  private async processTask(task: InternalTask): Promise<boolean> {
    try {
      // 标记为运行中
      task.status = "running";
      task.updatedAt = new Date();
      this.log(`开始处理任务: ${task.drama} (${task.date})`);

      // 1. 扫描本地目录
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

        // 更新飞书状态为"跳过上传"
        const updateSuccess = await this.apiService.updateFeishuRecordStatus(
          task.recordId,
          "跳过上传",
          this.configService,
          task.tableId
        );
        if (updateSuccess) {
          this.log(`飞书状态已更新为"跳过上传": ${task.drama}`);
        } else {
          this.log(`更新飞书状态失败: ${task.drama}`);
        }

        return true; // 返回 true 表示被跳过
      }

      task.localPath = dramaPath;
      task.mp4Files = dramaFiles;
      this.log(`找到 ${dramaFiles.length} 个视频文件`);

      // 2. 更新飞书状态为"上传中"
      const updateToUploading = await this.apiService.updateFeishuRecordStatus(
        task.recordId,
        "上传中",
        this.configService,
        task.tableId
      );

      if (!updateToUploading) {
        this.log(`更新飞书状态为"上传中"失败，但继续上传`);
      }

      // 3. 执行上传
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

      if (!uploadResult.success) {
        task.status = "failed";
        task.error = uploadResult.error || "上传失败";
        this.log(`任务失败: ${task.drama} - ${task.error}`);

        // 上传失败，将飞书状态改回"待上传"
        const revertSuccess = await this.apiService.updateFeishuRecordStatus(
          task.recordId,
          "待上传",
          this.configService,
          task.tableId
        );

        if (revertSuccess) {
          this.log(`已将飞书状态恢复为"待上传"，保留本地素材目录，等待下次重试`);
        } else {
          this.log(`恢复飞书状态为"待上传"失败`);
        }

        // 不删除本地素材目录，等待下次重试
        return false;
      }

      this.log(`上传完成: ${uploadResult.successCount}/${uploadResult.totalFiles} 个文件成功`);

      // 4. 更新飞书状态为"待搭建"
      const updateSuccess = await this.apiService.updateFeishuRecordStatus(
        task.recordId,
        "待搭建",
        this.configService,
        task.tableId
      );

      if (updateSuccess) {
        this.log(`飞书状态更新成功: ${task.drama} -> 待搭建`);
      } else {
        this.log(`飞书状态更新失败，但上传已成功`);
      }

      // 5. 删除本地素材目录（无论飞书更新是否成功）
      if (task.localPath) {
        const deleteSuccess = await this.fileService.deleteFolder(task.localPath);
        if (deleteSuccess.success) {
          this.log(`本地目录已删除: ${task.localPath}`);
        } else {
          this.log(`删除本地目录失败: ${task.localPath}`);
        }
      }

      task.status = "completed";
      task.updatedAt = new Date();
      this.log(`任务完成: ${task.drama}`);
      return false; // 正常完成
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      task.status = "failed";
      task.error = errorMsg;
      task.updatedAt = new Date();
      this.log(`任务异常: ${task.drama} - ${errorMsg}`);

      // 异常情况，将飞书状态改回"待上传"
      await this.apiService.updateFeishuRecordStatus(
        task.recordId,
        "待上传",
        this.configService,
        task.tableId
      );
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
  configService: ConfigService
): JuliangSchedulerService {
  if (!schedulerInstance) {
    schedulerInstance = new JuliangSchedulerService(apiService, fileService, configService);
  }
  return schedulerInstance;
}
