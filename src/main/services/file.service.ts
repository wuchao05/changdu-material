import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import extract from "extract-zip";

const execFileAsync = promisify(execFile);

export interface VideoMaterial {
  fileName: string;
  filePath: string;
  size: number;
  dramaName: string;
  status: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
}

export interface RenameVideosResult {
  success: boolean;
  dramaCount: number;
  renamedCount: number;
  skippedCount: number;
  error?: string;
}

export interface ExtractQueueStatus {
  taskId?: string;
  dramaName?: string;
  status: "queued" | "extracting" | "completed" | "failed";
  queueLength: number;
  activeCount: number;
  error?: string;
}

export class FileService {
  // 解压队列控制
  private extractQueue: Array<{
    zipPath: string;
    targetDir?: string;
    deleteAfterExtract: boolean;
    taskId?: string;
    dramaName?: string;
    resolve: (value: {
      success: boolean;
      error?: string;
      extractedPath: string;
    }) => void;
    reject: (reason?: any) => void;
  }> = [];
  private activeExtractCount = 0;
  private readonly maxConcurrentExtracts = 2;
  private extractStatusNotifier?: (status: ExtractQueueStatus) => void;

  setExtractStatusNotifier(
    notifier?: (status: ExtractQueueStatus) => void,
  ): void {
    this.extractStatusNotifier = notifier;
  }

  private notifyExtractStatus(
    task: { taskId?: string; dramaName?: string },
    status: ExtractQueueStatus["status"],
    error?: string,
  ): void {
    if (!this.extractStatusNotifier) {
      return;
    }

    this.extractStatusNotifier({
      taskId: task.taskId,
      dramaName: task.dramaName,
      status,
      queueLength: this.extractQueue.length,
      activeCount: this.activeExtractCount,
      error,
    });
  }

  /**
   * 列出指定目录下所有以"导出"结尾的子目录名
   */
  listExportDirs(rootPath: string): string[] {
    try {
      if (!fs.existsSync(rootPath)) return [];
      return fs
        .readdirSync(rootPath, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.endsWith("导出"))
        .map((d) => d.name);
    } catch (error) {
      console.error("[FileService] 列出导出目录失败:", error);
      return [];
    }
  }

  async scanVideos(basePath: string): Promise<VideoMaterial[]> {
    const materials: VideoMaterial[] = [];

    try {
      console.log(`[FileService] 扫描视频，基础路径: ${basePath}`);

      // 检查基础路径是否存在
      if (!fs.existsSync(basePath)) {
        console.log(`[FileService] 基础路径不存在: ${basePath}`);
        return materials;
      }

      // 读取基础路径下的所有文件夹（每个文件夹对应一个剧）
      const dramaFolders = fs
        .readdirSync(basePath, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory());

      for (const folder of dramaFolders) {
        const dramaName = folder.name;
        const dramaPath = path.join(basePath, dramaName);

        // 读取剧目录下的所有视频文件
        const files = fs
          .readdirSync(dramaPath, { withFileTypes: true })
          .filter((dirent) => dirent.isFile() && this.isVideoFile(dirent.name));

        for (const file of files) {
          const filePath = path.join(dramaPath, file.name);
          const stats = fs.statSync(filePath);

          materials.push({
            fileName: file.name,
            filePath: filePath,
            size: stats.size,
            dramaName: dramaName,
            status: "待上传",
          });
        }
      }

      console.log(
        `[FileService] 扫描完成，找到 ${materials.length} 个视频文件`,
      );
      return materials;
    } catch (error) {
      console.error("[FileService] 扫描视频失败:", error);
      return materials;
    }
  }

