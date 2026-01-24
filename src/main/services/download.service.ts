import https from "https";
import http from "http";
import fs from "fs";
import path from "path";

// 创建全局 Agent 用于连接复用，优化下载性能
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 0,
  // Windows 上优先使用 IPv4，避免 IPv6 DNS 解析慢
  family: 4,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 0,
  family: 4,
});

export interface DownloadProgress {
  dramaName: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: string;
  speed?: number;
}

export interface DownloadResult {
  success: boolean;
  filePath: string;
  error?: string;
}

interface ActiveDownload {
  request: http.ClientRequest;
  dramaName: string;
  paused?: boolean;
  abortController?: AbortController;
}

interface DownloadState {
  dramaName: string;
  url: string;
  savePath: string;
  downloadedBytes: number;
  totalBytes: number;
  paused: boolean;
  chunks?: Array<{ start: number; end: number; downloaded: boolean }>;
}

// 自动重试配置
const AUTO_RETRY_MAX = 5; // 最大自动重试次数
const AUTO_RETRY_DELAY = 3000; // 重试间隔（毫秒）

export class DownloadService {
  private activeDownloads: Map<string, ActiveDownload> = new Map();
  private downloadStates: Map<string, DownloadState> = new Map();
  private pausedDownloads: Set<string> = new Set();
  private cancelledDownloads: Set<string> = new Set(); // 新增：跟踪已取消的下载

  async downloadFile(
    url: string,
    savePath: string,
    dramaName: string,
    onProgress: (progress: DownloadProgress) => void
  ): Promise<DownloadResult> {
    console.log("[DownloadService] 开始下载文件");
    console.log("[DownloadService] URL:", url);
    console.log("[DownloadService] 保存路径:", savePath);
    console.log("[DownloadService] 剧名:", dramaName);

    // 清除可能存在的取消标记
    this.cancelledDownloads.delete(dramaName);

    // 确保目录存在
    const dir = path.dirname(savePath);
    console.log("[DownloadService] 目标目录:", dir);

    if (!fs.existsSync(dir)) {
      console.log("[DownloadService] 目录不存在，创建目录...");
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log("[DownloadService] ✓ 目录创建成功");
      } catch (error) {
        console.error("[DownloadService] ✗ 目录创建失败:", error);
        return { success: false, filePath: savePath, error: `创建目录失败: ${error}` };
      }
    } else {
      console.log("[DownloadService] ✓ 目录已存在");
    }

    // 检查是否存在已下载的部分文件，支持从文件大小恢复断点
    let startByte = 0;
    if (fs.existsSync(savePath)) {
      const stats = fs.statSync(savePath);
      startByte = stats.size;
      console.log(`[DownloadService] 发现已存在文件，大小: ${startByte} bytes`);
      
      // 先发送一个 HEAD 请求检查文件总大小
      try {
        const totalSize = await this.getFileSize(url);
        console.log(`[DownloadService] 服务器文件大小: ${totalSize} bytes`);
        
        if (totalSize > 0 && startByte >= totalSize) {
          console.log(`[DownloadService] 文件已完整下载，无需重新下载`);
          return { success: true, filePath: savePath };
        } else if (startByte > 0 && startByte < totalSize) {
          console.log(`[DownloadService] 将尝试断点续传，从 ${startByte} 字节开始`);
        } else if (startByte > totalSize) {
          console.log(`[DownloadService] 本地文件大小异常，删除后重新下载`);
          fs.unlinkSync(savePath);
          startByte = 0;
        }
      } catch (error) {
        console.warn(`[DownloadService] 无法获取文件大小，将尝试断点续传:`, error);
      }
    }

