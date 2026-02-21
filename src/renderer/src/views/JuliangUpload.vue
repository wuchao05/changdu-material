<script setup lang="ts">
defineOptions({ name: "JuliangUpload" });
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  NCard,
  NButton,
  NSpace,
  NAlert,
  NStatistic,
  NGrid,
  NGi,
  NProgress,
  NTag,
  NInput,
  NInputNumber,
  NSwitch,
  NCollapse,
  NCollapseItem,
  NDivider,
  NDataTable,
  useMessage,
} from "naive-ui";

const message = useMessage();

// 状态
const isInitializing = ref(false);
const isReady = ref(false);
const isUploading = ref(false);
const needLogin = ref(false);

// 调度器状态
const schedulerStatus = ref<"idle" | "running" | "stopped">("idle");
const schedulerStats = ref({
  total: 0,
  pending: 0,
  running: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
});
const schedulerConfig = ref({
  fetchIntervalMinutes: 20,
  localRootDir: "",
});

// 配置
const config = ref({
  baseUploadUrl: "",
  batchSize: 20,
  batchDelayMin: 3000,
  batchDelayMax: 5000,
  headless: false,
  slowMo: 50,
  progressBarThreshold: 90, // UI 上用百分比展示，保存时转为小数
});

// 当前任务
const currentTask = ref<{
  id: string;
  drama: string;
  status: string;
  currentBatch: number;
  totalBatches: number;
  successCount: number;
  totalFiles: number;
  message: string;
} | null>(null);

// 日志（合并调度器和上传日志）
const logs = ref<Array<{ time: string; message: string; type?: string }>>([]);
const showLogs = ref(false);

// 已完成任务列表
const completedTasks = ref<Array<{
  drama: string;
  date: string;
  fileCount: number;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
  duration: string;
}>>([]);

// 上传计时
const uploadStartTime = ref<number | null>(null);
const uploadElapsedMinutes = ref('0.0');
let uploadTimerInterval: ReturnType<typeof setInterval> | null = null;

// 进度监听器
let unsubscribeProgress: (() => void) | null = null;
let unsubscribeLog: (() => void) | null = null;
let unsubscribeSchedulerLog: (() => void) | null = null;

// 初始化浏览器（调度器启动时自动调用）
async function initializeBrowser() {
  if (isInitializing.value || isReady.value) return;

  isInitializing.value = true;
  try {
    const result = await window.api.juliangInitialize();
    if (result.success) {
      isReady.value = true;
      // 检查登录状态
      const loginResult = await window.api.juliangCheckLogin();
      needLogin.value = loginResult.needLogin;
    }
    return result;
  } finally {
    isInitializing.value = false;
  }
}

// 加载配置
async function loadConfig() {
  try {
    const cfg = await window.api.juliangGetConfig();
    config.value = { ...config.value, ...cfg };
    // 后端存的是小数，前端展示百分比
    if (cfg.progressBarThreshold !== undefined) {
      config.value.progressBarThreshold = Math.round(cfg.progressBarThreshold * 100);
    }
  } catch (error) {
    console.error("加载配置失败:", error);
  }
}

// 保存配置
async function saveConfig() {
  try {
    // 转换为普通对象，避免 Vue ref 无法序列化
    const cfg = {
      batchSize: config.value.batchSize,
      headless: config.value.headless,
      progressBarThreshold: config.value.progressBarThreshold / 100, // 百分比转小数
    };
    await window.api.juliangUpdateConfig(cfg);
    message.success("配置已保存");
  } catch (error) {
    message.error(`保存配置失败: ${error}`);
  }
}

// ==================== 调度器相关 ====================

// 启动调度器
async function startScheduler() {
  try {
    // 先初始化浏览器
    if (!isReady.value) {
      const initResult = await initializeBrowser();
      if (!initResult?.success) {
        message.error(`浏览器初始化失败: ${initResult?.error}`);
        return;
      }
    }

    const result = await window.api.juliangSchedulerStart();
    if (result.success) {
      schedulerStatus.value = "running";
      showLogs.value = true; // 自动展开日志
      message.success("调度器已启动");
    } else {
      message.error(`启动失败: ${result.error}`);
    }
  } catch (error) {
    message.error(`启动失败: ${error}`);
  }
}

// 停止调度器
async function stopScheduler() {
  try {
    await window.api.juliangSchedulerStop();
    schedulerStatus.value = "stopped";
    message.success("调度器已停止");
  } catch (error) {
    message.error(`停止失败: ${error}`);
  }
}

