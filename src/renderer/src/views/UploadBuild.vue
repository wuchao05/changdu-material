<script setup lang="ts">
defineOptions({ name: "UploadBuild" });

import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NInput,
  NInputNumber,
  NModal,
  NProgress,
  NSelect,
  NSwitch,
  NTag,
  NTooltip,
  useMessage,
} from "naive-ui";
import { useAuthStore } from "../stores/auth";
import {
  useDarenStore,
  type DarenInfo,
  type DouyinMaterialRule,
  type UploadBuildSettings,
} from "../stores/daren";

type UploadStatus = "pending" | "uploading" | "uploaded" | "failed";
type BuildStatus = "idle" | "building" | "built" | "failed" | "cancelled";
type RowEntryMode = "local" | "build-only";

interface DramaUploadRow {
  id: string;
  entryMode: RowEntryMode;
  drama: string;
  folderPath: string;
  files: string[];
  materialCount: number;
  accountId: string;
  dramaId: string;
  status: UploadStatus;
  error?: string;
  taskId?: string;
  currentBatch: number;
  totalBatches: number;
  successCount: number;
  totalFiles: number;
  deleted: boolean;
  deleteError?: string;
  buildStatus: BuildStatus;
  buildTaskId?: string;
  buildError?: string;
  buildMessage?: string;
  buildSuccessRuleCount: number;
  buildFailedRuleCount: number;
  buildTotalRules: number;
  skippedRules: Array<{ douyinAccount: string; error: string }>;
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

interface DailyBuildProgressPayload {
  taskId: string;
  drama: string;
  status: string;
  message: string;
  currentRuleIndex: number;
  totalRules: number;
  successRuleCount: number;
  failedRuleCount: number;
}

interface DailyBuildResult {
  success: boolean;
  cancelled?: boolean;
  taskId: string;
  drama: string;
  totalRules: number;
  successRuleCount: number;
  failedRuleCount: number;
  skippedRules: Array<{
    ruleId: string;
    douyinAccount: string;
    error: string;
  }>;
  error?: string;
}

const ROOT_DIR_STORAGE_KEY = "upload-build:root-dir";
const DELETE_AFTER_UPLOAD_STORAGE_KEY = "upload-build:delete-after-upload";
const BUILD_SETTINGS_SAVE_DELAY = 300;
const COLLAPSIBLE_SECTION_NAMES = [
  "build-config",
  "douyin-rules",
  "upload-list",
];

const authStore = useAuthStore();
const darenStore = useDarenStore();
const message = useMessage();

const rootDir = ref("");
const rows = ref<DramaUploadRow[]>([]);
const isScanning = ref(false);
const isRenaming = ref(false);
const isInitializing = ref(false);
const isReady = ref(false);
const needLogin = ref(false);
const logs = ref<Array<{ time: string; message: string }>>([]);
const buildLogs = ref<Array<{ time: string; message: string }>>([]);
const currentProgress = ref<JuliangUploadProgressPayload | null>(null);
const currentBuildProgress = ref<DailyBuildProgressPayload | null>(null);
const buildSettings = ref<UploadBuildSettings>(createDefaultBuildSettings());
const ruleModalVisible = ref(false);
const editingRuleId = ref<string | null>(null);
const ruleForm = ref<DouyinMaterialRule>(createEmptyRule());

const uploadConfig = ref({
  baseUploadUrl: "",
  batchSize: 10,
  headless: false,
  allowedMissingCount: 0,
  deleteAfterUpload: false,
});

let unsubscribeProgress: (() => void) | null = null;
let unsubscribeLog: (() => void) | null = null;
let unsubscribeBuildProgress: (() => void) | null = null;
let unsubscribeBuildLog: (() => void) | null = null;
let buildSettingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let syncingBuildSettings = false;
const cancelledTaskIds = new Set<string>();

const totalDramaCount = computed(() => rows.value.length);
const totalMaterialCount = computed(() =>
  rows.value.reduce((sum, row) => sum + row.materialCount, 0)
);
const uploadedDramaCount = computed(
  () => rows.value.filter((row) => row.status === "uploaded").length
);
const builtDramaCount = computed(
  () => rows.value.filter((row) => row.buildStatus === "built").length
);
const failedDramaCount = computed(
  () =>
    rows.value.filter(
      (row) => row.status === "failed" || row.buildStatus === "failed"
    ).length
);
const activeRow = computed(
  () => rows.value.find((row) => row.status === "uploading") || null
);
const activeBuildRow = computed(
  () => rows.value.find((row) => row.buildStatus === "building") || null
);
const currentDaren = computed<DarenInfo | null>(() => darenStore.currentDaren);
const darenOptions = computed(() =>
  darenStore.darenList
    .filter((item) => authStore.isAdmin || item.enableUploadBuild)
    .map((item) => ({
      label: `${item.label} (${item.id})`,
      value: item.id,
    }))
);
const validDouyinRules = computed(() =>
  buildSettings.value.douyinMaterialRules.filter(
    (rule) =>
      rule.douyinAccount.trim() &&
      rule.douyinAccountId.trim() &&
      rule.materialRange.trim()
  )
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

function createDefaultBuildSettings(): UploadBuildSettings {
  return {
    buildParams: {
      secretKey: "",
      source: "",
      bid: 5,
      productId: "",
      productPlatformId: "",
      landingUrl: "",
      microAppName: "",
      microAppId: "",
      ccId: "",
      rechargeTemplateId: "",
    },
    darenName: "小鱼",
    materialFilenameTemplate: "{日期}-{剧名}-{简称}-{序号}.mp4",
    materialDateValue: "",
    douyinMaterialRules: [],
  };
}

function createEmptyRule(): DouyinMaterialRule {
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    douyinAccount: "",
    douyinAccountId: "",
    shortName: "",
    materialRange: "",
    createdAt: now,
    updatedAt: now,
  };
}

function cloneBuildSettings(source?: UploadBuildSettings): UploadBuildSettings {
  return JSON.parse(
    JSON.stringify(source || createDefaultBuildSettings())
  ) as UploadBuildSettings;
}

function normalizeRule(rule?: Partial<DouyinMaterialRule>): DouyinMaterialRule {
  const now = new Date().toISOString();
  return {
    id: rule?.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    douyinAccount: rule?.douyinAccount?.trim() || "",
    douyinAccountId: rule?.douyinAccountId?.trim() || "",
    shortName: rule?.shortName?.trim() || "",
    materialRange: rule?.materialRange?.trim() || "",
    createdAt: rule?.createdAt || now,
    updatedAt: rule?.updatedAt || now,
  };
}

function normalizeBuildSettings(
  settings?: Partial<UploadBuildSettings>
): UploadBuildSettings {
  const defaults = createDefaultBuildSettings();
  return {
    buildParams: {
      ...defaults.buildParams,
      ...(settings?.buildParams || {}),
    },
    darenName: settings?.darenName?.trim() || defaults.darenName,
    materialFilenameTemplate:
      settings?.materialFilenameTemplate?.trim() ||
      defaults.materialFilenameTemplate,
    materialDateValue: settings?.materialDateValue?.trim() || "",
    douyinMaterialRules: Array.isArray(settings?.douyinMaterialRules)
      ? settings!.douyinMaterialRules.map((rule) => normalizeRule(rule))
      : [],
  };
}

function getAccountStorageKey(dirPath: string): string {
  return `upload-build:accounts:${encodeURIComponent(dirPath)}`;
}

function getDramaIdStorageKey(dirPath: string): string {
  return `upload-build:drama-ids:${encodeURIComponent(dirPath)}`;
}

function loadStoredMap(dirPath: string, storageKeyFactory: (dir: string) => string) {
  if (!dirPath) return {};
  try {
    const raw = localStorage.getItem(storageKeyFactory(dirPath));
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error("读取本地缓存失败:", error);
    return {};
  }
}

function saveStoredValue(
  dirPath: string,
  storageKeyFactory: (dir: string) => string,
  key: string,
  value: string
) {
  if (!dirPath) return;
  const current = loadStoredMap(dirPath, storageKeyFactory);
  current[key] = value;
  localStorage.setItem(storageKeyFactory(dirPath), JSON.stringify(current));
}

function getFolderPath(filePath: string): string {
  return filePath.replace(/[\\/][^\\/]+$/, "");
}

function getRowStatusType(status: UploadStatus) {
  if (status === "uploaded") return "success";
  if (status === "failed") return "error";
  if (status === "uploading") return "info";
  return "default";
}

function getBuildStatusType(status: BuildStatus) {
  if (status === "built") return "success";
  if (status === "failed") return "error";
  if (status === "building") return "warning";
  if (status === "cancelled") return "default";
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

function getBuildStatusText(row: DramaUploadRow) {
  if (row.buildStatus === "built") return "已搭建";
  if (row.buildStatus === "failed") return "搭建失败";
  if (row.buildStatus === "building") return "搭建中";
  if (row.buildStatus === "cancelled") return "已取消";
  return "待搭建";
}

function getCombinedStatusType(row: DramaUploadRow) {
  if (row.buildStatus === "idle" && row.status === "uploaded") {
    return getBuildStatusType("idle");
  }
  if (row.buildStatus !== "idle") {
    return getBuildStatusType(row.buildStatus);
  }
  return getRowStatusType(row.status);
}

function getCombinedStatusText(row: DramaUploadRow) {
  if (row.buildStatus === "idle" && row.status === "uploaded") {
    return getBuildStatusText(row);
  }
  if (row.buildStatus !== "idle") {
    return getBuildStatusText(row);
  }
  return getRowStatusText(row);
}

function getUploadButtonText(row: DramaUploadRow) {
  if (row.status === "failed") return "重新上传";
  return "开始上传";
}

function getBuildButtonText(row: DramaUploadRow) {
  if (row.buildStatus === "failed" || row.buildStatus === "cancelled") {
    return "重新搭建";
  }
  return "开始搭建";
}

function handleAdminDarenChange(value: string | null) {
  darenStore.setSelectedDaren(value);
}

function ensureAdminSelectedDaren() {
  if (!authStore.isAdmin) return;
  if (darenStore.currentDaren) return;
  const preferred =
    darenStore.darenList.find((item) => item.enableUploadBuild) ||
    darenStore.darenList[0];
  if (preferred) {
    darenStore.setSelectedDaren(preferred.id);
  }
}

function schedulePersistBuildSettings() {
  if (syncingBuildSettings || !currentDaren.value) {
    return;
  }

  if (buildSettingsSaveTimer) {
    clearTimeout(buildSettingsSaveTimer);
  }

  buildSettingsSaveTimer = setTimeout(async () => {
    if (!currentDaren.value) return;
    try {
      const payload = cloneBuildSettings(buildSettings.value);
      await darenStore.updateDaren(currentDaren.value.id, {
        uploadBuildSettings: payload,
      });
    } catch (error) {
      console.error("保存上传搭建配置失败:", error);
      message.error(`保存搭建配置失败: ${error}`);
    }
  }, BUILD_SETTINGS_SAVE_DELAY);
}

watch(
  () => currentDaren.value?.uploadBuildSettings,
  (settings) => {
    syncingBuildSettings = true;
    buildSettings.value = normalizeBuildSettings(settings);
    queueMicrotask(() => {
      syncingBuildSettings = false;
    });
  },
  { immediate: true }
);

watch(
  buildSettings,
  () => {
    schedulePersistBuildSettings();
  },
  { deep: true }
);

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

  const plainConfig = JSON.parse(
    JSON.stringify(uploadConfig.value)
  ) as typeof uploadConfig.value;
  const { deleteAfterUpload: _deleteAfterUpload, ...serviceConfig } =
    plainConfig;
  try {
    await window.api.juliangUpdateConfig(serviceConfig);
  } catch (error) {
    message.error(`更新巨量配置失败: ${error}`);
    return;
  }

  if (options?.resetBrowser && !activeRow.value && !activeBuildRow.value && isReady.value) {
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
    rows.value = rows.value.filter((row) => row.entryMode === "build-only");
    return;
  }

  isScanning.value = true;
  try {
    const materials = await window.api.scanVideos(rootDir.value);
    const manualRows = rows.value.filter((row) => row.entryMode === "build-only");
    const previousRowMap = new Map(rows.value.map((row) => [row.folderPath, row]));
    const storedAccounts = loadStoredMap(rootDir.value, getAccountStorageKey);
    const storedDramaIds = loadStoredMap(rootDir.value, getDramaIdStorageKey);
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
        const unchanged =
          previous &&
          previous.materialCount === group.files.length &&
          previous.files.join("|") === group.files.join("|") &&
          previous.status !== "uploading" &&
          previous.buildStatus !== "building";

        return {
          id: `${group.folderPath}-${group.files.length}`,
          entryMode: "local",
          drama: group.drama,
          folderPath: group.folderPath,
          files: [...group.files],
          materialCount: group.files.length,
          accountId:
            previous?.accountId ?? storedAccounts[group.folderPath] ?? "",
          dramaId:
            previous?.dramaId ?? storedDramaIds[group.folderPath] ?? "",
          status: unchanged ? previous!.status : "pending",
          error: unchanged && previous?.status === "failed" ? previous.error : undefined,
          taskId: undefined,
          currentBatch: unchanged ? previous?.currentBatch || 0 : 0,
          totalBatches: unchanged ? previous?.totalBatches || 0 : 0,
          successCount:
            unchanged && previous?.status === "uploaded"
              ? previous.successCount || group.files.length
              : 0,
          totalFiles:
            unchanged && previous?.status === "uploaded"
              ? previous.totalFiles || group.files.length
              : group.files.length,
          deleted: unchanged ? previous?.deleted || false : false,
          deleteError: unchanged ? previous?.deleteError : undefined,
          buildStatus: unchanged ? previous?.buildStatus || "idle" : "idle",
          buildTaskId: undefined,
          buildError:
            unchanged && previous?.buildStatus === "failed"
              ? previous.buildError
              : undefined,
          buildMessage: unchanged ? previous?.buildMessage : undefined,
          buildSuccessRuleCount: unchanged ? previous?.buildSuccessRuleCount || 0 : 0,
          buildFailedRuleCount: unchanged ? previous?.buildFailedRuleCount || 0 : 0,
          buildTotalRules: unchanged ? previous?.buildTotalRules || 0 : 0,
          skippedRules: unchanged ? previous?.skippedRules || [] : [],
        } satisfies DramaUploadRow;
      });
    rows.value = [...manualRows, ...rows.value];
  } catch (error) {
    console.error("扫描目录失败:", error);
    message.error(`扫描目录失败: ${error}`);
  } finally {
    isScanning.value = false;
  }
}

