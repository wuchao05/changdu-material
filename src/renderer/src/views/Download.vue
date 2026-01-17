<script setup lang="ts">
defineOptions({ name: "Download" });
import { ref, computed, onMounted, onUnmounted, h } from "vue";
import {
  NCard,
  NButton,
  NSpace,
  NProgress,
  NDataTable,
  NTag,
  NSwitch,
  NAlert,
  NSpin,
  NEmpty,
  NStatistic,
  NGrid,
  NGi,
  NInput,
  NInputNumber,
  NModal,
  NIcon,
  useMessage,
} from "naive-ui";
import { HelpCircleOutline } from "@vicons/ionicons5";
import type { DataTableColumns } from "naive-ui";
import dayjs from "dayjs";
import { useDarenStore } from "../stores/daren";
import { useAuthStore } from "../stores/auth";
import { useApiConfigStore } from "../stores/apiConfig";

interface DownloadTask {
  id: string; // 飞书 record_id
  tableId: string; // 飞书 tableId（保存以确保更新时使用正确的表）
  dramaName: string;
  bookId: string;
  date: number; // 日期时间戳（毫秒）
  publishTime: number; // 时间戳（毫秒）
  imagexUri: string; // 用于获取下载链接
  downloadUrl: string;
  status:
    | "pending"
    | "downloading"
    | "paused"
    | "success"
    | "error"
    | "cancelled";
  progress: number;
  totalBytes?: number; // 文件大小（字节）
  speed?: number; // 下载速度（字节/秒）
  localPath?: string;
  error?: string;
  lastProgressUpdate?: number; // 最后一次进度更新的时间戳
  retryCount?: number; // 重试次数
  stallCheckTimer?: any; // 停滞检测定时器
}

const message = useMessage();
const darenStore = useDarenStore();
const authStore = useAuthStore();
const apiConfigStore = useApiConfigStore();

// State
const downloadTasks = ref<DownloadTask[]>([]);
const loading = ref(false);
const downloading = ref(false);
const autoDownloadEnabled = ref(false);
const autoDownloadTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const lastAutoDownloadTime = ref<string>("");
const nextAutoDownloadTime = ref<string>("");
// 默认保存路径（用户需要手动选择或修改）
const savePath = ref("");
// 并行下载数量
const concurrentDownloads = ref(3);
// 自动下载轮询间隔（分钟）
const autoDownloadIntervalMinutes = ref(30);
// 帮助弹窗
const showHelpModal = ref(false);

// 计算是否有正在下载的任务
const hasDownloadingTasks = computed(() => {
  return downloadTasks.value.some((t) => t.status === "downloading");
});

// 正在下载的任务数量
const downloadingCount = computed(() => {
  return downloadTasks.value.filter((t) => t.status === "downloading").length;
});

// 统计
const stats = computed(() => {
  const total = downloadTasks.value.length;
  const downloaded = downloadTasks.value.filter(
    (t) => t.status === "success"
  ).length;
  const failed = downloadTasks.value.filter((t) => t.status === "error").length;
  const pending = downloadTasks.value.filter(
    (t) => t.status === "pending"
  ).length;

  return { total, downloaded, failed, pending };
});

