import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import extract from "extract-zip";
import type { ConfigService } from "./config.service";

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

export class FileService {
  private defaultBasePath = "D:\\短剧剪辑\\";
  
  // 解压队列控制
  private extractQueue: Array<{
    zipPath: string;
    targetDir?: string;
    deleteAfterExtract: boolean;
    resolve: (value: { success: boolean; error?: string; extractedPath: string }) => void;
    reject: (reason?: any) => void;
  }> = [];
  private isExtracting = false;

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
        `[FileService] 扫描完成，找到 ${materials.length} 个视频文件`
      );
      return materials;
    } catch (error) {
      console.error("[FileService] 扫描视频失败:", error);
      return materials;
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
          }
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
          (stream: { codec_type: string }) => stream.codec_type === "video"
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
            `[FileService] ⚠️ 文件可能被占用或路径有问题，将使用默认值: ${filePath}`
          );
          // 空 JSON 错误不重试，直接返回默认值
          return { width: 1280, height: 720, duration: 0 };
        }
        
        // 其他错误只在第一次和最后一次打印详细日志
        if (attempt === 1 || attempt === maxRetry) {
          console.error(
            `[FileService] 获取视频信息失败 (尝试 ${attempt}/${maxRetry}):`,
            error
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
              `[FileService] 文件信息: 大小=${stats.size} bytes, 修改时间=${stats.mtime}`
            );
          }

          // 如果所有尝试都失败，返回默认值
          return { width: 1280, height: 720, duration: 0 };
        }

        // 等待后重试，每次等待时间递增
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * attempt)
        );
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
    deleteAfterExtract = true
  ): Promise<{ success: boolean; error?: string; extractedPath: string }> {
    // 添加到队列
    return new Promise((resolve, reject) => {
      this.extractQueue.push({
        zipPath,
        targetDir,
        deleteAfterExtract,
        resolve,
        reject,
      });

      console.log(
        `[FileService] 解压任务已加入队列，当前队列长度: ${this.extractQueue.length}`
      );

      // 尝试处理队列
      this.processExtractQueue();
    });
  }

  /**
   * 处理解压队列（确保一次只解压一个文件）
   */
  private async processExtractQueue(): Promise<void> {
    // 如果正在解压或队列为空，直接返回
    if (this.isExtracting || this.extractQueue.length === 0) {
      console.log(
        `[FileService] processExtractQueue 检查: isExtracting=${this.isExtracting}, queueLength=${this.extractQueue.length}`
      );
      return;
    }

    this.isExtracting = true;
    const task = this.extractQueue.shift()!;

    console.log(
      `[FileService] 开始处理解压任务: ${path.basename(task.zipPath)}, 剩余队列: ${this.extractQueue.length}`
    );

    try {
      const result = await this.extractZipInternal(
        task.zipPath,
        task.targetDir,
        task.deleteAfterExtract
      );
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    } finally {
      this.isExtracting = false;
      console.log(
        `[FileService] 解压任务完成，继续处理队列 (剩余: ${this.extractQueue.length})`
      );
      
      // 使用 setImmediate 确保异步继续处理队列
      if (this.extractQueue.length > 0) {
        setImmediate(() => {
          this.processExtractQueue().catch(error => {
            console.error('[FileService] 处理解压队列时发生错误:', error);
          });
        });
      }
    }
  }

  /**
   * 实际的解压实现（内部方法）
   */
  private async extractZipInternal(
    zipPath: string,
    targetDir?: string,
    deleteAfterExtract = true
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
        `[FileService] zip 文件大小: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`
      );

      // 验证是否为有效的 zip 文件（检查文件头，只读取前 4 个字节）
      const fileHandle = await fs.promises.open(zipPath, "r");
      const headerBuffer = Buffer.alloc(4);
      await fileHandle.read(headerBuffer, 0, 4, 0);
      await fileHandle.close();

      const isPKZip =
        headerBuffer[0] === 0x50 &&
        headerBuffer[1] === 0x4b &&
        (headerBuffer[2] === 0x03 || headerBuffer[2] === 0x05 || headerBuffer[2] === 0x07);

      if (!isPKZip) {
        throw new Error(
          `文件不是有效的 zip 格式（文件头: ${headerBuffer.toString("hex")}）`
        );
      }

      // 确定解压目标目录
      const extractDir = targetDir || path.dirname(zipPath);

      // 确保目标目录存在
      if (!fs.existsSync(extractDir)) {
        await fs.promises.mkdir(extractDir, { recursive: true });
      }

      console.log("[FileService] 解压目标目录:", extractDir);

      // 使用 extract-zip 库解压（跨平台，纯 Node.js 实现）
      await extract(zipPath, { dir: path.resolve(extractDir) });

      console.log("[FileService] ✓ 解压成功");

      // 验证解压结果：检查目标目录中是否有文件
      const extractedFiles = await fs.promises.readdir(extractDir);
      const videoFiles = extractedFiles.filter((file) =>
        /\.(mp4|mov|avi|mkv|flv|wmv|webm)$/i.test(file)
      );

      console.log(
        `[FileService] 解压后文件统计: 总计 ${extractedFiles.length} 个文件/目录, 其中视频文件 ${videoFiles.length} 个`
      );

      if (videoFiles.length > 0) {
        console.log(
          `[FileService] 视频文件列表: ${videoFiles.slice(0, 5).join(", ")}${videoFiles.length > 5 ? "..." : ""}`
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
    maxRetry = 3
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
              `[FileService] ⚠️ 目录仍然存在，有 ${remainingFiles.length} 个文件未被删除:`
            );
            remainingFiles.forEach((file) => {
              console.warn(`  - ${file}`);
            });

            // 如果还有剩余文件，尝试逐个删除
            if (remainingFiles.length > 0 && attempt < maxRetry) {
              console.log(
                `[FileService] 尝试逐个删除剩余文件 (尝试 ${attempt + 1}/${maxRetry})...`
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
                `无法完全删除目录，还有 ${remainingFiles.length} 个文件`
              );
            }
          } else {
            console.log(`[FileService] ✓ 目录删除成功: ${folderPath}`);
            return { success: true };
          }
        } catch (error) {
          console.error(
            `[FileService] 删除目录失败 (尝试 ${attempt}/${maxRetry}):`,
            error
          );

          if (attempt === maxRetry) {
            // 最后一次失败，尝试检查哪些文件未被删除
            if (fs.existsSync(folderPath)) {
              const remainingFiles = this.listFilesInDirectory(folderPath);
              console.error(
                `[FileService] 以下文件未能删除 (共 ${remainingFiles.length} 个):`
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
      console.error(`[FileService] 删除目录最终失败: ${folderPath}`, errorMessage);
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
  checkZipFile(zipPath: string): { exists: boolean; valid: boolean; size?: number } {
    try {
      // 检查 zip 文件是否存在
      if (!fs.existsSync(zipPath)) {
        return { exists: false, valid: false };
      }

      const stats = fs.statSync(zipPath);
      const fileSize = stats.size;

      // 文件大小太小（小于 1MB），认为不完整
      if (fileSize < 1024 * 1024) {
        console.warn(`[FileService] zip 文件太小: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
        return { exists: true, valid: false, size: fileSize };
      }

      // 检查 zip 文件是否损坏（通过读取文件头）
      const fd = fs.openSync(zipPath, 'r');
      const buffer = Buffer.alloc(4);
      fs.readSync(fd, buffer, 0, 4, 0);
      fs.closeSync(fd);

      // 检查是否是有效的 zip 文件头（PK\x03\x04, PK\x05\x06, 或 PK\x07\x08）
      const isPKZip =
        buffer[0] === 0x50 &&
        buffer[1] === 0x4B &&
        (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);

      if (!isPKZip) {
        console.warn(`[FileService] zip 文件头无效: ${buffer.toString('hex')}`);
        return { exists: true, valid: false, size: fileSize };
      }

      // zip 文件存在且看起来完整
      console.log(`[FileService] 发现完整的 zip 文件: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
      return { exists: true, valid: true, size: fileSize };
    } catch (error) {
      console.error(`[FileService] 检查 zip 文件失败:`, error);
      return { exists: false, valid: false };
    }
  }
}
