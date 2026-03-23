<script setup lang="ts">
defineOptions({ name: "JuliangUpload" });
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  NCard,
  NButton,
  NSpace,
  NAlert,
  NTag,
  NInput,
  NInputNumber,
  NSwitch,
  NCollapse,
  NCollapseItem,
  useMessage,
} from "naive-ui";
import { useAuthStore } from "../stores/auth";
import { useDarenStore } from "../stores/daren";

const message = useMessage();
const authStore = useAuthStore();
const darenStore = useDarenStore();

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
  maxTaskRetries: 1,
});

const currentSchedulerDarenId = computed(() => {
  if (authStore.isAdmin) {
    return undefined;
  }
  return darenStore.currentDaren?.id || authStore.currentUser?.id;
});

// 配置
const config = ref({
  baseUploadUrl: "",
  batchSize: 20,
  batchUploadTimeoutMinutes: 5,
  maxBatchRetries: 5,
  batchDelayMin: 3000,
  batchDelayMax: 5000,
  headless: false,
  slowMo: 50,
  allowedMissingCount: 0,
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
const expandedPanels = ref<string[]>([]);

// 已完成任务列表
const completedTasks = ref<
  Array<{
    drama: string;
    date: string;
    fileCount: number;
    status: "completed" | "failed" | "skipped";
    error?: string;
    duration: string;
  }>
>([]);

// 上传计时
const uploadStartTime = ref<number | null>(null);
const uploadElapsedSeconds = ref(0);
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

    // 兼容旧字段：历史上用比例表示缺失容忍度，默认按每批 10 个换算
    if (
      cfg.allowedMissingCount === undefined &&
      typeof cfg.progressBarThreshold === "number"
    ) {
      config.value.allowedMissingCount = Math.max(
        0,
        Math.round((1 - cfg.progressBarThreshold) * 10),
      );
    }
  } catch (error) {
    console.error("加载配置失败:", error);
  }
}