// 立即执行调度
async function fetchNow() {
  try {
    const result = await window.api.juliangSchedulerFetchNow();
    if (result.success) {
      message.success(`查询完成，发现 ${result.count} 个任务`);
    } else {
      message.warning(result.error || "查询失败");
    }
  } catch (error) {
    message.error(`查询失败: ${error}`);
  }
}

// 取消所有上传
async function cancelAll() {
  try {
    const result = await window.api.juliangSchedulerCancelAll();
    if (result.success) {
      message.success("已取消所有上传任务");
      await refreshSchedulerStatus();
    } else {
      message.error(result.error || "取消失败");
    }
  } catch (error) {
    message.error(`取消失败: ${error}`);
  }
}

// 刷新调度器状态
async function refreshSchedulerStatus() {
  try {
    const result = await window.api.juliangSchedulerGetStatus();
    schedulerStatus.value = result.status;
    schedulerStats.value = result.stats;
  } catch (error) {
    console.error("刷新调度器状态失败:", error);
  }
}

// 加载调度器配置
async function loadSchedulerConfig() {
  try {
    schedulerConfig.value = await window.api.juliangSchedulerGetConfig();
  } catch (error) {
    console.error("加载调度器配置失败:", error);
  }
}

// 保存调度器配置
async function saveSchedulerConfig() {
  try {
    const cfg = {
      fetchIntervalMinutes: schedulerConfig.value.fetchIntervalMinutes,
      localRootDir: schedulerConfig.value.localRootDir,
    };
    await window.api.juliangSchedulerUpdateConfig(cfg);
    message.success("配置已保存");
  } catch (error) {
    message.error(`保存配置失败: ${error}`);
  }
}

// 选择素材根目录
async function selectLocalRootDir() {
  try {
    const path = await window.api.selectFolder();
    if (path) {
      schedulerConfig.value.localRootDir = path;
      // 自动保存
      await saveSchedulerConfig();
    }
  } catch (error) {
    message.error(`选择目录失败: ${error}`);
  }
}

// 清空日志
async function clearLogs() {
  try {
    await window.api.juliangClearLogs();
    await window.api.juliangSchedulerClearLogs();
    logs.value = [];
    message.success("日志已清空");
  } catch (error) {
    message.error(`清空日志失败: ${error}`);
  }
}

// 刷新已完成任务列表
async function refreshCompletedTasks() {
  try {
    completedTasks.value = await window.api.juliangSchedulerGetCompletedTasks();
  } catch (error) {
    console.error("刷新已完成任务失败:", error);
  }
}

// 启动上传计时
function startUploadTimer() {
  if (uploadTimerInterval) return;
  uploadStartTime.value = Date.now();
  uploadElapsedMinutes.value = '0.0';
  uploadTimerInterval = setInterval(() => {
    if (uploadStartTime.value) {
      const elapsed = (Date.now() - uploadStartTime.value) / 60000;
      uploadElapsedMinutes.value = elapsed.toFixed(1);
    }
  }, 1000);
}

// 停止上传计时
function stopUploadTimer() {
  if (uploadTimerInterval) {
    clearInterval(uploadTimerInterval);
    uploadTimerInterval = null;
  }
}

// 加载历史日志
async function loadAllLogs() {
  try {
    const [uploadLogs, schedulerLogs] = await Promise.all([
      window.api.juliangGetLogs(),
      window.api.juliangSchedulerGetLogs(),
    ]);
    // 合并并按时间排序
    const allLogs = [
      ...uploadLogs.map((l: { time: string; message: string }) => ({ ...l, type: "upload" })),
      ...schedulerLogs.map((l: { time: string; message: string }) => ({ ...l, type: "scheduler" })),
    ].sort((a, b) => a.time.localeCompare(b.time));
    logs.value = allLogs;
  } catch (error) {
    console.error("加载日志失败:", error);
  }
}

// 切换日志显示
async function toggleLogs() {
  showLogs.value = !showLogs.value;
  if (showLogs.value) {
    await loadAllLogs();
  }
}

// 调度器状态文本
const schedulerStatusText = computed(() => {
  switch (schedulerStatus.value) {
    case "running":
      return "运行中";
    case "stopped":
      return "已停止";
    default:
      return "未启动";
  }
});

const schedulerStatusType = computed(() => {
  switch (schedulerStatus.value) {
    case "running":
      return "success";
    case "stopped":
      return "error";
    default:
      return "default";
  }
});