    // 带自动重试的下载
    return this.downloadWithRetry(url, savePath, dramaName, startByte, onProgress, 0);
  }

  // 带自动重试的下载方法
  private async downloadWithRetry(
    url: string,
    savePath: string,
    dramaName: string,
    startByte: number,
    onProgress: (progress: DownloadProgress) => void,
    retryCount: number
  ): Promise<DownloadResult> {
    console.log(`[DownloadService] downloadWithRetry 开始，重试次数: ${retryCount}，起始字节: ${startByte}`);
    
    try {
      const result = await this.downloadFileInternal(url, savePath, dramaName, startByte, onProgress);
      console.log(`[DownloadService] downloadFileInternal 完成，结果:`, result.success ? '成功' : `失败: ${result.error}`);
      return result;
    } catch (error) {
      console.log(`[DownloadService] downloadWithRetry 捕获到错误:`, error);
      const errorCode = (error as any).code;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[DownloadService] 错误代码: ${errorCode}, 错误信息: ${errorMessage}`);
      
      // 检查是否被用户取消
      if (this.cancelledDownloads.has(dramaName)) {
        console.log(`[DownloadService] 下载已被用户取消，不再重试: ${dramaName}`);
        this.cancelledDownloads.delete(dramaName);
        return { success: false, filePath: savePath, error: "已取消" };
      }
      
      // 检查是否是用户暂停
      if (this.pausedDownloads.has(dramaName)) {
        console.log(`[DownloadService] 下载已被用户暂停: ${dramaName}`);
        return { success: false, filePath: savePath, error: "已暂停" };
      }
      
      // 判断是否是可重试的网络错误
      const isRetryableError =
        errorCode === "ECONNRESET" ||
        errorCode === "ETIMEDOUT" ||
        errorCode === "ENOTFOUND" ||
        errorCode === "ECONNREFUSED" ||
        errorCode === "EPIPE" ||
        errorCode === "ECONNABORTED" ||
        errorMessage.includes("网络连接中断") ||
        errorMessage.includes("socket hang up");

      // 获取当前已下载的字节数（从文件大小）
      let currentDownloadedBytes = startByte;
      try {
        if (fs.existsSync(savePath)) {
          const stats = fs.statSync(savePath);
          currentDownloadedBytes = stats.size;
        }
      } catch (fsError) {
        console.error("[DownloadService] 获取文件大小失败:", fsError);
        // 继续使用 startByte 作为已下载字节数
      }

      console.log(`[DownloadService] 是否可重试: ${isRetryableError}, 当前重试次数: ${retryCount}, 最大重试次数: ${AUTO_RETRY_MAX}`);
      
      if (isRetryableError && retryCount < AUTO_RETRY_MAX) {
        const nextRetry = retryCount + 1;
        console.log(
          `[DownloadService] 网络错误 (${errorCode || errorMessage})，${AUTO_RETRY_DELAY / 1000}秒后自动重试 (${nextRetry}/${AUTO_RETRY_MAX})，已下载: ${currentDownloadedBytes} bytes`
        );
        
        // 通知前端正在重试
        onProgress({
          dramaName,
          downloadedBytes: currentDownloadedBytes,
          totalBytes: this.downloadStates.get(dramaName)?.totalBytes || 0,
          percent: "0",
          speed: 0,
        });

        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, AUTO_RETRY_DELAY));
        
        // 再次检查是否被取消
        if (this.cancelledDownloads.has(dramaName)) {
          console.log(`[DownloadService] 等待期间下载被取消: ${dramaName}`);
          this.cancelledDownloads.delete(dramaName);
          return { success: false, filePath: savePath, error: "已取消" };
        }
        
        // 从文件当前大小继续下载
        return this.downloadWithRetry(url, savePath, dramaName, currentDownloadedBytes, onProgress, nextRetry);
      }

      // 不可重试或重试次数用尽
      console.error(
        `[DownloadService] 下载失败，已重试 ${retryCount} 次: ${errorMessage}`
      );
      
      return {
        success: false,
        filePath: savePath,
        error: retryCount >= AUTO_RETRY_MAX 
          ? `下载失败（已重试${AUTO_RETRY_MAX}次）: ${errorMessage}`
          : errorMessage,
      };
    }
  }

  // 内部下载实现
  private async downloadFileInternal(
    url: string,
    savePath: string,
    dramaName: string,
    startByte: number,
    onProgress: (progress: DownloadProgress) => void
  ): Promise<DownloadResult> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https") ? https : http;
      
      // 根据是否断点续传决定写入模式
      const fileFlags = startByte > 0 ? "a" : "w";
      const file = fs.createWriteStream(savePath, {
        flags: fileFlags,
        highWaterMark: 1024 * 1024, // 1MB 缓冲区
      });

      let downloadedBytes = startByte;
      let lastTime = Date.now();
      let lastDownloadedBytes = startByte;
      let lastSpeed = 0;
      let isPaused = false;
      let totalBytes = 0;

      // 设置请求选项和请求头
      const isHttps = url.startsWith("https");
      const headers: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.changdunovel.com/",
        Accept: "*/*",
        "Accept-Encoding": "identity",
        Connection: "keep-alive",
      };
      
      // 如果有断点，添加 Range 请求头
      if (startByte > 0) {
        headers["Range"] = `bytes=${startByte}-`;
        console.log(`[DownloadService] 断点续传，从 ${startByte} 字节开始`);
      }
      
      const requestOptions: https.RequestOptions = {
        headers,
        timeout: 0,
        agent: isHttps ? httpsAgent : httpAgent,
      };

      console.log("[DownloadService] 请求头:", JSON.stringify(requestOptions.headers, null, 2));

      const request = client.get(url, requestOptions, (response) => {
        console.log("[DownloadService] 响应状态码:", response.statusCode);
        console.log(
          "[DownloadService] 响应头:",
          JSON.stringify(response.headers, null, 2)
        );

        // 处理重定向
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          console.log("[DownloadService] 重定向到:", response.headers.location);
          file.close();
          // 重定向时需要从头开始
          if (fs.existsSync(savePath)) {
            fs.unlinkSync(savePath);
          }
          this.downloadFileInternal(
            response.headers.location,
            savePath,
            dramaName,
            0,
            onProgress
          )
            .then(resolve)
            .catch(reject);
          return;
        }

        // 200 表示从头开始，206 表示断点续传，416 表示请求范围错误（可能文件已完整）
        if (response.statusCode === 416) {
          console.log("[DownloadService] 收到 416 响应，文件可能已完整下载");
          file.close();
          
          // 验证本地文件大小是否匹配
          if (fs.existsSync(savePath)) {
            const stats = fs.statSync(savePath);
            console.log(`[DownloadService] 本地文件大小: ${stats.size} bytes`);
            
            // 尝试从响应头中获取文件总大小
            const contentRange = response.headers["content-range"];
            if (contentRange) {
              const match = contentRange.match(/bytes \*\/(\d+)/);
              if (match) {
                const serverSize = parseInt(match[1], 10);
                console.log(`[DownloadService] 服务器文件大小: ${serverSize} bytes`);
                
                if (stats.size >= serverSize) {
                  console.log("[DownloadService] ✓ 文件已完整下载");
                  resolve({ success: true, filePath: savePath });
                  return;
                }
              }
            }
          }
          
          reject(new Error(`下载失败，状态码: 416（Range Not Satisfiable）`));
          return;
        }
        
        if (response.statusCode !== 200 && response.statusCode !== 206) {
          console.error(
            "[DownloadService] 下载失败，状态码:",
            response.statusCode
          );
          file.close();
          if (fs.existsSync(savePath)) {
            fs.unlinkSync(savePath);
          }
          reject(new Error(`下载失败，状态码: ${response.statusCode}`));
          return;
        }

        // 解析文件总大小
        let useNewFile = false;
        let newFile: fs.WriteStream | null = null;
        
        if (response.statusCode === 206) {
          // 断点续传响应，从 Content-Range 获取总大小
          const contentRange = response.headers["content-range"];
          if (contentRange) {
            const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
            if (match) {
              totalBytes = parseInt(match[1], 10);
            }
          }
        } else if (response.statusCode === 200) {
          totalBytes = parseInt(response.headers["content-length"] || "0", 10);
          
          // 服务器不支持断点续传，需要从头开始
          if (startByte > 0) {
            console.log("[DownloadService] 服务器不支持断点续传，从头开始下载");
            downloadedBytes = 0;
            lastDownloadedBytes = 0;
            // 需要重新打开文件以覆盖模式写入
            file.close();
            useNewFile = true;
            newFile = fs.createWriteStream(savePath, {
              flags: "w",
              highWaterMark: 1024 * 1024,
            });
          }
        }

        console.log(
          "[DownloadService] 文件大小:",
          totalBytes,
          "bytes",
          `(${(totalBytes / 1024 / 1024).toFixed(2)} MB)`
        );

        // 保存下载状态
        this.downloadStates.set(dramaName, {
          dramaName,
          url,
          savePath,
          downloadedBytes,
          totalBytes,
          paused: false,
        });

        // 选择使用的文件流
        const activeFile = useNewFile && newFile ? newFile : file;

        response.on("data", (chunk: Buffer) => {
          // 检查是否被取消
          if (this.cancelledDownloads.has(dramaName)) {
            request.destroy();
            return;
          }
          
          // 检查是否被暂停
          if (this.pausedDownloads.has(dramaName)) {
            request.destroy();
            return;
          }

          downloadedBytes += chunk.length;

          // 更新下载状态
          const state = this.downloadStates.get(dramaName);
          if (state) {
            state.downloadedBytes = downloadedBytes;
          }

          // 计算下载速度 - 每 500ms 发送一次进度更新
          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000;

          if (timeDiff >= 0.5) {
            lastSpeed = (downloadedBytes - lastDownloadedBytes) / timeDiff;
            lastTime = now;
            lastDownloadedBytes = downloadedBytes;

            const percent =
              totalBytes > 0
                ? ((downloadedBytes / totalBytes) * 100).toFixed(2)
                : "0";

            onProgress({
              dramaName,
              downloadedBytes,
              totalBytes,
              percent,
              speed: lastSpeed,
            });
          }
        });

        // pipe 到正确的文件流
        response.pipe(activeFile);

        activeFile.on("finish", () => {
          if (isPaused) return;
          activeFile.close();
          this.activeDownloads.delete(dramaName);
          this.downloadStates.delete(dramaName);
          this.pausedDownloads.delete(dramaName);
          resolve({ success: true, filePath: savePath });
        });

        activeFile.on("error", (err) => {
          console.error("[DownloadService] 文件写入错误:", err);
          activeFile.close();
          reject(err);
        });

        response.on("error", (err) => {
          console.error("[DownloadService] 响应流错误:", err);

          if (this.pausedDownloads.has(dramaName)) {
            isPaused = true;
            console.log(`[DownloadService] 下载已暂停（响应流）`);
            activeFile.close();
            this.activeDownloads.delete(dramaName);
            const state = this.downloadStates.get(dramaName);
            if (state) {
              state.paused = true;
              state.downloadedBytes = downloadedBytes;
            }
            resolve({ success: false, filePath: savePath, error: "已暂停" });
            return;
          }

          activeFile.close();
          this.activeDownloads.delete(dramaName);
          // 不删除文件，保留用于断点续传
          reject(err);
        });
      });

      request.on("error", (err) => {
        console.error("[DownloadService] 请求错误:", err);
        console.error("[DownloadService] 错误代码:", (err as any).code);
        console.error("[DownloadService] 已下载字节数:", downloadedBytes);

        // 检查是否是用户暂停导致的
        if (this.pausedDownloads.has(dramaName)) {
          isPaused = true;
          console.log(`[DownloadService] 下载已暂停，保留文件: ${savePath}`);
          file.close();
          this.activeDownloads.delete(dramaName);
          const state = this.downloadStates.get(dramaName);
          if (state) {
            state.paused = true;
            state.downloadedBytes = downloadedBytes;
          }
          resolve({ success: false, filePath: savePath, error: "已暂停" });
          return;
        }

        // 关闭文件流但不删除文件（保留用于断点续传）
        file.close();
        this.activeDownloads.delete(dramaName);

        // 保存当前状态用于重试
        const state = this.downloadStates.get(dramaName);
        if (state) {
          state.downloadedBytes = downloadedBytes;
        }

        // 抛出错误，让外层处理重试逻辑
        const error = err as NodeJS.ErrnoException;
        reject(error);
      });

      // 保存下载引用以便取消
      this.activeDownloads.set(dramaName, { request, dramaName });
    });
  }

  cancelDownload(dramaName: string): boolean {
    console.log(`[DownloadService] 取消下载: ${dramaName}`);
    
    // 设置取消标记，阻止重试
    this.cancelledDownloads.add(dramaName);
    
    const download = this.activeDownloads.get(dramaName);
    if (download) {
      download.request.destroy();
      this.activeDownloads.delete(dramaName);
    }
    
    // 清理状态
    this.downloadStates.delete(dramaName);
    this.pausedDownloads.delete(dramaName);
    
    return true;
  }

  cancelAllDownloads(): void {
    console.log(`[DownloadService] 取消所有下载`);
    for (const [dramaName, download] of this.activeDownloads) {
      this.cancelledDownloads.add(dramaName);
      download.request.destroy();
    }
    this.activeDownloads.clear();
    this.downloadStates.clear();
    this.pausedDownloads.clear();
  }

  isDownloading(dramaName: string): boolean {
    return this.activeDownloads.has(dramaName);
  }

  getActiveDownloads(): string[] {
    return Array.from(this.activeDownloads.keys());
  }

  // 批量下载队列管理
  async downloadBatch(
    items: Array<{ url: string; savePath: string; dramaName: string }>,
    concurrency: number,
    onProgress: (dramaName: string, progress: DownloadProgress) => void,
    onComplete: (dramaName: string, result: DownloadResult) => void
  ): Promise<void> {
    const queue = [...items];
    const active: Promise<void>[] = [];

    const processNext = async (): Promise<void> => {
      if (queue.length === 0) return;

      const item = queue.shift()!;

      try {
        const result = await this.downloadFile(
          item.url,
          item.savePath,
          item.dramaName,
          (progress) => onProgress(item.dramaName, progress)
        );
        onComplete(item.dramaName, result);
      } catch (error) {
        onComplete(item.dramaName, {
          success: false,
          filePath: item.savePath,
          error: error instanceof Error ? error.message : "下载失败",
        });
      }
    };

    // 启动初始批次
    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
      active.push(processNext());
    }

    // 等待所有下载完成
    while (active.length > 0 || queue.length > 0) {
      if (active.length > 0) {
        await Promise.race(active);
        // 移除已完成的任务
        const index = active.findIndex((p) => p === undefined);
        if (index !== -1) {
          active.splice(index, 1);
        }
      }

      // 如果有空闲槽位且队列中还有任务
      if (active.length < concurrency && queue.length > 0) {
        active.push(processNext());
      }
    }
  }

  // 暂停下载
  pauseDownload(dramaName: string): boolean {
    const download = this.activeDownloads.get(dramaName);
    if (download) {
      console.log(`[DownloadService] 暂停下载: ${dramaName}`);
      download.paused = true;
      this.pausedDownloads.add(dramaName);
      download.request.destroy();
      return true;
    }
    return false;
  }

  // 继续下载（从断点处）
  async resumeDownload(
    dramaName: string,
    onProgress: (progress: DownloadProgress) => void
  ): Promise<DownloadResult> {
    const state = this.downloadStates.get(dramaName);
    if (!state) {
      // 如果没有内存中的状态，尝试从文件大小恢复
      console.log(`[DownloadService] 未找到内存状态，尝试从文件恢复: ${dramaName}`);
      throw new Error("未找到下载状态，请重新开始下载");
    }

    console.log(`[DownloadService] 继续下载: ${dramaName}`);
    console.log(
      `[DownloadService] 已下载: ${state.downloadedBytes} / ${state.totalBytes}`
    );

    // 清除暂停标记
    this.pausedDownloads.delete(dramaName);
    this.cancelledDownloads.delete(dramaName);

    // 使用带自动重试的下载方法，从断点处继续
    return this.downloadWithRetry(
      state.url,
      state.savePath,
      dramaName,
      state.downloadedBytes,
      onProgress,
      0
    );
  }

  // 检查是否暂停
  isPaused(dramaName: string): boolean {
    return this.pausedDownloads.has(dramaName);
  }

  // 获取下载状态
  getDownloadState(dramaName: string): DownloadState | undefined {
    return this.downloadStates.get(dramaName);
  }

  // 获取远程文件大小（通过 HEAD 请求）
  private async getFileSize(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https") ? https : http;
      const isHttps = url.startsWith("https");
      
      const requestOptions: https.RequestOptions = {
        method: 'HEAD',
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://www.changdunovel.com/",
        },
        timeout: 10000,
        agent: isHttps ? httpsAgent : httpAgent,
      };

      const request = client.request(url, requestOptions, (response) => {
        // 处理重定向
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          this.getFileSize(response.headers.location).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode === 200) {
          const contentLength = parseInt(response.headers["content-length"] || "0", 10);
          resolve(contentLength);
        } else {
          reject(new Error(`HEAD request failed with status ${response.statusCode}`));
        }
      });

      request.on("error", reject);
      request.on("timeout", () => {
        request.destroy();
        reject(new Error("HEAD request timeout"));
      });
      
      request.end();
    });
  }
}