// 查询待下载任务
async function fetchPendingDownloads(): Promise<boolean> {
  console.log("[Download] ===== 开始查询待下载任务 =====");
  loading.value = true;
  // 不在此处清空任务列表，等查询到新数据后再清空

  try {
    // 获取配置
    const appToken = apiConfigStore.config.feishuAppToken;
    const tableId = darenStore.currentDaren?.feishuDramaStatusTableId;

    console.log("[Download] 配置信息:", {
      appToken: appToken ? `${appToken.substring(0, 10)}...` : "未配置",
      tableId: tableId || "未配置",
      currentDaren: darenStore.currentDaren?.label || "无",
      isAdmin: authStore.currentUser?.role === "admin",
    });

    if (!appToken) {
      console.error("[Download] 错误: 飞书 App Token 未配置");
      message.error("请先在系统设置中配置飞书多维表格 Token");
      return false;
    }

    if (!tableId) {
      console.error("[Download] 错误: 当前达人未配置状态表 ID");
      message.error("当前达人未配置状态表 ID");
      return false;
    }

    // 1. 查询飞书中待下载状态的剧集
    console.log("[Download] 步骤1: 查询飞书待下载剧集");
    const feishuUrl = `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`;
    const feishuPayload = {
      filter: {
        conjunction: "and",
        conditions: [
          {
            field_name: "当前状态",
            operator: "is",
            value: ["待下载"],
          },
        ],
      },
      field_names: ["剧名", "日期", "上架时间"],
    };
    console.log("[Download] 飞书请求 URL:", feishuUrl);
    console.log(
      "[Download] 飞书请求参数:",
      JSON.stringify(feishuPayload, null, 2)
    );

    const feishuResult = (await window.api.feishuRequest(
      feishuUrl,
      feishuPayload
    )) as {
      data?: {
        items?: Array<{ fields: Record<string, unknown>; record_id: string }>;
      };
    };

    console.log("[Download] 飞书返回结果:", {
      hasData: !!feishuResult.data,
      itemsCount: feishuResult.data?.items?.length || 0,
      items: feishuResult.data?.items,
    });

    if (!feishuResult.data?.items?.length) {
      console.log("[Download] 飞书中没有待下载的剧集");
      message.info("没有待下载的剧集");
      return false;
    }

    // 2. 针对每个飞书剧集，单独查询常读下载中心的已完成任务
    console.log("[Download] 步骤2: 逐个查询飞书剧集在常读下载中心的完成状态");
    const tasks: DownloadTask[] = [];

    // 延迟函数
    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    // 查询单个剧集的函数（带重试机制）
    const queryChangduTask = async (
      cleanDramaName: string,
      retryCount = 0
    ): Promise<any> => {
      const maxRetries = 3;
      const changduPayload = {
        page_index: 0,
        page_size: 10,
        task_name: cleanDramaName, // 精确查询剧名
        task_status: 2, // 只查询已完成的任务
      };

      console.log(
        `[Download] 查询常读任务: ${cleanDramaName}${retryCount > 0 ? ` (重试 ${retryCount}/${maxRetries})` : ""}`
      );

      try {
        const changduResult = (await window.api.changduRequest(
          "/node/api/platform/distributor/download_center/task_list/",
          changduPayload
        )) as {
          code?: number;
          message?: string;
          data?: Array<{
            download_id: string;
            task_name: string;
            task_id: string;
            task_status: number;
            book_id: string;
            book_name: string;
            imagex_uri: string;
          }>;
          total?: number;
        };

        // 如果返回 14002（请求过快），进行重试
        if (changduResult.code === 14002 && retryCount < maxRetries) {
          console.log(`[Download] 请求过快，等待 2 秒后重试...`);
          await delay(2000);
          return await queryChangduTask(cleanDramaName, retryCount + 1);
        }

        return changduResult;
      } catch (error) {
        console.error(`[Download] 查询剧集 "${cleanDramaName}" 失败:`, error);
        throw error;
      }
    };

    for (let i = 0; i < feishuResult.data.items.length; i++) {
      const item = feishuResult.data.items[i];
      const dramaName =
        (item.fields["剧名"] as Array<{ text: string }>)?.[0]?.text || "";
      // 清理剧名，去除前后空格
      const cleanDramaName = dramaName.trim();

      // 日期字段（时间戳，毫秒），直接返回数字 1768406400000
      const date = (item.fields["日期"] as number) || 0;
      // 上架时间是时间戳（毫秒），结构为 { value: [1768444293000] }
      const publishTimeData = item.fields["上架时间"] as
        | { value?: number[] }
        | undefined;
      const publishTime = publishTimeData?.value?.[0] || 0;

      console.log("[Download] 处理飞书剧集:", {
        dramaName: cleanDramaName,
        originalName: dramaName,
        date,
        dateReadable: date ? dayjs(date).format("YYYY-MM-DD") : "无",
        publishTime,
        publishTimeReadable: publishTime
          ? dayjs(publishTime).format("YYYY-MM-DD HH:mm:ss")
          : "无",
        进度: `${i + 1}/${feishuResult.data.items.length}`,
      });

      // 查询该剧在常读下载中心的完成状态（task_status=2）
      try {
        const changduResult = await queryChangduTask(cleanDramaName);

        if (
          changduResult.code === 0 &&
          changduResult.data &&
          changduResult.data.length > 0
        ) {
          // 如果有多个任务，选择 task_name 最长的（通常是最完整的版本）
          const sortedTasks = changduResult.data.sort(
            (a, b) => (b.task_name?.length || 0) - (a.task_name?.length || 0)
          );
          const changduTask = sortedTasks[0];

          console.log("[Download] ✓ 找到匹配的常读任务:", {
            dramaName: cleanDramaName,
            task_name: changduTask.task_name,
            task_status: changduTask.task_status,
            imagex_uri: changduTask.imagex_uri,
            total: changduResult.total,
            record_id: item.record_id,
            tableId: tableId,
          });

          tasks.push({
            id: item.record_id,
            tableId: tableId!, // 保存 tableId 以便更新时使用
            dramaName: cleanDramaName,
            bookId: changduTask.book_id || "",
            date,
            publishTime,
            imagexUri: changduTask.imagex_uri,
            downloadUrl: "", // 需要调用 get_url 接口获取
            status: "pending",
            progress: 0,
          });
        } else {
          console.log("[Download] ✗ 未找到匹配的常读任务:", cleanDramaName, {
            code: changduResult.code,
            message: changduResult.message,
            dataLength: changduResult.data?.length || 0,
          });
        }
      } catch (error) {
        console.error(`[Download] 查询剧集 "${cleanDramaName}" 失败:`, error);
      }

      // 每次查询后延迟 1 秒，避免请求过快（最后一个不需要延迟）
      if (i < feishuResult.data.items.length - 1) {
        console.log("[Download] 等待 1 秒后继续...");
        await delay(1000);
      }
    }

    console.log("[Download] ===== 查询完成 =====");
    console.log("[Download] 最终匹配结果:", {
      飞书待下载剧集数: feishuResult.data.items.length,
      成功匹配任务数: tasks.length,
    });

    // 只有查询到新任务时才更新任务列表
    if (tasks.length > 0) {
      downloadTasks.value = tasks;
      message.success(`找到 ${tasks.length} 个待下载任务`);
      return true;
    } else {
      message.info("没有新的待下载任务");
      return false;
    }
  } catch (error) {
    console.error("[Download] 查询失败，错误详情:", error);
    message.error("查询待下载任务失败");
    console.error(error);
    return false;
  } finally {
    loading.value = false;
  }
}

// 获取下载 URL（带超时控制）
async function getDownloadUrl(imagexUri: string): Promise<string> {
  const GET_URL_TIMEOUT = 30000; // 30秒超时

  try {
    console.log("[Download] 获取下载 URL, imagex_uri:", imagexUri);

    const requestPromise = window.api.changduRequest(
      "/node/api/platform/distributor/download_center/get_url/",
      {
        imagex_uri: imagexUri,
      }
    ) as Promise<{ download_url?: string }>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("获取下载URL超时（超过30秒）"));
      }, GET_URL_TIMEOUT);
    });

    const result = await Promise.race([requestPromise, timeoutPromise]);

    console.log("[Download] 获取下载 URL 结果:", result);
    return result.download_url || "";
  } catch (error) {
    console.error("[Download] 获取下载 URL 失败:", error);
    return "";
  }
}