// 浏览器状态
const browserStatusText = computed(() => {
  if (isInitializing.value) return "初始化中...";
  if (!isReady.value) return "未启动";
  if (needLogin.value) return "需要登录";
  return "已就绪";
});

const browserStatusType = computed(() => {
  if (isInitializing.value) return "info";
  if (!isReady.value) return "default";
  if (needLogin.value) return "warning";
  return "success";
});

onMounted(async () => {
  // 加载配置
  await loadConfig();
  await loadSchedulerConfig();

  // 检查是否已初始化
  const ready = await window.api.juliangIsReady();
  isReady.value = ready;

  // 刷新调度器状态
  await refreshSchedulerStatus();

  // 加载已完成任务
  await refreshCompletedTasks();

  // 监听上传进度
  unsubscribeProgress = window.api.onJuliangUploadProgress((progress) => {
    const wasNull = currentTask.value === null;
    currentTask.value = progress;
    // 有新任务开始时启动计时
    if (wasNull && progress.status !== 'skipped') {
      startUploadTimer();
    }
    // 任务结束时停止计时
    if (progress.status === 'skipped' || progress.status === 'completed' || progress.status === 'failed') {
      stopUploadTimer();
    }
  });

  // 监听上传日志
  unsubscribeLog = window.api.onJuliangLog((log) => {
    logs.value.push({ ...log, type: "upload" });
    if (logs.value.length > 500) {
      logs.value.shift();
    }
  });

  // 监听调度器日志
  unsubscribeSchedulerLog = window.api.onJuliangSchedulerLog((log) => {
    logs.value.push({ ...log, type: "scheduler" });
    if (logs.value.length > 500) {
      logs.value.shift();
    }
  });

  // 定时刷新调度器状态和已完成任务
  setInterval(() => {
    refreshSchedulerStatus();
    refreshCompletedTasks();
  }, 5000);
});

onUnmounted(() => {
  if (unsubscribeProgress) unsubscribeProgress();
  if (unsubscribeLog) unsubscribeLog();
  if (unsubscribeSchedulerLog) unsubscribeSchedulerLog();
  stopUploadTimer();
});
</script>