  async renameVideosByTemplate(
    basePath: string,
    template: string,
    dateValue?: string,
  ): Promise<RenameVideosResult> {
    try {
      const normalizedTemplate = template.trim();
      const resolvedDateValue = this.resolveMaterialDateValue(dateValue);
      if (!normalizedTemplate) {
        throw new Error("素材名称模板不能为空");
      }
      if (
        !normalizedTemplate.includes("{剧名}") ||
        !normalizedTemplate.includes("{序号}")
      ) {
        throw new Error("素材名称模板必须包含 {剧名} 和 {序号}");
      }
      if (!fs.existsSync(basePath)) {
        throw new Error("素材目录不存在");
      }

      const mp4Files = this.collectRootLevelMp4Files(basePath);
      if (mp4Files.length === 0) {
        return {
          success: true,
          dramaCount: 0,
          renamedCount: 0,
          skippedCount: 0,
        };
      }

      let dramaCount = 0;
      let renamedCount = 0;
      let skippedCount = 0;

      const groupedFiles = new Map<string, string[]>();
      for (const filePath of mp4Files) {
        const dramaName = this.resolveDramaNameForRename(basePath, filePath);
        const dramaFiles = groupedFiles.get(dramaName) || [];
        dramaFiles.push(filePath);
        groupedFiles.set(dramaName, dramaFiles);
      }

      const allPlans: Array<{
        fileName: string;
        oldPath: string;
        targetName: string;
        targetPath: string;
      }> = [];

      for (const [dramaName, dramaFiles] of groupedFiles.entries()) {
        const normalizedDramaName = dramaName.trim();
        if (!normalizedDramaName) {
          throw new Error("存在无法识别剧名的素材文件");
        }

        const targetDramaPath = path.join(basePath, normalizedDramaName);
        const sortedFiles = [...dramaFiles].sort((left, right) =>
          this.compareFileNames(path.basename(left), path.basename(right)),
        );

        if (sortedFiles.length === 0) {
          continue;
        }

        dramaCount += 1;

        const plans = sortedFiles.map((oldPath, index) => {
          const fileName = path.basename(oldPath);
          const sequence = String(index + 1).padStart(2, "0");
          const extension = path.extname(fileName) || ".mp4";
          let targetName = this.normalizeTemplateFileName(
            normalizedTemplate
              .replaceAll("{剧名}", normalizedDramaName)
              .replaceAll("{日期}", resolvedDateValue)
              .replaceAll("{简称}", "")
              .replaceAll("{序号}", sequence),
          );

          if (!path.extname(targetName)) {
            targetName += extension;
          }

          return {
            fileName,
            oldPath,
            targetName,
            targetPath: path.join(targetDramaPath, targetName),
          };
        });

        const targetNameSet = new Set<string>();
        for (const plan of plans) {
          const lowerTargetName = plan.targetName.toLowerCase();
          if (targetNameSet.has(lowerTargetName)) {
            throw new Error(
              `《${normalizedDramaName}》重命名后文件名重复：${plan.targetName}`,
            );
          }
          targetNameSet.add(lowerTargetName);
        }

        allPlans.push(...plans);
      }

      const originalPathSet = new Set(allPlans.map((plan) => plan.oldPath));
      for (const plan of allPlans) {
        if (
          plan.oldPath !== plan.targetPath &&
          fs.existsSync(plan.targetPath) &&
          !originalPathSet.has(plan.targetPath)
        ) {
          const dramaName = path.basename(path.dirname(plan.targetPath));
          throw new Error(`《${dramaName}》目标文件已存在：${plan.targetName}`);
        }
      }

      const changedPlans = allPlans.filter(
        (plan) => plan.oldPath !== plan.targetPath,
      );
      skippedCount = allPlans.length - changedPlans.length;

      for (let index = 0; index < changedPlans.length; index += 1) {
        const plan = changedPlans[index];
        const tempPath = path.join(
          path.dirname(plan.oldPath),
          `.__rename_tmp__${Date.now()}_${index}_${Math.random()
            .toString(36)
            .slice(2, 8)}${path.extname(plan.fileName)}`,
        );
        await fs.promises.rename(plan.oldPath, tempPath);
        plan.oldPath = tempPath;
      }

      for (const plan of changedPlans) {
        await fs.promises.mkdir(path.dirname(plan.targetPath), {
          recursive: true,
        });
        await fs.promises.rename(plan.oldPath, plan.targetPath);
        renamedCount += 1;
      }

      return {
        success: true,
        dramaCount,
        renamedCount,
        skippedCount,
      };
    } catch (error) {
      return {
        success: false,
        dramaCount: 0,
        renamedCount: 0,
        skippedCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private isVideoFile(fileName: string): boolean {
    const videoExtensions = [
      ".mp4",
      ".avi",
      ".mov",
      ".mkv",
      ".wmv",
      ".flv",
      ".webm",
      ".m4v",
    ];
    const ext = path.extname(fileName).toLowerCase();
    return videoExtensions.includes(ext);
  }

  private collectRootLevelMp4Files(basePath: string): string[] {
    return fs
      .readdirSync(basePath, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          path.extname(entry.name).toLowerCase() === ".mp4" &&
          !entry.name.startsWith(".__rename_tmp__"),
      )
      .map((entry) => path.join(basePath, entry.name));
  }

  private resolveDramaNameForRename(
    _basePath: string,
    filePath: string,
  ): string {
    return this.extractDramaNameFromFileName(path.basename(filePath));
  }

  private extractDramaNameFromFileName(fileName: string): string {
    const baseName = path.basename(fileName, path.extname(fileName)).trim();
    const delimiters = ["（", "(", "-", "."];

    for (const delimiter of delimiters) {
      const delimiterIndex = baseName.indexOf(delimiter);
      if (delimiterIndex > 0) {
        return baseName.slice(0, delimiterIndex).trim();
      }
    }

    return baseName;
  }

  private compareFileNames(a: string, b: string): number {
    return a.localeCompare(b, "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    });
  }

  private resolveMaterialDateValue(dateValue?: string): string {
    const normalizedDateValue = String(dateValue || "").trim();
    if (normalizedDateValue) {
      return normalizedDateValue;
    }

    const formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
    });
    const parts = formatter.formatToParts(new Date());
    const month =
      parts.find((part) => part.type === "month")?.value ||
      String(new Date().getMonth() + 1);
    const day =
      parts.find((part) => part.type === "day")?.value ||
      String(new Date().getDate());
    return `${month}.${day}`;
  }

  private normalizeTemplateFileName(fileName: string): string {
    return fileName
      .replace(/-{2,}/g, "-")
      .replace(/-+\./g, ".")
      .replace(/^-+/g, "")
      .trim();
  }

  async getVideoInfo(filePath: string, maxRetry = 3): Promise<VideoInfo> {
    let isEmptyJsonError = false;

    for (let attempt = 1; attempt <= maxRetry; attempt++) {
      try {
        // 使用 ffprobe 获取视频信息，设置 UTF-8 编码环境
        const { stdout } = await execFileAsync(
          "ffprobe",
          [
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            filePath,
          ],
          {
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            env: {
              ...process.env,
              // Windows 上设置 UTF-8 代码页
              LANG: "en_US.UTF-8",
            },
          },
        );

        // 检查输出是否为空
        if (!stdout || stdout.trim() === "" || stdout.trim() === "{}") {
          isEmptyJsonError = true;
          throw new Error("ffprobe 返回空数据");
        }

        const videoData = JSON.parse(stdout);

        // 检查是否有有效的流数据
        if (!videoData.streams || videoData.streams.length === 0) {
          throw new Error("ffprobe 无法解析视频流");
        }

        const videoStream = videoData.streams.find(
          (stream: { codec_type: string }) => stream.codec_type === "video",
        );
        const format = videoData.format;

        if (videoStream) {
          return {
            width: parseInt(videoStream.width) || 0,
            height: parseInt(videoStream.height) || 0,
            duration: parseFloat(format.duration) || 0,
          };
        }

        return { width: 1280, height: 720, duration: 0 };
      } catch (error) {
        // 如果是空 JSON 错误，只在第一次打印简短日志
        if (isEmptyJsonError && attempt === 1) {
          console.warn(
            `[FileService] ⚠️ 文件可能被占用或路径有问题，将使用默认值: ${filePath}`,
          );
          // 空 JSON 错误不重试，直接返回默认值
          return { width: 1280, height: 720, duration: 0 };
        }

        // 其他错误只在第一次和最后一次打印详细日志
        if (attempt === 1 || attempt === maxRetry) {
          console.error(
            `[FileService] 获取视频信息失败 (尝试 ${attempt}/${maxRetry}):`,
            error,
          );
          console.error(`[FileService] 文件路径: ${filePath}`);
        }

        if (attempt === maxRetry) {
          // 检查文件是否存在
          if (!fs.existsSync(filePath)) {
            console.error(`[FileService] 文件不存在: ${filePath}`);
          } else {
            const stats = fs.statSync(filePath);
            console.error(
              `[FileService] 文件信息: 大小=${stats.size} bytes, 修改时间=${stats.mtime}`,
            );
          }

          // 如果所有尝试都失败，返回默认值
          return { width: 1280, height: 720, duration: 0 };
        }

        // 等待后重试，每次等待时间递增
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }

    return { width: 1280, height: 720, duration: 0 };
  }

  async calculateFileMd5(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = fs.createReadStream(filePath);

      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  async readFileAsBuffer(filePath: string): Promise<Buffer> {
    return fs.promises.readFile(filePath);
  }

  getFileSize(filePath: string): number {
    const stats = fs.statSync(filePath);
    return stats.size;
  }

  fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  async createDirectory(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  /**
   * 解压 zip 文件（跨平台，使用 extract-zip 库，带队列控制）
   * @param zipPath zip 文件路径
   * @param targetDir 解压目标目录（如果不指定，则解压到 zip 文件所在目录）
   * @param deleteAfterExtract 解压后是否删除原 zip 文件
   */
  async extractZip(
    zipPath: string,
    targetDir?: string,
    deleteAfterExtract = true,
    taskId?: string,
    dramaName?: string,
  ): Promise<{ success: boolean; error?: string; extractedPath: string }> {
    // 添加到队列
    return new Promise((resolve, reject) => {
      this.extractQueue.push({
        zipPath,
        targetDir,
        deleteAfterExtract,
        taskId,
        dramaName,
        resolve,
        reject,
      });

      console.log(
        `[FileService] 解压任务已加入队列，当前队列长度: ${this.extractQueue.length}`,
      );
      this.notifyExtractStatus({ taskId, dramaName }, "queued");

      // 尝试处理队列
      this.processExtractQueue();
    });
  }

  /**
   * 处理解压队列（限制最大并发解压数）
   */
  private processExtractQueue(): void {
    if (this.extractQueue.length === 0) {
      console.log(
        `[FileService] processExtractQueue 检查: activeCount=${this.activeExtractCount}, queueLength=${this.extractQueue.length}`,
      );
      return;
    }

    while (
      this.activeExtractCount < this.maxConcurrentExtracts &&
      this.extractQueue.length > 0
    ) {
      const task = this.extractQueue.shift()!;
      this.activeExtractCount += 1;

      console.log(
        `[FileService] 开始处理解压任务: ${path.basename(task.zipPath)}, 当前解压中: ${this.activeExtractCount}, 剩余队列: ${this.extractQueue.length}`,
      );
      this.notifyExtractStatus(task, "extracting");

      void this.extractZipInternal(
        task.zipPath,
        task.targetDir,
        task.deleteAfterExtract,
      )
        .then((result) => {
          this.notifyExtractStatus(
            task,
            result.success ? "completed" : "failed",
            result.error,
          );
          task.resolve(result);
        })
        .catch((error) => {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.notifyExtractStatus(task, "failed", errorMessage);
          task.reject(error);
        })
        .finally(() => {
          this.activeExtractCount = Math.max(0, this.activeExtractCount - 1);
          console.log(
            `[FileService] 解压任务完成，继续处理队列 (当前解压中: ${this.activeExtractCount}, 剩余: ${this.extractQueue.length})`,
          );

          if (this.extractQueue.length > 0) {
            setImmediate(() => {
              this.processExtractQueue();
            });
          }
        });
    }
  }

  private escapePowerShellLiteral(value: string): string {
    return value.replace(/'/g, "''");
  }

  private async extractZipWithPowerShell(
    zipPath: string,
    extractDir: string,
    timeoutMs = 10 * 60 * 1000,
  ): Promise<void> {
    const escapedZipPath = this.escapePowerShellLiteral(zipPath);
    const escapedExtractDir = this.escapePowerShellLiteral(extractDir);
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`,
      `if (!(Test-Path -LiteralPath '${escapedExtractDir}')) { New-Item -ItemType Directory -Path '${escapedExtractDir}' -Force | Out-Null }`,
      `Expand-Archive -LiteralPath '${escapedZipPath}' -DestinationPath '${escapedExtractDir}' -Force`,
    ].join("; ");

    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
      {
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
    );
  }

  private async extractZipWithLibrary(
    zipPath: string,
    extractDir: string,
    maxRetries = 3,
    timeoutMs = 10 * 60 * 1000,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await Promise.race([
          extract(zipPath, { dir: path.resolve(extractDir) }),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(
                new Error(`extract-zip 解压超时（${timeoutMs / 1000}秒）`),
              );
            }, timeoutMs);
          }),
        ]);
        return;
      } catch (extractError: unknown) {
        const errCode = (extractError as NodeJS.ErrnoException).code;
        if (
          (errCode === "EPERM" || errCode === "EBUSY") &&
          attempt < maxRetries
        ) {
          console.log(
            `[FileService] 解压时文件被占用 (${errCode})，${attempt}/${maxRetries} 次重试，等待 2 秒...`,
          );
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          throw extractError;
        }
      }
    }
  }

  /**
   * 实际的解压实现（内部方法）
   */
  private async extractZipInternal(
    zipPath: string,
    targetDir?: string,
    deleteAfterExtract = true,
  ): Promise<{ success: boolean; error?: string; extractedPath: string }> {
    try {
      console.log("[FileService] 开始解压:", zipPath);

      // 检查 zip 文件是否存在
      if (!fs.existsSync(zipPath)) {
        throw new Error(`zip 文件不存在: ${zipPath}`);
      }

      // 获取文件大小用于验证
      const stats = await fs.promises.stat(zipPath);
      console.log(
        `[FileService] zip 文件大小: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
      );

      // 验证是否为有效的 zip 文件（检查文件头，带重试机制应对 EPERM）
      let fileHandle: fs.promises.FileHandle | null = null;
      const headerBuffer = Buffer.alloc(4);
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          fileHandle = await fs.promises.open(zipPath, "r");
          await fileHandle.read(headerBuffer, 0, 4, 0);
          await fileHandle.close();
          fileHandle = null;
          break;
        } catch (openError: unknown) {
          if (fileHandle) {
            try {
              await fileHandle.close();
            } catch {
              /* ignore */
            }
            fileHandle = null;
          }
          const errCode = (openError as NodeJS.ErrnoException).code;
          if (
            (errCode === "EPERM" || errCode === "EBUSY") &&
            attempt < maxRetries
          ) {
            console.log(
              `[FileService] 文件被占用 (${errCode})，${attempt}/${maxRetries} 次重试，等待 2 秒...`,
            );
            await new Promise((r) => setTimeout(r, 2000));
          } else {
            throw openError;
          }
        }
      }

      const isPKZip =
        headerBuffer[0] === 0x50 &&
        headerBuffer[1] === 0x4b &&
        (headerBuffer[2] === 0x03 ||
          headerBuffer[2] === 0x05 ||
          headerBuffer[2] === 0x07);

      if (!isPKZip) {
        throw new Error(
          `文件不是有效的 zip 格式（文件头: ${headerBuffer.toString("hex")}）`,
        );
      }

      // 确定解压目标目录
      const extractDir = targetDir || path.dirname(zipPath);

      // 确保目标目录存在
      if (!fs.existsSync(extractDir)) {
        await fs.promises.mkdir(extractDir, { recursive: true });
      }

      console.log("[FileService] 解压目标目录:", extractDir);

      const resolvedExtractDir = path.resolve(extractDir);

      // Windows 下优先使用系统 PowerShell 解压，规避 extract-zip 在部分机器上的卡死问题
      if (process.platform === "win32") {
        try {
          console.log("[FileService] Windows 环境，优先使用 PowerShell 解压");
          await this.extractZipWithPowerShell(zipPath, resolvedExtractDir);
        } catch (powerShellError) {
          console.error(
            "[FileService] PowerShell 解压失败，回退 extract-zip:",
            powerShellError,
          );
          await this.extractZipWithLibrary(
            zipPath,
            resolvedExtractDir,
            maxRetries,
          );
        }
      } else {
        await this.extractZipWithLibrary(
          zipPath,
          resolvedExtractDir,
          maxRetries,
        );
      }

      console.log("[FileService] ✓ 解压成功");

      // 验证解压结果：检查目标目录中是否有文件
      const extractedFiles = await fs.promises.readdir(extractDir);
      const videoFiles = extractedFiles.filter((file) =>
        /\.(mp4|mov|avi|mkv|flv|wmv|webm)$/i.test(file),
      );

      console.log(
        `[FileService] 解压后文件统计: 总计 ${extractedFiles.length} 个文件/目录, 其中视频文件 ${videoFiles.length} 个`,
      );

      if (videoFiles.length > 0) {
        console.log(
          `[FileService] 视频文件列表: ${videoFiles.slice(0, 5).join(", ")}${videoFiles.length > 5 ? "..." : ""}`,
        );
      }

      // 删除原 zip 文件
      if (deleteAfterExtract) {
        try {
          await fs.promises.unlink(zipPath);
          console.log("[FileService] ✓ 已删除原 zip 文件:", zipPath);
        } catch (deleteError) {
          console.error("[FileService] 删除 zip 文件失败:", deleteError);
          // 删除失败不影响整体结果
        }
      }

      return {
        success: true,
        extractedPath: extractDir,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("[FileService] 解压失败:", errorMessage);
      console.error("[FileService] 完整错误信息:", error);
      return {
        success: false,
        error: errorMessage,
        extractedPath: "",
      };
    }
  }

  // 删除目录（递归删除，带重试机制）
  async deleteFolder(
    folderPath: string,
    maxRetry = 3,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[FileService] 开始删除目录: ${folderPath}`);

      // 检查目录是否存在
      if (!fs.existsSync(folderPath)) {
        console.log(`[FileService] 目录不存在，无需删除: ${folderPath}`);
        return { success: true };
      }

      // 先统计文件数量
      const fileCount = this.countFilesInDirectory(folderPath);
      console.log(`[FileService] 目录中有 ${fileCount} 个文件`);

      // 等待 2 秒，确保所有文件句柄被释放（例如 ffprobe 进程）
      console.log(`[FileService] 等待 2 秒以确保文件句柄释放...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 尝试删除，带重试机制
      for (let attempt = 1; attempt <= maxRetry; attempt++) {
        try {
          // 递归删除目录及其内容
          await fs.promises.rm(folderPath, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 1000,
          });

          // 验证删除是否成功
          if (fs.existsSync(folderPath)) {
            const remainingFiles = this.listFilesInDirectory(folderPath);
            console.warn(
              `[FileService] ⚠️ 目录仍然存在，有 ${remainingFiles.length} 个文件未被删除:`,
            );
            remainingFiles.forEach((file) => {
              console.warn(`  - ${file}`);
            });

            // 如果还有剩余文件，尝试逐个删除
            if (remainingFiles.length > 0 && attempt < maxRetry) {
              console.log(
                `[FileService] 尝试逐个删除剩余文件 (尝试 ${attempt + 1}/${maxRetry})...`,
              );

              for (const file of remainingFiles) {
                try {
                  const fullPath = path.join(folderPath, file);
                  const stat = await fs.promises.stat(fullPath);

                  if (stat.isDirectory()) {
                    await fs.promises.rm(fullPath, {
                      recursive: true,
                      force: true,
                    });
                  } else {
                    // 先尝试修改文件权限（Windows）
                    try {
                      await fs.promises.chmod(fullPath, 0o666);
                    } catch (chmodError) {
                      // 权限修改失败不影响继续
                    }
                    await fs.promises.unlink(fullPath);
                  }
                  console.log(`[FileService] ✓ 已删除: ${file}`);
                } catch (fileError) {
                  console.error(`[FileService] ✗ 无法删除: ${file}`, fileError);
                }
              }

              // 再次检查
              if (!fs.existsSync(folderPath)) {
                console.log(`[FileService] ✓ 目录删除成功: ${folderPath}`);
                return { success: true };
              }

              // 等待后再试
              const waitTime = 2000 * attempt;
              console.log(`[FileService] 等待 ${waitTime}ms 后重试...`);
              await new Promise((resolve) => setTimeout(resolve, waitTime));
              continue;
            }

            // 最后一次尝试还有剩余文件
            if (attempt === maxRetry) {
              throw new Error(
                `无法完全删除目录，还有 ${remainingFiles.length} 个文件`,
              );
            }
          } else {
            console.log(`[FileService] ✓ 目录删除成功: ${folderPath}`);
            return { success: true };
          }
        } catch (error) {
          console.error(
            `[FileService] 删除目录失败 (尝试 ${attempt}/${maxRetry}):`,
            error,
          );

          if (attempt === maxRetry) {
            // 最后一次失败，尝试检查哪些文件未被删除
            if (fs.existsSync(folderPath)) {
              const remainingFiles = this.listFilesInDirectory(folderPath);
              console.error(
                `[FileService] 以下文件未能删除 (共 ${remainingFiles.length} 个):`,
              );
              remainingFiles.forEach((file) => {
                console.error(`  - ${file}`);
              });
            }
            throw error;
          }

          // 等待后重试，每次等待时间递增
          const waitTime = 2000 * attempt;
          console.log(`[FileService] 等待 ${waitTime}ms 后重试...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[FileService] 删除目录最终失败: ${folderPath}`,
        errorMessage,
      );
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  // 统计目录中的文件数量
  private countFilesInDirectory(dirPath: string): number {
    try {
      let count = 0;
      const items = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        if (item.isDirectory()) {
          count += this.countFilesInDirectory(fullPath);
        } else {
          count++;
        }
      }

      return count;
    } catch (error) {
      console.error(`[FileService] 统计文件数量失败:`, error);
      return 0;
    }
  }

  // 列出目录中的所有文件
  private listFilesInDirectory(dirPath: string): string[] {
    try {
      const files: string[] = [];
      const items = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        if (item.isDirectory()) {
          files.push(...this.listFilesInDirectory(fullPath));
        } else {
          files.push(fullPath);
        }
      }

      return files;
    } catch (error) {
      console.error(`[FileService] 列出文件失败:`, error);
      return [];
    }
  }

  /**
   * 检查目录中的 mp4 文件数量
   * @param dirPath 目录路径
   * @returns mp4 文件数量
   */
  countMp4Files(dirPath: string): number {
    try {
      if (!fs.existsSync(dirPath)) {
        return 0;
      }

      let count = 0;
      const items = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        if (item.isDirectory()) {
          // 递归统计子目录中的 mp4 文件
          count += this.countMp4Files(fullPath);
        } else if (item.isFile() && /\.(mp4|MP4)$/i.test(item.name)) {
          count++;
        }
      }

      return count;
    } catch (error) {
      console.error(`[FileService] 统计 mp4 文件失败:`, error);
      return 0;
    }
  }

  /**
   * 检查 zip 文件是否存在且完整
   * @param zipPath zip 文件路径
   * @returns { exists: boolean, valid: boolean, size?: number }
   */
  checkZipFile(zipPath: string): {
    exists: boolean;
    valid: boolean;
    size?: number;
  } {
    try {
      // 检查 zip 文件是否存在
      if (!fs.existsSync(zipPath)) {
        return { exists: false, valid: false };
      }

      const stats = fs.statSync(zipPath);
      const fileSize = stats.size;

      // 文件大小太小（小于 1MB），认为不完整
      if (fileSize < 1024 * 1024) {
        console.warn(
          `[FileService] zip 文件太小: ${(fileSize / 1024 / 1024).toFixed(2)} MB`,
        );
        return { exists: true, valid: false, size: fileSize };
      }

      // 检查 zip 文件是否损坏（通过读取文件头，带重试机制应对 EPERM）
      let fd: number | null = null;
      const buffer = Buffer.alloc(4);
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          fd = fs.openSync(zipPath, "r");
          fs.readSync(fd, buffer, 0, 4, 0);
          fs.closeSync(fd);
          fd = null;
          break;
        } catch (openError: any) {
          if (fd !== null) {
            try {
              fs.closeSync(fd);
            } catch {}
            fd = null;
          }
          if (openError.code === "EPERM" && attempt < maxRetries) {
            console.warn(
              `[FileService] zip 文件被占用，${attempt}/${maxRetries} 次重试...`,
            );
            // 同步等待
            const waitMs = 2000 * attempt;
            const start = Date.now();
            while (Date.now() - start < waitMs) {
              /* busy wait */
            }
            continue;
          }
          console.warn(`[FileService] 无法读取 zip 文件头:`, openError.message);
          return { exists: true, valid: false, size: fileSize };
        }
      }

      // 检查是否是有效的 zip 文件头（PK\x03\x04, PK\x05\x06, 或 PK\x07\x08）
      const isPKZip =
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);

      if (!isPKZip) {
        console.warn(`[FileService] zip 文件头无效: ${buffer.toString("hex")}`);
        return { exists: true, valid: false, size: fileSize };
      }

      // zip 文件存在且看起来完整
      console.log(
        `[FileService] 发现完整的 zip 文件: ${(fileSize / 1024 / 1024).toFixed(2)} MB`,
      );
      return { exists: true, valid: true, size: fileSize };
    } catch (error) {
      console.error(`[FileService] 检查 zip 文件失败:`, error);
      return { exists: false, valid: false };
    }
  }
}