// 下载单个任务（进度停滞检测）
async function downloadSingleTask(task: DownloadTask, queue?: DownloadTask[]) {
  const STALL_TIMEOUT = 120 * 1000; // 2分钟无进度更新则判定为停滞
  const MAX_RETRIES = 3; // 最多重试3次
  const taskStartTime = Date.now();

  // 初始化重试计数
  if (task.retryCount === undefined) {
    task.retryCount = 0;
  }

  console.log(
    `[Download] 开始下载任务: ${task.dramaName}${task.retryCount > 0 ? ` (重试 ${task.retryCount}/${MAX_RETRIES})` : ""}`
  );

  try {
    // 获取下载 URL
    task.downloadUrl = await getDownloadUrl(task.imagexUri);
    if (!task.downloadUrl) {
      task.status = "error";
      task.error = "获取下载链接失败";
      console.error(`[Download] ${task.dramaName} 获取下载链接失败`);
      return;
    }

    task.status = "downloading";
    task.progress = 0; // 重置进度
    task.lastProgressUpdate = Date.now(); // 初始化进度更新时间

    // 更新飞书状态为"下载中"
    await updateFeishuStatus(task, "下载中");

    // 确定保存路径（跨平台兼容）
    const fileName = `${task.dramaName}.zip`;
    const normalizedSavePath =
      savePath.value.endsWith("/") || savePath.value.endsWith("\\")
        ? savePath.value
        : savePath.value + "/";
    const fullPath = `${normalizedSavePath}${task.dramaName}/${fileName}`;

    console.log("[Download] 下载文件:", {
      dramaName: task.dramaName,
      savePath: savePath.value,
      fullPath: fullPath,
    });

    // 启动停滞检测定时器
    let isStalled = false;
    const stallCheckInterval = setInterval(() => {
      const timeSinceLastUpdate =
        Date.now() - (task.lastProgressUpdate || Date.now());
      if (
        timeSinceLastUpdate > STALL_TIMEOUT &&
        task.status === "downloading"
      ) {
        console.warn(
          `[Download] ${task.dramaName} 检测到停滞 (${(timeSinceLastUpdate / 1000).toFixed(0)}秒无进度更新)`
        );
        isStalled = true;
        clearInterval(stallCheckInterval);
      }
    }, 10000); // 每10秒检查一次

    task.stallCheckTimer = stallCheckInterval;

    // 使用 Promise.race 实现停滞检测
    const downloadPromise = window.api.downloadVideo(
      task.downloadUrl,
      fullPath,
      task.dramaName
    );

    // 停滞检测 Promise
    const stallCheckPromise = new Promise<never>((_, reject) => {
      const checkStallInterval = setInterval(() => {
        if (isStalled) {
          clearInterval(checkStallInterval);
          clearInterval(stallCheckInterval);
          console.log(`[Download] ${task.dramaName} 停滞检测触发，取消下载...`);
          window.api.cancelDownload(task.dramaName).catch((err) => {
            console.error(`[Download] 取消下载失败:`, err);
          });
          reject(new Error("下载停滞（2分钟无进度更新）"));
        }
      }, 1000);
    });

    // 执行下载（带停滞检测）
    const result = await Promise.race([downloadPromise, stallCheckPromise]);

    // 清理定时器
    clearInterval(stallCheckInterval);

    if (result.success) {
      task.progress = 100;

      // 解压 zip 文件
      console.log(`[Download] 开始解压: ${result.filePath}`);
      const extractResult = await window.api.extractZip(
        result.filePath,
        undefined, // 解压到 zip 所在目录
        true // 解压后删除 zip
      );

      if (extractResult.success) {
        console.log(`[Download] ✓ 解压成功: ${extractResult.extractedPath}`);
        console.log(
          `[Download] 下载完成，准备更新飞书状态，task.id = ${task.id}`
        );
        task.status = "success";
        task.localPath = extractResult.extractedPath;

        // 更新飞书状态
        await updateFeishuStatus(task, "待剪辑");

        const duration = ((Date.now() - taskStartTime) / 1000).toFixed(1);
        console.log(`[Download] ${task.dramaName} 完成，耗时 ${duration}秒`);
        message.success(`${task.dramaName} 下载并解压成功`);
      } else {
        console.error(`[Download] ✗ 解压失败: ${extractResult.error}`);
        task.status = "success"; // 下载成功，但解压失败
        task.localPath = result.filePath;
        task.error = `解压失败: ${extractResult.error}`;

        // 仍然更新飞书状态
        await updateFeishuStatus(task, "待剪辑");

        message.warning(
          `${task.dramaName} 下载成功，但解压失败: ${extractResult.error}`
        );
      }
    } else {
      throw new Error("下载失败");
    }
  } catch (error) {
    // 清理停滞检测定时器
    if (task.stallCheckTimer) {
      clearInterval(task.stallCheckTimer);
      task.stallCheckTimer = null;
    }

    // 检查是否是用户主动取消或暂停
    const errorMessage = error instanceof Error ? error.message : "下载失败";
    const isUserAction =
      errorMessage.includes("已取消") ||
      errorMessage.includes("已暂停") ||
      errorMessage.includes("中断") ||
      errorMessage.includes("aborted") ||
      task.status === "paused" ||
      task.status === "cancelled";

    // 检查是否是停滞错误
    const isStallError = errorMessage.includes("下载停滞");

    if (!isUserAction) {
      const duration = ((Date.now() - taskStartTime) / 1000).toFixed(1);
      console.error(
        `[Download] ${task.dramaName} 失败，耗时 ${duration}秒，错误: ${errorMessage}`
      );

      // 如果是停滞错误且还有重试次数，重新排队到末尾
      if (isStallError && task.retryCount! < MAX_RETRIES) {
        task.retryCount!++;
        task.status = "pending";
        task.progress = 0;
        task.error = undefined;

        // 如果有队列引用，加入队列末尾（在本轮稍后重试）
        if (queue) {
          queue.push(task);
          console.log(
            `[Download] ${task.dramaName} 停滞后加入队列末尾，重试次数: ${task.retryCount}/${MAX_RETRIES}，当前队列长度: ${queue.length}`
          );
          message.warning(
            `${task.dramaName} 下载停滞，已加入队列末尾等待重试 (${task.retryCount}/${MAX_RETRIES})`
          );
        } else {
          // 没有队列引用（单独重试），等待下一轮
          console.log(
            `[Download] ${task.dramaName} 停滞后标记为pending，等待下一轮重试: ${task.retryCount}/${MAX_RETRIES}`
          );
          message.warning(
            `${task.dramaName} 下载停滞，已重新排队 (重试 ${task.retryCount}/${MAX_RETRIES})`
          );
        }
        return; // 返回，不标记为失败
      }

      // 其他错误或重试次数用尽，标记为失败
      task.status = "error";
      task.error = errorMessage;

      // 更新飞书状态为"下载失败"
      await updateFeishuStatus(task, "下载失败");
      message.error(`${task.dramaName} 下载失败: ${errorMessage}`);
    } else {
      console.log(`[Download] ${task.dramaName} 被用户取消或暂停`);
    }
  } finally {
    // 确保清理定时器
    if (task.stallCheckTimer) {
      clearInterval(task.stallCheckTimer);
      task.stallCheckTimer = null;
    }
  }
}