// 保存配置
async function saveConfig() {
  try {
    const cfg = {
      baseUploadUrl: config.value.baseUploadUrl,
      batchSize: config.value.batchSize,
      batchUploadTimeoutMinutes: Math.max(
        1,
        Math.floor(config.value.batchUploadTimeoutMinutes || 5),
      ),
      maxBatchRetries: Math.max(
        0,
        Math.min(10, Math.floor(config.value.maxBatchRetries || 0)),
      ),
      batchDelayMin: config.value.batchDelayMin,
      batchDelayMax: config.value.batchDelayMax,
      headless: config.value.headless,
      slowMo: config.value.slowMo,
      allowedMissingCount: Math.max(
        0,
        Math.floor(config.value.allowedMissingCount || 0),
      ),
    };
    await window.api.juliangUpdateConfig(cfg);
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

    const result = await window.api.juliangSchedulerStart(
      currentSchedulerDarenId.value,
    );
    if (result.success) {
      schedulerStatus.value = "running";
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
    const result = await window.api.juliangSchedulerFetchNow(
      currentSchedulerDarenId.value,
    );
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
      maxTaskRetries: Math.max(
        0,
        Math.min(5, Math.floor(schedulerConfig.value.maxTaskRetries || 0)),
      ),
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

// 启动上传计时（强制重置）
function startUploadTimer() {
  stopUploadTimer();
  uploadStartTime.value = Date.now();
  uploadElapsedSeconds.value = 0;
  uploadTimerInterval = setInterval(() => {
    if (uploadStartTime.value) {
      uploadElapsedSeconds.value = Math.max(
        0,
        Math.floor((Date.now() - uploadStartTime.value) / 1000),
      );
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
      ...uploadLogs.map((l: { time: string; message: string }) => ({
        ...l,
        type: "upload",
      })),
      ...schedulerLogs.map((l: { time: string; message: string }) => ({
        ...l,
        type: "scheduler",
      })),
    ].sort((a, b) => a.time.localeCompare(b.time));
    logs.value = allLogs;
  } catch (error) {
    console.error("加载日志失败:", error);
  }
}

function formatUploadDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((item) => String(item).padStart(2, "0"))
    .join(":");
}

const uploadDurationText = computed(() =>
  formatUploadDuration(uploadElapsedSeconds.value),
);

const statusSummary = computed(() => {
  if (currentTask.value) {
    return currentTask.value.message || `正在上传《${currentTask.value.drama}》`;
  }

  if (schedulerStatus.value === "running") {
    return "轮询上传运行中";
  }

  if (schedulerStatus.value === "stopped") {
    return "轮询上传已停止";
  }

  return "等待启动调度";
});

async function handleExpandedNamesChange(
  names: string[] | string | null | undefined,
) {
  expandedPanels.value = Array.isArray(names)
    ? names.map((item) => String(item))
    : names
      ? [String(names)]
      : [];

  if (expandedPanels.value.includes("logs")) {
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

// 浏览器状态
const browserStatusText = computed(() => {
  if (isInitializing.value) return "初始化中...";
  if (!isReady.value) return "未启动";
  if (needLogin.value) return "需要登录";
  return "已就绪";
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
  let lastDrama = "";
  unsubscribeProgress = window.api.onJuliangUploadProgress((progress) => {
    currentTask.value = progress;
    // 新剧集开始时重启计时器
    if (progress.drama !== lastDrama && progress.status !== "skipped") {
      lastDrama = progress.drama;
      startUploadTimer();
    }
    // 任务结束时停止计时
    if (
      progress.status === "completed" ||
      progress.status === "failed" ||
      progress.status === "skipped"
    ) {
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
    <NCard class="overview-card">
      <div class="hero-row">
        <div class="hero-title">巨量上传</div>
        <NSpace class="hero-actions" wrap>
          <NButton
            quaternary
            class="hero-action-btn"
            :disabled="
              schedulerStatus !== 'running' || schedulerStats.running > 0
            "
            @click="fetchNow"
          >
            立即查询
          </NButton>
          <NButton
            quaternary
            class="hero-action-btn"
            type="error"
            :disabled="
              schedulerStatus !== 'running' ||
              (schedulerStats.pending === 0 && schedulerStats.running === 0)
            "
            @click="cancelAll"
          >
            取消上传
          </NButton>
          <NButton
            v-if="schedulerStatus !== 'running'"
            type="primary"
            secondary
            strong
            class="hero-action-btn hero-action-btn-primary"
            :disabled="!schedulerConfig.localRootDir"
            :loading="isInitializing"
            @click="startScheduler"
          >
            {{ isInitializing ? "初始化中..." : "启动调度" }}
          </NButton>
          <NButton
            v-else
            type="error"
            secondary
            strong
            class="hero-action-btn hero-action-btn-danger"
            @click="stopScheduler"
          >
            停止调度
          </NButton>
        </NSpace>
      </div>
    </NCard>

    <NCard class="status-card">
      <template #header>运行状态</template>
      <div class="status-header">
        <div class="status-message">{{ statusSummary }}</div>
      </div>

      <div class="current-drama-section">
        <div class="section-title">调度与浏览器</div>
        <div class="progress-meta">
          <div class="progress-chip">
            <span class="progress-chip-label">调度状态</span>
            <span class="progress-chip-value">{{ schedulerStatusText }}</span>
          </div>
          <div class="progress-chip">
            <span class="progress-chip-label">浏览器</span>
            <span class="progress-chip-value">{{ browserStatusText }}</span>
          </div>
          <div
            v-if="currentTask"
            class="progress-chip"
          >
            <span class="progress-chip-label">当前任务</span>
            <span class="progress-chip-value">{{ currentTask.drama }}</span>
          </div>
        </div>
      </div>

      <!-- 当前任务进度 -->
      <div
        v-if="currentTask"
        :class="[
          'current-drama-section',
          'upload-task-section',
          currentTask.status === 'skipped' ? 'cancelled' : '',
        ]"
      >
        <div class="section-title">当前上传任务</div>
        <div class="drama-info">
          <span class="drama-name">{{ currentTask.drama }}</span>
          <span class="drama-tag">{{ currentTask.message }}</span>
        </div>
        <div v-if="currentTask.status !== 'skipped'" class="progress-info">
          <div class="progress-meta">
            <div class="progress-chip">
              <span class="progress-chip-label">批次</span>
              <span class="progress-chip-value"
                >{{ currentTask.currentBatch }}/{{ currentTask.totalBatches }}</span
              >
            </div>
            <div class="progress-chip">
              <span class="progress-chip-label">文件</span>
              <span class="progress-chip-value"
                >{{ currentTask.successCount }}/{{ currentTask.totalFiles }}</span
              >
            </div>
            <div v-if="uploadStartTime" class="progress-chip">
              <span class="progress-chip-label">上传时长</span>
              <span class="progress-chip-value">{{ uploadDurationText }}</span>
            </div>
          </div>
          <div class="progress-bar-container">
            <div
              class="progress-bar"
              :style="{
                width: `${
                  currentTask.totalFiles > 0
                    ? Math.round(
                        (currentTask.successCount / currentTask.totalFiles) * 100,
                      )
                    : 0
                }%`,
              }"
            ></div>
          </div>
        </div>
      </div>

      <NCollapse v-if="completedTasks.length > 0" class="status-collapse">
        <NCollapseItem
          :title="`已上传列表 (${completedTasks.length})`"
          name="completed"
        >
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
                    <NTag
                      v-if="task.status === 'completed'"
                      type="success"
                      size="small"
                      >成功</NTag
                    >
                    <NTag
                      v-else-if="task.status === 'failed'"
                      type="error"
                      size="small"
                      >失败</NTag
                    >
                    <NTag v-else type="warning" size="small">跳过</NTag>
                  </td>
                  <td>{{ task.duration }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </NCollapseItem>
      </NCollapse>
    </NCard>

    <NCard class="quick-card" title="快捷配置">
      <div class="config-groups">
        <div class="config-group-row">
          <div class="config-group half">
            <div class="group-header">
              <div class="group-title">素材目录与调度</div>
              <div class="group-desc">设置本地素材目录和轮询重试策略</div>
            </div>
            <div class="compact-grid">
              <div class="compact-field compact-field-wide">
                <div class="compact-label">素材根目录</div>
                <div class="compact-control compact-control-inline">
                  <NInput
                    v-model:value="schedulerConfig.localRootDir"
                    placeholder="选择本地素材导出的根目录"
                    readonly
                    class="config-input"
                  />
                  <NButton @click="selectLocalRootDir">选择目录</NButton>
                </div>
                <div class="config-hint">目录结构: 根目录/M.D导出/剧名/视频文件</div>
              </div>
              <div class="compact-field">
                <div class="compact-label">任务重试次数</div>
                <div class="compact-control">
                  <NInputNumber
                    v-model:value="schedulerConfig.maxTaskRetries"
                    :min="0"
                    :max="5"
                    :step="1"
                    style="width: 100%"
                    @update:value="saveSchedulerConfig"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </NCard>

    <!-- 需要登录提示 -->
    <NAlert
      v-if="isReady && needLogin"
      type="warning"
      title="需要登录"
      class="login-alert"
    >
      请在弹出的浏览器窗口中登录巨量创意后台。登录后系统会自动检测并继续上传任务。
    </NAlert>

    <!-- 高级配置 -->
    <NCollapse
      class="advanced-config"
      :expanded-names="expandedPanels"
      @update:expanded-names="handleExpandedNamesChange"
    >
      <NCollapseItem title="高级配置" name="config">
        <div class="advanced-config-content">
          <div class="config-grid">
            <div class="config-row">
              <span class="config-label">无头模式</span>
              <NSwitch
                v-model:value="config.headless"
                @update:value="saveConfig"
              />
              <span class="config-desc">开启后浏览器窗口不可见</span>
            </div>
            <div class="config-row">
              <span class="config-label">每批文件数</span>
              <NInputNumber
                v-model:value="config.batchSize"
                :min="1"
                :max="50"
                style="width: 120px"
                @update:value="saveConfig"
              />
              <span class="config-desc">每次上传的文件数量</span>
            </div>
            <div class="config-row">
              <span class="config-label">单批超时(分钟)</span>
              <NInputNumber
                v-model:value="config.batchUploadTimeoutMinutes"
                :min="1"
                :max="60"
                style="width: 120px"
                @update:value="saveConfig"
              />
              <span class="config-desc"
                >单批上传超过该时间仍未结束，就按超时处理</span
              >
            </div>
            <div class="config-row">
              <span class="config-label">批次重试次数</span>
              <NInputNumber
                v-model:value="config.maxBatchRetries"
                :min="0"
                :max="10"
                :step="1"
                style="width: 120px"
                @update:value="saveConfig"
              />
              <span class="config-desc">单批失败后最多额外重试的次数</span>
            </div>
            <div class="config-row">
              <span class="config-label">容许缺失个数</span>
              <NInputNumber
                v-model:value="config.allowedMissingCount"
                :min="0"
                :max="10"
                :step="1"
                style="width: 120px"
                @update:value="saveConfig"
              />
              <span class="config-desc"
                >例如一批 10 个文件，设置为 2，则最终剩 8
                个成功进度条也会点确定继续</span
              >
            </div>
            <div class="config-row">
              <span class="config-label">任务重试次数</span>
              <NInputNumber
                v-model:value="schedulerConfig.maxTaskRetries"
                :min="0"
                :max="5"
                :step="1"
                style="width: 120px"
                @update:value="saveSchedulerConfig"
              />
              <span class="config-desc"
                >调度器模式下整部剧上传失败后最多额外重试的次数</span
              >
            </div>
          </div>
        </div>
      </NCollapseItem>

      <NCollapseItem title="运行日志" name="logs">
        <div class="advanced-config-content">
          <div class="log-panel-actions">
            <NButton size="small" quaternary @click="clearLogs">清空</NButton>
          </div>
          <div class="log-container">
            <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
            <div v-for="(log, index) in logs" :key="index" class="log-item">
              <span class="log-time">[{{ log.time }}]</span>
              <span class="log-message">{{ log.message }}</span>
            </div>
          </div>
        </div>
      </NCollapseItem>
    </NCollapse>
  </div>
</template>

<style scoped>
.juliang-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
  background: #f5f7fa;
}

.overview-card,
.status-card,
.quick-card,
.advanced-config {
  background: #fff;
}

.hero-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.hero-title {
  font-size: 24px;
  font-weight: 700;
  color: #1f2937;
}

.hero-actions {
  justify-content: flex-end;
}

.hero-action-btn {
  border-radius: 999px;
}

.status-header {
  margin-bottom: 14px;
}

.status-message {
  font-size: 16px;
  font-weight: 600;
  color: #2563eb;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 12px;
}

.current-drama-section {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 20px;
}

.upload-task-section.cancelled {
  border-color: #cbd5e1;
}

.drama-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.drama-name {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}

.drama-tag {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  background: #e2e8f0;
  color: #475569;
}

.progress-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.progress-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid #dbe4f0;
}

.progress-chip-label {
  font-size: 13px;
  color: #64748b;
}

.progress-chip-value {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}

.progress-bar-container {
  height: 8px;
  background: #e2e8f0;
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: #3b82f6;
  transition: width 0.3s ease;
}

.status-collapse {
  margin-top: 20px;
  background: transparent;
}

.status-collapse :deep(.n-collapse-item) {
  background: transparent;
}

.status-collapse :deep(.n-collapse-item__header) {
  padding: 8px 0 12px !important;
  font-size: 14px;
  font-weight: 600;
  color: #475569;
}

.status-collapse :deep(.n-collapse-item__content-inner) {
  padding-top: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
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
  border-radius: 12px;
}

.log-container {
  height: 250px;
  overflow-y: auto;
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border-radius: 6px;
  font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
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
  border-radius: 12px;
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
  width: 112px;
  flex-shrink: 0;
  white-space: nowrap;
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

.log-panel-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.config-groups {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.config-group {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
}

.config-group-row {
  display: flex;
  gap: 24px;
}

.config-group.half {
  flex: 1;
  min-width: 0;
}

.group-header {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e2e8f0;
}

.group-title {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
}

.group-desc {
  font-size: 13px;
  color: #64748b;
  margin-top: 4px;
}

.compact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.compact-field {
  min-width: 0;
}

.compact-field-wide {
  grid-column: 1 / -1;
}

.compact-label {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  letter-spacing: 0.02em;
}

.compact-control {
  min-width: 0;
}

.compact-control-inline {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}

.config-input {
  width: 100%;
}

.config-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #94a3b8;
}

@media (max-width: 900px) {
  .hero-row {
    display: grid;
    grid-template-columns: 1fr;
  }

  .progress-meta {
    flex-direction: column;
    align-items: stretch;
  }

  .config-group-row {
    flex-direction: column;
  }

  .compact-grid,
  .compact-control-inline {
    grid-template-columns: 1fr;
  }
}
</style>