function getRenameTemplateError() {
  if (!rootDir.value) {
    return "请先选择素材目录";
  }

  const template = buildSettings.value.materialFilenameTemplate.trim();
  if (!template) {
    return "请先填写素材名称模板";
  }
  if (!template.includes("{剧名}") || !template.includes("{序号}")) {
    return "素材名称模板必须包含 {剧名}、{序号}";
  }

  return "";
}

async function renameVideosByTemplate() {
  if (activeRow.value) {
    message.warning(`当前正在上传《${activeRow.value.drama}》，请等待完成后再试`);
    return;
  }
  if (activeBuildRow.value) {
    message.warning(`当前正在搭建《${activeBuildRow.value.drama}》，请等待完成后再试`);
    return;
  }

  const errorText = getRenameTemplateError();
  if (errorText) {
    message.warning(errorText);
    return;
  }

  const confirmed = window.confirm(
    "将按当前素材名称模板批量重命名所选目录下所有剧目录中的 mp4 文件。序号会按每部剧目录内现有文件名的自然顺序生成，是否继续？"
  );
  if (!confirmed) {
    return;
  }

  isRenaming.value = true;
  try {
    if (typeof window.api.renameVideosByTemplate !== "function") {
      message.error("当前应用还没有加载到批量重命名功能，请重启应用后再试");
      return;
    }

    const result = await window.api.renameVideosByTemplate(
      rootDir.value,
      buildSettings.value.materialFilenameTemplate.trim()
    );

    if (!result.success) {
      message.error(`批量重命名失败：${result.error || "未知错误"}`);
      return;
    }

    await scanRootDir();
    message.success(
      `已处理 ${result.dramaCount} 部剧，重命名 ${result.renamedCount} 个文件，跳过 ${result.skippedCount} 个`
    );
  } catch (error) {
    message.error(`批量重命名失败：${error}`);
  } finally {
    isRenaming.value = false;
  }
}