// 开始下载（支持并行）
async function startDownload() {
  if (!savePath.value) {
    message.warning("请先选择保存路径");
    return;
  }

  if (downloadTasks.value.length === 0) {
    message.warning("请先查询待下载任务");
    return;
  }

  const pendingTasks = downloadTasks.value.filter(
    (t) => t.status === "pending"
  );
  if (pendingTasks.length === 0) {
    message.info("没有待下载的任务");
    return;
  }

  downloading.value = true;
  const concurrency = concurrentDownloads.value;

  try {
    // 使用并行下载队列（共享队列，支持动态添加任务）
    const queue = [...pendingTasks];
    console.log(
      `[Download] 开始并行下载，待下载任务数: ${queue.length}，并发数: ${concurrency}`
    );

    // 工作线程函数
    const worker = async (workerId: number, queue: DownloadTask[]) => {
      console.log(`[Download] Worker ${workerId} 启动`);
      let taskCount = 0;

      while (queue.length > 0) {
        const task = queue.shift();
        if (task) {
          taskCount++;
          console.log(
            `[Download] Worker ${workerId} 开始处理第 ${taskCount} 个任务: ${task.dramaName}，队列剩余: ${queue.length}`
          );

          try {
            await downloadSingleTask(task, queue);
            console.log(
              `[Download] Worker ${workerId} 完成任务: ${task.dramaName}，状态: ${task.status}`
            );
          } catch (error) {
            console.error(
              `[Download] Worker ${workerId} 处理任务 ${task.dramaName} 异常:`,
              error
            );
          }
        }
      }

      console.log(
        `[Download] Worker ${workerId} 完成，共处理 ${taskCount} 个任务`
      );
    };

    // 启动并行工作线程
    const workerCount = Math.min(concurrency, pendingTasks.length);
    const workers: Promise<void>[] = [];

    for (let i = 0; i < workerCount; i++) {
      workers.push(worker(i + 1, queue));
    }

    // 等待所有工作线程完成
    await Promise.all(workers);

    const successCount = downloadTasks.value.filter(
      (t) => t.status === "success"
    ).length;
    const errorCount = downloadTasks.value.filter(
      (t) => t.status === "error"
    ).length;
    console.log(
      `[Download] 所有下载任务完成，成功: ${successCount}，失败: ${errorCount}`
    );

    message.success(`下载完成！成功 ${successCount} 个，失败 ${errorCount} 个`);
  } catch (error) {
    console.error("[Download] 下载过程出错:", error);
  } finally {
    downloading.value = false;
    // 如果自动下载已开启，任务完成后立即查询新任务
    if (autoDownloadEnabled.value) {
      console.log("[Download] 下载完成，立即查询新任务...");
      runAutoDownloadCycle();
    }
  }
}

// 更新飞书状态（带重试机制）
async function updateFeishuStatus(
  task: DownloadTask,
  status: string,
  retryCount = 5
) {
  // 检查 task.id 是否有效
  if (!task.id) {
    console.error("[Download] ✗ 更新飞书状态失败: task.id 为空!");
    console.error("[Download] task 对象:", JSON.stringify(task, null, 2));
    return;
  }

  const appToken = apiConfigStore.config.feishuAppToken;
  // 优先使用任务中保存的 tableId（查询时确定的），否则回退到当前配置
  const tableId =
    task.tableId ||
    darenStore.currentDaren?.feishuDramaStatusTableId ||
    apiConfigStore.config.feishuDramaStatusTableId;

  console.log("[Download] 飞书配置检查:", {
    appToken: appToken ? `${appToken.substring(0, 10)}...` : "未配置",
    taskTableId: task.tableId || "未保存",
    darenTableId: darenStore.currentDaren?.feishuDramaStatusTableId || "未配置",
    adminTableId: apiConfigStore.config.feishuDramaStatusTableId || "未配置",
    finalTableId: tableId || "未配置",
    currentDaren: darenStore.currentDaren?.label || "无",
  });

  if (!appToken || !tableId) {
    console.warn("[Download] 缺少飞书配置，跳过状态更新");
    console.warn("[Download] appToken:", appToken ? "已配置" : "未配置");
    console.warn("[Download] tableId:", tableId || "未配置");
    return;
  }

  // 只更新“当前状态”，不传其他字段（避免字段不存在导致 FieldNameNotFound）
  const fields: Record<string, unknown> = { 当前状态: status };

  console.log(`[Download] 准备更新飞书状态:`, {
    dramaName: task.dramaName,
    recordId: task.id,
    status,
    appToken: `${appToken.substring(0, 10)}...`,
    tableId,
    requestUrl: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${task.id}`,
  });

  const FEISHU_REQUEST_TIMEOUT = 15000; // 15秒超时

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      console.log(
        `[Download] 更新飞书状态: ${task.dramaName} -> ${status} (尝试 ${attempt}/${retryCount})`
      );

      // 给飞书请求加超时控制
      const requestPromise = window.api.feishuRequest(
        `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${task.id}`,
        { fields },
        "PUT"
      ) as Promise<{ code?: number; msg?: string; data?: unknown }>;

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(`飞书请求超时（超过${FEISHU_REQUEST_TIMEOUT / 1000}秒）`)
          );
        }, FEISHU_REQUEST_TIMEOUT);
      });

      const result = await Promise.race([requestPromise, timeoutPromise]);

      // 检查飞书 API 返回的 code
      if (result.code !== 0) {
        console.error(
          `[Download] ✗ 飞书 API 返回错误: code=${result.code}, msg=${result.msg}`
        );
        throw new Error(`飞书 API 错误: ${result.msg || result.code}`);
      }

      console.log(
        `[Download] ✓ 飞书状态更新成功: ${task.dramaName} -> ${status}`,
        result
      );
      return; // 成功则返回
    } catch (error) {
      console.error(
        `[Download] ✗ 更新飞书状态失败 (尝试 ${attempt}/${retryCount}):`,
        error
      );

      if (attempt < retryCount) {
        // 等待一段时间后重试（指数退避，增加延迟时间以应对限流）
        const delay = attempt * 2000; // 2s, 4s, 6s, 8s
        console.log(`[Download] ${delay}ms 后重试...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(`[Download] 飞书状态更新最终失败: ${task.dramaName}`);
        message.warning(`${task.dramaName} 飞书状态更新失败，请手动检查`);
      }
    }
  }
}

