<script setup lang="ts">
defineOptions({ name: "UploadBuild" });

import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NInput,
  NInputNumber,
  NProgress,
  NSwitch,
  NTag,
  NTooltip,
  useMessage,
} from "naive-ui";

interface DramaUploadRow {
  id: string;
  drama: string;
  folderPath: string;
  files: string[];
  materialCount: number;
  accountId: string;
  status: "pending" | "uploading" | "uploaded" | "failed";
  error?: string;
  taskId?: string;
  currentBatch: number;
  totalBatches: number;
  successCount: number;
  totalFiles: number;
  deleted: boolean;
  deleteError?: string;
}

interface JuliangUploadProgressPayload {
  taskId: string;
  drama: string;
  status: string;
  currentBatch: number;
  totalBatches: number;
  successCount: number;
  totalFiles: number;
  message: string;
}

interface JuliangUploadResult {
  success: boolean;
  taskId: string;
  drama: string;
  successCount: number;
  totalFiles: number;
  skipped?: boolean;
  error?: string;
}

const ROOT_DIR_STORAGE_KEY = "upload-build:root-dir";
const DELETE_AFTER_UPLOAD_STORAGE_KEY = "upload-build:delete-after-upload";

const message = useMessage();

const rootDir = ref("");
const rows = ref<DramaUploadRow[]>([]);
const isScanning = ref(false);
const isInitializing = ref(false);
const isReady = ref(false);
const needLogin = ref(false);
const logs = ref<Array<{ time: string; message: string }>>([]);
const currentProgress = ref<JuliangUploadProgressPayload | null>(null);

const uploadConfig = ref({
  baseUploadUrl: "",
  batchSize: 10,
  headless: false,
  allowedMissingCount: 0,
  deleteAfterUpload: false,
});

let unsubscribeProgress: (() => void) | null = null;
let unsubscribeLog: (() => void) | null = null;

const totalDramaCount = computed(() => rows.value.length);
const totalMaterialCount = computed(() =>
  rows.value.reduce((sum, row) => sum + row.materialCount, 0)
);
const uploadedDramaCount = computed(
  () => rows.value.filter((row) => row.status === "uploaded").length
);
const failedDramaCount = computed(
  () => rows.value.filter((row) => row.status === "failed").length
);
const activeRow = computed(
  () => rows.value.find((row) => row.status === "uploading") || null
);

