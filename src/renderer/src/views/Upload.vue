<script setup lang="ts">
defineOptions({ name: "Upload" });
import { ref, computed, onMounted, onUnmounted, h, watch } from "vue";
import {
  NCard,
  NButton,
  NSpace,
  NDatePicker,
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
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NIcon,
  NInputNumber,
  NInput,
  NModal,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { HelpCircleOutline } from "@vicons/ionicons5";
import dayjs from "dayjs";
import { useDarenStore } from "../stores/daren";
import { useAuthStore } from "../stores/auth";
import { useApiConfigStore } from "../stores/apiConfig";

// 视频状态类型
type VideoStatus = "pending" | "uploading" | "success" | "error";

// 剧集状态类型
type DramaStatus = "pending" | "uploading" | "success" | "partial" | "error";

interface VideoMaterial {
  fileName: string;
  filePath: string;
  size: number;
  sizeFormatted: string;
  dramaName: string;
  date: string;
  status: VideoStatus;
  progress?: number;
  error?: string;
  url?: string;
  width?: number;
  height?: number;
  duration?: number;
  retryCount?: number;
  isSubmitted?: boolean;
  lastError?: {
    error: string;
    message: string;
    timestamp: string;
  };
}

interface DramaGroup {
  dramaName: string;
  videos: VideoMaterial[];
  status: DramaStatus;
  expanded: boolean;
}

const message = useMessage();
const darenStore = useDarenStore();
const authStore = useAuthStore();
const apiConfigStore = useApiConfigStore();

// State
const selectedDate = ref<number>(Date.now());
const rootFolder = ref<string>(""); // 上传根目录

// 计算实际扫描路径：根目录 + "日期导出"
const scanFolder = computed(() => {
  if (!rootFolder.value) return "";
  const dateStr = formatDateForPath(selectedDate.value);
  // 根据系统使用正确的路径分隔符
  const sep = rootFolder.value.includes("\\") ? "\\" : "/";
  return `${rootFolder.value}${sep}${dateStr}导出`;
});
const videoMaterials = ref<VideoMaterial[]>([]);
const groupedMaterials = ref<DramaGroup[]>([]);
const loading = ref(false);
const uploading = ref(false);
const autoUploadEnabled = ref(false);
const autoUploadRunning = ref(false);
const autoUploadTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const lastAutoUploadTime = ref<string>("");
const nextAutoUploadTime = ref<string>("");
// 自动上传轮询间隔（分钟）
const autoUploadIntervalMinutes = ref(30);
// 帮助弹窗
const showHelpModal = ref(false);

// 选中状态
const selectedVideos = ref<Set<string>>(new Set());

// 飞书记录映射：剧名 -> recordId/tableId（用于更新“当前状态”）
const feishuRecordMap = ref<
  Record<string, { recordId: string; tableId: string }>
>({});
// 记录已设置为“上传中/待搭建”的剧，避免重复更新
const feishuUploadingSet = ref<Set<string>>(new Set());
const feishuBuiltPendingSet = ref<Set<string>>(new Set());

// 上传进度跟踪
const uploadStartTime = ref<number>(0);
const elapsedTime = ref(0);
const timeInterval = ref<ReturnType<typeof setInterval> | null>(null);

// 统计
const stats = computed(() => {
  const total = videoMaterials.value.length;
  const uploaded = videoMaterials.value.filter(
    (v) => v.status === "success"
  ).length;
  const failed = videoMaterials.value.filter(
    (v) => v.status === "error"
  ).length;
  const pending = videoMaterials.value.filter(
    (v) => v.status === "pending"
  ).length;
  const uploadingCount = videoMaterials.value.filter(
    (v) => v.status === "uploading"
  ).length;

  return { total, uploaded, failed, pending, uploadingCount };
});

// 整体上传进度百分比
const overallProgressPercentage = computed(() => {
  if (stats.value.total === 0) return 0;
  return Math.round((stats.value.uploaded / stats.value.total) * 100);
});

// 检查是否所有上传都完成
const isAllUploadsCompleted = computed(() => {
  return stats.value.total > 0 && stats.value.uploaded >= stats.value.total;
});

// 当前选中的视频数量
const selectedVideoCount = computed(() => {
  return videoMaterials.value.filter((v) =>
    selectedVideos.value.has(v.fileName)
  ).length;
});

// 全选状态
const isAllSelected = computed(() => {
  if (videoMaterials.value.length === 0) return false;
  return videoMaterials.value.every((v) =>
    selectedVideos.value.has(v.fileName)
  );
});

const isIndeterminate = computed(() => {
  if (videoMaterials.value.length === 0) return false;
  const selectedCount = videoMaterials.value.filter((v) =>
    selectedVideos.value.has(v.fileName)
  ).length;
  return selectedCount > 0 && selectedCount < videoMaterials.value.length;
});

// 格式化日期用于目录（如 "1.15"）
function formatDateForPath(timestamp: number): string {
  return dayjs(timestamp).format("M.D");
}

// 生成自动上传的日期列表：昨天、今天、往后3天（共5天）
function getAutoUploadDates(): number[] {
  const dates: number[] = [];
  const today = dayjs().startOf("day");

  // 昨天
  dates.push(today.subtract(1, "day").valueOf());
  // 今天
  dates.push(today.valueOf());
  // 往后3天
  for (let i = 1; i <= 3; i++) {
    dates.push(today.add(i, "day").valueOf());
  }

  return dates;
}

// 根据日期时间戳生成扫描目录路径
function getScanFolderForDate(dateTimestamp: number): string {
  if (!rootFolder.value) return "";
  const dateStr = formatDateForPath(dateTimestamp);
  const sep = rootFolder.value.includes("\\") ? "\\" : "/";
  return `${rootFolder.value}${sep}${dateStr}导出`;
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

// 格式化时间
function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

// 选择上传根目录
async function selectRootFolder() {
  try {
    const folder = await window.api.selectFolder();
    if (folder) {
      rootFolder.value = folder;
      message.success(`已选择上传根目录: ${folder}`);
    }
  } catch (error) {
    console.error("选择上传根目录失败:", error);
    message.error("选择上传根目录失败");
  }
}

// 从飞书查询待上传剧集并扫描
async function scanFromFeishu() {
  if (!rootFolder.value) {
    message.warning("请先选择上传根目录");
    return;
  }

  loading.value = true;
  videoMaterials.value = [];
  groupedMaterials.value = [];
  selectedVideos.value = new Set();
  feishuRecordMap.value = {};
  feishuUploadingSet.value = new Set();
  feishuBuiltPendingSet.value = new Set();

  try {
    // 确保已加载系统配置（获取飞书 appToken / 管理员 tableId）
    if (!apiConfigStore.loaded) {
      await apiConfigStore.loadConfig();
    }

    // 1. 获取当前用户的状态表 ID（达人优先，否则用管理员配置）
    const currentDaren = darenStore.currentDaren;
    const tableId =
      currentDaren?.feishuDramaStatusTableId ||
      apiConfigStore.config.feishuDramaStatusTableId;

    // 2. 查询飞书待上传剧集
    const response = await window.api.feishuGetPendingUpload(tableId);

    if (
      !response.data ||
      !response.data.items ||
      !response.data.items.length === 0
    ) {
      message.info("飞书表中暂无待上传的剧集");
      return;
    }

    // 3. 提取剧名列表 + 缓存 record_id（后续用于更新状态）
    const pendingDramas = new Set<string>();
    response.data.items.forEach(
      (item: { fields: Record<string, unknown>; record_id?: string }) => {
        const dramaName = extractTextFromField(item.fields["剧名"]);
        if (dramaName) {
          pendingDramas.add(dramaName);
          if (item.record_id && tableId) {
            feishuRecordMap.value[dramaName] = {
              recordId: item.record_id,
              tableId,
            };
          }
        }
      }
    );

    if (pendingDramas.size === 0) {
      message.info("未找到有效的剧名");
      return;
    }

    // 4. 扫描文件夹（使用拼接后的日期目录）
    const materials = await window.api.scanVideos(scanFolder.value);

    if (materials.length === 0) {
      message.info("文件夹中未找到视频文件");
      return;
    }

    // 5. 过滤出待上传剧集的视频
    const date = formatDateForPath(selectedDate.value);
    const filteredMaterials = materials.filter((m) =>
      pendingDramas.has(m.dramaName)
    );

    if (filteredMaterials.length === 0) {
      message.info(
        `找到 ${materials.length} 个视频，但没有匹配飞书表中待上传的剧集`
      );
      return;
    }

    videoMaterials.value = filteredMaterials.map((m) => ({
      ...m,
      sizeFormatted: formatSize(m.size),
      date,
      status: "pending" as VideoStatus,
      progress: 0,
    }));

    // 按剧名分组
    updateGroupedMaterials();

    // 默认全选
    videoMaterials.value.forEach((v) => selectedVideos.value.add(v.fileName));

    message.success(
      `找到 ${filteredMaterials.length} 个待上传视频（共 ${pendingDramas.size} 个剧集）`
    );
  } catch (error) {
    message.error("查询飞书待上传剧集失败");
    console.error(error);
  } finally {
    loading.value = false;
  }
}

// 更新飞书“当前状态”（只更新字段：当前状态）
async function updateFeishuDramaStatus(
  dramaName: string,
  status: string,
  remark?: string
) {
  try {
    if (!apiConfigStore.loaded) {
      await apiConfigStore.loadConfig();
    }

    const appToken = apiConfigStore.config.feishuAppToken;
    const mapping = feishuRecordMap.value[dramaName];
    const tableId =
      mapping?.tableId ||
      darenStore.currentDaren?.feishuDramaStatusTableId ||
      apiConfigStore.config.feishuDramaStatusTableId;
    const recordId = mapping?.recordId;

    if (!appToken || !tableId || !recordId) {
      console.warn("[Upload] 缺少飞书更新所需信息，跳过状态更新:", {
        dramaName,
        status,
        appToken: appToken ? `${appToken.substring(0, 10)}...` : "未配置",
        tableId: tableId || "未配置",
        recordId: recordId || "未缓存",
      });
      return;
    }

    console.log("[Upload] 更新飞书状态:", {
      dramaName,
      status,
      remark: remark || "(无备注)",
      tableId,
      recordId,
    });

    // 构建更新字段
    const fields: Record<string, string> = { 当前状态: status };
    if (remark !== undefined) {
      fields["备注"] = remark;
    }

    const result = (await window.api.feishuRequest(
      `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      { fields },
      "PUT"
    )) as { code?: number; msg?: string };

    if (result.code !== 0) {
      throw new Error(result.msg || `飞书更新失败: ${result.code}`);
    }
  } catch (error) {
    console.error("[Upload] 更新飞书状态失败:", error);
  }
}

// 扫描视频文件（手动扫描）
async function scanVideos() {
  if (!rootFolder.value) {
    message.warning("请先选择上传根目录");
    return;
  }

  loading.value = true;
  videoMaterials.value = [];
  groupedMaterials.value = [];
  selectedVideos.value = new Set();

  try {
    // 使用拼接后的日期目录扫描
    const materials = await window.api.scanVideos(scanFolder.value);

    if (materials.length === 0) {
      message.info("未找到视频文件");
      return;
    }

    const date = formatDateForPath(selectedDate.value);
    videoMaterials.value = materials.map((m) => ({
      ...m,
      sizeFormatted: formatSize(m.size),
      date,
      status: "pending" as VideoStatus,
      progress: 0,
    }));

    // 按剧名分组
    updateGroupedMaterials();

    // 默认全选
    videoMaterials.value.forEach((v) => selectedVideos.value.add(v.fileName));

    message.success(`找到 ${materials.length} 个视频文件`);
  } catch (error) {
    message.error("扫描视频文件失败");
    console.error(error);
  } finally {
    loading.value = false;
  }
}

// 从飞书字段提取文本
function extractTextFromField(field: unknown): string {
  if (!field) return "";
  if (Array.isArray(field)) {
    return field[0]?.text || "";
  }
  return String(field);
}

// 更新分组
function updateGroupedMaterials() {
  const groups = new Map<string, VideoMaterial[]>();

  for (const video of videoMaterials.value) {
    if (!groups.has(video.dramaName)) {
      groups.set(video.dramaName, []);
    }
    groups.get(video.dramaName)!.push(video);
  }

  groupedMaterials.value = Array.from(groups.entries()).map(
    ([dramaName, videos]) => {
      const allSuccess = videos.every((v) => v.status === "success");
      const allError = videos.every((v) => v.status === "error");
      const hasUploading = videos.some((v) => v.status === "uploading");
      const hasSuccess = videos.some((v) => v.status === "success");

      let status: DramaStatus = "pending";
      if (allSuccess) status = "success";
      else if (allError) status = "error";
      else if (hasUploading) status = "uploading";
      else if (hasSuccess) status = "partial";

      return {
        dramaName,
        videos,
        status,
        expanded: false,
      };
    }
  );
}

// 开始上传
async function startUpload() {
  if (videoMaterials.value.length === 0) {
    message.warning("请先扫描视频文件");
    return;
  }

  const selectedFiles = videoMaterials.value.filter(
    (v) => selectedVideos.value.has(v.fileName) && v.status === "pending"
  );

  if (selectedFiles.length === 0) {
    message.warning("没有可上传的文件");
    return;
  }

  uploading.value = true;
  uploadStartTime.value = Date.now();
  startTimeTracking();

  try {
    // 初始化 TOS 客户端
    await window.api.tosInitClient();

    // 获取文件路径列表
    const filePaths = selectedFiles.map((v) => v.filePath);

    // 开始批量上传
    await window.api.tosUploadBatch(filePaths, 5);
  } catch (error) {
    message.error("上传过程出错");
    console.error(error);
  }
}

// 开始时间跟踪
function startTimeTracking() {
  if (timeInterval.value) {
    clearInterval(timeInterval.value);
  }
  timeInterval.value = setInterval(() => {
    elapsedTime.value = Date.now() - uploadStartTime.value;
  }, 1000);
}

// 停止时间跟踪
function stopTimeTracking() {
  if (timeInterval.value) {
    clearInterval(timeInterval.value);
    timeInterval.value = null;
  }
}

// 取消上传
function cancelUpload() {
  window.api.tosCancelAllUploads();
  uploading.value = false;
  stopTimeTracking();

  // 重置上传中的视频状态
  videoMaterials.value.forEach((v) => {
    if (v.status === "uploading") {
      v.status = "pending";
      v.progress = 0;
    }
  });
  updateGroupedMaterials();

  message.info("上传已取消");
}

// 提交到素材库
async function submitToMaterialLibrary() {
  const successVideos = videoMaterials.value.filter(
    (v) => v.status === "success" && v.url && !v.isSubmitted
  );

  if (successVideos.length === 0) {
    message.info("没有需要提交的素材");
    return;
  }

  try {
    // 获取视频信息并准备素材数据
    const materials = await Promise.all(
      successVideos.map(async (v) => {
        // 获取视频详细信息
        let videoInfo = { width: 1280, height: 720, duration: 60 };
        try {
          videoInfo = await window.api.getVideoInfo(v.filePath);
        } catch (e) {
          console.warn("获取视频信息失败，使用默认值");
        }

        return {
          name: v.fileName,
          url: v.url!,
          type: 0,
          width: videoInfo.width,
          height: videoInfo.height,
          duration: Math.round(videoInfo.duration),
          size: Math.ceil((v.size / 1024 / 1024) * 1000), // MB * 1000
        };
      })
    );

    await window.api.submitMaterial(materials);

    // 标记为已提交
    successVideos.forEach((v) => {
      v.isSubmitted = true;
    });

    message.success(`成功提交 ${materials.length} 个素材到素材库`);
  } catch (error) {
    message.error("素材库提交失败");
    console.error(error);
  }
}

// 选择相关方法
function toggleVideoSelection(fileName: string) {
  if (selectedVideos.value.has(fileName)) {
    selectedVideos.value.delete(fileName);
  } else {
    selectedVideos.value.add(fileName);
  }
}

function toggleDramaSelection(dramaName: string) {
  const group = groupedMaterials.value.find((g) => g.dramaName === dramaName);
  if (!group) return;

  const allSelected = group.videos.every((v) =>
    selectedVideos.value.has(v.fileName)
  );

  if (allSelected) {
    group.videos.forEach((v) => selectedVideos.value.delete(v.fileName));
  } else {
    group.videos.forEach((v) => selectedVideos.value.add(v.fileName));
  }
}

function toggleAllSelection() {
  if (isAllSelected.value) {
    selectedVideos.value.clear();
  } else {
    videoMaterials.value.forEach((v) => selectedVideos.value.add(v.fileName));
  }
}

function isDramaSelected(dramaName: string): boolean {
  const group = groupedMaterials.value.find((g) => g.dramaName === dramaName);
  if (!group || group.videos.length === 0) return false;
  return group.videos.every((v) => selectedVideos.value.has(v.fileName));
}

function isDramaIndeterminate(dramaName: string): boolean {
  const group = groupedMaterials.value.find((g) => g.dramaName === dramaName);
  if (!group || group.videos.length === 0) return false;
  const selectedCount = group.videos.filter((v) =>
    selectedVideos.value.has(v.fileName)
  ).length;
  return selectedCount > 0 && selectedCount < group.videos.length;
}

// 获取剧集状态标签类型
function getDramaStatusType(
  status: DramaStatus
): "default" | "success" | "error" | "warning" | "info" {
  const typeMap: Record<
    DramaStatus,
    "default" | "success" | "error" | "warning" | "info"
  > = {
    pending: "default",
    uploading: "info",
    success: "success",
    partial: "warning",
    error: "error",
  };
  return typeMap[status];
}

function getDramaStatusText(status: DramaStatus): string {
  const textMap: Record<DramaStatus, string> = {
    pending: "待上传",
    uploading: "上传中",
    success: "已完成",
    partial: "部分完成",
    error: "失败",
  };
  return textMap[status];
}

// 获取视频状态样式
function getVideoStatusClass(status: VideoStatus): string {
  const classMap: Record<VideoStatus, string> = {
    pending: "status-pending",
    uploading: "status-uploading",
    success: "status-success",
    error: "status-error",
  };
  return classMap[status];
}

function getVideoStatusText(status: VideoStatus): string {
  const textMap: Record<VideoStatus, string> = {
    pending: "待上传",
    uploading: "上传中",
    success: "已完成",
    error: "失败",
  };
  return textMap[status];
}

// 获取剧集完成视频数
function getDramaCompletedCount(group: DramaGroup): number {
  return group.videos.filter((v) => v.status === "success").length;
}

// 获取剧集总大小
function getDramaTotalSize(videos: VideoMaterial[]): string {
  const totalBytes = videos.reduce((sum, v) => sum + v.size, 0);
  return formatSize(totalBytes);
}

// 重新上传失败的视频
async function retryUpload(video: VideoMaterial) {
  video.status = "pending";
  video.progress = 0;
  video.error = undefined;
  video.retryCount = (video.retryCount || 0) + 1;

  try {
    await window.api.tosUploadFile(video.filePath);
  } catch (error) {
    console.error("重新上传失败:", error);
  }
}

// 调度下一次自动上传检查
function scheduleNextUploadCheck() {
  if (!autoUploadEnabled.value) return;

  const intervalMs = autoUploadIntervalMinutes.value * 60 * 1000;
  const next = new Date(Date.now() + intervalMs);
  nextAutoUploadTime.value = next.toLocaleTimeString();

  console.log(
    `[AutoUpload] 调度下一次检查，${autoUploadIntervalMinutes.value} 分钟后`
  );

  autoUploadTimeout.value = setTimeout(() => {
    runAutoUploadCycle().then((hasNewTasks) => {
      if (!hasNewTasks) {
        // 无新任务，继续调度
        scheduleNextUploadCheck();
      }
      // 有新任务会开始上传，上传完成后会自动触发新一轮查询
    });
  }, intervalMs);
}

// 切换自动上传
function toggleAutoUpload(enabled: boolean) {
  autoUploadEnabled.value = enabled;

  if (enabled) {
    console.log(
      `[AutoUpload] 开启自动上传，轮询间隔: ${autoUploadIntervalMinutes.value} 分钟`
    );
    message.info(
      `自动上传已开启，每 ${autoUploadIntervalMinutes.value} 分钟检查一次`
    );

    // 立即开始第一次循环
    runAutoUploadCycle().then((hasNewTasks) => {
      if (!hasNewTasks) {
        // 无新任务，调度下一次检查
        scheduleNextUploadCheck();
      }
      // 有新任务会开始上传，上传完成后会自动触发新一轮查询
    });
  } else {
    stopAutoUploadTimer();
  }
}

// 立即触发自动上传（手动刷新）
async function triggerAutoUploadNow() {
  if (!autoUploadEnabled.value || autoUploadRunning.value || uploading.value) {
    return;
  }

  message.info("正在刷新...");

  // 取消当前的定时器
  if (autoUploadTimeout.value) {
    clearTimeout(autoUploadTimeout.value);
    autoUploadTimeout.value = null;
  }

  // 立即执行一次循环
  const hasNewTasks = await runAutoUploadCycle();

  if (!hasNewTasks) {
    // 无新任务，调度下一次检查
    scheduleNextUploadCheck();
  }
  // 有新任务会开始上传，上传完成后会自动触发新一轮查询
}

// 停止自动上传定时器
function stopAutoUploadTimer() {
  if (autoUploadTimeout.value) {
    clearTimeout(autoUploadTimeout.value);
    autoUploadTimeout.value = null;
  }
  autoUploadRunning.value = false;
  lastAutoUploadTime.value = "";
  nextAutoUploadTime.value = "";
  message.info("自动上传已关闭");
}

// 运行自动上传循环（多日期扫描）
async function runAutoUploadCycle(): Promise<boolean> {
  if (
    !autoUploadEnabled.value ||
    autoUploadRunning.value ||
    uploading.value ||
    !rootFolder.value
  ) {
    console.log("[AutoUpload] 跳过本次轮询（条件不满足或正在上传中）");
    return false;
  }

  autoUploadRunning.value = true;
  const now = new Date();
  lastAutoUploadTime.value = now.toLocaleTimeString();

  try {
    // 确保已加载系统配置
    if (!apiConfigStore.loaded) {
      await apiConfigStore.loadConfig();
    }

    // 获取当前用户的状态表 ID
    const currentDaren = darenStore.currentDaren;
    const tableId =
      currentDaren?.feishuDramaStatusTableId ||
      apiConfigStore.config.feishuDramaStatusTableId;

    // 获取需要检查的日期列表
    const datesToCheck = getAutoUploadDates();
    console.log(
      "[AutoUpload] 检查日期列表:",
      datesToCheck.map((d) => formatDateForPath(d))
    );

    // 临时存储新找到的任务
    const newMaterials: Array<{
      fileName: string;
      filePath: string;
      size: number;
      sizeFormatted: string;
      dramaName: string;
      date: string;
      status: VideoStatus;
      progress: number;
    }> = [];
    const newFeishuRecordMap: Record<
      string,
      { recordId: string; tableId: string }
    > = {};

    let totalFoundVideos = 0;

    // 遍历每个日期
    for (const dateTimestamp of datesToCheck) {
      const dateStr = formatDateForPath(dateTimestamp);
      console.log(`[AutoUpload] 正在检查日期: ${dateStr}`);

      try {
        // 查询该日期的待上传剧集
        const response = await window.api.feishuGetPendingUploadByDate(
          tableId,
          dateTimestamp
        );

        if (
          !response.data ||
          !response.data.items ||
          response.data.items.length === 0
        ) {
          console.log(`[AutoUpload] ${dateStr} 无待上传剧集`);
          continue;
        }

        // 提取剧名列表
        const pendingDramas = new Set<string>();
        response.data.items.forEach(
          (item: { fields: Record<string, unknown>; record_id?: string }) => {
            const dramaName = extractTextFromField(item.fields["剧名"]);
            if (dramaName) {
              pendingDramas.add(dramaName);
              if (item.record_id && tableId) {
                newFeishuRecordMap[dramaName] = {
                  recordId: item.record_id,
                  tableId,
                };
              }
            }
          }
        );

        if (pendingDramas.size === 0) {
          console.log(`[AutoUpload] ${dateStr} 未找到有效剧名`);
          continue;
        }

        console.log(
          `[AutoUpload] ${dateStr} 找到 ${pendingDramas.size} 个待上传剧集:`,
          Array.from(pendingDramas)
        );

        // 扫描该日期的本地目录
        const scanPath = getScanFolderForDate(dateTimestamp);
        console.log(`[AutoUpload] 扫描目录: ${scanPath}`);

        let materials: Array<{
          fileName: string;
          filePath: string;
          size: number;
          dramaName: string;
        }> = [];
        try {
          materials = await window.api.scanVideos(scanPath);
        } catch (scanError) {
          console.log(`[AutoUpload] 目录 ${scanPath} 不存在或无法访问`);
          continue;
        }

        if (materials.length === 0) {
          console.log(`[AutoUpload] ${dateStr} 目录中无视频文件`);
          continue;
        }

        // 过滤出待上传剧集的视频
        const filteredMaterials = materials.filter((m) =>
          pendingDramas.has(m.dramaName)
        );

        if (filteredMaterials.length === 0) {
          console.log(`[AutoUpload] ${dateStr} 无匹配的待上传视频`);
          continue;
        }

        console.log(
          `[AutoUpload] ${dateStr} 找到 ${filteredMaterials.length} 个待上传视频`
        );

        // 添加到临时列表
        const materialsForDate = filteredMaterials.map((m) => ({
          ...m,
          sizeFormatted: formatSize(m.size),
          date: dateStr,
          status: "pending" as VideoStatus,
          progress: 0,
        }));

        newMaterials.push(...materialsForDate);
        totalFoundVideos += materialsForDate.length;
      } catch (dateError) {
        console.error(`[AutoUpload] 处理日期 ${dateStr} 失败:`, dateError);
      }
    }

    if (totalFoundVideos > 0) {
      console.log(`[AutoUpload] 共找到 ${totalFoundVideos} 个待上传视频`);

      // 清空旧数据并更新为新任务
      videoMaterials.value = newMaterials;
      groupedMaterials.value = [];
      selectedVideos.value = new Set();
      feishuRecordMap.value = newFeishuRecordMap;
      feishuUploadingSet.value = new Set();
      feishuBuiltPendingSet.value = new Set();

      // 全选新添加的视频
      newMaterials.forEach((v) => selectedVideos.value.add(v.fileName));

      // 更新分组
      updateGroupedMaterials();

      // 开始上传
      await startUpload();

      return true;
    } else {
      console.log("[AutoUpload] 所有日期都无待上传素材");
      return false;
    }
  } catch (error) {
    console.error("[AutoUpload] 自动上传循环失败:", error);
    return false;
  } finally {
    autoUploadRunning.value = false;
  }
}

// 监听上传进度
let unsubscribeProgress: (() => void) | null = null;
let unsubscribeComplete: (() => void) | null = null;

onMounted(() => {
  // 监听上传进度
  unsubscribeProgress = window.api.onTosUploadProgress((progress) => {
    const video = videoMaterials.value.find(
      (v) => v.fileName === progress.fileName
    );
    if (video) {
      video.status = progress.status as VideoStatus;
      video.progress = progress.percent;
      if (progress.error) {
        video.error = progress.error;
      }

      // 当视频真正进入 uploading 状态时，更新对应剧集的飞书状态为“上传中”（每个剧只更新一次）
      if (progress.status === "uploading") {
        const dramaName = video.dramaName;
        if (!feishuUploadingSet.value.has(dramaName)) {
          feishuUploadingSet.value.add(dramaName);
          void updateFeishuDramaStatus(dramaName, "上传中");
        }
      }

      updateGroupedMaterials();
    }
  });

  // 监听上传完成
  unsubscribeComplete = window.api.onTosUploadComplete((result) => {
    const video = videoMaterials.value.find(
      (v) => v.fileName === result.fileName
    );
    if (video) {
      if (result.success) {
        video.status = "success";
        video.progress = 100;
        video.url = result.url;
      } else {
        video.status = "error";
        video.error = result.error;
      }
      updateGroupedMaterials();

      // 单剧集维度：检查该剧集的所有视频是否都已完成（成功或失败）
      const dramaName = video.dramaName;
      const selectedDramaVideos = videoMaterials.value.filter(
        (v) => v.dramaName === dramaName && selectedVideos.value.has(v.fileName)
      );

      // 检查是否所有视频都已完成（成功或最终失败，不包括上传中）
      const dramaAllCompleted =
        selectedDramaVideos.length > 0 &&
        selectedDramaVideos.every((v) => v.status === "success" || v.status === "error");

      if (dramaAllCompleted && !feishuBuiltPendingSet.value.has(dramaName)) {
        // 统计失败数量
        const failedVideos = selectedDramaVideos.filter((v) => v.status === "error");
        const failCount = failedVideos.length;
        const successVideos = selectedDramaVideos.filter((v) => v.status === "success");

        feishuBuiltPendingSet.value.add(dramaName);

        // 异步处理：检查结果 → 提交素材库（带重试）→ 更新飞书 → 删除目录
        (async () => {
          try {
            // 如果失败数量 > 2，标记为失败
            if (failCount > 2) {
              console.error(
                `[Upload] 剧《${dramaName}》上传失败，${failCount} 个视频失败，超过阈值`
              );

              // 更新飞书状态为"上传失败"
              await updateFeishuDramaStatus(
                dramaName,
                "上传失败",
                `有 ${failCount} 个视频上传失败`
              );

              message.error(
                `剧《${dramaName}》有 ${failCount} 个视频上传失败，已标记为上传失败`
              );

              // 从已处理集合中移除，以便下次可以重新上传
              feishuBuiltPendingSet.value.delete(dramaName);
              return;
            }

            // 失败数量 ≤ 2，判定为成功，继续提交素材库
            console.log(
              `[Upload] 剧《${dramaName}》上传完成（${successVideos.length} 成功，${failCount} 失败），开始获取视频信息并提交到素材库`
            );

            // 获取该剧的本地素材目录
            const dramaVideo = selectedDramaVideos[0];
            const dramaFolderPath = dramaVideo?.filePath
              ? dramaVideo.filePath.substring(
                  0,
                  dramaVideo.filePath.lastIndexOf(
                    dramaVideo.filePath.includes("\\") ? "\\" : "/"
                  )
                )
              : null;

            // 1. 只获取成功上传的视频信息（跳过失败的视频）
            // 使用 for...of 循环而不是 Promise.all，避免单个失败导致整体失败
            const materials: any[] = [];
            for (const v of successVideos) {
              try {
                const videoInfo = await window.api.getVideoInfo(v.filePath);
                materials.push({
                  name: v.fileName,
                  url: v.url!,
                  type: 0,
                  width: videoInfo.width,
                  height: videoInfo.height,
                  duration: Math.round(videoInfo.duration),
                  size: Math.ceil((v.size / 1024 / 1024) * 1000),
                });
              } catch (e) {
                console.error(`获取视频信息失败: ${v.fileName}`, e);
                // 跳过这个视频，继续处理其他视频
                continue;
              }
            }

            // 检查是否还有有效的素材可以提交
            if (materials.length === 0) {
              throw new Error('没有可用的视频素材提交');
            }

            // 2. 提交到素材库（带重试机制，最多3次）
            const maxRetry = 3;
            let submitSuccess = false;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= maxRetry; attempt++) {
              try {
                console.log(
                  `[Upload] 剧《${dramaName}》提交素材库，第 ${attempt}/${maxRetry} 次尝试`
                );
                await window.api.submitMaterial(materials);
                submitSuccess = true;
                console.log(`[Upload] ✓ 剧《${dramaName}》素材库提交成功`);
                break;
              } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.error(
                  `[Upload] 剧《${dramaName}》素材库提交失败 (${attempt}/${maxRetry}):`,
                  lastError.message
                );
                if (attempt < maxRetry) {
                  // 等待2秒后重试
                  await new Promise((resolve) => setTimeout(resolve, 2000));
                }
              }
            }

            if (submitSuccess) {
              // 提交成功：只标记成功的视频为已提交
              successVideos.forEach((v) => {
                v.isSubmitted = true;
              });

              // 3. 更新飞书状态为"待搭建"
              console.log(`[Upload] 剧《${dramaName}》更新飞书状态为"待搭建"`);
              await updateFeishuDramaStatus(dramaName, "待搭建");

              // 如果有失败的视频，在备注中说明
              if (failCount > 0) {
                await updateFeishuDramaStatus(
                  dramaName,
                  "待搭建",
                  `有 ${failCount} 个视频上传失败，已提交成功视频`
                );
              }

              // 4. 删除本地目录（只要剧集成功，就删除目录）
              if (dramaFolderPath) {
                console.log(`[Upload] 剧《${dramaName}》开始删除本地目录`);
                const deleteResult = await window.api.deleteFolder(dramaFolderPath);
                if (deleteResult.success) {
                  console.log(`[Upload] ✓ 成功删除目录: ${dramaFolderPath}`);
                  const msg = failCount > 0
                    ? `剧《${dramaName}》已完成（${successVideos.length} 成功，${failCount} 失败），本地素材已清理`
                    : `剧《${dramaName}》已完成，本地素材已清理`;
                  message.success(msg);
                } else {
                  console.error(
                    `[Upload] ✗ 删除目录失败: ${dramaFolderPath}`,
                    deleteResult.error
                  );
                  const msg = failCount > 0
                    ? `剧《${dramaName}》已完成（${successVideos.length} 成功，${failCount} 失败），但本地素材清理失败`
                    : `剧《${dramaName}》已完成，但本地素材清理失败`;
                  message.warning(msg);
                }
              } else {
                const msg = failCount > 0
                  ? `剧《${dramaName}》已完成（${successVideos.length} 成功，${failCount} 失败）`
                  : `剧《${dramaName}》已完成`;
                message.success(msg);
              }
            } else {
              // 提交失败：更新飞书状态为"上传失败"，备注说明原因，不删除本地素材
              console.error(
                `[Upload] ✗ 剧《${dramaName}》素材库提交失败，${maxRetry}次重试均失败`
              );
              message.error(
                `剧《${dramaName}》素材库提交失败，已标记为上传失败，请重新上传`
              );

              // 更新飞书状态为"上传失败"，并添加备注
              await updateFeishuDramaStatus(
                dramaName,
                "上传失败",
                "提交到素材库失败，请重新上传"
              );

              // 从已处理集合中移除，以便下次可以重新上传
              feishuBuiltPendingSet.value.delete(dramaName);
            }
          } catch (error) {
            // 捕获所有未处理的异常
            console.error(`[Upload] 剧《${dramaName}》处理过程中发生错误:`, error);
            message.error(`剧《${dramaName}》处理失败: ${error instanceof Error ? error.message : String(error)}`);

            // 更新飞书状态为"上传失败"
            try {
              await updateFeishuDramaStatus(
                dramaName,
                "上传失败",
                `处理失败: ${error instanceof Error ? error.message : String(error)}`
              );
            } catch (feishuError) {
              console.error(`[Upload] 更新飞书状态失败:`, feishuError);
            }

            // 从已处理集合中移除，以便下次可以重新上传
            feishuBuiltPendingSet.value.delete(dramaName);
          }
        })();
      }

      // 检查是否所有文件都上传完成
      const allDone = videoMaterials.value
        .filter((v) => selectedVideos.value.has(v.fileName))
        .every((v) => v.status === "success" || v.status === "error");

      if (allDone) {
        uploading.value = false;
        stopTimeTracking();

        const successCount = videoMaterials.value.filter(
          (v) => v.status === "success"
        ).length;
        const failCount = videoMaterials.value.filter(
          (v) => v.status === "error"
        ).length;

        if (failCount > 0) {
          message.warning(`上传完成，${successCount} 成功，${failCount} 失败`);
        } else {
          message.success(`上传完成，${successCount} 个文件全部成功`);
        }

        // 注意：每部剧上传完成后已自动提交到素材库并删除目录
        // 这里不需要再次调用 submitToMaterialLibrary()

        // 如果自动上传已开启，上传完成后立即查询新任务
        if (autoUploadEnabled.value) {
          console.log("[AutoUpload] 上传完成，立即查询新任务...");
          runAutoUploadCycle().then((hasNewTasks) => {
            if (!hasNewTasks) {
              // 无新任务，调度下一次检查
              scheduleNextUploadCheck();
            }
            // 有新任务会自动开始上传
          });
        }
      }
    }
  });
});

onUnmounted(() => {
  if (unsubscribeProgress) {
    unsubscribeProgress();
  }
  if (unsubscribeComplete) {
    unsubscribeComplete();
  }
  if (autoUploadTimeout.value) {
    clearTimeout(autoUploadTimeout.value);
  }
  stopTimeTracking();
});
</script>

<template>
  <div class="upload-page">
    <div
      style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px"
    >
      <h2 class="page-title" style="margin-bottom: 0">素材上传</h2>
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
          <NDatePicker
            v-model:value="selectedDate"
            type="date"
            :disabled="uploading"
            style="width: 150px"
          />
          <NButton
            :loading="loading"
            :disabled="uploading || !rootFolder"
            @click="scanVideos"
          >
            扫描全部
          </NButton>
          <NButton
            type="primary"
            :loading="loading"
            :disabled="uploading || !rootFolder"
            @click="scanFromFeishu"
          >
            扫描待上传
          </NButton>
          <NButton
            type="success"
            :disabled="
              uploading ||
              videoMaterials.length === 0 ||
              loading ||
              selectedVideoCount === 0
            "
            @click="startUpload"
          >
            {{ uploading ? "上传中..." : `开始上传 (${selectedVideoCount})` }}
          </NButton>
          <NButton v-if="uploading" type="error" @click="cancelUpload">
            取消上传
          </NButton>
        </NSpace>

        <NSpace align="center">
          <template v-if="darenStore.canUpload">
            <span style="color: #666; font-size: 13px">间隔(分钟)</span>
            <NInputNumber
              v-model:value="autoUploadIntervalMinutes"
              :min="20"
              :max="720"
              :disabled="autoUploadEnabled"
              style="width: 80px"
              size="small"
            />
            <span style="margin-left: 16px">自动上传</span>
            <NSwitch
              :value="autoUploadEnabled"
              :disabled="loading || !rootFolder"
              @update:value="toggleAutoUpload"
            />
            <NButton
              v-if="autoUploadEnabled"
              size="small"
              :disabled="autoUploadRunning || uploading"
              :loading="autoUploadRunning"
              style="margin-left: 12px"
              @click="triggerAutoUploadNow"
            >
              立即刷新
            </NButton>
          </template>
        </NSpace>
      </NSpace>
    </NCard>

    <!-- 根目录选择 -->
    <NCard class="path-card">
      <NSpace align="center">
        <span>上传根目录：</span>
        <NInput
          v-model:value="rootFolder"
          placeholder="选择上传根目录"
          style="width: 300px"
          :disabled="uploading"
          readonly
        />
        <NButton :disabled="uploading || loading" @click="selectRootFolder">
          选择目录
        </NButton>
        <span style="color: #999; margin: 0 8px">→</span>
        <span style="color: #1890ff; font-weight: 500">{{
          scanFolder || "扫描目录"
        }}</span>
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
          <NStatistic label="已上传" :value="stats.uploaded">
            <template #suffix>
              <NTag type="success" size="small">成功</NTag>
            </template>
          </NStatistic>
        </NCard>
      </NGi>
      <NGi>
        <NCard>
          <NStatistic label="待上传" :value="stats.pending" />
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

    <!-- 上传进度 -->
    <NCard v-if="uploading || stats.uploaded > 0" class="progress-card">
      <div class="progress-header">
        <div class="progress-title">
          <span class="progress-label">上传进度</span>
        </div>
        <div class="progress-stats">
          <span class="progress-count"
            >{{ stats.uploaded }}/{{ stats.total }}</span
          >
          <span class="progress-percentage"
            >{{ overallProgressPercentage }}%</span
          >
        </div>
      </div>
      <NProgress
        :percentage="overallProgressPercentage"
        :processing="uploading"
        indicator-placement="inside"
      />
      <div v-if="uploading" class="upload-status-info">
        <div class="status-indicator">
          <div class="pulse-dot"></div>
          <span class="status-text">
            正在上传 ({{ formatElapsedTime(elapsedTime) }})
          </span>
        </div>
      </div>
      <div
        v-else-if="isAllUploadsCompleted"
        class="upload-status-info completed"
      >
        <span class="status-text"
          >上传完成！耗时 {{ formatElapsedTime(elapsedTime) }}</span
        >
      </div>
    </NCard>

    <!-- 自动上传提示 -->
    <NAlert
      v-if="autoUploadEnabled"
      type="info"
      closable
      class="auto-upload-alert"
    >
      <div style="display: flex; align-items: center; gap: 24px">
        <span>
          自动上传已开启，每 {{ autoUploadIntervalMinutes }} 分钟检查一次
          <span style="color: #999; font-size: 12px">（昨天至后天共5天）</span>
        </span>
        <span v-if="lastAutoUploadTime" style="color: #1890ff">
          上一轮: {{ lastAutoUploadTime }}
        </span>
        <span v-if="nextAutoUploadTime" style="color: #52c41a">
          下一轮: {{ nextAutoUploadTime }}
        </span>
      </div>
    </NAlert>

    <!-- 选择控制 -->
    <NCard v-if="groupedMaterials.length > 0" class="selection-card">
      <NSpace align="center">
        <NCheckbox
          :checked="isAllSelected"
          :indeterminate="isIndeterminate"
          @update:checked="toggleAllSelection"
        >
          全选
        </NCheckbox>
        <span class="selection-count">
          已选择 {{ selectedVideoCount }} / {{ videoMaterials.length }} 个视频
        </span>
      </NSpace>
    </NCard>

    <!-- 视频列表 -->
    <NCard class="table-card">
      <NSpin :show="loading">
        <template v-if="groupedMaterials.length > 0">
          <NCollapse
            v-for="group in groupedMaterials"
            :key="group.dramaName"
            class="drama-group"
          >
            <NCollapseItem :name="group.dramaName">
              <template #header>
                <div class="drama-header">
                  <div class="drama-header-left">
                    <NCheckbox
                      :checked="isDramaSelected(group.dramaName)"
                      :indeterminate="isDramaIndeterminate(group.dramaName)"
                      @update:checked="toggleDramaSelection(group.dramaName)"
                      @click.stop
                      class="drama-checkbox"
                    />
                    <div class="drama-info">
                      <div class="drama-title">{{ group.dramaName }}</div>
                      <div class="drama-meta">
                        <span class="video-count"
                          >{{ group.videos.length }}个视频</span
                        >
                        <span class="drama-separator">•</span>
                        <span class="drama-size">{{
                          getDramaTotalSize(group.videos)
                        }}</span>
                        <span class="drama-separator">•</span>
                        <span class="drama-progress">
                          已完成：{{ getDramaCompletedCount(group) }}/{{
                            group.videos.length
                          }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
              <template #header-extra>
                <NTag :type="getDramaStatusType(group.status)" size="small">
                  {{ getDramaStatusText(group.status) }}
                </NTag>
              </template>

              <div class="videos-list">
                <div
                  v-for="video in group.videos"
                  :key="video.fileName"
                  class="video-item"
                >
                  <div class="video-checkbox">
                    <NCheckbox
                      :checked="selectedVideos.has(video.fileName)"
                      :disabled="video.status === 'uploading'"
                      @update:checked="toggleVideoSelection(video.fileName)"
                    />
                  </div>
                  <div class="video-info">
                    <div class="video-name">{{ video.fileName }}</div>
                    <div class="video-details">
                      <span class="video-size">{{ video.sizeFormatted }}</span>
                      <!-- 上传进度 -->
                      <div
                        v-if="
                          video.status === 'uploading' &&
                          video.progress !== undefined
                        "
                        class="simple-progress-container"
                      >
                        <div class="simple-progress-bar">
                          <div class="simple-progress-track">
                            <div
                              class="simple-progress-fill"
                              :style="{ width: video.progress + '%' }"
                            ></div>
                          </div>
                          <span class="simple-progress-text"
                            >{{ video.progress }}%</span
                          >
                        </div>
                      </div>
                      <!-- 状态标签 -->
                      <div
                        class="status-badge"
                        :class="getVideoStatusClass(video.status)"
                      >
                        <div class="status-dot"></div>
                        <span>{{ getVideoStatusText(video.status) }}</span>
                      </div>
                      <!-- 重试次数 -->
                      <div
                        v-if="video.retryCount && video.retryCount > 0"
                        class="retry-badge"
                      >
                        <span>重试 {{ video.retryCount }} 次</span>
                      </div>
                    </div>
                    <!-- 错误信息 -->
                    <div
                      v-if="video.status === 'error' && video.error"
                      class="video-error"
                    >
                      {{ video.error }}
                    </div>
                  </div>
                  <!-- 重新上传按钮 -->
                  <div v-if="video.status === 'error'" class="video-actions">
                    <NButton
                      type="primary"
                      size="small"
                      @click="retryUpload(video)"
                    >
                      重新上传
                    </NButton>
                  </div>
                </div>
              </div>
            </NCollapseItem>
          </NCollapse>
        </template>
        <NEmpty v-else description="请先扫描视频文件" />
      </NSpin>
    </NCard>

    <!-- 操作说明弹窗 -->
    <NModal
      v-model:show="showHelpModal"
      preset="card"
      title="素材上传操作说明"
      style="width: 600px"
      :bordered="false"
      :segmented="{ content: true }"
    >
      <div class="help-content">
        <section class="help-section">
          <h3 class="help-title">📤 手动上传</h3>
          <ol class="help-list">
            <li>
              点击"<strong>选择目录</strong>"按钮，选择上传根目录（如：D:\短剧剪辑）
            </li>
            <li>
              选择日期，系统会自动将日期拼接到根目录（如：D:\短剧剪辑\1.15
              导出）
            </li>
            <li>
              点击"<strong>扫描待上传</strong>"按钮，系统会查询飞书状态为"待上传"的剧集
            </li>
            <li>扫描完成后，在对应日期目录下查找匹配的素材文件</li>
            <li>勾选需要上传的视频文件（默认全选）</li>
            <li>
              点击"<strong>开始上传</strong>"按钮，开始批量上传到火山引擎TOS
            </li>
          </ol>
        </section>

        <section class="help-section">
          <h3 class="help-title">⚙️ 上传设置</h3>
          <ul class="help-list">
            <li>
              <strong>上传根目录：</strong
              >素材导出的根目录，系统会自动加上日期后缀
            </li>
            <li>
              <strong>扫描目录：</strong>实际扫描的目录路径（根目录 + 日期）
            </li>
            <li>
              <strong>并发数量：</strong>同时上传的视频文件数量，默认 5 个
            </li>
          </ul>
        </section>

        <section class="help-section">
          <h3 class="help-title">🔄 自动上传</h3>
          <ol class="help-list">
            <li>设置"<strong>间隔(分钟)</strong>"，建议 20-60 分钟</li>
            <li>打开"<strong>自动上传</strong>"开关</li>
            <li>系统会自动扫描昨天、今天和未来3天（共5天）的待上传剧集</li>
            <li>对每个日期，先查询飞书待上传剧集，再扫描本地对应目录</li>
            <li>如果当前有任务正在上传，会等待任务完成后再查询新任务</li>
            <li>
              如果查询到新任务，会立即开始上传；如果没有新任务，会等待下一个间隔周期
            </li>
            <li>
              点击"<strong>立即刷新</strong>"按钮可以立即触发一次查询，无需等待
            </li>
          </ol>
        </section>

        <section class="help-section">
          <h3 class="help-title">🔁 重试与容错机制</h3>
          <ul class="help-list">
            <li><strong>单个视频重试：</strong>上传失败自动重试 3 次，间隔 2 秒</li>
            <li><strong>超时重试：</strong>单个视频上传超过 20 分钟自动取消并重试</li>
            <li><strong>素材库重试：</strong>提交素材库失败自动重试 3 次，间隔 2 秒</li>
            <li>
              <strong>剧集判定规则：</strong
              >某剧所有视频上传完成后，统计失败数量：
            </li>
            <li class="help-sub-item">
              • 失败 ≤ 2 个：判定成功，提交成功的视频到素材库，飞书状态改为"待搭建"，删除本地目录
            </li>
            <li class="help-sub-item">
              • 失败 > 2 个：判定失败，飞书状态改为"上传失败"，不提交素材库，保留本地目录
            </li>
          </ul>
        </section>

        <section class="help-section">
          <h3 class="help-title">💡 温馨提示</h3>
          <ul class="help-list">
            <li>上传过程中可以点击"取消上传"停止所有上传任务</li>
            <li>上传进度会实时显示，包括每个文件的上传百分比</li>
            <li>自动上传开启后，会显示"上一轮"和"下一轮"的查询时间</li>
            <li>上传成功的剧集本地目录会被自动删除，释放磁盘空间</li>
            <li>视频按剧名分组展示，可展开查看每个剧集的详细文件</li>
            <li>失败的视频可以点击"重新上传"按钮手动重试</li>
          </ul>
        </section>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.upload-page {
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
  margin-bottom: 20px;
}

.path-card {
  margin-bottom: 20px;
}

.stats-grid {
  margin-bottom: 20px;
}

.progress-card {
  margin-bottom: 20px;
  padding: 20px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.progress-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-label {
  font-size: 14px;
  font-weight: 500;
  color: #262626;
}

.progress-stats {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-count {
  font-size: 13px;
  color: #595959;
  background: #f5f5f5;
  padding: 4px 10px;
  border-radius: 4px;
}

.progress-percentage {
  font-size: 16px;
  font-weight: 600;
  color: #1890ff;
}

.upload-status-info {
  margin-top: 12px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  background: #1890ff;
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.2);
  }
}

.status-text {
  font-size: 13px;
  color: #595959;
}

.auto-upload-alert {
  margin-bottom: 20px;
}

.selection-card {
  margin-bottom: 20px;
  padding: 16px 20px;
}

.selection-count {
  font-size: 14px;
  color: #666;
}

.table-card {
  min-height: 400px;
  padding: 20px;
}

.drama-group {
  margin-bottom: 20px;
  background: #f8f9fa;
  border-radius: 12px;
  border: 1px solid #e9ecef;
  overflow: hidden;
}

/* 调整折叠面板的右侧状态标签间距 */
.drama-group :deep(.n-collapse-item__header-extra) {
  margin-right: 12px;
}

.drama-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.drama-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.drama-checkbox {
  flex-shrink: 0;
}

.drama-info {
  flex: 1;
  min-width: 0;
}

.drama-title {
  font-weight: 600;
  color: #1a1a1a;
  font-size: 15px;
  margin-bottom: 4px;
}

.drama-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #666;
}

.video-count {
  color: #4a90e2;
  font-weight: 500;
}

.drama-separator {
  color: #ccc;
}

.drama-size {
  color: #888;
}

.drama-progress {
  color: #16a34a;
  font-weight: 500;
}

.videos-list {
  padding: 16px;
  background: #fff;
}

.video-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 10px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.video-item:last-child {
  margin-bottom: 0;
}

.video-checkbox {
  flex-shrink: 0;
  padding-top: 2px;
}

.video-info {
  flex: 1;
  min-width: 0;
}

.video-name {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  margin-bottom: 6px;
  word-break: break-all;
}

.video-details {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.video-size {
  font-size: 12px;
  color: #4a90e2;
  font-weight: 500;
}

.simple-progress-container {
  display: flex;
  align-items: center;
}

.simple-progress-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.simple-progress-track {
  width: 80px;
  height: 4px;
  background: #e9ecef;
  border-radius: 2px;
  overflow: hidden;
}

.simple-progress-fill {
  height: 100%;
  background: #1890ff;
  border-radius: 2px;
  transition: width 0.2s ease;
}

.simple-progress-text {
  font-size: 11px;
  color: #1890ff;
  font-weight: 500;
  min-width: 32px;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-pending {
  background: #f5f5f5;
  color: #666;
}

.status-pending .status-dot {
  background: #999;
}

.status-uploading {
  background: #e6f7ff;
  color: #1890ff;
}

.status-uploading .status-dot {
  background: #1890ff;
}

.status-success {
  background: #f6ffed;
  color: #52c41a;
}

.status-success .status-dot {
  background: #52c41a;
}

.status-error {
  background: #fff2f0;
  color: #ff4d4f;
}

.status-error .status-dot {
  background: #ff4d4f;
}

.retry-badge {
  font-size: 11px;
  color: #faad14;
  background: rgba(250, 173, 20, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}

.video-error {
  margin-top: 8px;
  padding: 8px;
  background: #fff2f0;
  border: 1px solid #ffccc7;
  border-radius: 4px;
  font-size: 12px;
  color: #ff4d4f;
}

.video-actions {
  flex-shrink: 0;
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