<template>
  <div class="juliang-page">
    <!-- 状态概览 -->
    <div class="status-bar">
      <div class="status-item">
        <span class="status-label">调度状态</span>
        <NTag :type="schedulerStatusType" size="small">{{ schedulerStatusText }}</NTag>
      </div>
      <div class="status-item">
        <span class="status-label">浏览器</span>
        <NTag :type="browserStatusType" size="small">{{ browserStatusText }}</NTag>
      </div>
      <div class="status-item" v-if="currentTask">
        <span class="status-label">当前任务</span>
        <span class="status-value">{{ currentTask.drama }}</span>
      </div>
    </div>

    <!-- 主控制区 -->
    <NCard class="main-card">
      <!-- 统计数据 -->
      <NGrid :cols="6" :x-gap="16" class="stats-grid">
        <NGi>
          <div class="stat-item">
            <div class="stat-value">{{ schedulerStats.pending }}</div>
            <div class="stat-label">待处理</div>
          </div>
        </NGi>
        <NGi>
          <div class="stat-item running">
            <div class="stat-value">{{ schedulerStats.running }}</div>
            <div class="stat-label">进行中</div>
          </div>
        </NGi>
        <NGi>
          <div class="stat-item success">
            <div class="stat-value">{{ schedulerStats.completed }}</div>
            <div class="stat-label">已完成</div>
          </div>
        </NGi>
        <NGi>
          <div class="stat-item">
            <div class="stat-value">{{ schedulerStats.skipped }}</div>
            <div class="stat-label">已跳过</div>
          </div>
        </NGi>
        <NGi>
          <div class="stat-item error">
            <div class="stat-value">{{ schedulerStats.failed }}</div>
            <div class="stat-label">失败</div>
          </div>
        </NGi>
        <NGi>
          <div class="stat-item">
            <div class="stat-value">{{ schedulerStats.total }}</div>
            <div class="stat-label">总计</div>
          </div>
        </NGi>
      </NGrid>

      <NDivider style="margin: 16px 0" />

      <!-- 素材目录配置 -->
      <div class="config-row">
        <span class="config-label">素材根目录</span>
        <NInput
          v-model:value="schedulerConfig.localRootDir"
          placeholder="选择本地素材导出的根目录"
          readonly
          class="config-input"
        />
        <NButton @click="selectLocalRootDir">选择目录</NButton>
      </div>
      <div class="config-hint">目录结构: 根目录/M.D导出/剧名/视频文件</div>

      <NDivider style="margin: 16px 0" />

      <!-- 控制按钮 -->
      <div class="control-buttons">
        <NButton
          type="primary"
          size="large"
          :disabled="schedulerStatus === 'running' || !schedulerConfig.localRootDir"
          :loading="isInitializing"
          @click="startScheduler"
        >
          {{ isInitializing ? '初始化中...' : '启动调度' }}
        </NButton>
        <NButton
          size="large"
          :disabled="schedulerStatus !== 'running'"
          @click="stopScheduler"
        >
          停止调度
        </NButton>
        <NButton
          size="large"
          :disabled="schedulerStatus !== 'running' || schedulerStats.running > 0"
          @click="fetchNow"
        >
          立即查询
        </NButton>
        <NButton
          size="large"
          type="error"
          :disabled="schedulerStatus !== 'running' || (schedulerStats.pending === 0 && schedulerStats.running === 0)"
          @click="cancelAll"
        >
          取消上传
        </NButton>
        <NButton size="large" @click="toggleLogs">
          {{ showLogs ? '隐藏日志' : '查看日志' }}
        </NButton>
      </div>
    </NCard>

    <!-- 当前任务进度 -->
    <NCard v-if="currentTask" :class="['progress-card', currentTask.status === 'skipped' ? 'cancelled' : '']">
      <div class="progress-header">
        <span class="progress-title">{{ currentTask.drama }}</span>
        <span class="progress-status">{{ currentTask.message }}</span>
      </div>
      <div v-if="currentTask.status !== 'skipped'" class="progress-info">
        <span>批次: {{ currentTask.currentBatch }}/{{ currentTask.totalBatches }}</span>
        <span>文件: {{ currentTask.successCount }}/{{ currentTask.totalFiles }}</span>
        <span v-if="uploadStartTime" class="upload-timer">已用时: {{ uploadElapsedMinutes }} 分钟</span>
      </div>
      <NProgress
        v-if="currentTask.status !== 'skipped'"
        type="line"
        :percentage="currentTask.totalFiles > 0 ? Math.round((currentTask.successCount / currentTask.totalFiles) * 100) : 0"
        :indicator-placement="'inside'"
        :height="24"
        :border-radius="4"
      />
    </NCard>

    <!-- 已上传列表 -->
    <NCollapse v-if="completedTasks.length > 0" class="completed-collapse">
      <NCollapseItem :title="`已上传列表 (${completedTasks.length})`" name="completed">
        <div class="completed-table">
          <table>
            <thead>
              <tr>
                <th>剧名</th>
                <th>飞书日期</th>
                <th>素材数</th>
                <th>状态</th>
                <th>耗时</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(task, index) in completedTasks" :key="index">
                <td>{{ task.drama }}</td>
                <td>{{ task.date }}</td>
                <td>{{ task.fileCount }}</td>
                <td>
                  <NTag v-if="task.status === 'completed'" type="success" size="small">成功</NTag>
                  <NTag v-else-if="task.status === 'failed'" type="error" size="small">失败</NTag>
                  <NTag v-else type="warning" size="small">跳过</NTag>
                </td>
                <td>{{ task.duration }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </NCollapseItem>
    </NCollapse>

    <!-- 需要登录提示 -->
    <NAlert
      v-if="isReady && needLogin"
      type="warning"
      title="需要登录"
      class="login-alert"
    >
      请在弹出的浏览器窗口中登录巨量创意后台。登录后系统会自动检测并继续上传任务。
    </NAlert>

    <!-- 日志面板 -->
    <NCard v-if="showLogs" class="log-card">
      <template #header>
        <span>运行日志</span>
      </template>
      <template #header-extra>
        <NButton size="small" quaternary @click="clearLogs">清空</NButton>
      </template>
      <div class="log-container">
        <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
        <div v-for="(log, index) in logs" :key="index" class="log-item">
          <span class="log-time">[{{ log.time }}]</span>
          <span class="log-message">{{ log.message }}</span>
        </div>
      </div>
    </NCard>

    <!-- 高级配置 -->
    <NCollapse class="advanced-config">
      <NCollapseItem title="高级配置" name="config">
        <div class="advanced-config-content">
          <div class="config-grid">
            <div class="config-row">
              <span class="config-label">每批文件数</span>
              <NInputNumber
                v-model:value="config.batchSize"
                :min="1"
                :max="50"
                style="width: 120px"
              />
              <span class="config-desc">每次上传的文件数量</span>
            </div>
            <div class="config-row">
              <span class="config-label">无头模式</span>
              <NSwitch v-model:value="config.headless" />
              <span class="config-desc">开启后浏览器窗口不可见</span>
            </div>
            <div class="config-row">
              <span class="config-label">进度条容许率</span>
              <NInputNumber
                v-model:value="config.progressBarThreshold"
                :min="50"
                :max="100"
                :step="5"
                style="width: 120px"
              >
                <template #suffix>%</template>
              </NInputNumber>
              <span class="config-desc">进度条数量达到此比例即继续上传，如 80% 表示允许缺失 20%</span>
            </div>
          </div>
          <div class="config-actions">
            <NButton type="primary" @click="saveConfig">保存配置</NButton>
          </div>
        </div>
      </NCollapseItem>
    </NCollapse>
  </div>
</template>

<style scoped>
.juliang-page {
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  background: #f5f7fa;
}

.status-bar {
  display: flex;
  gap: 24px;
  padding: 12px 16px;
  background: #fff;
  border-radius: 8px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.status-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-label {
  color: #666;
  font-size: 13px;
}

.status-value {
  color: #333;
  font-weight: 500;
}

.main-card {
  margin-bottom: 16px;
}

.stats-grid {
  margin-bottom: 8px;
}

.stat-item {
  text-align: center;
  padding: 12px 0;
}

.stat-value {
  font-size: 28px;
  font-weight: 600;
  color: #333;
  line-height: 1.2;
}

.stat-item.running .stat-value {
  color: #2080f0;
}

.stat-item.success .stat-value {
  color: #18a058;
}

.stat-item.error .stat-value {
  color: #d03050;
}

.stat-label {
  font-size: 13px;
  color: #888;
  margin-top: 4px;
}

.config-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.config-label {
  width: 80px;
  flex-shrink: 0;
  color: #666;
  font-size: 14px;
}

.config-input {
  flex: 1;
}

.config-hint {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
  margin-left: 92px;
}

.control-buttons {
  display: flex;
  gap: 12px;
}

.progress-card {
  margin-bottom: 16px;
  background: #fff;
  border-left: 3px solid #2080f0;
}

.progress-card :deep(.n-card__content) {
  padding: 16px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.progress-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.progress-status {
  font-size: 13px;
  color: #666;
}

.progress-info {
  display: flex;
  gap: 24px;
  font-size: 13px;
  margin-bottom: 12px;
  color: #888;
}

.progress-card :deep(.n-progress) {
  --n-fill-color: #2080f0;
  --n-rail-color: #e8e8e8;
}

.progress-card.cancelled {
  border-left-color: #999;
}

.upload-timer {
  color: #2080f0;
  font-weight: 500;
}

.completed-collapse {
  margin-bottom: 16px;
  background: #fff;
  border-radius: 8px;
}

.completed-collapse :deep(.n-collapse-item__header) {
  padding: 12px 16px !important;
}

.completed-table {
  overflow-x: auto;
}

.completed-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.completed-table th,
.completed-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid #f0f0f0;
}

.completed-table th {
  color: #888;
  font-weight: 500;
  background: #fafafa;
}

.completed-table tr:hover td {
  background: #f9f9f9;
}

.login-alert {
  margin-bottom: 16px;
}

.log-card {
  margin-bottom: 16px;
}

.log-container {
  height: 250px;
  overflow-y: auto;
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.6;
}

.log-empty {
  color: #666;
  text-align: center;
  padding: 20px;
}

.log-item {
  margin-bottom: 2px;
}

.log-time {
  color: #6a9955;
}

.log-message {
  margin-left: 8px;
}

.advanced-config {
  margin-top: 16px;
  background: #fff;
  border-radius: 8px;
}

.advanced-config :deep(.n-collapse-item__header) {
  padding: 14px 16px !important;
}

.advanced-config :deep(.n-collapse-item__header-main) {
  font-size: 14px;
  font-weight: 500;
}

.advanced-config :deep(.n-collapse-item__content-inner) {
  padding-top: 0 !important;
}

.advanced-config-content {
  padding: 16px;
  background: #fafafa;
  border-radius: 6px;
}

.advanced-config .config-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.advanced-config .config-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.advanced-config .config-label {
  width: 80px;
  flex-shrink: 0;
  color: #333;
  font-size: 14px;
  font-weight: 500;
}

.config-desc {
  color: #999;
  font-size: 12px;
  margin-left: 8px;
}

.config-actions {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}
</style>