const browserStatusText = computed(() => {
  if (isInitializing.value) return "初始化中";
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

function getAccountStorageKey(dirPath: string): string {
  return `upload-build:accounts:${encodeURIComponent(dirPath)}`;
}

function loadStoredAccounts(dirPath: string): Record<string, string> {
  if (!dirPath) return {};
  try {
    const raw = localStorage.getItem(getAccountStorageKey(dirPath));
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error("加载账户缓存失败:", error);
    return {};
  }
}

function saveStoredAccount(row: DramaUploadRow) {
  if (!rootDir.value) return;
  const current = loadStoredAccounts(rootDir.value);
  current[row.folderPath] = row.accountId;
  localStorage.setItem(getAccountStorageKey(rootDir.value), JSON.stringify(current));
}

function getFolderPath(filePath: string): string {
  return filePath.replace(/[\\/][^\\/]+$/, "");
}

function getRowStatusType(status: DramaUploadRow["status"]) {
  if (status === "uploaded") return "success";
  if (status === "failed") return "error";
  if (status === "uploading") return "info";
  return "default";
}

function getRowStatusText(row: DramaUploadRow) {
  if (row.status === "uploaded") {
    if (row.deleteError) return "已上传，删除失败";
    if (row.deleted) return "已上传，已删除本地目录";
    return "已上传";
  }
  if (row.status === "failed") return "上传失败";
  if (row.status === "uploading") return "上传中";
  return "待上传";
}

function getUploadButtonText(row: DramaUploadRow) {
  if (row.status === "failed") return "重新上传";
  return "开始上传";
}

async function initializeBrowser() {
  if (isInitializing.value) return { success: false, error: "浏览器初始化中" };

  isInitializing.value = true;
  try {
    const result = await window.api.juliangInitialize();
    if (result.success) {
      isReady.value = true;
      const loginStatus = await window.api.juliangCheckLogin();
      needLogin.value = loginStatus.needLogin;
    }
    return result;
  } finally {
    isInitializing.value = false;
  }
}

async function ensureBrowserReady() {
  if (!isReady.value) {
    const initResult = await initializeBrowser();
    if (!initResult.success) {
      message.error(`浏览器初始化失败: ${initResult.error || "未知错误"}`);
      return false;
    }
  }

  const loginStatus = await window.api.juliangCheckLogin();
  needLogin.value = loginStatus.needLogin;
  if (needLogin.value) {
    message.warning("请先在弹出的浏览器中登录巨量创意后台");
    return false;
  }

  return true;
}

async function loadUploadConfig() {
  try {
    const config = await window.api.juliangGetConfig();
    uploadConfig.value = {
      ...uploadConfig.value,
      ...config,
      deleteAfterUpload:
        localStorage.getItem(DELETE_AFTER_UPLOAD_STORAGE_KEY) === "1",
    };
  } catch (error) {
    console.error("加载巨量配置失败:", error);
  }
}

async function applyUploadConfig(
  patch: Partial<typeof uploadConfig.value>,
  options?: { resetBrowser?: boolean }
) {
  const nextConfig = {
    ...uploadConfig.value,
    ...patch,
  };
  nextConfig.batchSize = Math.max(1, Math.floor(Number(nextConfig.batchSize || 1)));
  nextConfig.allowedMissingCount = Math.max(
    0,
    Math.floor(Number(nextConfig.allowedMissingCount || 0))
  );

  uploadConfig.value = nextConfig;

  localStorage.setItem(
    DELETE_AFTER_UPLOAD_STORAGE_KEY,
    uploadConfig.value.deleteAfterUpload ? "1" : "0"
  );

  const { deleteAfterUpload: _deleteAfterUpload, ...serviceConfig } =
    uploadConfig.value;
  try {
    await window.api.juliangUpdateConfig(serviceConfig);
  } catch (error) {
    message.error(`更新巨量配置失败: ${error}`);
    return;
  }

  if (options?.resetBrowser && !activeRow.value && isReady.value) {
    await window.api.juliangClose();
    isReady.value = false;
    needLogin.value = false;
  }
}

async function selectRootDir() {
  try {
    const selected = await window.api.selectFolder();
    if (!selected) return;

    rootDir.value = selected;
    localStorage.setItem(ROOT_DIR_STORAGE_KEY, selected);
    await scanRootDir();
  } catch (error) {
    message.error(`选择目录失败: ${error}`);
  }
}

async function scanRootDir() {
  if (!rootDir.value) {
    rows.value = [];
    return;
  }

  isScanning.value = true;
  try {
    const materials = await window.api.scanVideos(rootDir.value);
    const previousRowMap = new Map(
      rows.value.map((row) => [row.folderPath, row])
    );
    const storedAccounts = loadStoredAccounts(rootDir.value);
    const grouped = new Map<
      string,
      { drama: string; folderPath: string; files: string[] }
    >();

    for (const material of materials) {
      const existing = grouped.get(material.dramaName);
      if (existing) {
        existing.files.push(material.filePath);
        continue;
      }

      grouped.set(material.dramaName, {
        drama: material.dramaName,
        folderPath: getFolderPath(material.filePath),
        files: [material.filePath],
      });
    }

    rows.value = Array.from(grouped.values())
      .sort((a, b) => a.drama.localeCompare(b.drama, "zh-Hans-CN"))
      .map((group) => {
        const previous = previousRowMap.get(group.folderPath);
        const preservedStatus =
          previous &&
          previous.materialCount === group.files.length &&
          previous.files.join("|") === group.files.join("|") &&
          previous.status !== "uploading"
            ? previous.status
            : "pending";

        return {
          id: `${group.folderPath}-${group.files.length}`,
          drama: group.drama,
          folderPath: group.folderPath,
          files: [...group.files],
          materialCount: group.files.length,
          accountId:
            previous?.accountId ?? storedAccounts[group.folderPath] ?? "",
          status: preservedStatus,
          error:
            preservedStatus === "failed" ? previous?.error : undefined,
          taskId: undefined,
          currentBatch: preservedStatus === "uploaded"
            ? previous?.currentBatch || 0
            : 0,
          totalBatches: preservedStatus === "uploaded"
            ? previous?.totalBatches || 0
            : 0,
          successCount:
            preservedStatus === "uploaded"
              ? previous?.successCount || group.files.length
              : 0,
          totalFiles:
            preservedStatus === "uploaded"
              ? previous?.totalFiles || group.files.length
              : group.files.length,
          deleted: preservedStatus === "uploaded" ? previous?.deleted || false : false,
          deleteError:
            preservedStatus === "uploaded" ? previous?.deleteError : undefined,
        };
      });
  } catch (error) {
    console.error("扫描目录失败:", error);
    message.error(`扫描目录失败: ${error}`);
  } finally {
    isScanning.value = false;
  }
}

function handleAccountInput(row: DramaUploadRow, value: string) {
  row.accountId = value.trim();
  saveStoredAccount(row);
}

function updateRowProgress(progress: JuliangUploadProgressPayload) {
  const row = rows.value.find((item) => item.taskId === progress.taskId);
  if (!row) return;

  row.currentBatch = progress.currentBatch;
  row.totalBatches = progress.totalBatches;
  row.successCount = progress.successCount;
  row.totalFiles = progress.totalFiles;

  if (progress.status === "uploading" || progress.status === "running") {
    row.status = "uploading";
  }
}

async function startUpload(row: DramaUploadRow) {
  if (activeRow.value && activeRow.value.id !== row.id) {
    message.warning(`当前正在上传《${activeRow.value.drama}》，请等待完成后再试`);
    return;
  }

  if (!row.accountId.trim()) {
    message.warning("请先输入账户");
    return;
  }

  const ready = await ensureBrowserReady();
  if (!ready) {
    return;
  }

  row.status = "uploading";
  row.error = undefined;
  row.deleteError = undefined;
  row.deleted = false;
  row.successCount = 0;
  row.totalFiles = row.materialCount;
  row.currentBatch = 0;
  row.totalBatches = 0;
  row.taskId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  currentProgress.value = {
    taskId: row.taskId,
    drama: row.drama,
    status: "running",
    currentBatch: 0,
    totalBatches: 0,
    successCount: 0,
    totalFiles: row.materialCount,
    message: "开始上传",
  };

  try {
    const result = (await window.api.juliangUploadTask({
      id: row.taskId,
      drama: row.drama,
      date: new Date().toISOString().slice(0, 10),
      account: "manual",
      accountId: row.accountId.trim(),
      files: row.files,
      recordId: "",
      status: "pending",
    })) as JuliangUploadResult;

    if (!result.success) {
      row.status = "failed";
      row.error = result.error || "上传失败";
      message.error(`《${row.drama}》上传失败：${row.error}`);
      return;
    }

    row.status = "uploaded";
    row.successCount = result.successCount;
    row.totalFiles = result.totalFiles;
    row.error = undefined;
    message.success(`《${row.drama}》上传完成`);

    if (uploadConfig.value.deleteAfterUpload) {
      const deleteResult = await window.api.deleteFolder(row.folderPath);
      if (deleteResult.success) {
        row.deleted = true;
      } else {
        row.deleteError = deleteResult.error || "未知错误";
        message.warning(
          `《${row.drama}》上传成功，但删除目录失败：${row.deleteError}`
        );
      }
    }
  } catch (error) {
    row.status = "failed";
    row.error = error instanceof Error ? error.message : String(error);
    message.error(`《${row.drama}》上传失败：${row.error}`);
  }
}

function startBuild(row: DramaUploadRow) {
  message.info(`《${row.drama}》的搭建流程暂未接入`);
}

function getDisabledUploadTip(row: DramaUploadRow) {
  if (!row.accountId.trim()) {
    return "请先输入账户";
  }
  if (activeRow.value && activeRow.value.id !== row.id) {
    return `当前正在上传《${activeRow.value.drama}》`;
  }
  return "";
}

async function loadLogs() {
  try {
    logs.value = await window.api.juliangGetLogs();
  } catch (error) {
    console.error("加载日志失败:", error);
  }
}

onMounted(async () => {
  await loadUploadConfig();

  const savedRootDir = localStorage.getItem(ROOT_DIR_STORAGE_KEY);
  if (savedRootDir) {
    rootDir.value = savedRootDir;
    await scanRootDir();
  }

  isReady.value = await window.api.juliangIsReady();
  if (isReady.value) {
    const loginStatus = await window.api.juliangCheckLogin();
    needLogin.value = loginStatus.needLogin;
  }

  await loadLogs();

  unsubscribeProgress = window.api.onJuliangUploadProgress((progress) => {
    currentProgress.value = progress;
    updateRowProgress(progress);
  });

  unsubscribeLog = window.api.onJuliangLog((log) => {
    logs.value.push(log);
    if (logs.value.length > 500) {
      logs.value.shift();
    }
  });
});

onUnmounted(() => {
  if (unsubscribeProgress) unsubscribeProgress();
  if (unsubscribeLog) unsubscribeLog();
});
</script>

<template>
  <div class="upload-build-page">
    <div class="status-bar">
      <div class="status-item">
        <span class="status-label">浏览器</span>
        <NTag :type="browserStatusType" size="small">{{ browserStatusText }}</NTag>
      </div>
      <div class="status-item">
        <span class="status-label">剧目数</span>
        <span class="status-value">{{ totalDramaCount }}</span>
      </div>
      <div class="status-item">
        <span class="status-label">素材总数</span>
        <span class="status-value">{{ totalMaterialCount }}</span>
      </div>
      <div class="status-item">
        <span class="status-label">已上传</span>
        <span class="status-value success">{{ uploadedDramaCount }}</span>
      </div>
      <div class="status-item">
        <span class="status-label">失败</span>
        <span class="status-value error">{{ failedDramaCount }}</span>
      </div>
    </div>

    <NCard class="main-card">
      <div class="toolbar">
        <div class="toolbar-main">
          <span class="toolbar-label">素材目录</span>
          <NInput
            v-model:value="rootDir"
            readonly
            placeholder="选择目录，目录下每个子文件夹都视为一部剧"
            class="toolbar-input"
          />
          <NButton :disabled="!!activeRow" @click="selectRootDir">选择目录</NButton>
          <NButton :disabled="!rootDir || !!activeRow" :loading="isScanning" @click="scanRootDir">
            {{ isScanning ? "扫描中..." : "重新扫描" }}
          </NButton>
        </div>
        <div class="toolbar-hint">
          目录结构：指定目录 / 剧名文件夹 / 素材视频文件
        </div>
      </div>

      <div class="config-panel">
        <div class="config-row">
          <span class="config-label">上传后删除本地目录</span>
          <NSwitch
            :value="uploadConfig.deleteAfterUpload"
            @update:value="(value) => applyUploadConfig({ deleteAfterUpload: value })"
          />
          <span class="config-desc">上传成功后删除该剧目录及其素材</span>
        </div>
      </div>
    </NCard>

    <NCard v-if="currentProgress && activeRow" class="progress-card">
      <div class="progress-header">
        <span class="progress-title">{{ currentProgress.drama }}</span>
        <span class="progress-message">{{ currentProgress.message }}</span>
      </div>
      <div class="progress-meta">
        <span>批次 {{ currentProgress.currentBatch }}/{{ currentProgress.totalBatches || 0 }}</span>
        <span>成功 {{ currentProgress.successCount }}/{{ currentProgress.totalFiles }}</span>
      </div>
      <NProgress
        type="line"
        :height="22"
        :percentage="
          currentProgress.totalFiles > 0
            ? Math.round((currentProgress.successCount / currentProgress.totalFiles) * 100)
            : 0
        "
        indicator-placement="inside"
      />
    </NCard>

    <NAlert
      v-if="isReady && needLogin"
      type="warning"
      title="需要登录巨量创意后台"
      class="login-alert"
    >
      请先在弹出的浏览器窗口中完成登录，再点击剧目的“开始上传”。
    </NAlert>

    <NCard class="table-card">
      <template #header>
        <div class="table-header">
          <span>上传列表</span>
          <span class="table-header-desc">每部剧单独填写账户并手动触发上传</span>
        </div>
      </template>

      <NEmpty v-if="rows.length === 0" description="请选择目录并扫描剧目" />

      <div v-else class="drama-table">
        <table>
          <thead>
            <tr>
              <th>剧名</th>
              <th>素材数</th>
              <th>账户</th>
              <th>状态</th>
              <th>进度</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td class="drama-cell">
                <div class="drama-name">{{ row.drama }}</div>
                <div class="drama-path">{{ row.folderPath }}</div>
                <div v-if="row.error || row.deleteError" class="row-error">
                  {{ row.error || row.deleteError }}
                </div>
              </td>
              <td>{{ row.materialCount }}</td>
              <td>
                <NInput
                  :value="row.accountId"
                  placeholder="请输入巨量账户 ID"
                  :disabled="row.status === 'uploading'"
                  @update:value="(value) => handleAccountInput(row, value)"
                />
              </td>
              <td>
                <div class="status-stack">
                  <NTag :type="getRowStatusType(row.status)" size="small">
                    {{ getRowStatusText(row) }}
                  </NTag>
                  <NTag v-if="row.deleted" type="success" size="small" round>
                    本地已删除
                  </NTag>
                </div>
              </td>
              <td>
                <div class="progress-cell">
                  <span>{{ row.successCount }}/{{ row.totalFiles || row.materialCount }}</span>
                  <span v-if="row.totalBatches > 0">
                    批次 {{ row.currentBatch }}/{{ row.totalBatches }}
                  </span>
                </div>
              </td>
              <td>
                <NButton
                  v-if="row.status === 'uploaded'"
                  type="success"
                  @click="startBuild(row)"
                >
                  开始搭建
                </NButton>
                <NButton
                  v-else-if="row.status === 'uploading'"
                  type="primary"
                  loading
                >
                  上传中
                </NButton>
                <NTooltip v-else-if="getDisabledUploadTip(row)">
                  <template #trigger>
                    <span class="button-trigger">
                      <NButton disabled>{{ getUploadButtonText(row) }}</NButton>
                    </span>
                  </template>
                  {{ getDisabledUploadTip(row) }}
                </NTooltip>
                <NButton v-else type="primary" @click="startUpload(row)">
                  {{ getUploadButtonText(row) }}
                </NButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </NCard>

    <NCollapse class="advanced-config">
      <NCollapseItem title="巨量高级配置" name="advanced-config">
        <div class="advanced-config-grid">
          <div class="config-row">
            <span class="config-label">每批文件数</span>
            <NInputNumber
              :value="uploadConfig.batchSize"
              :min="1"
              :max="50"
              @update:value="
                (value) =>
                  applyUploadConfig({ batchSize: Math.max(1, Number(value || 1)) })
              "
            />
            <span class="config-desc">新任务会按最新批量配置切批上传</span>
          </div>
          <div class="config-row">
            <span class="config-label">允许缺失数</span>
            <NInputNumber
              :value="uploadConfig.allowedMissingCount"
              :min="0"
              :max="10"
              @update:value="
                (value) =>
                  applyUploadConfig({
                    allowedMissingCount: Math.max(0, Number(value || 0)),
                  })
              "
            />
            <span class="config-desc">每批允许缺失的最终进度条数量</span>
          </div>
          <div class="config-row">
            <span class="config-label">无头模式</span>
            <NSwitch
              :value="uploadConfig.headless"
              :disabled="!!activeRow"
              @update:value="
                (value) =>
                  applyUploadConfig({ headless: value }, { resetBrowser: true })
              "
            />
            <span class="config-desc">空闲时修改会关闭浏览器，下次上传按新配置重启</span>
          </div>
        </div>
      </NCollapseItem>
    </NCollapse>

    <NCollapse class="log-panel">
      <NCollapseItem title="上传日志" name="upload-logs">
        <div class="log-container">
          <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
          <div v-for="(log, index) in logs" :key="`${log.time}-${index}`" class="log-item">
            <span class="log-time">[{{ log.time }}]</span>
            <span class="log-message">{{ log.message }}</span>
          </div>
        </div>
      </NCollapseItem>
    </NCollapse>
  </div>
</template>

<style scoped>
.upload-build-page {
  padding: 20px;
  min-height: 100%;
  background:
    radial-gradient(circle at top left, rgba(255, 176, 59, 0.14), transparent 24%),
    linear-gradient(180deg, #f8fbff 0%, #f3f5f8 100%);
}

.status-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid #e7ebf0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 12px 30px rgba(37, 48, 77, 0.06);
}

.status-label {
  color: #7b8597;
  font-size: 13px;
}

.status-value {
  color: #202531;
  font-size: 24px;
  font-weight: 700;
}

.status-value.success {
  color: #0f9d5b;
}

.status-value.error {
  color: #cf3f3f;
}

.main-card,
.table-card,
.progress-card,
.advanced-config,
.log-panel {
  margin-bottom: 16px;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toolbar-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toolbar-label,
.config-label {
  width: 152px;
  flex-shrink: 0;
  color: #59657a;
  font-size: 14px;
}

.toolbar-input {
  flex: 1;
}

.toolbar-hint,
.config-desc,
.table-header-desc,
.drama-path {
  color: #8a94a7;
  font-size: 12px;
}

.config-panel {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #eef2f6;
}

.config-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
}

.progress-header,
.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.progress-title {
  font-size: 18px;
  font-weight: 700;
  color: #1d2433;
}

.progress-message,
.progress-meta {
  color: #667089;
}

.progress-meta {
  display: flex;
  gap: 16px;
  margin: 12px 0;
}

.drama-table {
  overflow-x: auto;
}

.drama-table table {
  width: 100%;
  border-collapse: collapse;
}

.drama-table th,
.drama-table td {
  padding: 14px 12px;
  border-bottom: 1px solid #edf1f5;
  text-align: left;
  vertical-align: top;
}

.drama-table th {
  color: #667089;
  font-size: 13px;
  font-weight: 600;
  background: #f7f9fc;
}

.drama-name {
  color: #1e2430;
  font-size: 15px;
  font-weight: 700;
}

.drama-cell {
  min-width: 260px;
}

.row-error {
  margin-top: 8px;
  color: #d03050;
  font-size: 12px;
  line-height: 1.5;
}

.status-stack,
.progress-cell {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.button-trigger {
  display: inline-flex;
}

.advanced-config-grid {
  display: grid;
  gap: 14px;
}

.log-container {
  max-height: 320px;
  overflow-y: auto;
  border-radius: 10px;
  background: #11161f;
  padding: 14px;
}

.log-empty {
  color: #8d98ab;
  text-align: center;
  padding: 24px 0;
}

.log-item {
  color: #d8deea;
  font-family: "SFMono-Regular", "Menlo", "Monaco", monospace;
  font-size: 12px;
  line-height: 1.7;
}

.log-time {
  color: #8fd5b3;
  margin-right: 8px;
}

@media (max-width: 960px) {
  .toolbar-main,
  .config-row,
  .progress-header,
  .table-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .toolbar-label,
  .config-label {
    width: auto;
  }
}
</style>