// 调度下一次自动下载检查
function scheduleNextDownloadCheck() {
  if (!autoDownloadEnabled.value) return;

  const intervalMs = autoDownloadIntervalMinutes.value * 60 * 1000;
  const next = new Date(Date.now() + intervalMs);
  nextAutoDownloadTime.value = next.toLocaleTimeString();

  console.log(
    `[Download] 调度下一次检查，${autoDownloadIntervalMinutes.value} 分钟后`
  );

  autoDownloadTimeout.value = setTimeout(() => {
    runAutoDownloadCycle();
  }, intervalMs);
}

// 自动下载循环
async function runAutoDownloadCycle() {
  if (!autoDownloadEnabled.value || downloading.value) {
    console.log("[Download] 跳过本次轮询（自动下载已禁用或正在下载中）");
    return;
  }

  console.log("[Download] 开始自动下载循环...");
  lastAutoDownloadTime.value = new Date().toLocaleTimeString();

  // 查询新任务
  const hasNewTasks = await fetchPendingDownloads();

  if (hasNewTasks) {
    // 有新任务，开始下载（下载完成后会自动触发新一轮查询）
    const pendingTasks = downloadTasks.value.filter(
      (t) => t.status === "pending"
    );
    if (pendingTasks.length > 0) {
      console.log(
        `[Download] 找到 ${pendingTasks.length} 个待下载任务，开始下载`
      );
      await startDownload();
      // startDownload 完成后会调用 runAutoDownloadCycle()
    }
  } else {
    // 无新任务，设置定时器等待下一次轮询
    console.log("[Download] 无新任务，等待下一次轮询");
    scheduleNextDownloadCheck();
  }
}

// 自动下载开关
function toggleAutoDownload(enabled: boolean) {
  if (enabled && !savePath.value) {
    message.warning("请先选择保存路径");
    return;
  }

  autoDownloadEnabled.value = enabled;

  if (enabled) {
    console.log(
      `[Download] 开启自动下载，轮询间隔: ${autoDownloadIntervalMinutes.value} 分钟`
    );
    message.success(
      `自动下载已开启，每 ${autoDownloadIntervalMinutes.value} 分钟检查一次`
    );

    // 立即开始第一次循环
    runAutoDownloadCycle();
  } else {
    // 关闭自动下载
    if (autoDownloadTimeout.value) {
      clearTimeout(autoDownloadTimeout.value);
      autoDownloadTimeout.value = null;
    }
    lastAutoDownloadTime.value = "";
    nextAutoDownloadTime.value = "";
    message.info("自动下载已关闭");
  }
}

// 立即触发自动下载（手动刷新）
async function triggerAutoDownloadNow() {
  if (!autoDownloadEnabled.value || loading.value || downloading.value) {
    return;
  }

  message.info("正在刷新...");

  // 取消当前的定时器
  if (autoDownloadTimeout.value) {
    clearTimeout(autoDownloadTimeout.value);
    autoDownloadTimeout.value = null;
  }

  // 立即执行一次循环
  await runAutoDownloadCycle();
}

// 选择保存目录
async function selectSavePath() {
  const path = await window.api.selectFolder();
  if (path) {
    // 规范化路径，确保以斜杠结尾（跨平台兼容）
    savePath.value =
      path.endsWith("/") || path.endsWith("\\") ? path : path + "/";
    console.log("[Download] 选择保存路径:", savePath.value);
  }
}

// 打开本地目录
function openFolder(path: string) {
  window.api.showInFolder(path);
}

// 暂停下载
async function pauseDownload(task: DownloadTask) {
  try {
    console.log("[Download] 暂停下载:", task.dramaName);
    // 先设置状态为 paused，保持进度不变
    task.status = "paused";
    task.speed = 0; // 只重置速度，保持进度

    const result = await window.api.pauseDownload(task.dramaName);
    if (result) {
      // 更新飞书状态为"已暂停下载"
      await updateFeishuStatus(task, "已暂停下载");
      message.info(
        `已暂停下载: ${task.dramaName}，进度 ${task.progress.toFixed(1)}%`
      );
    }
  } catch (error) {
    console.error("[Download] 暂停下载失败:", error);
    message.error("暂停下载失败");
  }
}

