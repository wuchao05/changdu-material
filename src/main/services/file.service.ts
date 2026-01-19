import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
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
          throw new Error("ffprobe 返回空数据，可能文件损坏或被占用");
        }

        const videoData = JSON.parse(stdout);

        // 检查是否有有效的流数据
        if (!videoData.streams || videoData.streams.length === 0) {
          throw new Error("ffprobe 无法解析视频流，可能文件格式不支持");
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
        console.error(
          `[FileService] 获取视频信息失败 (尝试 ${attempt}/${maxRetry}):`,
          error
        );
        console.error(`[FileService] 文件路径: ${filePath}`);

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
   * 解压 zip 文件（跨平台）
   * @param zipPath zip 文件路径
   * @param targetDir 解压目标目录（如果不指定，则解压到 zip 文件所在目录）
   * @param deleteAfterExtract 解压后是否删除原 zip 文件
   */
  async extractZip(
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

      // 确定解压目标目录
      const extractDir = targetDir || path.dirname(zipPath);

      // 确保目标目录存在
      if (!fs.existsSync(extractDir)) {
        await fs.promises.mkdir(extractDir, { recursive: true });
      }

      console.log("[FileService] 解压目标目录:", extractDir);

      // 根据操作系统选择解压命令
      const platform = process.platform;

      if (platform === "win32") {
        // Windows: 使用 PowerShell 的 Expand-Archive
        await execFileAsync("powershell", [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`,
        ]);
      } else {
        // macOS/Linux: 使用 unzip 命令
        await execFileAsync("unzip", ["-o", "-q", zipPath, "-d", extractDir]);
      }

      console.log("[FileService] ✓ 解压成功");

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

          console.log(`[FileService] ✓ 目录删除成功: ${folderPath}`);
          return { success: true };
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
          const waitTime = 1000 * attempt;
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
}
