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

export class DownloadService {
  private activeDownloads: Map<string, ActiveDownload> = new Map();
  private downloadStates: Map<string, DownloadState> = new Map();
  private pausedDownloads: Set<string> = new Set();

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

    return new Promise((resolve, reject) => {
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
          reject(new Error(`创建目录失败: ${error}`));
          return;
        }
      } else {
        console.log("[DownloadService] ✓ 目录已存在");
      }

      const client = url.startsWith("https") ? https : http;
      // 增大写入缓冲区，提高大文件写入效率
      const file = fs.createWriteStream(savePath, {
        highWaterMark: 1024 * 1024, // 1MB 缓冲区
      });

      let downloadedBytes = 0;
      let lastTime = Date.now();
      let lastDownloadedBytes = 0;
      let lastSpeed = 0; // 保存上一次的速度值

      // 设置请求选项和请求头（模拟浏览器请求）
      const isHttps = url.startsWith("https");
      const requestOptions: https.RequestOptions = {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://www.changdunovel.com/",
          Accept: "*/*",
          "Accept-Encoding": "identity", // 禁用压缩，避免额外解压开销
          Connection: "keep-alive",
        },
        timeout: 0, // 不设置超时，让大文件可以慢慢下载
        agent: isHttps ? httpsAgent : httpAgent, // 使用连接池
      };

      console.log("[DownloadService] 请求头:", requestOptions.headers);

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
          fs.unlinkSync(savePath);
          this.downloadFile(
            response.headers.location,
            savePath,
            dramaName,
            onProgress
          )
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          console.error(
            "[DownloadService] 下载失败，状态码:",
            response.statusCode
          );
          file.close();
          fs.unlinkSync(savePath);
          reject(new Error(`下载失败，状态码: ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(
          response.headers["content-length"] || "0",
          10
        );
        console.log(
          "[DownloadService] 文件大小:",
          totalBytes,
          "bytes",
          `(${(totalBytes / 1024 / 1024).toFixed(2)} MB)`
        );

        // 保存下载状态（用于断点续传）
        this.downloadStates.set(dramaName, {
          dramaName,
          url,
          savePath,
          downloadedBytes: 0,
          totalBytes,
          paused: false,
        });

        response.on("data", (chunk: Buffer) => {
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

          // 计算下载速度（每秒）- 节流：每 500ms 才发送一次进度
          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000;

          // 只有时间间隔 >= 0.5 秒才发送进度更新（节流）
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

        response.pipe(file);

        let isPaused = false;

        file.on("finish", () => {
          // 如果已经被暂停处理过，不再处理
          if (isPaused) {
            return;
          }
          file.close();
          this.activeDownloads.delete(dramaName);
          this.downloadStates.delete(dramaName);
          this.pausedDownloads.delete(dramaName);
          resolve({
            success: true,
            filePath: savePath,
          });
        });

        response.on("error", (err) => {
          console.error("[DownloadService] 响应流错误:", err);

          // 检查是否是用户暂停导致的
          if (this.pausedDownloads.has(dramaName)) {
            isPaused = true;
            console.log(`[DownloadService] 下载已暂停（响应流）`);
            file.close();
            this.activeDownloads.delete(dramaName);
            // 更新状态但不删除
            const state = this.downloadStates.get(dramaName);
            if (state) {
              state.paused = true;
              state.downloadedBytes = downloadedBytes;
              console.log(
                `[DownloadService] 保存断点: ${downloadedBytes} / ${state.totalBytes}`
              );
            }
            resolve({ success: false, error: "已暂停" });
            return;
          }

          file.close();
          this.activeDownloads.delete(dramaName);
          if (fs.existsSync(savePath)) {
            fs.unlinkSync(savePath);
          }
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
          // 更新状态但不删除
          const state = this.downloadStates.get(dramaName);
          if (state) {
            state.paused = true;
            state.downloadedBytes = downloadedBytes;
            console.log(
              `[DownloadService] 保存断点: ${downloadedBytes} / ${state.totalBytes}`
            );
          }
          // 暂停时返回特殊结果，不算错误
          resolve({
            success: false,
            error: "已暂停",
          });
          return;
        }

        // 真正的错误才删除文件
        if (fs.existsSync(savePath)) {
          fs.unlinkSync(savePath);
        }

        // 提供更友好的错误信息
        const errorCode = (err as any).code;
        let errorMessage = err.message;
        if (errorCode === "ECONNRESET") {
          errorMessage = "网络连接中断，请检查网络后重试";
        } else if (errorCode === "ETIMEDOUT") {
          errorMessage = "下载超时，请重试";
        } else if (errorCode === "HPE_JS_EXCEPTION") {
          errorMessage = "数据传输异常，可能是网络不稳定";
        }

        reject(new Error(errorMessage));
      });

      // 保存下载引用以便取消
      this.activeDownloads.set(dramaName, { request, dramaName });
    });
  }

  cancelDownload(dramaName: string): boolean {
    const download = this.activeDownloads.get(dramaName);
    if (download) {
      download.request.destroy();
      this.activeDownloads.delete(dramaName);
      return true;
    }
    return false;
  }

  cancelAllDownloads(): void {
    for (const [dramaName, download] of this.activeDownloads) {
      download.request.destroy();
      this.activeDownloads.delete(dramaName);
    }
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
      throw new Error("未找到下载状态");
    }

    console.log(`[DownloadService] 继续下载: ${dramaName}`);
    console.log(
      `[DownloadService] 已下载: ${state.downloadedBytes} / ${state.totalBytes}`
    );

    this.pausedDownloads.delete(dramaName);

    // 使用 Range 请求从断点处继续
    return this.downloadFileWithResume(
      state.url,
      state.savePath,
      dramaName,
      state.downloadedBytes,
      onProgress
    );
  }

  // 支持断点续传的下载方法
  private async downloadFileWithResume(
    url: string,
    savePath: string,
    dramaName: string,
    startByte: number,
    onProgress: (progress: DownloadProgress) => void
  ): Promise<DownloadResult> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https") ? https : http;

      // 打开文件，追加模式，增大缓冲区
      const file = fs.createWriteStream(savePath, {
        flags: "a",
        highWaterMark: 1024 * 1024, // 1MB 缓冲区
      });

      let downloadedBytes = startByte;
      let lastTime = Date.now();
      let lastDownloadedBytes = startByte;
      let lastSpeed = 0; // 保存上一次的速度值

      const isHttps = url.startsWith("https");
      const requestOptions: https.RequestOptions = {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://www.changdunovel.com/",
          Accept: "*/*",
          "Accept-Encoding": "identity",
          Connection: "keep-alive",
          Range: `bytes=${startByte}-`, // 从指定位置开始下载
        },
        timeout: 0,
        agent: isHttps ? httpsAgent : httpAgent,
      };

      console.log("[DownloadService] 断点续传请求头:", requestOptions.headers);

      const request = client.get(url, requestOptions, (response) => {
        console.log("[DownloadService] 续传响应状态码:", response.statusCode);

        // 206 Partial Content 表示支持断点续传
        if (response.statusCode !== 206 && response.statusCode !== 200) {
          file.close();
          reject(new Error(`续传失败，状态码: ${response.statusCode}`));
          return;
        }

        // 从响应头获取总大小
        const contentRange = response.headers["content-range"];
        const totalBytes = contentRange
          ? parseInt(contentRange.split("/")[1], 10)
          : parseInt(response.headers["content-length"] || "0", 10) + startByte;

        // 更新状态
        const state = this.downloadStates.get(dramaName);
        if (state) {
          state.totalBytes = totalBytes;
          state.paused = false;
        }

        response.on("data", (chunk: Buffer) => {
          if (this.pausedDownloads.has(dramaName)) {
            request.destroy();
            return;
          }

          downloadedBytes += chunk.length;

          // 更新状态
          if (state) {
            state.downloadedBytes = downloadedBytes;
          }

          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000;

          // 只有时间间隔 >= 0.5 秒才发送进度更新（节流）
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

        response.pipe(file);

        let isCompleted = false;
        let isPaused = false;

        file.on("finish", () => {
          // 如果已经被暂停处理过，不再处理
          if (isPaused) {
            return;
          }
          isCompleted = true;
          file.close();
          this.activeDownloads.delete(dramaName);
          this.downloadStates.delete(dramaName);
          this.pausedDownloads.delete(dramaName);
          resolve({
            success: true,
            filePath: savePath,
          });
        });

        response.on("error", (err) => {
          console.error("[DownloadService] 续传响应流错误:", err);

          // 检查是否是用户暂停导致的
          if (this.pausedDownloads.has(dramaName)) {
            isPaused = true;
            console.log(`[DownloadService] 续传下载已暂停（响应流）`);
            file.close();
            this.activeDownloads.delete(dramaName);
            // 更新状态但不删除
            const state = this.downloadStates.get(dramaName);
            if (state) {
              state.paused = true;
              state.downloadedBytes = downloadedBytes;
              console.log(
                `[DownloadService] 保存断点: ${downloadedBytes} / ${state.totalBytes}`
              );
            }
            resolve({ success: false, error: "已暂停" });
            return;
          }

          file.close();
          this.activeDownloads.delete(dramaName);
          reject(err);
        });
      });

      request.on("error", (err) => {
        console.error("[DownloadService] 续传请求错误:", err);

        // 检查是否是用户暂停导致的
        if (this.pausedDownloads.has(dramaName)) {
          isPaused = true;
          console.log(`[DownloadService] 续传下载已暂停（请求错误）`);
          file.close();
          this.activeDownloads.delete(dramaName);
          // 更新状态但不删除
          const state = this.downloadStates.get(dramaName);
          if (state) {
            state.paused = true;
            state.downloadedBytes = downloadedBytes;
            console.log(
              `[DownloadService] 保存断点: ${downloadedBytes} / ${state.totalBytes}`
            );
          }
          resolve({ success: false, error: "已暂停" });
          return;
        }

        file.close();
        this.activeDownloads.delete(dramaName);
        reject(err);
      });

      this.activeDownloads.set(dramaName, { request, dramaName });
    });
  }

  // 检查是否暂停
  isPaused(dramaName: string): boolean {
    return this.pausedDownloads.has(dramaName);
  }

  // 获取下载状态
  getDownloadState(dramaName: string): DownloadState | undefined {
    return this.downloadStates.get(dramaName);
  }
}