// 继续下载（从断点处）
async function resumeDownload(task: DownloadTask) {
  console.log("[Download] 继续下载:", task.dramaName);
  task.status = "downloading";
  task.error = undefined;

  // 更新飞书状态为"下载中"
  await updateFeishuStatus(task, "下载中");
  message.info(`继续下载: ${task.dramaName}`);

  // 使用非阻塞方式启动继续下载
  // 下载结果通过 IPC 事件接收，不在这里等待
  window.api
    .resumeDownload(task.dramaName)
    .then(async (result) => {
      if (result.success) {
        task.progress = 100;

        // 解压 zip 文件
        console.log(`[Download] 开始解压: ${result.filePath}`);
        const extractResult = await window.api.extractZip(
          result.filePath,
          undefined,
          true
        );

        if (extractResult.success) {
          task.status = "success";
          task.localPath = extractResult.extractedPath;
          console.log(
            `[Download] 继续下载完成，准备更新飞书状态: ${task.dramaName}`
          );
          await updateFeishuStatus(task, "待剪辑");
          message.success(`${task.dramaName} 下载并解压成功`);
        } else {
          task.status = "success";
          task.localPath = result.filePath;
          task.error = `解压失败: ${extractResult.error}`;
          console.log(
            `[Download] 继续下载完成（解压失败），准备更新飞书状态: ${task.dramaName}`
          );
          await updateFeishuStatus(task, "待剪辑");
          message.warning(`${task.dramaName} 下载成功，但解压失败`);
        }
      }
    })
    .catch(async (error) => {
      // 检查是否是用户操作导致的中断
      const errorMessage = error instanceof Error ? error.message : "下载失败";
      const isUserAction =
        task.status === "paused" ||
        task.status === "cancelled" ||
        errorMessage.includes("aborted");

      if (!isUserAction) {
        task.status = "error";
        task.error = errorMessage;
        // 更新飞书状态为"下载失败"
        await updateFeishuStatus(task, "下载失败");
        message.error(`${task.dramaName} 下载失败: ${errorMessage}`);
      }
    });
}

// 取消下载
async function cancelDownload(task: DownloadTask) {
  try {
    console.log("[Download] 取消下载:", task.dramaName);
    // 先设置状态为已取消
    task.status = "cancelled";
    task.error = undefined;
    task.speed = 0;
    // 保留进度，方便用户查看取消时的进度

    await window.api.cancelDownload(task.dramaName);

    // 更新飞书状态为"待下载"（恢复原状态）
    await updateFeishuStatus(task, "待下载");
    message.info(`已取消下载: ${task.dramaName}`);
  } catch (error) {
    console.error("[Download] 取消下载失败:", error);
  }
}

// 重试下载
async function retryDownload(task: DownloadTask) {
  console.log("[Download] 重试下载:", task.dramaName);

  // 重置状态
  task.status = "pending";
  task.progress = 0;
  task.speed = 0;
  task.error = undefined;

  // 重新获取下载 URL（可能已过期）
  try {
    task.downloadUrl = await getDownloadUrl(task.imagexUri);
    if (!task.downloadUrl) {
      task.status = "error";
      task.error = "获取下载链接失败";
      message.error(`${task.dramaName}: 获取下载链接失败`);
      return;
    }
  } catch (error) {
    task.status = "error";
    task.error = "获取下载链接失败";
    message.error(`${task.dramaName}: 获取下载链接失败`);
    return;
  }

  task.status = "downloading";

  // 更新飞书状态为"下载中"
  await updateFeishuStatus(task, "下载中");

  // 执行下载
  const fileName = `${task.dramaName}.zip`;
  const normalizedSavePath =
    savePath.value.endsWith("/") || savePath.value.endsWith("\\")
      ? savePath.value
      : savePath.value + "/";
  const fullPath = `${normalizedSavePath}${task.dramaName}/${fileName}`;

  console.log("[Download] 重试下载文件:", {
    dramaName: task.dramaName,
    fullPath: fullPath,
  });

  message.info(`重新下载: ${task.dramaName}`);

  // 使用非阻塞方式启动下载
  window.api
    .downloadVideo(task.downloadUrl, fullPath, task.dramaName)
    .then(async (result) => {
      if (result.success) {
        task.progress = 100;

        // 解压 zip 文件
        console.log(`[Download] 开始解压: ${result.filePath}`);
        const extractResult = await window.api.extractZip(
          result.filePath,
          undefined,
          true
        );

        if (extractResult.success) {
          task.status = "success";
          task.localPath = extractResult.extractedPath;
          console.log(
            `[Download] 重试下载完成，准备更新飞书状态: ${task.dramaName}`
          );
          await updateFeishuStatus(task, "待剪辑");
          message.success(`${task.dramaName} 下载并解压成功`);
        } else {
          task.status = "success";
          task.localPath = result.filePath;
          task.error = `解压失败: ${extractResult.error}`;
          console.log(
            `[Download] 重试下载完成（解压失败），准备更新飞书状态: ${task.dramaName}`
          );
          await updateFeishuStatus(task, "待剪辑");
          message.warning(`${task.dramaName} 下载成功，但解压失败`);
        }
      }
    })
    .catch(async (error) => {
      // 检查是否是用户操作导致的中断
      const errorMessage = error instanceof Error ? error.message : "下载失败";
      const isUserAction =
        task.status === "paused" ||
        task.status === "cancelled" ||
        errorMessage.includes("aborted");

      if (!isUserAction) {
        task.status = "error";
        task.error = errorMessage;
        // 更新飞书状态为"下载失败"
        await updateFeishuStatus(task, "下载失败");
        message.error(`${task.dramaName} 下载失败: ${errorMessage}`);
      }
    });
}

// 监听下载进度
let unsubscribeProgress: (() => void) | null = null;

onMounted(async () => {
  // 加载 API 配置
  if (!apiConfigStore.loaded) {
    await apiConfigStore.loadConfig();
  }

  // 监听下载进度
  unsubscribeProgress = window.api.onDownloadProgress((progress) => {
    const task = downloadTasks.value.find(
      (t) => t.dramaName === progress.dramaName
    );
    if (task) {
      const oldProgress = task.progress;
      task.progress = parseFloat(progress.percent);
      task.totalBytes = progress.totalBytes || task.totalBytes;

      // 如果进度有变化，更新进度时间戳（用于停滞检测）
      if (task.progress !== oldProgress) {
        task.lastProgressUpdate = Date.now();
      }
      // Windows 下可能会出现短时间 speed=0/undefined 导致 UI “闪烁”
      // 这里保持“最近一次非 0 网速”，避免频繁在 “-” 和 数值之间跳变
      if (typeof progress.speed === "number" && progress.speed > 0) {
        task.speed = progress.speed;
      } else if (task.speed == null) {
        task.speed = 0;
      }
    }
  });
});

onUnmounted(() => {
  if (unsubscribeProgress) {
    unsubscribeProgress();
  }
  if (autoDownloadTimeout.value) {
    clearTimeout(autoDownloadTimeout.value);
  }
});