function handleAccountInput(row: DramaUploadRow, value: string) {
  row.accountId = value.trim();
  if (row.entryMode === "local") {
    saveStoredValue(rootDir.value, getAccountStorageKey, row.folderPath, row.accountId);
  }
}

function handleDramaIdInput(row: DramaUploadRow, value: string) {
  row.dramaId = value.trim();
  if (row.entryMode === "local") {
    saveStoredValue(rootDir.value, getDramaIdStorageKey, row.folderPath, row.dramaId);
  }
}

function handleDramaNameInput(row: DramaUploadRow, value: string) {
  row.drama = value.trim();
}

function addBuildOnlyRow() {
  if (activeRow.value) {
    message.warning(`当前正在上传《${activeRow.value.drama}》，请稍后再试`);
    return;
  }
  if (activeBuildRow.value) {
    message.warning(`当前正在搭建《${activeBuildRow.value.drama}》，请稍后再试`);
    return;
  }

  rows.value.unshift({
    id: `build-only-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    entryMode: "build-only",
    drama: "",
    folderPath: "",
    files: [],
    materialCount: 0,
    accountId: "",
    dramaId: "",
    status: "uploaded",
    error: undefined,
    taskId: undefined,
    currentBatch: 0,
    totalBatches: 0,
    successCount: 0,
    totalFiles: 0,
    deleted: false,
    deleteError: undefined,
    buildStatus: "idle",
    buildTaskId: undefined,
    buildError: undefined,
    buildMessage: undefined,
    buildSuccessRuleCount: 0,
    buildFailedRuleCount: 0,
    buildTotalRules: 0,
    skippedRules: [],
  });
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

function updateBuildProgress(progress: DailyBuildProgressPayload) {
  const row = rows.value.find((item) => item.buildTaskId === progress.taskId);
  if (!row) return;

  row.buildMessage = progress.message;
  row.buildTotalRules = progress.totalRules;
  row.buildSuccessRuleCount = progress.successRuleCount;
  row.buildFailedRuleCount = progress.failedRuleCount;

  if (progress.status === "building" || progress.status === "assetizing") {
    row.buildStatus = "building";
  } else if (progress.status === "cancelled") {
    row.buildStatus = "cancelled";
  } else if (progress.status === "failed") {
    row.buildStatus = "failed";
  } else if (progress.status === "completed") {
    row.buildStatus = "built";
  }
}

function resetRowToPending(row: DramaUploadRow) {
  row.status = "pending";
  row.error = undefined;
  row.taskId = undefined;
  row.currentBatch = 0;
  row.totalBatches = 0;
  row.successCount = 0;
  row.totalFiles = row.materialCount;
}

function isCancelledUploadResult(result: JuliangUploadResult) {
  return (
    result.error === "上传已取消" ||
    result.error === "浏览器页面已关闭" ||
    result.error === "页面已关闭，上传取消"
  );
}

function validateMaterialRange(value: string): boolean {
  const normalized = value.trim();
  if (!/^\d+(-\d+)?$/.test(normalized)) {
    return false;
  }
  if (!normalized.includes("-")) {
    return true;
  }
  const [startText, endText] = normalized.split("-");
  return Number(startText) <= Number(endText);
}

function normalizeMaterialRange(value: string): string {
  const normalized = value.trim();
  if (!normalized.includes("-")) {
    return normalized.padStart(2, "0");
  }
  const [startText, endText] = normalized.split("-");
  return `${startText.padStart(2, "0")}-${endText.padStart(2, "0")}`;
}

function openAddRuleModal() {
  editingRuleId.value = null;
  ruleForm.value = createEmptyRule();
  ruleModalVisible.value = true;
}

function openEditRuleModal(rule: DouyinMaterialRule) {
  editingRuleId.value = rule.id;
  ruleForm.value = normalizeRule(rule);
  ruleModalVisible.value = true;
}

function closeRuleModal() {
  ruleModalVisible.value = false;
  editingRuleId.value = null;
  ruleForm.value = createEmptyRule();
}

function saveRuleModal() {
  const nextRule = normalizeRule(ruleForm.value);

  if (!nextRule.douyinAccount) {
    message.warning("请填写抖音号名称");
    return;
  }
  if (!nextRule.douyinAccountId) {
    message.warning("请填写抖音号ID");
    return;
  }
  if (!nextRule.materialRange) {
    message.warning("请填写序号范围");
    return;
  }
  if (!validateMaterialRange(nextRule.materialRange)) {
    message.warning("序号范围仅支持 01 或 01-03，且结束序号不能小于开始序号");
    return;
  }

  nextRule.materialRange = normalizeMaterialRange(nextRule.materialRange);
  nextRule.updatedAt = new Date().toISOString();

  if (editingRuleId.value) {
    const index = buildSettings.value.douyinMaterialRules.findIndex(
      (item) => item.id === editingRuleId.value
    );
    if (index >= 0) {
      nextRule.createdAt =
        buildSettings.value.douyinMaterialRules[index].createdAt || nextRule.createdAt;
      buildSettings.value.douyinMaterialRules.splice(index, 1, nextRule);
    }
  } else {
    buildSettings.value.douyinMaterialRules.push(nextRule);
  }

  closeRuleModal();
}

function removeDouyinRule(ruleId: string) {
  const index = buildSettings.value.douyinMaterialRules.findIndex(
    (rule) => rule.id === ruleId
  );
  if (index >= 0) {
    buildSettings.value.douyinMaterialRules.splice(index, 1);
  }
}

function getBuildConfigError(): string {
  const params = buildSettings.value.buildParams;
  const fieldLabels: Array<[keyof typeof params, string]> = [
    ["secretKey", "Secret密钥"],
    ["source", "来源"],
    ["bid", "出价"],
    ["productId", "商品ID"],
    ["productPlatformId", "商品库ID"],
    ["landingUrl", "落地页 URL"],
    ["microAppName", "小程序名称"],
    ["microAppId", "小程序 AppID"],
    ["ccId", "cc_id"],
    ["rechargeTemplateId", "首充模版ID"],
  ];

  for (const [field, label] of fieldLabels) {
    if (!String(params[field] ?? "").trim()) {
      return `请先填写${label}`;
    }
  }

  const template = buildSettings.value.materialFilenameTemplate.trim();
  if (!template) {
    return "请先填写素材名称模板";
  }
  if (!template.includes("{剧名}") || !template.includes("{序号}")) {
    return "素材名称模板必须包含 {剧名}、{序号}";
  }

  if (!buildSettings.value.douyinMaterialRules.length) {
    return "请先添加抖音号匹配素材规则";
  }

  for (const rule of buildSettings.value.douyinMaterialRules) {
    if (
      !rule.douyinAccount.trim() ||
      !rule.douyinAccountId.trim() ||
      !rule.materialRange.trim()
    ) {
      return "请完善每条抖音号匹配素材规则";
    }
    if (!validateMaterialRange(rule.materialRange)) {
      return `素材序号范围格式不正确：${rule.materialRange}`;
    }
  }

  return "";
}

function getDisabledUploadTip(row: DramaUploadRow) {
  if (!row.accountId.trim()) {
    return "请先输入账户";
  }
  if (activeBuildRow.value) {
    return `当前正在搭建《${activeBuildRow.value.drama}》`;
  }
  if (activeRow.value && activeRow.value.id !== row.id) {
    return `当前正在上传《${activeRow.value.drama}》`;
  }
  return "";
}

function getDisabledBuildTip(row: DramaUploadRow) {
  if (row.status !== "uploaded") {
    return "请先完成上传";
  }
  if (!row.drama.trim()) {
    return "请先填写剧名";
  }
  if (!row.accountId.trim()) {
    return "请先输入账户";
  }
  if (!row.dramaId.trim()) {
    return "请先填写短剧ID";
  }
  if (activeRow.value) {
    return `当前正在上传《${activeRow.value.drama}》`;
  }
  if (activeBuildRow.value && activeBuildRow.value.id !== row.id) {
    return `当前正在搭建《${activeBuildRow.value.drama}》`;
  }
  return getBuildConfigError();
}

async function startUpload(row: DramaUploadRow) {
  if (activeBuildRow.value) {
    message.warning(`当前正在搭建《${activeBuildRow.value.drama}》，请稍后再试`);
    return;
  }

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
  const currentTaskId = row.taskId;

  currentProgress.value = {
    taskId: currentTaskId,
    drama: row.drama,
    status: "running",
    currentBatch: 0,
    totalBatches: 0,
    successCount: 0,
    totalFiles: row.materialCount,
    message: "开始上传",
  };

  try {
    const plainTask = JSON.parse(
      JSON.stringify({
        id: currentTaskId,
        drama: row.drama,
        date: new Date().toISOString().slice(0, 10),
        account: "manual",
        accountId: row.accountId.trim(),
        files: [...row.files],
        recordId: "",
        status: "pending",
      })
    );

    const result = (await window.api.juliangUploadTask(
      plainTask
    )) as JuliangUploadResult;

    if (cancelledTaskIds.has(currentTaskId)) {
      cancelledTaskIds.delete(currentTaskId);
      resetRowToPending(row);
      currentProgress.value = null;
      return;
    }

    if (!result.success) {
      if (isCancelledUploadResult(result)) {
        resetRowToPending(row);
        currentProgress.value = null;
        return;
      }
      row.status = "failed";
      row.error = result.error || "上传失败";
      message.error(`《${row.drama}》上传失败：${row.error}`);
      return;
    }

    row.status = "uploaded";
    row.successCount = result.successCount;
    row.totalFiles = result.totalFiles;
    row.error = undefined;
    row.taskId = undefined;
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
    if (cancelledTaskIds.has(currentTaskId)) {
      cancelledTaskIds.delete(currentTaskId);
      resetRowToPending(row);
      currentProgress.value = null;
      return;
    }
    row.status = "failed";
    row.error = error instanceof Error ? error.message : String(error);
    message.error(`《${row.drama}》上传失败：${row.error}`);
  }
}

async function cancelUpload(row: DramaUploadRow) {
  if (row.status !== "uploading" || !row.taskId) {
    return;
  }

  cancelledTaskIds.add(row.taskId);
  currentProgress.value = null;

  try {
    await window.api.juliangClose();
  } catch (error) {
    cancelledTaskIds.delete(row.taskId);
    message.error(`取消上传失败: ${error}`);
    return;
  }

  isReady.value = false;
  needLogin.value = false;
  resetRowToPending(row);
  message.info(`已取消《${row.drama}》上传`);
}

async function startBuild(row: DramaUploadRow) {
  const disabledTip = getDisabledBuildTip(row);
  if (disabledTip) {
    message.warning(disabledTip);
    return;
  }

  const ready = await ensureBrowserReady();
  if (!ready || !currentDaren.value) {
    return;
  }

  row.buildStatus = "building";
  row.buildError = undefined;
  row.buildMessage = "开始搭建";
  row.buildSuccessRuleCount = 0;
  row.buildFailedRuleCount = 0;
  row.buildTotalRules = validDouyinRules.value.length;
  row.skippedRules = [];
  row.buildTaskId = `build-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  currentBuildProgress.value = {
    taskId: row.buildTaskId,
    drama: row.drama,
    status: "assetizing",
    message: "开始搭建",
    currentRuleIndex: 0,
    totalRules: validDouyinRules.value.length,
    successRuleCount: 0,
    failedRuleCount: 0,
  };

  try {
    const payload = JSON.parse(
      JSON.stringify({
        taskId: row.buildTaskId,
        drama: row.drama,
        dramaId: row.dramaId.trim(),
        accountId: row.accountId.trim(),
        files: [...row.files],
        darenId: currentDaren.value.id,
        changduConfigType: currentDaren.value.changduConfigType || "sanrou",
        customChangduConfig: currentDaren.value.customChangduConfig,
        buildSettings: cloneBuildSettings(buildSettings.value),
      })
    );

    const result = (await window.api.dailyBuildStartTask(
      payload
    )) as DailyBuildResult;

    if (result.cancelled) {
      row.buildStatus = "cancelled";
      row.buildError = undefined;
      row.buildMessage = "搭建已取消";
      row.buildTaskId = undefined;
      currentBuildProgress.value = null;
      message.info(`已取消《${row.drama}》搭建`);
      return;
    }

    row.buildSuccessRuleCount = result.successRuleCount;
    row.buildFailedRuleCount = result.failedRuleCount;
    row.buildTotalRules = result.totalRules;
    row.skippedRules = result.skippedRules.map((item) => ({
      douyinAccount: item.douyinAccount,
      error: item.error,
    }));

    if (!result.success) {
      row.buildStatus = "failed";
      row.buildError = result.error || "搭建失败";
      row.buildMessage = row.buildError;
      row.buildTaskId = undefined;
      message.error(`《${row.drama}》搭建失败：${row.buildError}`);
      return;
    }

    row.buildStatus = "built";
    row.buildError = undefined;
    row.buildMessage = `搭建完成（成功 ${result.successRuleCount}/${result.totalRules}）`;
    row.buildTaskId = undefined;
    if (result.skippedRules.length > 0) {
      message.warning(
        `《${row.drama}》搭建完成，但有 ${result.skippedRules.length} 个抖音号失败`
      );
    } else {
      message.success(`《${row.drama}》搭建完成`);
    }
  } catch (error) {
    row.buildStatus = "failed";
    row.buildError = error instanceof Error ? error.message : String(error);
    row.buildMessage = row.buildError;
    row.buildTaskId = undefined;
    message.error(`《${row.drama}》搭建失败：${row.buildError}`);
  } finally {
    currentBuildProgress.value = null;
  }
}

async function cancelBuild(row: DramaUploadRow) {
  if (row.buildStatus !== "building" || !row.buildTaskId) {
    return;
  }

  const result = await window.api.dailyBuildCancelTask(row.buildTaskId);
  if (!result.success) {
    message.error(result.error || "取消搭建失败");
    return;
  }

  row.buildMessage = "正在取消搭建";
  message.info(`正在取消《${row.drama}》搭建`);
}

async function loadLogs() {
  try {
    logs.value = await window.api.juliangGetLogs();
    buildLogs.value = await window.api.dailyBuildGetLogs();
  } catch (error) {
    console.error("加载日志失败:", error);
  }
}

onMounted(async () => {
  if (!darenStore.darenList.length) {
    await darenStore.loadFromServer(true);
  }
  ensureAdminSelectedDaren();

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

  unsubscribeBuildProgress = window.api.onDailyBuildProgress((progress) => {
    currentBuildProgress.value = progress;
    updateBuildProgress(progress);
  });

  unsubscribeBuildLog = window.api.onDailyBuildLog((log) => {
    buildLogs.value.push(log);
    if (buildLogs.value.length > 500) {
      buildLogs.value.shift();
    }
  });
});

onUnmounted(() => {
  if (unsubscribeProgress) unsubscribeProgress();
  if (unsubscribeLog) unsubscribeLog();
  if (unsubscribeBuildProgress) unsubscribeBuildProgress();
  if (unsubscribeBuildLog) unsubscribeBuildLog();
  if (buildSettingsSaveTimer) {
    clearTimeout(buildSettingsSaveTimer);
    buildSettingsSaveTimer = null;
  }
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
        <span class="status-label">已搭建</span>
        <span class="status-value success">{{ builtDramaCount }}</span>
      </div>
      <div class="status-item">
        <span class="status-label">失败</span>
        <span class="status-value error">{{ failedDramaCount }}</span>
      </div>
    </div>

    <NCard class="main-card">
      <div class="template-panel">
        <label class="build-field build-field-full">
          <span>达人</span>
          <NInput
            v-model:value="buildSettings.darenName"
            placeholder="请输入达人名称，用于生成推广链、项目和广告名称"
          />
          <small class="field-help">
            这里填写的达人名称会作为推广链名称、项目名称和广告名称的统一前缀。
          </small>
        </label>
        <label class="build-field build-field-full">
          <span>素材名称模板</span>
          <NInput
            v-model:value="buildSettings.materialFilenameTemplate"
            placeholder="{日期}-{剧名}-{简称}-{序号}.mp4"
          />
          <small class="field-help">
            默认模板已带上 {日期}、{剧名}、{简称}、{序号}。{日期} 如果保留占位符会自动替换成当天北京时间日期，例如 3.15；如果你想写死日期或简称，也可以直接把占位符改成具体值。
          </small>
        </label>
        <div class="template-actions">
          <NButton
            type="warning"
            secondary
            :disabled="!rootDir || !!activeRow || !!activeBuildRow"
            :loading="isRenaming"
            @click="renameVideosByTemplate"
          >
            {{ isRenaming ? "重命名中..." : "按模板批量重命名" }}
          </NButton>
        </div>
      </div>

      <div class="toolbar">
        <div class="toolbar-main">
          <span class="toolbar-label">素材目录</span>
          <NInput
            v-model:value="rootDir"
            readonly
            placeholder="选择目录，目录下每个子文件夹都视为一部剧"
            class="toolbar-input"
          />
          <NButton :disabled="!!activeRow || !!activeBuildRow" @click="selectRootDir">
            选择目录
          </NButton>
          <NButton
            :disabled="!rootDir || !!activeRow || !!activeBuildRow"
            :loading="isScanning"
            @click="scanRootDir"
          >
            {{ isScanning ? "扫描中..." : "重新扫描" }}
          </NButton>
        </div>
        <div v-if="authStore.isAdmin" class="toolbar-main">
          <span class="toolbar-label">当前达人</span>
          <NSelect
            :value="darenStore.selectedDarenId"
            :options="darenOptions"
            class="toolbar-select"
            placeholder="请选择要配置的达人"
            @update:value="handleAdminDarenChange"
          />
          <span class="toolbar-hint">上传搭建配置按达人隔离存储</span>
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

    <NCollapse
      class="section-collapse"
      :default-expanded-names="COLLAPSIBLE_SECTION_NAMES"
    >
      <NCollapseItem name="build-config">
        <template #header>
          <div class="table-header">
            <span>搭建参数配置</span>
            <span class="table-header-desc">修改后立即生效，仅作用于当前达人</span>
          </div>
        </template>
        <NCard class="build-config-card collapse-card">
          <div class="build-config-grid">
            <label class="build-field">
              <span>Secret密钥</span>
              <NInput
                v-model:value="buildSettings.buildParams.secretKey"
                placeholder="请输入 Secret 密钥"
              />
            </label>
            <label class="build-field">
              <span>来源</span>
              <NInput
                v-model:value="buildSettings.buildParams.source"
                placeholder="请输入来源，例如：泰州晴天"
              />
            </label>
            <label class="build-field">
              <span>出价</span>
              <NInput
                v-model:value="buildSettings.buildParams.bid"
                placeholder="请输入出价，例如：5"
              />
            </label>
            <label class="build-field">
              <span>商品ID</span>
              <NInput
                v-model:value="buildSettings.buildParams.productId"
                placeholder="请输入商品ID"
              />
            </label>
            <label class="build-field">
              <span>商品库ID</span>
              <NInput
                v-model:value="buildSettings.buildParams.productPlatformId"
                placeholder="请输入商品库ID"
              />
            </label>
            <label class="build-field">
              <span>落地页 URL</span>
              <NInput
                v-model:value="buildSettings.buildParams.landingUrl"
                placeholder="请输入落地页 URL"
              />
            </label>
            <label class="build-field">
              <span>小程序名称</span>
              <NInput
                v-model:value="buildSettings.buildParams.microAppName"
                placeholder="请输入小程序名称"
              />
            </label>
            <label class="build-field">
              <span>小程序 AppID</span>
              <NInput
                v-model:value="buildSettings.buildParams.microAppId"
                placeholder="请输入小程序 AppID"
              />
            </label>
            <label class="build-field">
              <span>cc_id</span>
              <NInput
                v-model:value="buildSettings.buildParams.ccId"
                placeholder="请输入 cc_id"
              />
            </label>
            <label class="build-field">
              <span>首充模版ID</span>
              <NInput
                v-model:value="buildSettings.buildParams.rechargeTemplateId"
                placeholder="请输入首充模版ID"
              />
            </label>
          </div>
        </NCard>
      </NCollapseItem>

      <NCollapseItem name="douyin-rules">
        <template #header>
          <div class="table-header">
            <span>抖音号匹配素材</span>
            <span class="table-header-desc">每条规则对应一个抖音号与一组素材序号</span>
          </div>
        </template>
        <NCard class="build-config-card collapse-card">
          <div class="rule-toolbar">
            <span class="toolbar-hint">序号范围支持单个 01，或区间 01-03</span>
            <NButton type="primary" secondary @click="openAddRuleModal">添加规则</NButton>
          </div>

          <NEmpty
            v-if="buildSettings.douyinMaterialRules.length === 0"
            description="暂无抖音号匹配素材规则"
          />

          <div v-else class="rule-list">
            <div
              v-for="rule in buildSettings.douyinMaterialRules"
              :key="rule.id"
              class="rule-item"
            >
              <div class="rule-summary">
                <div class="rule-title-row">
                  <span class="rule-name">{{ rule.douyinAccount || "未命名规则" }}</span>
                  <NTag
                    size="small"
                    :type="validateMaterialRange(rule.materialRange) ? 'success' : 'warning'"
                  >
                    {{ rule.materialRange || "未配置范围" }}
                  </NTag>
                </div>
                <div class="rule-meta">
                  <span>抖音号ID：{{ rule.douyinAccountId || "-" }}</span>
                </div>
                <div
                  v-if="rule.materialRange && !validateMaterialRange(rule.materialRange)"
                  class="row-error"
                >
                  序号范围格式不正确
                </div>
              </div>
              <div class="rule-actions">
                <NButton tertiary @click="openEditRuleModal(rule)">编辑</NButton>
                <NButton type="error" tertiary @click="removeDouyinRule(rule.id)">删除</NButton>
              </div>
            </div>
          </div>
        </NCard>
      </NCollapseItem>

      <NCollapseItem name="upload-list">
        <template #header>
          <div class="table-header">
            <span>上传列表</span>
            <span class="table-header-desc">每部剧单独填写账户和短剧ID后手动触发</span>
          </div>
        </template>
        <NCard class="table-card collapse-card">
          <div class="list-toolbar">
            <span class="toolbar-hint">如果素材已上传但本地目录不可用，可以直接提交搭建</span>
            <NButton type="primary" secondary @click="addBuildOnlyRow">提交搭建</NButton>
          </div>

          <NEmpty v-if="rows.length === 0" description="请选择目录并扫描剧目" />

          <div v-else class="drama-table">
            <table>
              <thead>
                <tr>
                  <th>剧名</th>
                  <th>素材数</th>
                  <th>账户</th>
                  <th>短剧ID</th>
                  <th>状态</th>
                  <th>进度</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.id">
                  <td class="drama-cell">
                    <NInput
                      v-if="row.entryMode === 'build-only'"
                      :value="row.drama"
                      placeholder="请输入剧名"
                      :disabled="row.buildStatus === 'building'"
                      @update:value="(value) => handleDramaNameInput(row, value)"
                    />
                    <div v-else class="drama-name">{{ row.drama }}</div>
                    <div v-if="row.error || row.deleteError || row.buildError" class="row-error">
                      {{ row.error || row.deleteError || row.buildError }}
                    </div>
                    <div
                      v-for="item in row.skippedRules"
                      :key="`${row.id}-${item.douyinAccount}`"
                      class="row-error"
                    >
                      {{ item.douyinAccount }}：{{ item.error }}
                    </div>
                  </td>
                  <td>{{ row.entryMode === "build-only" ? "-" : row.materialCount }}</td>
                  <td>
                    <NInput
                      :value="row.accountId"
                      placeholder="请输入巨量账户 ID"
                      :disabled="row.status === 'uploading' || row.buildStatus === 'building'"
                      @update:value="(value) => handleAccountInput(row, value)"
                    />
                  </td>
                  <td>
                    <NInput
                      :value="row.dramaId"
                      placeholder="请输入短剧 ID"
                      :disabled="row.status === 'uploading' || row.buildStatus === 'building'"
                      @update:value="(value) => handleDramaIdInput(row, value)"
                    />
                  </td>
                  <td>
                    <div class="status-stack">
                      <NTag :type="getCombinedStatusType(row)" size="small">
                        {{ getCombinedStatusText(row) }}
                      </NTag>
                      <NTag v-if="row.deleted" type="success" size="small" round>
                        本地已删除
                      </NTag>
                      <span v-if="row.buildMessage" class="row-hint">{{ row.buildMessage }}</span>
                    </div>
                  </td>
                  <td>
                    <div class="progress-cell">
                      <span v-if="row.entryMode !== 'build-only'">
                        上传 {{ row.successCount }}/{{ row.totalFiles || row.materialCount }}
                      </span>
                      <span v-if="row.buildTotalRules > 0">
                        搭建 {{ row.buildSuccessRuleCount }}/{{ row.buildTotalRules }}
                      </span>
                      <span
                        v-if="row.entryMode === 'build-only' && row.buildTotalRules === 0"
                        class="row-hint"
                      >
                        待搭建
                      </span>
                    </div>
                  </td>
                  <td>
                    <NButton
                      v-if="row.buildStatus === 'building'"
                      type="error"
                      @click="cancelBuild(row)"
                    >
                      取消搭建
                    </NButton>
                    <NButton v-else-if="row.buildStatus === 'built'" disabled>
                      已搭建
                    </NButton>
                    <NButton
                      v-else-if="row.status === 'uploaded' && !getDisabledBuildTip(row)"
                      type="success"
                      @click="startBuild(row)"
                    >
                      {{ getBuildButtonText(row) }}
                    </NButton>
                    <NTooltip v-else-if="row.status === 'uploaded' && getDisabledBuildTip(row)">
                      <template #trigger>
                        <span class="button-trigger">
                          <NButton disabled>{{ getBuildButtonText(row) }}</NButton>
                        </span>
                      </template>
                      {{ getDisabledBuildTip(row) }}
                    </NTooltip>
                    <NButton
                      v-else-if="row.status === 'uploading'"
                      type="error"
                      @click="cancelUpload(row)"
                    >
                      取消上传
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
      </NCollapseItem>
    </NCollapse>

    <NModal
      v-model:show="ruleModalVisible"
      preset="card"
      :style="{ width: 'min(560px, calc(100vw - 32px))' }"
      :title="editingRuleId ? '编辑规则' : '添加规则'"
      :bordered="false"
      segmented
    >
      <div class="rule-modal-body">
        <label class="build-field">
          <span>抖音号名称</span>
          <NInput v-model:value="ruleForm.douyinAccount" placeholder="例如：小红看剧" />
        </label>
        <label class="build-field">
          <span>抖音号ID</span>
          <NInput v-model:value="ruleForm.douyinAccountId" placeholder="请输入抖音号ID" />
        </label>
        <label class="build-field">
          <span>序号范围</span>
          <NInput
            v-model:value="ruleForm.materialRange"
            placeholder="请输入单个序号或范围序号，例如：01或者01-03"
          />
          <small
            v-if="ruleForm.materialRange && !validateMaterialRange(ruleForm.materialRange)"
            class="field-help field-help-error"
          >
            仅支持 01 或 01-03，且结束序号不能小于开始序号
          </small>
        </label>
      </div>
      <template #footer>
        <div class="rule-modal-footer">
          <NButton @click="closeRuleModal">取消</NButton>
          <NButton type="primary" @click="saveRuleModal">
            {{ editingRuleId ? "保存修改" : "确认添加" }}
          </NButton>
        </div>
      </template>
    </NModal>

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

    <NCard v-if="currentBuildProgress && activeBuildRow" class="progress-card">
      <div class="progress-header">
        <span class="progress-title">{{ currentBuildProgress.drama }}</span>
        <span class="progress-message">{{ currentBuildProgress.message }}</span>
      </div>
      <div class="progress-meta">
        <span>规则 {{ currentBuildProgress.currentRuleIndex }}/{{ currentBuildProgress.totalRules || 0 }}</span>
        <span>
          成功 {{ currentBuildProgress.successRuleCount }} / 失败
          {{ currentBuildProgress.failedRuleCount }}
        </span>
      </div>
      <NProgress
        type="line"
        :height="22"
        :percentage="
          currentBuildProgress.totalRules > 0
            ? Math.round(
                ((currentBuildProgress.successRuleCount +
                  currentBuildProgress.failedRuleCount) /
                  currentBuildProgress.totalRules) *
                  100
              )
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
      请先在弹出的浏览器窗口中完成登录，再点击“开始上传”或“开始搭建”。
    </NAlert>

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
              :disabled="!!activeRow || !!activeBuildRow"
              @update:value="
                (value) =>
                  applyUploadConfig({ headless: value }, { resetBrowser: true })
              "
            />
            <span class="config-desc">空闲时修改会关闭浏览器，下次按新配置重启</span>
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
      <NCollapseItem title="搭建日志" name="build-logs">
        <div class="log-container">
          <div v-if="buildLogs.length === 0" class="log-empty">暂无日志</div>
          <div
            v-for="(log, index) in buildLogs"
            :key="`build-${log.time}-${index}`"
            class="log-item"
          >
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
.log-panel,
.build-config-card,
.section-collapse {
  margin-bottom: 16px;
}

.collapse-card {
  margin-bottom: 0;
}

.section-collapse :deep(.n-collapse-item__content-inner) {
  padding-top: 12px;
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
  flex-wrap: wrap;
}

.toolbar-label,
.config-label {
  width: 152px;
  flex-shrink: 0;
  color: #59657a;
  font-size: 14px;
}

.toolbar-input,
.toolbar-select {
  flex: 1;
  min-width: 260px;
}

.toolbar-hint,
.config-desc,
.table-header-desc,
.field-help,
.row-hint {
  color: #8a94a7;
  font-size: 12px;
}

.field-help {
  display: block;
  margin-top: 6px;
}

.field-help-error {
  color: #d03050;
}

.config-panel {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #eef2f6;
}

.template-panel {
  margin-bottom: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid #eef2f6;
}

.template-actions {
  margin-top: 12px;
}

.config-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
}

.progress-header,
.table-header,
.list-toolbar,
.rule-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.list-toolbar {
  margin-bottom: 16px;
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

.build-config-grid,
.rule-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 20px;
}

.build-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.build-field > span {
  color: #4a5568;
  font-size: 14px;
  font-weight: 600;
}

.build-field-full {
  grid-column: 1 / -1;
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.rule-item {
  padding: 16px;
  border: 1px solid #edf1f5;
  border-radius: 14px;
  background: #fbfcfe;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.rule-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.rule-summary {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rule-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.rule-name {
  color: #1e2430;
  font-size: 15px;
  font-weight: 700;
}

.rule-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  color: #667089;
  font-size: 13px;
}

.rule-modal-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 20px;
}

.rule-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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

.login-alert {
  margin-bottom: 16px;
}

.log-container {
  max-height: 280px;
  overflow: auto;
  padding: 4px 0;
}

.log-empty {
  color: #8a94a7;
  font-size: 13px;
}

.log-item {
  display: flex;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed #eef2f6;
  font-size: 13px;
  line-height: 1.5;
}

.log-time {
  color: #8a94a7;
  flex-shrink: 0;
}

.log-message {
  color: #2a3241;
  white-space: pre-wrap;
  word-break: break-all;
}

@media (max-width: 960px) {
  .build-config-grid,
  .rule-grid,
  .rule-modal-body {
    grid-template-columns: 1fr;
  }

  .rule-item {
    flex-direction: column;
  }

  .rule-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .toolbar-main {
    align-items: stretch;
  }

  .toolbar-label,
  .config-label {
    width: 100%;
  }
}
</style>