// 表格列
const columns: DataTableColumns<DownloadTask> = [
  {
    title: "剧名",
    key: "dramaName",
    width: 200,
  },
  {
    title: "日期",
    key: "date",
    width: 80,
    render: (row) => (row.date ? dayjs(row.date).format("MM-DD") : "-"),
  },
  {
    title: "上架时间",
    key: "publishTime",
    width: 140,
    render: (row) =>
      row.publishTime ? dayjs(row.publishTime).format("YYYY-MM-DD HH:mm") : "-",
  },
  {
    title: "状态",
    key: "status",
    width: 100,
    render: (row) => {
      const typeMap: Record<
        string,
        "default" | "success" | "error" | "warning" | "info"
      > = {
        pending: "default",
        downloading: "info",
        paused: "warning",
        success: "success",
        error: "error",
        cancelled: "default",
      };
      const textMap: Record<string, string> = {
        pending: "待下载",
        downloading: "下载中",
        paused: "已暂停",
        success: "已完成",
        error: "失败",
        cancelled: "已取消",
      };
      return h(
        NTag,
        { type: typeMap[row.status] },
        { default: () => textMap[row.status] }
      );
    },
  },
  {
    title: "文件大小",
    key: "totalBytes",
    width: 100,
    render: (row) => {
      const bytes = row.totalBytes;
      if (!bytes) return "-";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
      if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
      return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    },
  },
  {
    title: "进度",
    key: "progress",
    width: 180,
    render: (row) => {
      if (row.status === "pending") return "-";
      return h(NProgress, {
        percentage: row.progress,
        indicatorPlacement: "inside",
        processing: row.status === "downloading",
      });
    },
  },
  {
    title: "网速",
    key: "speed",
    width: 100,
    render: (row) => {
      if (row.status !== "downloading") return "-";
      const speed = row.speed;
      if (typeof speed !== "number") return "计算中...";
      if (speed < 1024) {
        return `${speed.toFixed(0)} B/s`;
      } else if (speed < 1024 * 1024) {
        return `${(speed / 1024).toFixed(2)} KB/s`;
      } else {
        return `${(speed / 1024 / 1024).toFixed(2)} MB/s`;
      }
    },
  },
  {
    title: "操作",
    key: "actions",
    width: 150,
    render: (row) => {
      // 下载中：显示暂停和取消按钮
      if (row.status === "downloading") {
        return h(
          NSpace,
          { size: "small" },
          {
            default: () => [
              h(
                NButton,
                {
                  size: "small",
                  type: "warning",
                  onClick: () => pauseDownload(row),
                },
                { default: () => "暂停" }
              ),
              h(
                NButton,
                {
                  size: "small",
                  type: "error",
                  onClick: () => cancelDownload(row),
                },
                { default: () => "取消" }
              ),
            ],
          }
        );
      }
      // 已暂停：显示继续和取消按钮
      if (row.status === "paused") {
        // 如果当前下载数已达到并发上限，禁用"继续"按钮
        const isMaxConcurrency =
          downloadingCount.value >= concurrentDownloads.value;
        return h(
          NSpace,
          { size: "small" },
          {
            default: () => [
              h(
                NButton,
                {
                  size: "small",
                  type: "success",
                  disabled: isMaxConcurrency,
                  onClick: () => resumeDownload(row),
                },
                { default: () => isMaxConcurrency ? "等待空位" : "继续" }
              ),
              h(
                NButton,
                {
                  size: "small",
                  type: "error",
                  onClick: () => cancelDownload(row),
                },
                { default: () => "取消" }
              ),
            ],
          }
        );
      }
      // 失败或已取消：显示重试按钮
      if (row.status === "error" || row.status === "cancelled") {
        return h(
          NButton,
          {
            size: "small",
            type: row.status === "error" ? "warning" : "primary",
            onClick: () => retryDownload(row),
          },
          { default: () => "重新下载" }
        );
      }
      // 成功：显示打开目录按钮
      if (row.status === "success" && row.localPath) {
        return h(
          NButton,
          {
            size: "small",
            onClick: () => openFolder(row.localPath!),
          },
          { default: () => "打开目录" }
        );
      }
      return null;
    },
  },
];
</script>

<template>
  <div class="download-page">
    <div
      style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px"
    >
      <h2 class="page-title" style="margin-bottom: 0">素材下载</h2>
      <NButton text @click="showHelpModal = true" style="padding: 4px">
        <template #icon>
          <NIcon size="20" color="#666">
            <HelpCircleOutline />
          </NIcon>
        </template>
      </NButton>
    </div>

    <!-- 操作栏 -->
    <NCard class="action-card">
      <NSpace align="center" justify="space-between">
        <NSpace align="center">
          <NButton
            type="primary"
            :loading="loading"
            :disabled="hasDownloadingTasks"
            @click="fetchPendingDownloads"
          >
            查询待下载
          </NButton>
          <NButton
            type="success"
            :disabled="
              downloadTasks.length === 0 ||
              loading ||
              !savePath ||
              hasDownloadingTasks
            "
            @click="startDownload"
          >
            {{
              hasDownloadingTasks
                ? `下载中 (${downloadingCount})...`
                : "开始下载"
            }}
          </NButton>
        </NSpace>

        <NSpace align="center">
          <span style="color: #666; font-size: 13px">并行数量</span>
          <NInputNumber
            v-model:value="concurrentDownloads"
            :min="1"
            :max="10"
            :disabled="hasDownloadingTasks"
            style="width: 80px"
            size="small"
          />
          <template v-if="darenStore.canDownload">
            <span style="margin-left: 16px; color: #666; font-size: 13px"
              >间隔(分钟)</span
            >
            <NInputNumber
              v-model:value="autoDownloadIntervalMinutes"
              :min="20"
              :max="720"
              :disabled="autoDownloadEnabled"
              style="width: 90px"
              size="small"
            />
            <span style="margin-left: 16px">自动下载</span>
            <NSwitch
              :value="autoDownloadEnabled"
              :disabled="loading || !savePath"
              @update:value="toggleAutoDownload"
            />
            <NButton
              v-if="autoDownloadEnabled"
              size="small"
              :disabled="loading || downloading"
              :loading="loading"
              style="margin-left: 12px"
              @click="triggerAutoDownloadNow"
            >
              立即刷新
            </NButton>
          </template>
        </NSpace>
      </NSpace>
    </NCard>

    <!-- 保存路径 -->
    <NCard class="path-card">
      <NSpace align="center">
        <span>保存路径：</span>
        <NInput
          v-model:value="savePath"
          placeholder="选择保存目录"
          style="width: 400px"
          :disabled="hasDownloadingTasks"
        />
        <NButton :disabled="hasDownloadingTasks" @click="selectSavePath">
          选择目录
        </NButton>
      </NSpace>
    </NCard>

    <!-- 统计信息 -->
    <NGrid :cols="4" :x-gap="16" :y-gap="16" class="stats-grid">
      <NGi>
        <NCard>
          <NStatistic label="总计" :value="stats.total" />
        </NCard>
      </NGi>
      <NGi>
        <NCard>
          <NStatistic label="已下载" :value="stats.downloaded">
            <template #suffix>
              <NTag type="success" size="small">成功</NTag>
            </template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard>
          <NStatistic label="待下载" :value="stats.pending" />
        </NCard>
      </NGi>
      <NGi>
        <NCard>
          <NStatistic label="失败" :value="stats.failed">
            <template v-if="stats.failed > 0" #suffix>
              <NTag type="error" size="small">需处理</NTag>
            </template>
          </NStatistic>
        </NCard>
      </NGi>
    </NGrid>

    <!-- 自动下载提示 -->
    <NAlert
      v-if="autoDownloadEnabled"
      type="info"
      closable
      class="auto-download-alert"
    >
      <div style="display: flex; align-items: center; gap: 24px">
        <span
          >自动下载已开启，每
          {{ autoDownloadIntervalMinutes }} 分钟检查一次</span
        >
        <span
          v-if="lastAutoDownloadTime && !hasDownloadingTasks"
          style="color: #1890ff"
        >
          上一轮: {{ lastAutoDownloadTime }}
        </span>
        <span
          v-if="nextAutoDownloadTime && !hasDownloadingTasks"
          style="color: #52c41a"
        >
          下一轮: {{ nextAutoDownloadTime }}
        </span>
      </div>
    </NAlert>

    <!-- 下载列表 -->
    <NCard class="table-card">
      <NSpin :show="loading">
        <NDataTable
          v-if="downloadTasks.length > 0"
          :columns="columns"
          :data="downloadTasks"
          :bordered="false"
          :single-line="false"
        />
        <NEmpty v-else description="请先查询待下载任务" />
      </NSpin>
    </NCard>

    <!-- 操作说明弹窗 -->
    <NModal
      v-model:show="showHelpModal"
      preset="card"
      title="素材下载操作说明"
      style="width: 600px"
      :bordered="false"
      :segmented="{ content: true }"
    >
      <div class="help-content">
        <section class="help-section">
          <h3 class="help-title">📥 手动下载</h3>
          <ol class="help-list">
            <li>点击"<strong>选择目录</strong>"按钮，选择素材保存位置</li>
            <li>
              点击"<strong>查询待下载</strong>"按钮，系统会从飞书查询状态为"待下载"的剧集
            </li>
            <li>查询成功后，列表会显示所有可下载的剧集</li>
            <li>点击"<strong>开始下载</strong>"按钮，开始批量下载素材</li>
            <li>下载完成后，系统会自动解压素材包，并更新飞书状态为"待剪辑"</li>
          </ol>
        </section>

        <section class="help-section">
          <h3 class="help-title">⚙️ 下载设置</h3>
          <ul class="help-list">
            <li>
              <strong>并行数量：</strong
              >同时下载的剧集数量（1-10个），建议设置为 3-5
            </li>
            <li>
              <strong>保存路径：</strong
              >下载素材的保存目录，下载的文件会按剧名自动分类
            </li>
          </ul>
        </section>

        <section class="help-section">
          <h3 class="help-title">🔄 自动下载</h3>
          <ol class="help-list">
            <li>设置"<strong>间隔(分钟)</strong>"，建议 20-60 分钟</li>
            <li>打开"<strong>自动下载</strong>"开关</li>
            <li>系统会按设定的间隔自动查询并下载新剧集</li>
            <li>如果当前有任务正在下载，会等待任务完成后再查询新任务</li>
            <li>
              如果查询到新任务，会立即开始下载；如果没有新任务，会等待下一个间隔周期
            </li>
            <li>
              点击"<strong>立即刷新</strong>"按钮可以立即触发一次查询，无需等待
            </li>
          </ol>
        </section>

        <section class="help-section">
          <h3 class="help-title">💡 温馨提示</h3>
          <ul class="help-list">
            <li>下载过程中可以暂停、继续或取消单个任务</li>
            <li>失败的任务可以点击"重新下载"按钮重试</li>
            <li>自动下载开启后，会显示"上一轮"和"下一轮"的查询时间</li>
            <li>下载完成的剧集可以点击"打开目录"按钮查看文件</li>
          </ul>
        </section>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.download-page {
  max-width: 1200px;
  margin: 0 auto;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #333;
  margin-bottom: 20px;
}

.action-card {
  margin-bottom: 16px;
}

.path-card {
  margin-bottom: 16px;
}

.stats-grid {
  margin-bottom: 16px;
}

.auto-download-alert {
  margin-bottom: 16px;
}

.table-card {
  min-height: 400px;
}

/* 帮助弹窗样式 */
.help-content {
  font-size: 14px;
  line-height: 1.8;
  color: #333;
}

.help-section {
  margin-bottom: 24px;
}

.help-section:last-child {
  margin-bottom: 0;
}

.help-title {
  font-size: 16px;
  font-weight: 600;
  color: #1890ff;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.help-list {
  margin: 0;
  padding-left: 24px;
}

.help-list li {
  margin-bottom: 8px;
  color: #666;
}

.help-list li:last-child {
  margin-bottom: 0;
}

.help-list strong {
  color: #333;
  font-weight: 600;
}
</style>
