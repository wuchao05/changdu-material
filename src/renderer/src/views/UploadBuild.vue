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
  NIcon,
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
import { RefreshOutline, TrashOutline } from "@vicons/ionicons5";
import {
  calculateAllocationSummary,
  distributeRemainingByWeight,
  distributeRemainingEvenly,
  getRowAvailableIncrease,
  getRowMaxSettablePercent,
  normalizeAllocationMaxPercent,
  normalizeAllocationPercent,
  normalizeAllocationWeight,
  normalizeUnlockedAllocation,
  setAllocationPercent,
} from "../../../shared/material-allocation";
import {
  useDarenStore,
  type DarenInfo,
  type DouyinMaterialRule,
  type UploadBuildSettings,
} from "../stores/daren";
import { useApiConfigStore } from "../stores/apiConfig";
import { useSessionStore } from "../stores/session";

type UploadStatus = "pending" | "uploading" | "uploaded" | "failed";
type BuildStatus = "idle" | "building" | "built" | "failed" | "cancelled";
type RowEntryMode = "local" | "build-only";
type BuildParamField = keyof UploadBuildSettings["buildParams"];

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
  dramaIdLoading: boolean;
  dramaIdError?: string;
  pendingAutoAssignedAccount?: UploadListAutoAssignedAccount;
  skippedRules: Array<{ douyinAccount: string; error: string }>;
}

interface UploadListDraftRow {
  row: DramaUploadRow;
  snapshot: UploadListSavedRowSnapshot;
  nextAccountId: string;
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

interface JuliangTaskStatePayload extends JuliangUploadProgressPayload {
  updatedAt: string;
}

interface DailyBuildTaskStatePayload extends DailyBuildProgressPayload {
  updatedAt: string;
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
  materialPreviewSchedule?: {
    enabled: boolean;
    scheduledCount: number;
    delaysMinutes: number[];
    error?: string;
  };
}

interface UploadBuildViewState {
  rootDir: string;
  rows: DramaUploadRow[];
  currentProgress: JuliangUploadProgressPayload | null;
  currentBuildProgress: DailyBuildProgressPayload | null;
  autoRunEnabled: boolean;
  removedFolderPaths: string[];
}

interface FeishuRecordItem {
  record_id: string;
  fields: Record<string, unknown>;
}

interface FeishuSearchResponse {
  code?: number;
  msg?: string;
  data?: {
    items?: FeishuRecordItem[];
  };
}

interface UploadListAutoAssignedAccount {
  accountId: string;
  recordId: string;
  tableId: string;
}

interface UploadListSavedRowSnapshot {
  rowKey: string;
  entryMode: RowEntryMode;
  drama: string;
  folderPath: string;
  files: string[];
  accountId: string;
  dramaId: string;
  autoAssignedAccount?: UploadListAutoAssignedAccount;
}

interface UploadListSavedSnapshot {
  userId: string;
  channelId: string;
  rootDir: string;
  savedAt: string;
  rows: UploadListSavedRowSnapshot[];
}

interface FeishuAccountRecord {
  recordId: string;
  accountId: string;
  isUsed: boolean;
}

const DEFAULT_MATERIAL_FILENAME_TEMPLATE = "{日期}-{剧名}-{简称}-{序号}.mp4";
const ROOT_DIR_STORAGE_KEY = "upload-build:root-dir";
const DELETE_AFTER_UPLOAD_STORAGE_KEY = "upload-build:delete-after-upload";
const CLEAR_PROJECTS_BEFORE_BUILD_STORAGE_KEY =
  "upload-build:clear-projects-before-build";
const AUTO_PREVIEW_AFTER_BUILD_STORAGE_KEY =
  "upload-build:auto-preview-after-build";
const VIEW_STATE_STORAGE_KEY = "upload-build:view-state";
const UPLOAD_LIST_SNAPSHOT_STORAGE_KEY = "upload-build:upload-list-snapshots";
const COLLAPSIBLE_SECTION_NAMES = [
  "build-config",
  "douyin-rules",
  "upload-list",
];
const BUILD_PARAM_LABELS: Array<[BuildParamField, string]> = [
  ["distributorId", "Distributor ID"],
  ["secretKey", "Secret密钥"],
  ["source", "来源"],
  ["bid", "出价"],
  ["productId", "商品ID"],
  ["productPlatformId", "商品库ID"],
  ["landingUrl", "落地页 URL"],
  ["microAppName", "小程序名称"],
  ["microAppId", "小程序 AppID"],
  ["microAppInstanceId", "小程序实例 ID"],
  ["ccId", "cc_id"],
  ["rechargeTemplateId", "首充模版ID"],
];

const darenStore = useDarenStore();
const sessionStore = useSessionStore();
const apiConfigStore = useApiConfigStore();
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
const previewLogs = ref<Array<{ time: string; message: string }>>([]);
const currentProgress = ref<JuliangUploadProgressPayload | null>(null);
const currentBuildProgress = ref<DailyBuildProgressPayload | null>(null);
const autoRunEnabled = ref(false);
const removedFolderPaths = ref<string[]>([]);
const buildSettings = ref<UploadBuildSettings>(createDefaultBuildSettings());
const ruleModalVisible = ref(false);
const editingRuleId = ref<string | null>(null);
const ruleForm = ref<DouyinMaterialRule>(createEmptyRule());

const uploadConfig = ref({
  baseUploadUrl: "",
  batchSize: 10,
  batchUploadTimeoutMinutes: 5,
  maxBatchRetries: 1,
  timeoutPartialRetryRounds: 5,
  headless: false,
  allowedMissingCount: 0,
  abandonedRetryTimeoutMinutes: 3,
  deleteAfterUpload: false,
  clearProjectsBeforeBuild: false,
  autoPreviewAfterBuild: false,
});

let unsubscribeProgress: (() => void) | null = null;
let unsubscribeLog: (() => void) | null = null;
let unsubscribeBuildProgress: (() => void) | null = null;
let unsubscribeBuildLog: (() => void) | null = null;
let unsubscribePreviewLog: (() => void) | null = null;
const cancelledTaskIds = new Set<string>();
const savedBuildSettingsSnapshot = ref<UploadBuildSettings>(
  createDefaultBuildSettings(),
);
const allocationFeedback = ref("");
const allocationFeedbackType = ref<"info" | "success" | "warning">("info");
const savingUploadList = ref(false);
const dramaIdLookupTimers = new Map<string, number>();
const dramaIdLookupRequestIds = new Map<string, number>();
const savedUploadListSnapshot = ref<UploadListSavedSnapshot | null>(null);

const totalDramaCount = computed(() => rows.value.length);
const totalMaterialCount = computed(() =>
  rows.value.reduce((sum, row) => sum + row.materialCount, 0),
);
const uploadedDramaCount = computed(
  () => rows.value.filter((row) => row.status === "uploaded").length,
);
const builtDramaCount = computed(
  () => rows.value.filter((row) => row.buildStatus === "built").length,
);
const failedDramaCount = computed(
  () =>
    rows.value.filter(
      (row) => row.status === "failed" || row.buildStatus === "failed",
    ).length,
);
const activeRow = computed(
  () => rows.value.find((row) => row.status === "uploading") || null,
);
const activeBuildRow = computed(
  () => rows.value.find((row) => row.buildStatus === "building") || null,
);
const currentDaren = computed<DarenInfo | null>(() => darenStore.currentDaren);
const currentFeishuAccountTableId = computed(
  () => darenStore.currentFeishuAccountTableId,
);
const currentRemoteDarenName = computed(
  () =>
    String(
      sessionStore.currentRuntimeUser?.nickname ||
        sessionStore.currentUser?.nickname ||
        "小鱼",
    ).trim() || "小鱼",
);
const currentMaterialShortName = computed(() =>
  String(
    sessionStore.currentRuntimeUser?.account ||
      sessionStore.currentUser?.account ||
      "",
  ).trim(),
);
const allocationRulesForMath = computed(() =>
  buildSettings.value.douyinMaterialRules.map((rule, index) => ({
    ...normalizeRule(rule),
    order: index + 1,
  })),
);
const configuredDouyinRules = computed(() =>
  buildSettings.value.douyinMaterialRules.filter(
    (rule) => rule.douyinAccount.trim() && rule.douyinAccountId.trim(),
  ),
);
const executableDouyinRules = computed(() =>
  configuredDouyinRules.value.filter(
    (rule) => normalizeAllocationPercent(rule.percent) > 0,
  ),
);
const allocationSummary = computed(() =>
  calculateAllocationSummary(allocationRulesForMath.value),
);
const hasUnsavedBuildSettingsChanges = computed(
  () =>
    JSON.stringify(cloneBuildSettings(buildSettings.value)) !==
    JSON.stringify(savedBuildSettingsSnapshot.value),
);
const hasUnsavedBuildParamChanges = computed(
  () =>
    JSON.stringify(buildSettings.value.buildParams) !==
    JSON.stringify(savedBuildSettingsSnapshot.value.buildParams),
);
const allocationStatusText = computed(() => {
  if (allocationSummary.value.status === "over") {
    return "超限";
  }
  if (allocationSummary.value.status === "full") {
    return "已分满";
  }
  return "未分满";
});
const allocationStatusType = computed<"success" | "warning" | "error">(() => {
  if (allocationSummary.value.status === "over") {
    return "error";
  }
  if (allocationSummary.value.status === "full") {
    return "success";
  }
  return "warning";
});
const allocationAlertType = computed<"success" | "warning" | "error" | "info">(
  () =>
    allocationFeedback.value
      ? allocationFeedbackType.value
      : allocationStatusType.value,
);
const ruleConfigError = computed(() => getRuleConfigError());
const canSaveBuildSettings = computed(
  () => hasUnsavedBuildSettingsChanges.value && !ruleConfigError.value,
);
const canSaveBuildParams = computed(() => hasUnsavedBuildParamChanges.value);
const missingBuildParamFields = computed(() => getMissingBuildParamFields());
const missingBuildParamFieldSet = computed(
  () => new Set<BuildParamField>(missingBuildParamFields.value),
);
const buildParamNoticeType = computed<"success" | "warning" | "info">(() => {
  if (missingBuildParamFields.value.length) {
    return "warning";
  }
  if (hasUnsavedBuildParamChanges.value) {
    return "info";
  }
  return "success";
});
const buildParamNoticeText = computed(() => {
  if (missingBuildParamFields.value.length) {
    return `以下配置还未填写：${missingBuildParamFields.value
      .map((field) => getBuildParamLabel(field))
      .join("、")}`;
  }
  if (hasUnsavedBuildParamChanges.value) {
    return "当前搭建参数有改动，保存到本地后下次进入会自动带入";
  }
  return "当前搭建参数已保存到本地，下次进入会自动带入";
});
const currentUploadListSnapshotKey = computed(() => {
  const userId = apiConfigStore.config.userId.trim();
  const channelId = apiConfigStore.config.channelId.trim();
  if (!userId || !channelId) {
    return "";
  }
  return JSON.stringify([userId, channelId, rootDir.value.trim()]);
});
const savedUploadListComparableRows = computed(() =>
  (savedUploadListSnapshot.value?.rows || []).map((row) =>
    buildUploadListComparableRowFromSnapshot(row),
  ),
);
const currentUploadListComparableRows = computed(() =>
  rows.value.map((row) => buildUploadListComparableRow(row)),
);
const hasUnsavedUploadListChanges = computed(
  () =>
    JSON.stringify(currentUploadListComparableRows.value) !==
    JSON.stringify(savedUploadListComparableRows.value),
);
const canSaveUploadList = computed(
  () =>
    hasUnsavedUploadListChanges.value &&
    !savingUploadList.value &&
    !activeRow.value &&
    !activeBuildRow.value,
);
const canPullUploadListAccounts = computed(
  () =>
    rows.value.some((row) => !row.accountId.trim()) &&
    !savingUploadList.value &&
    !activeRow.value &&
    !activeBuildRow.value,
);
const uploadListSaveStatusText = computed(() =>
  hasUnsavedUploadListChanges.value ? "未保存" : "已保存",
);
const uploadListSaveStatusType = computed<"success" | "warning">(() =>
  hasUnsavedUploadListChanges.value ? "warning" : "success",
);
const allocationStatusMessage = computed(() => {
  if (ruleConfigError.value) {
    return ruleConfigError.value;
  }
  if (allocationSummary.value.status === "over") {
    return "当前总比例已超限，系统不会保留非法值，请继续调整。";
  }
  if (allocationSummary.value.status === "full") {
    return "当前配置合法，可保存。";
  }
  return "当前总和未达到 100%，允许保存，但会保留未分配素材。";
});
const autoRunDisabledReason = computed(() => {
  const executionError = getExecutionRowsValidationError();
  if (executionError) {
    return executionError;
  }

  if (hasUnsavedUploadListChanges.value) {
    return "请先保存上传列表配置";
  }

  const buildConfigError = getBuildConfigError();
  if (buildConfigError) {
    return buildConfigError;
  }

  if (hasUnsavedBuildSettingsChanges.value) {
    return "请先保存搭建参数和抖音号匹配素材配置";
  }

  return "";
});
const autoRunDisabledTooltip = computed(() => autoRunDisabledReason.value);

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
      distributorId: "",
      secretKey: "",
      source: "",
      bid: 5,
      productId: "",
      productPlatformId: "",
      landingUrl: "",
      microAppName: "",
      microAppId: "",
      microAppInstanceId: "",
      ccId: "",
      rechargeTemplateId: "",
    },
    darenName: "小鱼",
    materialFilenameTemplate: DEFAULT_MATERIAL_FILENAME_TEMPLATE,
    materialDateValue: "",
    materialAllocationMode: "ratio",
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
    percent: 0,
    maxPercent: 100,
    locked: false,
    weight: 1,
    order: buildSettings.value.douyinMaterialRules.length + 1,
    createdAt: now,
    updatedAt: now,
  };
}

function cloneBuildSettings(source?: UploadBuildSettings): UploadBuildSettings {
  return JSON.parse(
    JSON.stringify(source || createDefaultBuildSettings()),
  ) as UploadBuildSettings;
}

function resolveCurrentDarenName(): string {
  return currentRemoteDarenName.value;
}

function getFixedMaterialFilenameTemplate(): string {
  return DEFAULT_MATERIAL_FILENAME_TEMPLATE;
}

function resolveTemplateWithCurrentShortName(template: string): string {
  return template.replaceAll("{简称}", currentMaterialShortName.value);
}

function createEffectiveBuildSettings(): UploadBuildSettings {
  const nextSettings = cloneBuildSettings(buildSettings.value);
  nextSettings.darenName = resolveCurrentDarenName();
  nextSettings.materialFilenameTemplate = getFixedMaterialFilenameTemplate();
  return nextSettings;
}

function normalizeRule(rule?: Partial<DouyinMaterialRule>): DouyinMaterialRule {
  const now = new Date().toISOString();
  return {
    id: rule?.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    douyinAccount: rule?.douyinAccount?.trim() || "",
    douyinAccountId: rule?.douyinAccountId?.trim() || "",
    shortName: rule?.shortName?.trim() || "",
    percent: normalizeAllocationPercent(
      rule?.percent ?? rule?.materialRatio ?? 0,
    ),
    maxPercent: normalizeAllocationMaxPercent(rule?.maxPercent ?? 100),
    locked: Boolean(rule?.locked),
    weight: normalizeAllocationWeight(rule?.weight ?? 1),
    order: Number(rule?.order || 0),
    materialRange: rule?.materialRange?.trim() || "",
    materialRatio: normalizeAllocationPercent(
      rule?.materialRatio ?? rule?.percent ?? 0,
    ),
    createdAt: rule?.createdAt || now,
    updatedAt: rule?.updatedAt || now,
  };
}

function normalizeBuildSettings(
  settings?: Partial<UploadBuildSettings>,
): UploadBuildSettings {
  const defaults = createDefaultBuildSettings();
  return {
    buildParams: {
      ...defaults.buildParams,
      ...(settings?.buildParams || {}),
    },
    darenName: settings?.darenName?.trim() || defaults.darenName,
    materialFilenameTemplate: getFixedMaterialFilenameTemplate(),
    materialDateValue: settings?.materialDateValue?.trim() || "",
    douyinMaterialRules: Array.isArray(settings?.douyinMaterialRules)
      ? settings!.douyinMaterialRules.map((rule, index) => ({
          ...normalizeRule(rule),
          order: Number(rule?.order || index + 1),
        }))
      : [],
    materialAllocationMode: "ratio",
  };
}

function getAccountStorageKey(dirPath: string): string {
  return `upload-build:accounts:${encodeURIComponent(dirPath)}`;
}

function getDramaIdStorageKey(dirPath: string): string {
  return `upload-build:drama-ids:${encodeURIComponent(dirPath)}`;
}

function loadStoredMap(
  dirPath: string,
  storageKeyFactory: (dir: string) => string,
) {
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
  value: string,
) {
  if (!dirPath) return;
  const current = loadStoredMap(dirPath, storageKeyFactory);
  current[key] = value;
  localStorage.setItem(storageKeyFactory(dirPath), JSON.stringify(current));
}

function persistLocalAccount(row: DramaUploadRow) {
  if (row.entryMode !== "local") {
    return;
  }

  saveStoredValue(
    rootDir.value,
    getAccountStorageKey,
    row.folderPath,
    row.accountId.trim(),
  );
}

function getUploadListRowKey(row: DramaUploadRow): string {
  return row.entryMode === "local"
    ? `local:${row.folderPath}`
    : `build-only:${row.id}`;
}

function buildUploadListComparableRow(
  row: DramaUploadRow,
): UploadListSavedRowSnapshot {
  return {
    rowKey: getUploadListRowKey(row),
    entryMode: row.entryMode,
    drama: row.drama.trim(),
    folderPath: row.folderPath,
    files: [...row.files],
    accountId: row.accountId.trim(),
    dramaId: row.dramaId.trim(),
  };
}

function buildUploadListComparableRowFromSnapshot(
  row: UploadListSavedRowSnapshot,
): UploadListSavedRowSnapshot {
  return {
    rowKey: String(row.rowKey || "").trim(),
    entryMode: row.entryMode === "build-only" ? "build-only" : "local",
    drama: String(row.drama || "").trim(),
    folderPath: String(row.folderPath || ""),
    files: Array.isArray(row.files)
      ? row.files.map((item) => String(item || ""))
      : [],
    accountId: String(row.accountId || "").trim(),
    dramaId: String(row.dramaId || "").trim(),
  };
}

function normalizeUploadListSavedSnapshot(
  snapshot?: Partial<UploadListSavedSnapshot> | null,
): UploadListSavedSnapshot | null {
  if (!snapshot) {
    return null;
  }

  return {
    userId: String(snapshot.userId || "").trim(),
    channelId: String(snapshot.channelId || "").trim(),
    rootDir: String(snapshot.rootDir || ""),
    savedAt: String(snapshot.savedAt || ""),
    rows: Array.isArray(snapshot.rows)
      ? snapshot.rows.map((row) => ({
          ...buildUploadListComparableRowFromSnapshot(row),
          autoAssignedAccount: row.autoAssignedAccount
            ? {
                accountId: String(
                  row.autoAssignedAccount.accountId || "",
                ).trim(),
                recordId: String(row.autoAssignedAccount.recordId || "").trim(),
                tableId: String(row.autoAssignedAccount.tableId || "").trim(),
              }
            : undefined,
        }))
      : [],
  };
}

function readUploadListSnapshotStore(): Record<
  string,
  UploadListSavedSnapshot
> {
  try {
    const raw = localStorage.getItem(UPLOAD_LIST_SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, UploadListSavedSnapshot>;
    const normalizedEntries = Object.entries(parsed).map(([key, value]) => [
      key,
      normalizeUploadListSavedSnapshot(value),
    ]);

    return Object.fromEntries(
      normalizedEntries.filter(
        (entry): entry is [string, UploadListSavedSnapshot] =>
          Boolean(entry[1]),
      ),
    );
  } catch (error) {
    console.error("读取上传列表保存快照失败:", error);
    return {};
  }
}

function writeUploadListSnapshotStore(
  snapshots: Record<string, UploadListSavedSnapshot>,
) {
  localStorage.setItem(
    UPLOAD_LIST_SNAPSHOT_STORAGE_KEY,
    JSON.stringify(snapshots),
  );
}

function loadUploadListSnapshot(
  snapshotKey: string,
): UploadListSavedSnapshot | null {
  if (!snapshotKey) {
    return null;
  }

  return readUploadListSnapshotStore()[snapshotKey] || null;
}

function saveUploadListSnapshot(
  snapshotKey: string,
  snapshot: UploadListSavedSnapshot,
) {
  const snapshots = readUploadListSnapshotStore();
  snapshots[snapshotKey] = snapshot;
  writeUploadListSnapshotStore(snapshots);
  savedUploadListSnapshot.value = snapshot;
}

function buildUploadListDraftRows(): UploadListDraftRow[] {
  return rows.value.map((row) => ({
    row,
    snapshot: buildUploadListComparableRow(row),
    nextAccountId: row.accountId.trim(),
  }));
}

function collectUploadListAutoAssignments(
  draftRows: UploadListDraftRow[],
  previousRowMap: Map<string, UploadListSavedRowSnapshot>,
) {
  const finalAutoAssignments = new Map<string, UploadListAutoAssignedAccount>();

  for (const draftRow of draftRows) {
    const previousAuto = previousRowMap.get(
      draftRow.snapshot.rowKey,
    )?.autoAssignedAccount;
    if (previousAuto) {
      if (
        !draftRow.nextAccountId ||
        draftRow.nextAccountId === previousAuto.accountId
      ) {
        draftRow.nextAccountId = previousAuto.accountId;
        finalAutoAssignments.set(draftRow.snapshot.rowKey, previousAuto);
        continue;
      }
    }

    const pendingAuto = draftRow.row.pendingAutoAssignedAccount;
    if (pendingAuto && draftRow.nextAccountId === pendingAuto.accountId) {
      finalAutoAssignments.set(draftRow.snapshot.rowKey, pendingAuto);
    }
  }

  return finalAutoAssignments;
}

async function planUploadListAccountAssignments(
  draftRows: UploadListDraftRow[],
  previousAutoAssignmentMap: Map<string, UploadListAutoAssignedAccount>,
  finalAutoAssignments: Map<string, UploadListAutoAssignedAccount>,
  accountTableId: string,
) {
  let recycledAllAccounts = false;
  const rowsNeedAutoAssignment = draftRows.filter(
    (draftRow) => !draftRow.nextAccountId,
  );

  if (!rowsNeedAutoAssignment.length) {
    return {
      recycledAllAccounts,
      rowsNeedAutoAssignment,
    };
  }

  const availableAccountRecords = await queryChannelFeishuAccounts();
  if (!availableAccountRecords.length) {
    throw new Error("当前渠道账户表没有可分配的账户记录");
  }

  const preservedRecordIds = new Set(
    Array.from(finalAutoAssignments.values()).map((item) => item.recordId),
  );

  let candidateRecords = availableAccountRecords.filter((record) => {
    if (!record.recordId || !record.accountId) {
      return false;
    }
    if (preservedRecordIds.has(record.recordId)) {
      return false;
    }
    return !record.isUsed || previousAutoAssignmentMap.has(record.recordId);
  });

  if (candidateRecords.length < rowsNeedAutoAssignment.length) {
    recycledAllAccounts = true;
    candidateRecords = availableAccountRecords.filter(
      (record) =>
        Boolean(record.recordId && record.accountId) &&
        !preservedRecordIds.has(record.recordId),
    );
  }

  const occupiedAccounts = new Set(
    draftRows.map((draftRow) => draftRow.nextAccountId.trim()).filter(Boolean),
  );
  const usedRecordIds = new Set(
    Array.from(finalAutoAssignments.values()).map((item) => item.recordId),
  );

  for (const draftRow of rowsNeedAutoAssignment) {
    const candidateIndex = candidateRecords.findIndex(
      (record) =>
        !usedRecordIds.has(record.recordId) &&
        !occupiedAccounts.has(record.accountId.trim()),
    );

    if (candidateIndex === -1) {
      throw new Error("可用飞书账户不足，无法为当前上传列表完成分配");
    }

    const candidate = candidateRecords.splice(candidateIndex, 1)[0];
    const assignment: UploadListAutoAssignedAccount = {
      accountId: candidate.accountId.trim(),
      recordId: candidate.recordId,
      tableId: accountTableId,
    };
    draftRow.nextAccountId = assignment.accountId;
    finalAutoAssignments.set(draftRow.snapshot.rowKey, assignment);
    usedRecordIds.add(candidate.recordId);
    occupiedAccounts.add(assignment.accountId);
  }

  return {
    recycledAllAccounts,
    rowsNeedAutoAssignment,
  };
}

function parseFeishuTextField(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        return item.trim();
      }
      if (
        item &&
        typeof item === "object" &&
        "text" in item &&
        typeof item.text === "string" &&
        item.text.trim()
      ) {
        return item.text.trim();
      }
    }
  }

  if (value && typeof value === "object" && "text" in value) {
    const text = value.text;
    if (typeof text === "string") {
      return text.trim();
    }
  }

  return "";
}

function isFeishuAccountUsed(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.includes("是");
  }
  return String(value || "").trim() === "是";
}

function buildDuplicateAccountError(
  rowsToValidate: Array<{ drama: string; accountId: string }>,
): string {
  const accountMap = new Map<string, string[]>();
  for (const row of rowsToValidate) {
    const accountId = row.accountId.trim();
    if (!accountId) {
      continue;
    }
    const dramas = accountMap.get(accountId) || [];
    dramas.push(row.drama.trim() || "未命名剧目");
    accountMap.set(accountId, dramas);
  }

  const duplicateEntry = Array.from(accountMap.entries()).find(
    ([, dramas]) => dramas.length > 1,
  );
  if (!duplicateEntry) {
    return "";
  }

  const [accountId, dramas] = duplicateEntry;
  return `账户 ${accountId} 被重复使用：${dramas.join("、")}`;
}

function getUploadListSaveValidationError(): string {
  for (const row of rows.value) {
    const dramaLabel = row.drama.trim() || "未命名剧目";
    if (row.entryMode === "build-only" && !row.drama.trim()) {
      return "提交搭建的剧目需要先填写剧名";
    }
    if (row.dramaIdLoading) {
      return `《${dramaLabel}》短剧ID获取中`;
    }
    if (!row.dramaId.trim() && row.dramaIdError) {
      return `《${dramaLabel}》短剧ID获取失败`;
    }
    if (!row.dramaId.trim()) {
      return `《${dramaLabel}》还没有填写短剧ID`;
    }
  }

  return "";
}

function getExecutionRowsValidationError(): string {
  if (!rows.value.length) {
    return "请先选择素材目录并扫描剧目";
  }

  for (const row of rows.value) {
    const dramaLabel = row.drama.trim() || "未命名剧目";
    if (row.entryMode === "build-only" && !row.drama.trim()) {
      return "提交搭建的剧目需要先填写剧名";
    }
    if (!row.accountId.trim()) {
      return `《${dramaLabel}》还没有填写账户`;
    }
    if (row.dramaIdLoading) {
      return `《${dramaLabel}》短剧ID获取中`;
    }
    if (!row.dramaId.trim() && row.dramaIdError) {
      return `《${dramaLabel}》短剧ID获取失败`;
    }
    if (!row.dramaId.trim()) {
      return `《${dramaLabel}》还没有填写短剧ID`;
    }
  }

  return "";
}

async function queryChannelFeishuAccounts(): Promise<FeishuAccountRecord[]> {
  const appToken = apiConfigStore.config.feishuAppToken.trim();
  const tableId = currentFeishuAccountTableId.value.trim();
  if (!appToken || !tableId) {
    throw new Error("当前渠道未配置飞书账户表");
  }

  const result = (await window.api.feishuRequest(
    `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search?ignore_consistency_check=true`,
    {
      field_names: ["账户", "是否已用"],
      page_size: 1000,
    },
    "POST",
  )) as FeishuSearchResponse;

  if (result.code !== 0) {
    throw new Error(result.msg || "查询飞书账户表失败");
  }

  return Array.isArray(result.data?.items)
    ? result.data.items.map((item) => ({
        recordId: item.record_id,
        accountId: parseFeishuTextField(item.fields?.["账户"]),
        isUsed: isFeishuAccountUsed(item.fields?.["是否已用"]),
      }))
    : [];
}

async function updateFeishuAccountUsedStatus(recordId: string, used: boolean) {
  const appToken = apiConfigStore.config.feishuAppToken.trim();
  const tableId = currentFeishuAccountTableId.value.trim();
  if (!appToken || !tableId) {
    throw new Error("当前渠道未配置飞书账户表");
  }

  const result = (await window.api.feishuRequest(
    `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}?ignore_consistency_check=true`,
    {
      fields: {
        是否已用: used ? "是" : "否",
      },
    },
    "PUT",
  )) as { code?: number; msg?: string };

  if (result.code !== 0) {
    throw new Error(result.msg || "更新飞书账户状态失败");
  }
}

async function resetAllChannelFeishuAccountsUnused(
  records: FeishuAccountRecord[],
) {
  const appToken = apiConfigStore.config.feishuAppToken.trim();
  const tableId = currentFeishuAccountTableId.value.trim();
  if (!appToken || !tableId) {
    throw new Error("当前渠道未配置飞书账户表");
  }

  if (!records.length) {
    return;
  }

  const chunkSize = 200;
  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize);
    const result = (await window.api.feishuRequest(
      `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_update?ignore_consistency_check=true`,
      {
        records: chunk.map((record) => ({
          record_id: record.recordId,
          fields: {
            是否已用: "否",
          },
        })),
      },
      "POST",
    )) as { code?: number; msg?: string };

    if (result.code !== 0) {
      throw new Error(result.msg || "重置飞书账户状态失败");
    }
  }
}

function clearDramaIdLookupTimer(rowId: string) {
  const timer = dramaIdLookupTimers.get(rowId);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    dramaIdLookupTimers.delete(rowId);
  }
}

function persistLocalDramaId(row: DramaUploadRow) {
  if (row.entryMode !== "local") {
    return;
  }

  saveStoredValue(
    rootDir.value,
    getDramaIdStorageKey,
    row.folderPath,
    row.dramaId.trim(),
  );
}

async function resolveDramaIdForRow(row: DramaUploadRow) {
  clearDramaIdLookupTimer(row.id);

  const dramaName = row.drama.trim();
  if (!dramaName) {
    row.dramaId = "";
    row.dramaIdLoading = false;
    row.dramaIdError = undefined;
    persistLocalDramaId(row);
    return;
  }

  const requestId = (dramaIdLookupRequestIds.get(row.id) || 0) + 1;
  dramaIdLookupRequestIds.set(row.id, requestId);

  row.dramaId = "";
  row.dramaIdLoading = true;
  row.dramaIdError = undefined;
  persistLocalDramaId(row);

  try {
    const result = await window.api.changduSearchSeries(dramaName);
    if (dramaIdLookupRequestIds.get(row.id) !== requestId) {
      return;
    }

    if (!result?.bookId) {
      row.dramaId = "";
      row.dramaIdError = `未找到《${dramaName}》对应的短剧ID`;
      persistLocalDramaId(row);
      return;
    }

    row.dramaId = result.bookId.trim();
    row.dramaIdError = undefined;
    persistLocalDramaId(row);
  } catch (error) {
    if (dramaIdLookupRequestIds.get(row.id) !== requestId) {
      return;
    }

    const errorText =
      error instanceof Error ? error.message : String(error || "未知错误");
    row.dramaId = "";
    row.dramaIdError = `自动获取失败：${errorText}`;
    persistLocalDramaId(row);
  } finally {
    if (dramaIdLookupRequestIds.get(row.id) === requestId) {
      row.dramaIdLoading = false;
    }
  }
}

async function resolveDramaIdsForRows(targetRows: DramaUploadRow[]) {
  const queue = targetRows.filter((row) => row.drama.trim());
  const workerCount = Math.min(queue.length, 3);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length) {
        const row = queue.shift();
        if (!row) {
          return;
        }
        await resolveDramaIdForRow(row);
      }
    }),
  );
}

function scheduleDramaIdLookup(row: DramaUploadRow, delay = 400) {
  clearDramaIdLookupTimer(row.id);

  const dramaName = row.drama.trim();
  if (!dramaName) {
    row.dramaId = "";
    row.dramaIdLoading = false;
    row.dramaIdError = undefined;
    persistLocalDramaId(row);
    return;
  }

  const timer = window.setTimeout(() => {
    dramaIdLookupTimers.delete(row.id);
    void resolveDramaIdForRow(row);
  }, delay);
  dramaIdLookupTimers.set(row.id, timer);
}

function refreshDramaId(row: DramaUploadRow) {
  void resolveDramaIdForRow(row);
}

function normalizeRow(row?: Partial<DramaUploadRow>): DramaUploadRow {
  return {
    id:
      row?.id || `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    entryMode: row?.entryMode === "build-only" ? "build-only" : "local",
    drama: row?.drama || "",
    folderPath: row?.folderPath || "",
    files: Array.isArray(row?.files) ? [...row.files] : [],
    materialCount: Number(row?.materialCount || 0),
    accountId: row?.accountId || "",
    dramaId: row?.dramaId || "",
    status: (row?.status as UploadStatus) || "pending",
    error: row?.error,
    taskId: row?.taskId,
    currentBatch: Number(row?.currentBatch || 0),
    totalBatches: Number(row?.totalBatches || 0),
    successCount: Number(row?.successCount || 0),
    totalFiles: Number(row?.totalFiles || 0),
    deleted: Boolean(row?.deleted),
    deleteError: row?.deleteError,
    buildStatus: (row?.buildStatus as BuildStatus) || "idle",
    buildTaskId: row?.buildTaskId,
    buildError: row?.buildError,
    buildMessage: row?.buildMessage,
    buildSuccessRuleCount: Number(row?.buildSuccessRuleCount || 0),
    buildFailedRuleCount: Number(row?.buildFailedRuleCount || 0),
    buildTotalRules: Number(row?.buildTotalRules || 0),
    dramaIdLoading: Boolean(row?.dramaIdLoading),
    dramaIdError: row?.dramaIdError,
    skippedRules: Array.isArray(row?.skippedRules)
      ? row.skippedRules.map((item) => ({
          douyinAccount: String(item?.douyinAccount || ""),
          error: String(item?.error || ""),
        }))
      : [],
  };
}

function loadPersistedViewState(): UploadBuildViewState | null {
  try {
    const raw = localStorage.getItem(VIEW_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UploadBuildViewState>;
    return {
      rootDir: parsed.rootDir || "",
      rows: Array.isArray(parsed.rows)
        ? parsed.rows.map((row) => normalizeRow(row))
        : [],
      currentProgress: parsed.currentProgress || null,
      currentBuildProgress: parsed.currentBuildProgress || null,
      autoRunEnabled: Boolean(parsed.autoRunEnabled),
      removedFolderPaths: Array.isArray(parsed.removedFolderPaths)
        ? parsed.removedFolderPaths
            .map((item) => String(item || "").trim())
            .filter(Boolean)
        : [],
    };
  } catch (error) {
    console.error("读取上传搭建页面状态失败:", error);
    return null;
  }
}

function persistViewState() {
  try {
    if (!rootDir.value && rows.value.length === 0) {
      localStorage.removeItem(VIEW_STATE_STORAGE_KEY);
      return;
    }

    const payload: UploadBuildViewState = {
      rootDir: rootDir.value,
      rows: rows.value.map((row) =>
        normalizeRow(JSON.parse(JSON.stringify(row))),
      ),
      currentProgress: currentProgress.value
        ? JSON.parse(JSON.stringify(currentProgress.value))
        : null,
      currentBuildProgress: currentBuildProgress.value
        ? JSON.parse(JSON.stringify(currentBuildProgress.value))
        : null,
      autoRunEnabled: autoRunEnabled.value,
      removedFolderPaths: [...removedFolderPaths.value],
    };
    localStorage.setItem(VIEW_STATE_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error("保存上传搭建页面状态失败:", error);
  }
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

function getUploadProgressPercentage(row: DramaUploadRow): number {
  if (row.entryMode === "build-only") {
    return 100;
  }
  if (row.status === "uploaded") {
    return 100;
  }

  const total = Number(row.totalFiles || row.materialCount || 0);
  if (total <= 0) {
    return row.status === "pending" ? 0 : 100;
  }

  return Math.max(
    0,
    Math.min(100, Math.round((Number(row.successCount || 0) / total) * 100)),
  );
}

function getBuildProgressPercentage(row: DramaUploadRow): number {
  if (row.buildStatus === "built") {
    return 100;
  }

  const total = Number(row.buildTotalRules || 0);
  if (total <= 0) {
    return row.buildStatus === "idle" ? 0 : 100;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round((Number(row.buildSuccessRuleCount || 0) / total) * 100),
    ),
  );
}

function shouldShowBuildProgress(row: DramaUploadRow): boolean {
  return (
    row.entryMode === "build-only" ||
    row.buildTotalRules > 0 ||
    row.buildStatus !== "idle"
  );
}

function setAllocationFeedbackMessage(
  text: string,
  type: "info" | "success" | "warning" = "info",
) {
  allocationFeedback.value = text;
  allocationFeedbackType.value = type;
}

async function persistBuildSettingsNow() {
  if (!currentDaren.value) {
    return;
  }

  const payload = createEffectiveBuildSettings();
  await darenStore.updateDaren(currentDaren.value.id, {
    uploadBuildSettings: payload,
  });
  savedBuildSettingsSnapshot.value = cloneBuildSettings(payload);
}

watch(
  () => currentDaren.value?.id,
  () => {
    buildSettings.value = normalizeBuildSettings(
      currentDaren.value?.uploadBuildSettings,
    );
    savedBuildSettingsSnapshot.value = cloneBuildSettings(buildSettings.value);
    allocationFeedback.value = "";
  },
  { immediate: true },
);

watch(
  () => sessionStore.currentChannel?.id,
  (current, previous) => {
    if (!current || !previous || current === previous || !rows.value.length) {
      return;
    }

    void resolveDramaIdsForRows(rows.value);
  },
);

watch(
  currentUploadListSnapshotKey,
  (snapshotKey) => {
    savedUploadListSnapshot.value = loadUploadListSnapshot(snapshotKey);
  },
  { immediate: true },
);

watch(
  [
    rows,
    currentProgress,
    currentBuildProgress,
    rootDir,
    autoRunEnabled,
    removedFolderPaths,
  ],
  () => {
    persistViewState();
  },
  { deep: true },
);

watch(autoRunDisabledReason, (reason) => {
  if (reason && autoRunEnabled.value) {
    autoRunEnabled.value = false;
    message.warning(`自动运行已关闭：${reason}`);
  }
});

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
      clearProjectsBeforeBuild:
        localStorage.getItem(CLEAR_PROJECTS_BEFORE_BUILD_STORAGE_KEY) === "1",
      autoPreviewAfterBuild:
        localStorage.getItem(AUTO_PREVIEW_AFTER_BUILD_STORAGE_KEY) === "1",
    };
  } catch (error) {
    console.error("加载巨量配置失败:", error);
  }
}

async function applyUploadConfig(
  patch: Partial<typeof uploadConfig.value>,
  options?: { resetBrowser?: boolean },
) {
  const nextConfig = {
    ...uploadConfig.value,
    ...patch,
  };
  nextConfig.batchSize = Math.max(
    1,
    Math.floor(Number(nextConfig.batchSize || 1)),
  );
  nextConfig.batchUploadTimeoutMinutes = Math.max(
    1,
    Math.floor(Number(nextConfig.batchUploadTimeoutMinutes || 5)),
  );
  nextConfig.maxBatchRetries = Math.max(
    0,
    Math.min(10, Math.floor(Number(nextConfig.maxBatchRetries || 0))),
  );
  nextConfig.timeoutPartialRetryRounds = Math.max(
    0,
    Math.min(10, Math.floor(Number(nextConfig.timeoutPartialRetryRounds || 0))),
  );
  nextConfig.allowedMissingCount = Math.max(
    0,
    Math.floor(Number(nextConfig.allowedMissingCount || 0)),
  );

  uploadConfig.value = nextConfig;

  localStorage.setItem(
    DELETE_AFTER_UPLOAD_STORAGE_KEY,
    uploadConfig.value.deleteAfterUpload ? "1" : "0",
  );
  localStorage.setItem(
    CLEAR_PROJECTS_BEFORE_BUILD_STORAGE_KEY,
    uploadConfig.value.clearProjectsBeforeBuild ? "1" : "0",
  );
  localStorage.setItem(
    AUTO_PREVIEW_AFTER_BUILD_STORAGE_KEY,
    uploadConfig.value.autoPreviewAfterBuild ? "1" : "0",
  );

  const plainConfig = JSON.parse(
    JSON.stringify(uploadConfig.value),
  ) as typeof uploadConfig.value;
  const {
    deleteAfterUpload: _deleteAfterUpload,
    clearProjectsBeforeBuild: _clearProjectsBeforeBuild,
    autoPreviewAfterBuild: _autoPreviewAfterBuild,
    ...serviceConfig
  } = plainConfig;
  try {
    await window.api.juliangUpdateConfig(serviceConfig);
  } catch (error) {
    message.error(`更新巨量配置失败: ${error}`);
    return;
  }

  if (
    options?.resetBrowser &&
    !activeRow.value &&
    !activeBuildRow.value &&
    isReady.value
  ) {
    await window.api.juliangClose();
    isReady.value = false;
    needLogin.value = false;
  }
}

async function selectRootDir() {
  try {
    const selected = await window.api.selectFolder();
    if (!selected) return;

    removedFolderPaths.value = [];
    rootDir.value = selected;
    localStorage.setItem(ROOT_DIR_STORAGE_KEY, selected);
    await scanRootDir();
  } catch (error) {
    message.error(`选择目录失败: ${error}`);
  }
}

async function rescanRootDir() {
  removedFolderPaths.value = [];
  await scanRootDir();
}

async function scanRootDir() {
  if (!rootDir.value) {
    rows.value = rows.value.filter((row) => row.entryMode === "build-only");
    return;
  }

  isScanning.value = true;
  try {
    const materials = await window.api.scanVideos(rootDir.value);
    const manualRows = rows.value.filter(
      (row) => row.entryMode === "build-only",
    );
    const removedFolderPathSet = new Set(removedFolderPaths.value);
    const previousRowMap = new Map(
      rows.value
        .filter((row) => row.entryMode === "local")
        .map((row) => [row.folderPath, row]),
    );
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
      .filter((group) => !removedFolderPathSet.has(group.folderPath))
      .sort((a, b) => a.drama.localeCompare(b.drama, "zh-Hans-CN"))
      .map((group) => {
        const previous = previousRowMap.get(group.folderPath);
        const unchanged =
          previous &&
          previous.materialCount === group.files.length &&
          previous.files.join("|") === group.files.join("|");

        return {
          id: `${group.folderPath}-${group.files.length}`,
          entryMode: "local",
          drama: group.drama,
          folderPath: group.folderPath,
          files: [...group.files],
          materialCount: group.files.length,
          accountId:
            previous?.accountId ?? storedAccounts[group.folderPath] ?? "",
          dramaId: previous?.dramaId ?? storedDramaIds[group.folderPath] ?? "",
          status: unchanged ? previous!.status : "pending",
          error:
            unchanged && previous?.status === "failed"
              ? previous.error
              : undefined,
          taskId: unchanged ? previous?.taskId : undefined,
          currentBatch: unchanged ? previous?.currentBatch || 0 : 0,
          totalBatches: unchanged ? previous?.totalBatches || 0 : 0,
          successCount: unchanged ? previous?.successCount || 0 : 0,
          totalFiles: unchanged
            ? previous?.totalFiles || group.files.length
            : group.files.length,
          deleted: unchanged ? previous?.deleted || false : false,
          deleteError: unchanged ? previous?.deleteError : undefined,
          buildStatus: unchanged ? previous?.buildStatus || "idle" : "idle",
          buildTaskId: unchanged ? previous?.buildTaskId : undefined,
          buildError: unchanged ? previous?.buildError : undefined,
          buildMessage: unchanged ? previous?.buildMessage : undefined,
          buildSuccessRuleCount: unchanged
            ? previous?.buildSuccessRuleCount || 0
            : 0,
          buildFailedRuleCount: unchanged
            ? previous?.buildFailedRuleCount || 0
            : 0,
          buildTotalRules: unchanged ? previous?.buildTotalRules || 0 : 0,
          dramaIdLoading: false,
          dramaIdError: undefined,
          skippedRules: unchanged ? previous?.skippedRules || [] : [],
        } satisfies DramaUploadRow;
      });
    rows.value = [...manualRows, ...rows.value];
    void resolveDramaIdsForRows(rows.value);
  } catch (error) {
    console.error("扫描目录失败:", error);
    message.error(`扫描目录失败: ${error}`);
  } finally {
    isScanning.value = false;
  }
}

function applyUploadTaskState(
  row: DramaUploadRow,
  state: JuliangTaskStatePayload,
) {
  row.currentBatch = state.currentBatch;
  row.totalBatches = state.totalBatches;
  row.successCount = state.successCount;
  row.totalFiles = state.totalFiles || row.materialCount;

  if (state.status === "running" || state.status === "pending") {
    row.status = "uploading";
    row.error = undefined;
    return;
  }

  row.taskId = undefined;

  if (state.status === "completed") {
    row.status = "uploaded";
    row.error = undefined;
    return;
  }

  if (state.status === "skipped" && state.message.includes("取消")) {
    resetRowToPending(row);
    return;
  }

  row.status = "failed";
  row.error = state.message || "上传失败";
}

function applyBuildTaskState(
  row: DramaUploadRow,
  state: DailyBuildTaskStatePayload,
) {
  row.buildMessage = state.message;
  row.buildTotalRules = state.totalRules;
  row.buildSuccessRuleCount = state.successRuleCount;
  row.buildFailedRuleCount = state.failedRuleCount;

  if (state.status === "assetizing" || state.status === "building") {
    row.buildStatus = "building";
    row.buildError = undefined;
    return;
  }

  row.buildTaskId = undefined;

  if (state.status === "completed") {
    row.buildStatus = "built";
    row.buildError = undefined;
    return;
  }

  if (state.status === "cancelled") {
    row.buildStatus = "cancelled";
    row.buildError = undefined;
    return;
  }

  row.buildStatus = "failed";
  row.buildError = state.message || "搭建失败";
}

async function syncTaskStatesFromMain() {
  try {
    const [uploadStates, buildStates] = await Promise.all([
      window.api.juliangGetTaskStates(),
      window.api.dailyBuildGetTaskStates(),
    ]);
    const uploadMap = new Map(uploadStates.map((item) => [item.taskId, item]));
    const buildMap = new Map(buildStates.map((item) => [item.taskId, item]));
    let nextUploadProgress: JuliangUploadProgressPayload | null = null;
    let nextBuildProgress: DailyBuildProgressPayload | null = null;

    for (const row of rows.value) {
      if (row.taskId) {
        const uploadState = uploadMap.get(row.taskId);
        if (uploadState) {
          applyUploadTaskState(row, uploadState);
          if (
            uploadState.status === "running" ||
            uploadState.status === "pending"
          ) {
            nextUploadProgress = {
              taskId: uploadState.taskId,
              drama: uploadState.drama,
              status: uploadState.status,
              currentBatch: uploadState.currentBatch,
              totalBatches: uploadState.totalBatches,
              successCount: uploadState.successCount,
              totalFiles: uploadState.totalFiles,
              message: uploadState.message,
            };
          }
        }
      }

      if (row.buildTaskId) {
        const buildState = buildMap.get(row.buildTaskId);
        if (buildState) {
          applyBuildTaskState(row, buildState);
          if (
            buildState.status === "assetizing" ||
            buildState.status === "building"
          ) {
            nextBuildProgress = {
              taskId: buildState.taskId,
              drama: buildState.drama,
              status: buildState.status,
              message: buildState.message,
              currentRuleIndex: buildState.currentRuleIndex,
              totalRules: buildState.totalRules,
              successRuleCount: buildState.successRuleCount,
              failedRuleCount: buildState.failedRuleCount,
            };
          }
        }
      }
    }

    currentProgress.value = nextUploadProgress;
    currentBuildProgress.value = nextBuildProgress;
  } catch (error) {
    console.error("同步上传搭建任务状态失败:", error);
  }
}

function getRenameTemplateError() {
  if (!rootDir.value) {
    return "请先选择素材目录";
  }

  const template = getFixedMaterialFilenameTemplate().trim();
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
    message.warning(
      `当前正在上传《${activeRow.value.drama}》，请等待完成后再试`,
    );
    return;
  }
  if (activeBuildRow.value) {
    message.warning(
      `当前正在搭建《${activeBuildRow.value.drama}》，请等待完成后再试`,
    );
    return;
  }

  const errorText = getRenameTemplateError();
  if (errorText) {
    message.warning(errorText);
    return;
  }

  const confirmed = window.confirm(
    "仅处理当前目录下的 mp4 文件；会自动按剧名分组并按固定模板重命名，已有子目录会跳过。是否继续？",
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
      resolveTemplateWithCurrentShortName(getFixedMaterialFilenameTemplate()),
    );

    if (!result.success) {
      message.error(`批量重命名失败：${result.error || "未知错误"}`);
      return;
    }

    await scanRootDir();
    message.success(
      `已处理 ${result.dramaCount} 部剧，重命名 ${result.renamedCount} 个文件，跳过 ${result.skippedCount} 个`,
    );
  } catch (error) {
    message.error(`批量重命名失败：${error}`);
  } finally {
    isRenaming.value = false;
  }
}

function handleAccountInput(row: DramaUploadRow, value: string) {
  row.accountId = value.trim();
  if (
    row.pendingAutoAssignedAccount &&
    row.accountId !== row.pendingAutoAssignedAccount.accountId
  ) {
    row.pendingAutoAssignedAccount = undefined;
  }
  persistLocalAccount(row);
}

function handleDramaNameInput(row: DramaUploadRow, value: string) {
  row.drama = value.trim();
  row.dramaId = "";
  row.dramaIdError = undefined;
  scheduleDramaIdLookup(row);
}

function addBuildOnlyRow() {
  if (activeRow.value) {
    message.warning(`当前正在上传《${activeRow.value.drama}》，请稍后再试`);
    return;
  }
  if (activeBuildRow.value) {
    message.warning(
      `当前正在搭建《${activeBuildRow.value.drama}》，请稍后再试`,
    );
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
    dramaIdLoading: false,
    dramaIdError: undefined,
    skippedRules: [],
  });
}

function removeRow(row: DramaUploadRow) {
  if (row.status === "uploading" || row.buildStatus === "building") {
    message.warning("请先等待当前剧目处理完成后再移除");
    return;
  }

  clearDramaIdLookupTimer(row.id);
  dramaIdLookupRequestIds.delete(row.id);
  rows.value = rows.value.filter((item) => item.id !== row.id);
  if (row.entryMode === "local" && row.folderPath) {
    const nextRemovedFolderPaths = new Set(removedFolderPaths.value);
    nextRemovedFolderPaths.add(row.folderPath);
    removedFolderPaths.value = Array.from(nextRemovedFolderPaths);
  }
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

function syncLegacyRuleFields(rule: DouyinMaterialRule, index: number) {
  rule.percent = normalizeAllocationPercent(rule.percent);
  rule.maxPercent = normalizeAllocationMaxPercent(rule.maxPercent ?? 100);
  rule.weight = normalizeAllocationWeight(rule.weight ?? 1);
  rule.order = index + 1;
  rule.materialRatio = rule.percent;
  rule.updatedAt = new Date().toISOString();
}

function syncAllRuleOrders() {
  buildSettings.value.douyinMaterialRules.forEach((rule, index) => {
    syncLegacyRuleFields(rule, index);
  });
}

function applyRuleMutation(
  nextRules: DouyinMaterialRule[],
  messageText?: string,
  type: "info" | "success" | "warning" = "info",
) {
  buildSettings.value.douyinMaterialRules = nextRules.map((rule, index) => {
    const nextRule = normalizeRule(rule);
    syncLegacyRuleFields(nextRule, index);
    return nextRule;
  });

  if (messageText) {
    setAllocationFeedbackMessage(messageText, type);
  }
}

function handleRulePercentChange(ruleId: string, value: number | null) {
  const result = setAllocationPercent(
    buildSettings.value.douyinMaterialRules.map((rule) => normalizeRule(rule)),
    ruleId,
    Number(value ?? 0),
  );
  applyRuleMutation(
    result.items,
    result.message,
    result.changed ? "info" : "warning",
  );
}

function handleRuleWeightChange(ruleId: string, value: number | null) {
  const nextRules = buildSettings.value.douyinMaterialRules.map((rule) => {
    if (rule.id !== ruleId) {
      return normalizeRule(rule);
    }
    return normalizeRule({
      ...rule,
      weight: normalizeAllocationWeight(value ?? 0),
    });
  });
  applyRuleMutation(nextRules, "已更新权重", "info");
}

function handleRuleLockChange(ruleId: string, value: boolean) {
  const nextRules = buildSettings.value.douyinMaterialRules.map((rule) => {
    if (rule.id !== ruleId) {
      return normalizeRule(rule);
    }
    return normalizeRule({
      ...rule,
      locked: value,
    });
  });
  applyRuleMutation(nextRules, value ? "已锁定该账号" : "已解锁该账号", "info");
}

function handleAverageAllocate() {
  const result = distributeRemainingEvenly(
    buildSettings.value.douyinMaterialRules.map((rule) => normalizeRule(rule)),
  );
  applyRuleMutation(
    result.items,
    result.message,
    result.changed ? "success" : "warning",
  );
}

function handleWeightAllocate() {
  const result = distributeRemainingByWeight(
    buildSettings.value.douyinMaterialRules.map((rule) => normalizeRule(rule)),
  );
  applyRuleMutation(
    result.items,
    result.message,
    result.changed ? "success" : "warning",
  );
}

function handleNormalizeAllocate() {
  const result = normalizeUnlockedAllocation(
    buildSettings.value.douyinMaterialRules.map((rule) => normalizeRule(rule)),
  );
  applyRuleMutation(
    result.items,
    result.message,
    result.changed ? "success" : "warning",
  );
}

function handleResetBuildSettings() {
  buildSettings.value = cloneBuildSettings(savedBuildSettingsSnapshot.value);
  syncAllRuleOrders();
  setAllocationFeedbackMessage("已恢复为初始加载时的配置", "info");
}

async function handlePullAccountsFromFeishu() {
  if (activeRow.value) {
    message.warning(
      `当前正在上传《${activeRow.value.drama}》，请稍后再拉取账户`,
    );
    return;
  }

  if (activeBuildRow.value) {
    message.warning(
      `当前正在搭建《${activeBuildRow.value.drama}》，请稍后再拉取账户`,
    );
    return;
  }

  const accountTableId = currentFeishuAccountTableId.value.trim();
  if (!accountTableId) {
    message.warning("当前渠道未配置飞书账户表 table_id");
    return;
  }

  const draftRows = buildUploadListDraftRows();
  const rowsNeedAutoAssignment = draftRows.filter(
    (draftRow) => !draftRow.nextAccountId,
  );
  if (!rowsNeedAutoAssignment.length) {
    message.info("当前没有空账户需要拉取");
    return;
  }

  const previousRows = savedUploadListSnapshot.value?.rows || [];
  const previousRowMap = new Map(previousRows.map((row) => [row.rowKey, row]));
  const previousAutoAssignmentMap = new Map(
    previousRows
      .map((row) => row.autoAssignedAccount)
      .filter((item): item is UploadListAutoAssignedAccount => Boolean(item))
      .map((item) => [item.recordId, item]),
  );
  const finalAutoAssignments = collectUploadListAutoAssignments(
    draftRows,
    previousRowMap,
  );

  try {
    const result = await planUploadListAccountAssignments(
      draftRows,
      previousAutoAssignmentMap,
      finalAutoAssignments,
      accountTableId,
    );

    const duplicateError = buildDuplicateAccountError(
      draftRows.map((draftRow) => ({
        drama: draftRow.snapshot.drama,
        accountId: draftRow.nextAccountId,
      })),
    );
    if (duplicateError) {
      message.warning(duplicateError);
      return;
    }

    for (const draftRow of draftRows) {
      const assignment = finalAutoAssignments.get(draftRow.snapshot.rowKey);
      if (!assignment) {
        continue;
      }

      if (draftRow.row.accountId.trim() !== draftRow.nextAccountId) {
        draftRow.row.accountId = draftRow.nextAccountId;
        persistLocalAccount(draftRow.row);
      }

      const previousAuto = previousRowMap.get(
        draftRow.snapshot.rowKey,
      )?.autoAssignedAccount;
      draftRow.row.pendingAutoAssignedAccount = previousAuto
        ? undefined
        : assignment;
    }

    const messageParts = [
      `已拉取 ${result.rowsNeedAutoAssignment.length} 个账户`,
    ];
    if (result.recycledAllAccounts) {
      messageParts.push("保存配置时会按账户回收后的顺序占用");
    }
    message.success(messageParts.join("，"));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    message.error(`拉取账户失败：${errorMessage}`);
  }
}

async function handleSaveUploadList() {
  if (savingUploadList.value) {
    return;
  }

  if (activeRow.value) {
    message.warning(`当前正在上传《${activeRow.value.drama}》，请稍后再保存`);
    return;
  }

  if (activeBuildRow.value) {
    message.warning(
      `当前正在搭建《${activeBuildRow.value.drama}》，请稍后再保存`,
    );
    return;
  }

  const snapshotKey = currentUploadListSnapshotKey.value;
  if (!snapshotKey) {
    message.warning("未获取到当前用户或渠道信息，请刷新后重试");
    return;
  }

  const accountTableId = currentFeishuAccountTableId.value.trim();
  if (!accountTableId) {
    message.warning("当前渠道未配置飞书账户表 table_id");
    return;
  }

  const saveError = getUploadListSaveValidationError();
  if (saveError) {
    message.warning(saveError);
    return;
  }

  const previousSnapshot = savedUploadListSnapshot.value;
  const previousRows = previousSnapshot?.rows || [];
  const previousRowMap = new Map(previousRows.map((row) => [row.rowKey, row]));
  const previousAutoAssignments = previousRows
    .map((row) => row.autoAssignedAccount)
    .filter((item): item is UploadListAutoAssignedAccount => Boolean(item));
  const previousAutoAssignmentMap = new Map(
    previousAutoAssignments.map((item) => [item.recordId, item]),
  );

  const draftRows = buildUploadListDraftRows();
  const finalAutoAssignments = collectUploadListAutoAssignments(
    draftRows,
    previousRowMap,
  );

  let duplicateError = buildDuplicateAccountError(
    draftRows.map((draftRow) => ({
      drama: draftRow.snapshot.drama,
      accountId: draftRow.nextAccountId,
    })),
  );
  if (duplicateError) {
    message.warning(duplicateError);
    return;
  }

  let recycledAllAccounts = false;
  const restoreAfterRecycleFailure = async () => {
    if (!recycledAllAccounts) {
      return;
    }

    for (const assignment of previousAutoAssignmentMap.values()) {
      try {
        await updateFeishuAccountUsedStatus(assignment.recordId, true);
      } catch (rollbackError) {
        console.error("恢复旧账户占用状态失败:", rollbackError);
      }
    }
  };

  let rowsNeedAutoAssignment = draftRows.filter(
    (draftRow) => !draftRow.nextAccountId,
  );

  if (rowsNeedAutoAssignment.length) {
    try {
      const planResult = await planUploadListAccountAssignments(
        draftRows,
        previousAutoAssignmentMap,
        finalAutoAssignments,
        accountTableId,
      );
      rowsNeedAutoAssignment = planResult.rowsNeedAutoAssignment;
      recycledAllAccounts = planResult.recycledAllAccounts;

      if (recycledAllAccounts) {
        const availableAccountRecords = await queryChannelFeishuAccounts();
        await resetAllChannelFeishuAccountsUnused(availableAccountRecords);
      }

      duplicateError = buildDuplicateAccountError(
        draftRows.map((draftRow) => ({
          drama: draftRow.snapshot.drama,
          accountId: draftRow.nextAccountId,
        })),
      );
      if (duplicateError) {
        throw new Error(duplicateError);
      }
    } catch (error) {
      await restoreAfterRecycleFailure();
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      message.warning(errorMessage);
      return;
    }
  }

  const finalAutoAssignmentList = Array.from(finalAutoAssignments.values());
  const finalAutoAssignmentRecordIds = new Set(
    finalAutoAssignmentList.map((item) => item.recordId),
  );
  const assignmentsToRelease = Array.from(
    previousAutoAssignmentMap.values(),
  ).filter((item) => !finalAutoAssignmentRecordIds.has(item.recordId));
  const assignmentsToUse = recycledAllAccounts
    ? finalAutoAssignmentList
    : finalAutoAssignmentList.filter(
        (item) => !previousAutoAssignmentMap.has(item.recordId),
      );

  const performedUseRecordIds: string[] = [];
  const performedReleaseRecordIds: string[] = [];

  savingUploadList.value = true;

  try {
    if (!recycledAllAccounts) {
      for (const assignment of assignmentsToRelease) {
        await updateFeishuAccountUsedStatus(assignment.recordId, false);
        performedReleaseRecordIds.push(assignment.recordId);
      }
    }

    for (const assignment of assignmentsToUse) {
      await updateFeishuAccountUsedStatus(assignment.recordId, true);
      performedUseRecordIds.push(assignment.recordId);
    }
  } catch (error) {
    console.error("保存上传列表时同步飞书账户失败:", error);

    if (recycledAllAccounts) {
      for (const recordId of performedUseRecordIds) {
        if (previousAutoAssignmentMap.has(recordId)) {
          continue;
        }
        try {
          await updateFeishuAccountUsedStatus(recordId, false);
        } catch (rollbackError) {
          console.error("回滚新占用账户失败:", rollbackError);
        }
      }

      for (const assignment of previousAutoAssignmentMap.values()) {
        try {
          await updateFeishuAccountUsedStatus(assignment.recordId, true);
        } catch (rollbackError) {
          console.error("恢复旧账户占用状态失败:", rollbackError);
        }
      }
    } else {
      for (const recordId of [...performedUseRecordIds].reverse()) {
        try {
          await updateFeishuAccountUsedStatus(recordId, false);
        } catch (rollbackError) {
          console.error("回滚已占用账户失败:", rollbackError);
        }
      }

      for (const recordId of [...performedReleaseRecordIds].reverse()) {
        try {
          await updateFeishuAccountUsedStatus(recordId, true);
        } catch (rollbackError) {
          console.error("恢复已释放账户失败:", rollbackError);
        }
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    message.error(`保存上传列表失败：${errorMessage}`);
    return;
  } finally {
    savingUploadList.value = false;
  }

  for (const draftRow of draftRows) {
    draftRow.row.accountId = draftRow.nextAccountId;
    draftRow.row.pendingAutoAssignedAccount = undefined;
    persistLocalAccount(draftRow.row);
  }

  const nextSnapshot: UploadListSavedSnapshot = {
    userId: apiConfigStore.config.userId.trim(),
    channelId: apiConfigStore.config.channelId.trim(),
    rootDir: rootDir.value.trim(),
    savedAt: new Date().toISOString(),
    rows: draftRows.map((draftRow) => ({
      ...draftRow.snapshot,
      accountId: draftRow.nextAccountId,
      autoAssignedAccount: finalAutoAssignments.get(draftRow.snapshot.rowKey),
    })),
  };
  saveUploadListSnapshot(snapshotKey, nextSnapshot);

  const autoAssignedCount = rowsNeedAutoAssignment.length;
  if (!draftRows.length) {
    message.success("上传列表已保存，旧账户占用已同步释放");
    return;
  }

  const messageParts = ["上传列表配置已保存"];
  if (autoAssignedCount > 0) {
    messageParts.push(`自动分配 ${autoAssignedCount} 个账户`);
  }
  if (assignmentsToRelease.length > 0) {
    messageParts.push(`释放 ${assignmentsToRelease.length} 个旧账户`);
  }
  message.success(messageParts.join("，"));
}

async function handleSaveBuildSettings() {
  if (!currentDaren.value) {
    return;
  }

  const saveError = getBuildConfigError();
  if (saveError) {
    message.warning(saveError);
    return;
  }

  try {
    syncAllRuleOrders();
    await persistBuildSettingsNow();
    setAllocationFeedbackMessage(
      "当前配置已保存到本地，并更新为新的基准状态",
      "success",
    );
    message.success("搭建配置已保存到本地");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    setAllocationFeedbackMessage(`保存失败：${errorMessage}`, "warning");
    message.error(`保存搭建配置失败：${errorMessage}`);
  }
}

function handleClearRulePercent(ruleId: string) {
  handleRulePercentChange(ruleId, 0);
}

function handleSetRuleToMax(ruleId: string) {
  handleRulePercentChange(
    ruleId,
    getRowMaxSettablePercent(allocationRulesForMath.value, ruleId),
  );
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

  if (editingRuleId.value) {
    const index = buildSettings.value.douyinMaterialRules.findIndex(
      (item) => item.id === editingRuleId.value,
    );
    if (index >= 0) {
      nextRule.createdAt =
        buildSettings.value.douyinMaterialRules[index].createdAt ||
        nextRule.createdAt;
      buildSettings.value.douyinMaterialRules.splice(index, 1, nextRule);
    }
  } else {
    buildSettings.value.douyinMaterialRules.push(nextRule);
  }

  syncAllRuleOrders();
  setAllocationFeedbackMessage("账号信息已更新，请记得保存当前配置", "info");

  closeRuleModal();
}

function removeDouyinRule(ruleId: string) {
  const index = buildSettings.value.douyinMaterialRules.findIndex(
    (rule) => rule.id === ruleId,
  );
  if (index >= 0) {
    buildSettings.value.douyinMaterialRules.splice(index, 1);
    syncAllRuleOrders();
    setAllocationFeedbackMessage("已删除账号规则，请记得保存当前配置", "info");
  }
}

function stopAutoRun(reason?: string) {
  if (!autoRunEnabled.value) return;
  autoRunEnabled.value = false;
  if (reason) {
    message.warning(reason);
  }
}

function notifyAutoRunSkippedFailure(reason: string) {
  if (!autoRunEnabled.value) return;
  message.warning(`${reason}，已自动跳过并继续后续剧目`);
}

function getNextAutoRunRow(): DramaUploadRow | null {
  for (const row of rows.value) {
    if (row.status === "pending") {
      return row;
    }
    if (row.status === "uploaded" && row.buildStatus === "idle") {
      return row;
    }
  }
  return null;
}

async function maybeStartNextAutoTask() {
  if (!autoRunEnabled.value || activeRow.value || activeBuildRow.value) {
    return;
  }

  const nextRow = getNextAutoRunRow();
  if (!nextRow) {
    autoRunEnabled.value = false;
    message.success("自动运行已完成");
    return;
  }

  if (nextRow.status === "uploaded") {
    const disabledTip = getDisabledBuildTip(nextRow);
    if (disabledTip) {
      stopAutoRun(
        `自动运行已停止：《${nextRow.drama || "未命名剧目"}》无法开始搭建，${disabledTip}`,
      );
      return;
    }
    await startBuild(nextRow);
    return;
  }

  const disabledTip = getDisabledUploadTip(nextRow);
  if (disabledTip) {
    stopAutoRun(
      `自动运行已停止：《${nextRow.drama || "未命名剧目"}》无法开始上传，${disabledTip}`,
    );
    return;
  }
  await startUpload(nextRow);
}

function handleAutoRunChange(value: boolean) {
  if (!value) {
    autoRunEnabled.value = false;
    return;
  }

  if (autoRunDisabledReason.value) {
    message.warning(autoRunDisabledReason.value);
    return;
  }

  autoRunEnabled.value = true;
  void maybeStartNextAutoTask();
}

function getBuildParamLabel(field: BuildParamField): string {
  return (
    BUILD_PARAM_LABELS.find(([currentField]) => currentField === field)?.[1] ||
    field
  );
}

function getMissingBuildParamFields(): BuildParamField[] {
  const params = buildSettings.value.buildParams;
  return BUILD_PARAM_LABELS.filter(
    ([field]) => !String(params[field] ?? "").trim(),
  ).map(([field]) => field);
}

function isBuildParamMissing(field: BuildParamField): boolean {
  return missingBuildParamFieldSet.value.has(field);
}

function getBuildParamsError(): string {
  if (!missingBuildParamFields.value.length) {
    return "";
  }

  return `请先填写${missingBuildParamFields.value
    .map((field) => getBuildParamLabel(field))
    .join("、")}`;
}

async function handleSaveBuildParams() {
  if (!currentDaren.value) {
    return;
  }

  const buildParamsError = getBuildParamsError();
  if (buildParamsError) {
    message.warning(buildParamsError);
    return;
  }

  try {
    syncAllRuleOrders();
    await persistBuildSettingsNow();
    message.success("当前搭建配置已保存到本地");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    message.error(`保存搭建参数失败：${errorMessage}`);
  }
}

function getRuleConfigError(): string {
  if (!buildSettings.value.douyinMaterialRules.length) {
    return "请先添加抖音号匹配素材规则";
  }

  for (const rule of buildSettings.value.douyinMaterialRules) {
    if (!rule.douyinAccount.trim() || !rule.douyinAccountId.trim()) {
      return "请完善每条抖音号匹配素材规则";
    }
    if (
      normalizeAllocationPercent(rule.percent) >
      normalizeAllocationMaxPercent(rule.maxPercent)
    ) {
      return `抖音号 ${rule.douyinAccount} 的比例不能超过单项上限`;
    }
    if (normalizeAllocationWeight(rule.weight) < 0) {
      return "素材比例配置不正确";
    }
  }

  if (allocationSummary.value.status === "over") {
    return `当前总比例已超过 100%，请先调整后再保存`;
  }

  if (allocationSummary.value.hasInvalidRow) {
    return "当前存在非法比例配置，请先修正";
  }

  return "";
}

function getBuildConfigError(): string {
  const buildParamsError = getBuildParamsError();
  if (buildParamsError) {
    return buildParamsError;
  }

  const template = getFixedMaterialFilenameTemplate().trim();
  if (!template) {
    return "请先填写素材名称模板";
  }
  if (!template.includes("{剧名}") || !template.includes("{序号}")) {
    return "素材名称模板必须包含 {剧名}、{序号}";
  }

  const ruleError = getRuleConfigError();
  if (ruleError) {
    return ruleError;
  }

  if (!executableDouyinRules.value.length) {
    return "请至少为一个抖音号分配大于 0% 的素材比例";
  }

  return "";
}

function getDisabledUploadTip(row: DramaUploadRow) {
  if (hasUnsavedUploadListChanges.value) {
    return "请先保存上传列表配置";
  }
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
  if (hasUnsavedUploadListChanges.value) {
    return "请先保存上传列表配置";
  }
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
  if (hasUnsavedBuildSettingsChanges.value) {
    return "请先保存搭建参数和抖音号匹配素材配置";
  }
  return getBuildConfigError();
}

async function startUpload(row: DramaUploadRow) {
  const disabledTip = getDisabledUploadTip(row);
  if (disabledTip) {
    message.warning(disabledTip);
    return;
  }

  if (activeBuildRow.value) {
    message.warning(
      `当前正在搭建《${activeBuildRow.value.drama}》，请稍后再试`,
    );
    return;
  }

  if (activeRow.value && activeRow.value.id !== row.id) {
    message.warning(
      `当前正在上传《${activeRow.value.drama}》，请等待完成后再试`,
    );
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
      }),
    );

    const result = (await window.api.juliangUploadTask(
      plainTask,
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
      notifyAutoRunSkippedFailure(`《${row.drama}》上传失败`);
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
          `《${row.drama}》上传成功，但删除目录失败：${row.deleteError}`,
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
    notifyAutoRunSkippedFailure(`《${row.drama}》上传失败`);
  } finally {
    if (autoRunEnabled.value) {
      queueMicrotask(() => {
        void maybeStartNextAutoTask();
      });
    }
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
  stopAutoRun("已手动取消上传，自动运行已关闭");
  message.info(`已取消《${row.drama}》上传`);
}

async function clearExistingProjectsBeforeBuild(row: DramaUploadRow) {
  if (!uploadConfig.value.clearProjectsBeforeBuild) {
    return true;
  }

  try {
    const result = await window.api.juliangClearExistingProjects(
      row.accountId.trim(),
    );
    if (result.deletedCount > 0) {
      message.success(`已清理账户历史项目 ${result.deletedCount} 个`);
    }
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    message.error(`清理账户历史项目失败：${errorMessage}`);
    return false;
  }
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

  const cleared = await clearExistingProjectsBeforeBuild(row);
  if (!cleared) {
    row.buildStatus = "failed";
    row.buildError = "清理账户历史项目失败";
    row.buildMessage = row.buildError;
    row.buildTaskId = undefined;
    notifyAutoRunSkippedFailure(
      `《${row.drama || "未命名剧目"}》清理账户历史项目失败`,
    );
    if (autoRunEnabled.value) {
      queueMicrotask(() => {
        void maybeStartNextAutoTask();
      });
    }
    return;
  }

  row.buildStatus = "building";
  row.buildError = undefined;
  row.buildMessage = "开始搭建";
  row.buildSuccessRuleCount = 0;
  row.buildFailedRuleCount = 0;
  row.buildTotalRules = executableDouyinRules.value.length;
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
    totalRules: executableDouyinRules.value.length,
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
        postBuildPreview: uploadConfig.value.autoPreviewAfterBuild
          ? {
              enabled: true,
              delaysMinutes: [20, 30],
            }
          : undefined,
        buildSettings: {
          ...createEffectiveBuildSettings(),
          darenName: resolveCurrentDarenName(),
          materialFilenameTemplate: resolveTemplateWithCurrentShortName(
            getFixedMaterialFilenameTemplate(),
          ),
        },
      }),
    );

    const result = (await window.api.dailyBuildStartTask(
      payload,
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
      notifyAutoRunSkippedFailure(`《${row.drama}》搭建失败`);
      return;
    }

    row.buildStatus = "built";
    row.buildError = undefined;
    row.buildMessage = `搭建完成（成功 ${result.successRuleCount}/${result.totalRules}）`;
    row.buildTaskId = undefined;
    if (result.skippedRules.length > 0) {
      message.warning(
        `《${row.drama}》搭建完成，但有 ${result.skippedRules.length} 个抖音号失败`,
      );
    } else {
      message.success(`《${row.drama}》搭建完成`);
    }

    if (result.materialPreviewSchedule?.enabled) {
      if (result.materialPreviewSchedule.error) {
        message.warning(
          `《${row.drama}》素材预览定时任务创建失败：${result.materialPreviewSchedule.error}`,
        );
      } else if (result.materialPreviewSchedule.scheduledCount > 0) {
        message.info(
          `《${row.drama}》已安排 ${result.materialPreviewSchedule.delaysMinutes.join("/")} 分钟后自动执行素材预览`,
        );
      }
    }
  } catch (error) {
    row.buildStatus = "failed";
    row.buildError = error instanceof Error ? error.message : String(error);
    row.buildMessage = row.buildError;
    row.buildTaskId = undefined;
    message.error(`《${row.drama}》搭建失败：${row.buildError}`);
    notifyAutoRunSkippedFailure(`《${row.drama}》搭建失败`);
  } finally {
    currentBuildProgress.value = null;
    if (autoRunEnabled.value) {
      queueMicrotask(() => {
        void maybeStartNextAutoTask();
      });
    }
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
  stopAutoRun("已手动取消搭建，自动运行已关闭");
  message.info(`正在取消《${row.drama}》搭建`);
}

async function loadLogs() {
  try {
    logs.value = await window.api.juliangGetLogs();
    buildLogs.value = await window.api.dailyBuildGetLogs();
    previewLogs.value = await window.api.materialPreviewGetLogs();
  } catch (error) {
    console.error("加载日志失败:", error);
  }
}

onMounted(async () => {
  if (!darenStore.darenList.length) {
    await darenStore.loadFromServer(true);
  }

  if (!apiConfigStore.loaded) {
    await apiConfigStore.loadConfig();
  }

  await loadUploadConfig();

  const persistedState = loadPersistedViewState();
  if (persistedState) {
    rows.value = persistedState.rows;
    currentProgress.value = persistedState.currentProgress;
    currentBuildProgress.value = persistedState.currentBuildProgress;
    autoRunEnabled.value = persistedState.autoRunEnabled;
    removedFolderPaths.value = persistedState.removedFolderPaths;
  }

  const savedRootDir =
    localStorage.getItem(ROOT_DIR_STORAGE_KEY) || persistedState?.rootDir || "";
  if (savedRootDir) {
    rootDir.value = savedRootDir;
    await scanRootDir();
  } else if (rows.value.length) {
    void resolveDramaIdsForRows(rows.value);
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

  unsubscribePreviewLog = window.api.onMaterialPreviewLog((log) => {
    previewLogs.value.push(log);
    if (previewLogs.value.length > 500) {
      previewLogs.value.shift();
    }
  });

  await syncTaskStatesFromMain();
  if (autoRunEnabled.value) {
    void maybeStartNextAutoTask();
  }
});

onUnmounted(() => {
  dramaIdLookupTimers.forEach((timer) => window.clearTimeout(timer));
  dramaIdLookupTimers.clear();
  dramaIdLookupRequestIds.clear();
  if (unsubscribeProgress) unsubscribeProgress();
  if (unsubscribeLog) unsubscribeLog();
  if (unsubscribeBuildProgress) unsubscribeBuildProgress();
  if (unsubscribeBuildLog) unsubscribeBuildLog();
  if (unsubscribePreviewLog) unsubscribePreviewLog();
});
</script>

<template>
  <div class="upload-build-page">
    <div class="status-bar">
      <div class="status-item">
        <span class="status-label">浏览器</span>
        <NTag :type="browserStatusType" size="small">{{
          browserStatusText
        }}</NTag>
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
      <div class="setup-strip">
        <label class="compact-field compact-field-sm">
          <span>达人</span>
          <NInput :value="resolveCurrentDarenName()" disabled />
        </label>
        <label class="compact-field compact-field-template">
          <span>素材名称模板</span>
          <NInput :value="getFixedMaterialFilenameTemplate()" disabled />
        </label>
        <label class="compact-field compact-field-dir">
          <span>素材目录</span>
          <div class="directory-row">
            <NInput
              v-model:value="rootDir"
              readonly
              placeholder="选择目录，目录下每个子文件夹都视为一部剧"
              class="toolbar-input"
            />
            <NButton
              :disabled="!!activeRow || !!activeBuildRow"
              @click="selectRootDir"
            >
              选择目录
            </NButton>
            <NButton
              :disabled="!rootDir || !!activeRow || !!activeBuildRow"
              :loading="isScanning"
              @click="rescanRootDir"
            >
              {{ isScanning ? "扫描中..." : "重新扫描" }}
            </NButton>
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
        </label>
      </div>
      <div class="toolbar-hint">
        目录结构：指定目录 / 剧名文件夹 / 素材视频文件
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
            <span class="table-header-desc"
              >保存到本地后，下次进入会自动带入当前登录用户的当前渠道配置</span
            >
          </div>
        </template>
        <template #header-extra>
          <div class="collapse-header-action" @click.stop>
            <NButton
              type="primary"
              size="small"
              :disabled="!canSaveBuildParams"
              @click.stop="handleSaveBuildParams"
            >
              保存配置
            </NButton>
          </div>
        </template>
        <NCard class="build-config-card collapse-card">
          <NAlert class="build-config-alert" :type="buildParamNoticeType">
            {{ buildParamNoticeText }}
          </NAlert>
          <div class="build-config-grid">
            <label class="build-field">
              <span>Distributor ID</span>
              <NInput
                v-model:value="buildSettings.buildParams.distributorId"
                :status="
                  isBuildParamMissing('distributorId') ? 'error' : undefined
                "
                placeholder="请输入推广链 Distributor ID"
              />
            </label>
            <label class="build-field">
              <span>Secret密钥</span>
              <NInput
                v-model:value="buildSettings.buildParams.secretKey"
                :status="isBuildParamMissing('secretKey') ? 'error' : undefined"
                placeholder="请输入 Secret 密钥"
              />
            </label>
            <label class="build-field">
              <span>来源</span>
              <NInput
                v-model:value="buildSettings.buildParams.source"
                :status="isBuildParamMissing('source') ? 'error' : undefined"
                placeholder="请输入来源，例如：泰州晴天"
              />
            </label>
            <label class="build-field">
              <span>出价</span>
              <NInput
                v-model:value="buildSettings.buildParams.bid"
                :status="isBuildParamMissing('bid') ? 'error' : undefined"
                placeholder="请输入出价，例如：5"
              />
            </label>
            <label class="build-field">
              <span>商品ID</span>
              <NInput
                v-model:value="buildSettings.buildParams.productId"
                :status="isBuildParamMissing('productId') ? 'error' : undefined"
                placeholder="请输入商品ID"
              />
            </label>
            <label class="build-field">
              <span>商品库ID</span>
              <NInput
                v-model:value="buildSettings.buildParams.productPlatformId"
                :status="
                  isBuildParamMissing('productPlatformId') ? 'error' : undefined
                "
                placeholder="请输入商品库ID"
              />
            </label>
            <label class="build-field">
              <span>落地页 URL</span>
              <NInput
                v-model:value="buildSettings.buildParams.landingUrl"
                :status="
                  isBuildParamMissing('landingUrl') ? 'error' : undefined
                "
                placeholder="请输入落地页 URL"
              />
            </label>
            <label class="build-field">
              <span>小程序名称</span>
              <NInput
                v-model:value="buildSettings.buildParams.microAppName"
                :status="
                  isBuildParamMissing('microAppName') ? 'error' : undefined
                "
                placeholder="请输入小程序名称"
              />
            </label>
            <label class="build-field">
              <span>小程序 AppID</span>
              <NInput
                v-model:value="buildSettings.buildParams.microAppId"
                :status="
                  isBuildParamMissing('microAppId') ? 'error' : undefined
                "
                placeholder="请输入小程序 AppID"
              />
            </label>
            <label class="build-field">
              <span>小程序实例 ID</span>
              <NInput
                v-model:value="buildSettings.buildParams.microAppInstanceId"
                :status="
                  isBuildParamMissing('microAppInstanceId')
                    ? 'error'
                    : undefined
                "
                placeholder="请输入小程序实例 ID"
              />
            </label>
            <label class="build-field">
              <span>cc_id</span>
              <NInput
                v-model:value="buildSettings.buildParams.ccId"
                :status="isBuildParamMissing('ccId') ? 'error' : undefined"
                placeholder="请输入 cc_id"
              />
            </label>
            <label class="build-field">
              <span>首充模版ID</span>
              <NInput
                v-model:value="buildSettings.buildParams.rechargeTemplateId"
                :status="
                  isBuildParamMissing('rechargeTemplateId')
                    ? 'error'
                    : undefined
                "
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
            <span class="table-header-desc"
              >用百分比分配表格管理素材占比，支持锁定、自动补足与保存</span
            >
          </div>
        </template>
        <template #header-extra>
          <div class="collapse-header-action" @click.stop>
            <NButton
              type="primary"
              size="small"
              :disabled="!canSaveBuildSettings"
              @click.stop="handleSaveBuildSettings"
            >
              保存配置
            </NButton>
          </div>
        </template>
        <NCard class="build-config-card collapse-card">
          <div class="allocation-summary-grid">
            <div class="allocation-summary-card">
              <span class="allocation-summary-label">总比例上限</span>
              <strong>100%</strong>
            </div>
            <div class="allocation-summary-card">
              <span class="allocation-summary-label">当前已分配</span>
              <strong>{{ allocationSummary.totalPercent }}%</strong>
            </div>
            <div class="allocation-summary-card">
              <span class="allocation-summary-label">剩余可分配</span>
              <strong
                >{{ Math.max(0, allocationSummary.remainingPercent) }}%</strong
              >
            </div>
            <div class="allocation-summary-card">
              <span class="allocation-summary-label">当前状态</span>
              <NTag :type="allocationStatusType">{{
                allocationStatusText
              }}</NTag>
            </div>
            <div class="allocation-summary-card">
              <span class="allocation-summary-label">可自动补足账号</span>
              <strong>{{ allocationSummary.autoAllocatableCount }}</strong>
            </div>
          </div>

          <div class="rule-toolbar">
            <div class="rule-toolbar-copy">
              <span class="toolbar-hint"
                >自动补足只会作用于“未锁定且未到上限”的账号</span
              >
              <span class="toolbar-hint"
                >保存会把当前搭建参数和素材比例配置一起写入本地</span
              >
            </div>
            <div class="rule-toolbar-actions">
              <NButton secondary @click="handleAverageAllocate"
                >平均分配剩余</NButton
              >
              <NButton secondary @click="handleWeightAllocate"
                >按权重补足</NButton
              >
              <NButton secondary @click="handleNormalizeAllocate"
                >归一化到 100%</NButton
              >
              <NButton secondary @click="handleResetBuildSettings"
                >重置</NButton
              >
              <NButton type="primary" secondary @click="openAddRuleModal"
                >添加账号</NButton
              >
            </div>
          </div>

          <NAlert class="allocation-alert" :type="allocationAlertType">
            {{ allocationFeedback || allocationStatusMessage }}
          </NAlert>

          <NEmpty
            v-if="buildSettings.douyinMaterialRules.length === 0"
            description="暂无抖音号匹配素材规则"
          />

          <div v-else class="allocation-table">
            <table>
              <thead>
                <tr>
                  <th>排名</th>
                  <th>账号名称</th>
                  <th>当前比例</th>
                  <th>权重</th>
                  <th>锁定</th>
                  <th>行操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(rule, index) in buildSettings.douyinMaterialRules"
                  :key="rule.id"
                >
                  <td>#{{ index + 1 }}</td>
                  <td>
                    <div class="allocation-name-cell">
                      <strong>{{ rule.douyinAccount || "未命名账号" }}</strong>
                    </div>
                  </td>
                  <td>
                    <div class="percent-input-wrap">
                      <NInputNumber
                        :value="normalizeAllocationPercent(rule.percent)"
                        :min="0"
                        :max="
                          getRowMaxSettablePercent(
                            allocationRulesForMath,
                            rule.id,
                          )
                        "
                        :step="1"
                        @update:value="
                          (value) => handleRulePercentChange(rule.id, value)
                        "
                      />
                      <span class="percent-suffix">%</span>
                    </div>
                  </td>
                  <td>
                    <NInputNumber
                      :value="normalizeAllocationWeight(rule.weight)"
                      :min="0"
                      :step="1"
                      @update:value="
                        (value) => handleRuleWeightChange(rule.id, value)
                      "
                    />
                  </td>
                  <td>
                    <NSwitch
                      :value="Boolean(rule.locked)"
                      @update:value="
                        (value) => handleRuleLockChange(rule.id, value)
                      "
                    />
                  </td>
                  <td>
                    <div class="rule-actions">
                      <NButton
                        tertiary
                        size="small"
                        @click="handleClearRulePercent(rule.id)"
                      >
                        清零
                      </NButton>
                      <NButton
                        tertiary
                        size="small"
                        @click="handleSetRuleToMax(rule.id)"
                      >
                        设为最大
                      </NButton>
                      <NButton
                        tertiary
                        size="small"
                        @click="openEditRuleModal(rule)"
                      >
                        编辑
                      </NButton>
                      <NButton
                        tertiary
                        size="small"
                        type="error"
                        @click="removeDouyinRule(rule.id)"
                      >
                        删除
                      </NButton>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </NCard>
      </NCollapseItem>

      <NCollapseItem name="upload-list">
        <template #header>
          <div class="table-header">
            <span>上传列表</span>
            <span class="table-header-desc"
              >保存时会自动补齐空账户，并同步当前渠道飞书账户表的占用状态</span
            >
          </div>
        </template>
        <template #header-extra>
          <div class="collapse-header-action" @click.stop>
            <NTag size="small" :type="uploadListSaveStatusType">
              {{ uploadListSaveStatusText }}
            </NTag>
            <NButton
              type="primary"
              size="small"
              :disabled="!canSaveUploadList"
              :loading="savingUploadList"
              @click.stop="handleSaveUploadList"
            >
              {{ savingUploadList ? "保存中..." : "保存配置" }}
            </NButton>
          </div>
        </template>
        <NCard class="table-card collapse-card">
          <div class="list-toolbar">
            <div class="list-toolbar-left">
              <div class="inline-switch">
                <span class="auto-run-label">上传后删除本地素材目录</span>
                <NSwitch
                  :value="uploadConfig.deleteAfterUpload"
                  @update:value="
                    (value) => applyUploadConfig({ deleteAfterUpload: value })
                  "
                />
              </div>
              <div class="inline-switch">
                <span class="auto-run-label">搭建前清空账户项目</span>
                <NSwitch
                  :value="uploadConfig.clearProjectsBeforeBuild"
                  @update:value="
                    (value) =>
                      applyUploadConfig({ clearProjectsBeforeBuild: value })
                  "
                />
              </div>
              <div class="inline-switch">
                <span class="auto-run-label">搭建后自动素材预览</span>
                <NSwitch
                  :value="uploadConfig.autoPreviewAfterBuild"
                  @update:value="
                    (value) =>
                      applyUploadConfig({ autoPreviewAfterBuild: value })
                  "
                />
              </div>
            </div>
            <div class="list-actions">
              <NTooltip v-if="autoRunDisabledReason">
                <template #trigger>
                  <span class="button-trigger auto-run-trigger">
                    <div class="auto-run-switch">
                      <span class="auto-run-label">自动运行</span>
                      <NSwitch :value="autoRunEnabled" disabled />
                    </div>
                  </span>
                </template>
                {{ autoRunDisabledTooltip }}
              </NTooltip>
              <div v-else class="auto-run-switch">
                <span class="auto-run-label">自动运行</span>
                <NSwitch
                  :value="autoRunEnabled"
                  @update:value="handleAutoRunChange"
                />
              </div>
              <NButton type="primary" secondary @click="addBuildOnlyRow"
                >提交搭建</NButton
              >
            </div>
          </div>

          <NEmpty v-if="rows.length === 0" description="请选择目录并扫描剧目" />

          <div v-else class="drama-table">
            <table>
              <thead>
                <tr>
                  <th>剧名</th>
                  <th>素材数</th>
                  <th>
                    <div class="column-header-action">
                      <span>账户</span>
                      <NButton
                        class="column-header-link"
                        text
                        :disabled="!canPullUploadListAccounts"
                        @click="handlePullAccountsFromFeishu"
                      >
                        拉取账户
                      </NButton>
                    </div>
                  </th>
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
                      @update:value="
                        (value) => handleDramaNameInput(row, value)
                      "
                    />
                    <div v-else class="drama-name">{{ row.drama }}</div>
                    <div
                      v-if="row.error || row.deleteError || row.buildError"
                      class="row-error"
                    >
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
                  <td>
                    {{
                      row.entryMode === "build-only" ? "-" : row.materialCount
                    }}
                  </td>
                  <td>
                    <NInput
                      :value="row.accountId"
                      placeholder="请输入巨量账户 ID"
                      :disabled="
                        row.status === 'uploading' ||
                        row.buildStatus === 'building'
                      "
                      @update:value="(value) => handleAccountInput(row, value)"
                    />
                  </td>
                  <td class="drama-id-column">
                    <div class="drama-id-cell">
                      <NInput
                        :value="row.dramaId"
                        placeholder="自动获取短剧 ID"
                        readonly
                      >
                        <template #suffix>
                          <NButton
                            quaternary
                            circle
                            size="tiny"
                            class="drama-id-refresh-button"
                            :disabled="
                              row.dramaIdLoading ||
                              !row.drama.trim() ||
                              row.status === 'uploading' ||
                              row.buildStatus === 'building'
                            "
                            @click="refreshDramaId(row)"
                          >
                            <template #icon>
                              <NIcon>
                                <RefreshOutline />
                              </NIcon>
                            </template>
                          </NButton>
                        </template>
                      </NInput>
                      <span
                        v-if="row.dramaIdLoading"
                        class="row-hint drama-id-feedback"
                        >正在根据剧名查询短剧ID</span
                      >
                      <span
                        v-else-if="row.dramaIdError"
                        class="row-error row-error-inline drama-id-feedback"
                      >
                        {{ row.dramaIdError }}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div class="status-stack">
                      <NTag :type="getCombinedStatusType(row)" size="small">
                        {{ getCombinedStatusText(row) }}
                      </NTag>
                      <NTag
                        v-if="row.deleted"
                        type="success"
                        size="small"
                        round
                      >
                        本地已删除
                      </NTag>
                      <span v-if="row.buildMessage" class="row-hint">{{
                        row.buildMessage
                      }}</span>
                    </div>
                  </td>
                  <td>
                    <div class="progress-cell">
                      <div
                        v-if="row.entryMode !== 'build-only'"
                        class="inline-progress-block"
                      >
                        <span class="inline-progress-label">上传</span>
                        <NProgress
                          type="line"
                          status="info"
                          :percentage="getUploadProgressPercentage(row)"
                          indicator-placement="inside"
                          :processing="row.status === 'uploading'"
                          :height="14"
                          :border-radius="999"
                          :fill-border-radius="999"
                        />
                      </div>
                      <div
                        v-if="shouldShowBuildProgress(row)"
                        class="inline-progress-block"
                      >
                        <span class="inline-progress-label">搭建</span>
                        <NProgress
                          type="line"
                          :status="
                            row.buildStatus === 'failed' ? 'error' : 'success'
                          "
                          :percentage="getBuildProgressPercentage(row)"
                          indicator-placement="inside"
                          :processing="row.buildStatus === 'building'"
                          :height="14"
                          :border-radius="999"
                          :fill-border-radius="999"
                        />
                      </div>
                      <span
                        v-if="
                          row.entryMode === 'build-only' &&
                          row.buildTotalRules === 0 &&
                          row.buildStatus === 'idle'
                        "
                        class="row-hint"
                      >
                        待搭建
                      </span>
                    </div>
                  </td>
                  <td>
                    <div class="operation-actions">
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
                        v-else-if="
                          row.status === 'uploaded' && !getDisabledBuildTip(row)
                        "
                        type="success"
                        @click="startBuild(row)"
                      >
                        {{ getBuildButtonText(row) }}
                      </NButton>
                      <NTooltip
                        v-else-if="
                          row.status === 'uploaded' && getDisabledBuildTip(row)
                        "
                      >
                        <template #trigger>
                          <span class="button-trigger">
                            <NButton disabled>{{
                              getBuildButtonText(row)
                            }}</NButton>
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
                            <NButton text class="action-link-button" disabled>{{
                              getUploadButtonText(row)
                            }}</NButton>
                          </span>
                        </template>
                        {{ getDisabledUploadTip(row) }}
                      </NTooltip>
                      <NButton
                        v-else
                        text
                        class="action-link-button"
                        @click="startUpload(row)"
                      >
                        {{ getUploadButtonText(row) }}
                      </NButton>
                      <NButton
                        text
                        class="remove-icon-button"
                        :disabled="
                          row.status === 'uploading' ||
                          row.buildStatus === 'building'
                        "
                        @click="removeRow(row)"
                      >
                        <template #icon>
                          <NIcon>
                            <TrashOutline />
                          </NIcon>
                        </template>
                      </NButton>
                    </div>
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
      :title="editingRuleId ? '编辑账号' : '添加账号'"
      :bordered="false"
      segmented
    >
      <div class="rule-modal-body">
        <label class="build-field">
          <span>抖音号名称</span>
          <NInput
            v-model:value="ruleForm.douyinAccount"
            placeholder="例如：小红看剧"
          />
        </label>
        <label class="build-field">
          <span>抖音号ID</span>
          <NInput
            v-model:value="ruleForm.douyinAccountId"
            placeholder="请输入抖音号ID"
          />
        </label>
        <div class="field-help build-field-full">
          添加后可在表格里继续编辑比例、上限、权重和锁定状态；保存配置后才会写入本地。
        </div>
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
        <span
          >批次 {{ currentProgress.currentBatch }}/{{
            currentProgress.totalBatches || 0
          }}</span
        >
        <span
          >成功 {{ currentProgress.successCount }}/{{
            currentProgress.totalFiles
          }}</span
        >
      </div>
      <NProgress
        type="line"
        :height="22"
        :percentage="
          currentProgress.totalFiles > 0
            ? Math.round(
                (currentProgress.successCount / currentProgress.totalFiles) *
                  100,
              )
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
        <span
          >规则 {{ currentBuildProgress.currentRuleIndex }}/{{
            currentBuildProgress.totalRules || 0
          }}</span
        >
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
                  100,
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
      <NCollapseItem title="巨量上传配置" name="advanced-config">
        <div class="advanced-config-grid">
          <div class="config-row">
            <span class="config-label">每批文件数</span>
            <NInputNumber
              :value="uploadConfig.batchSize"
              :min="1"
              :max="50"
              @update:value="
                (value) =>
                  applyUploadConfig({
                    batchSize: Math.max(1, Number(value || 1)),
                  })
              "
            />
            <span class="config-desc">新任务会按最新批量配置切批上传</span>
          </div>
          <div class="config-row">
            <span class="config-label">单批超时(分钟)</span>
            <NInputNumber
              :value="uploadConfig.batchUploadTimeoutMinutes"
              :min="1"
              :max="60"
              @update:value="
                (value) =>
                  applyUploadConfig({
                    batchUploadTimeoutMinutes: Math.max(1, Number(value || 1)),
                  })
              "
            />
            <span class="config-desc"
              >单批上传超过该时间仍未结束，就按超时处理</span
            >
          </div>
          <div class="config-row">
            <span class="config-label">超时轮回次数</span>
            <NInputNumber
              :value="uploadConfig.timeoutPartialRetryRounds"
              :min="0"
              :max="10"
              @update:value="
                (value) =>
                  applyUploadConfig({
                    timeoutPartialRetryRounds: Math.max(
                      0,
                      Math.min(10, Number(value || 0)),
                    ),
                  })
              "
            />
            <span class="config-desc"
              >单批超时后仅重传未完成素材的轮回次数</span
            >
          </div>
          <div class="config-row">
            <span class="config-label">批次重试次数</span>
            <NInputNumber
              :value="uploadConfig.maxBatchRetries"
              :min="0"
              :max="10"
              @update:value="
                (value) =>
                  applyUploadConfig({
                    maxBatchRetries: Math.max(
                      0,
                      Math.min(10, Number(value || 0)),
                    ),
                  })
              "
            />
            <span class="config-desc">单批失败后最多额外重试的次数</span>
          </div>
          <div class="config-row">
            <span class="config-label">兜底重传超时(分钟)</span>
            <NInputNumber
              :value="uploadConfig.abandonedRetryTimeoutMinutes"
              :min="1"
              :max="30"
              @update:value="
                (value) =>
                  applyUploadConfig({
                    abandonedRetryTimeoutMinutes: Math.max(
                      1,
                      Math.min(30, Number(value || 3)),
                    ),
                  })
              "
            />
            <span class="config-desc">兜底重传放弃文件的超时时间</span>
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
            <span class="config-desc"
              >空闲时修改会关闭浏览器，下次按新配置重启</span
            >
          </div>
        </div>
      </NCollapseItem>
    </NCollapse>

    <NCollapse class="section-collapse log-panel">
      <NCollapseItem title="上传日志" name="upload-logs">
        <NCard class="table-card collapse-card log-card">
          <div class="log-container">
            <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
            <div
              v-for="(log, index) in logs"
              :key="`${log.time}-${index}`"
              class="log-item"
            >
              <span class="log-time">[{{ log.time }}]</span>
              <span class="log-message">{{ log.message }}</span>
            </div>
          </div>
        </NCard>
      </NCollapseItem>
      <NCollapseItem title="搭建日志" name="build-logs">
        <NCard class="table-card collapse-card log-card">
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
        </NCard>
      </NCollapseItem>
      <NCollapseItem title="预览日志" name="preview-logs">
        <NCard class="table-card collapse-card log-card">
          <div class="log-container">
            <div v-if="previewLogs.length === 0" class="log-empty">
              暂无日志
            </div>
            <div
              v-for="(log, index) in previewLogs"
              :key="`preview-${log.time}-${index}`"
              class="log-item"
            >
              <span class="log-time">[{{ log.time }}]</span>
              <span class="log-message">{{ log.message }}</span>
            </div>
          </div>
        </NCard>
      </NCollapseItem>
    </NCollapse>
  </div>
</template>

<style scoped>
.upload-build-page {
  padding: 20px;
  min-height: 100%;
  background:
    radial-gradient(
      circle at top left,
      rgba(255, 176, 59, 0.14),
      transparent 24%
    ),
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

.status-item :deep(.n-tag),
.status-stack :deep(.n-tag) {
  align-self: flex-start;
  width: auto;
  max-width: 100%;
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
.build-config-card,
.section-collapse {
  margin-bottom: 16px;
}

.collapse-card {
  margin-bottom: 0;
}

.section-collapse :deep(.n-collapse-item__content-inner) {
  padding: 12px 10px 10px;
}

.collapse-card :deep(.n-card__content),
.collapse-card :deep(.n-card__footer) {
  padding-left: 20px;
  padding-right: 20px;
}

.table-card :deep(.n-card__content) {
  padding-bottom: 20px;
}

.advanced-config :deep(.n-collapse-item) {
  margin: 0 0 8px;
  padding: 0 0 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.94);
  overflow: hidden;
}

.advanced-config :deep(.n-collapse-item__header) {
  padding-left: 0;
  padding-right: 0;
  padding-top: 16px;
}

.advanced-config :deep(.n-collapse-item__content-inner) {
  padding: 12px 12px 0;
}

.log-card :deep(.n-card__content) {
  padding-top: 18px;
  padding-bottom: 18px;
}

.log-panel :deep(.n-collapse-item:first-child .n-collapse-item__content-inner) {
  padding-bottom: 0;
}

.setup-strip {
  display: grid;
  grid-template-columns: 180px 320px minmax(0, 1fr);
  gap: 12px;
  align-items: end;
  margin-bottom: 10px;
}

.compact-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.compact-field > span,
.config-label {
  color: #59657a;
  font-size: 13px;
  font-weight: 600;
}

.config-label {
  width: 108px;
  flex: 0 0 108px;
}

.compact-field-sm {
  min-width: 0;
}

.compact-field-template {
  min-width: 0;
}

.compact-field-dir {
  min-width: 0;
}

.directory-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.toolbar-input,
.toolbar-select {
  flex: 1;
  min-width: 0;
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

.list-toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.inline-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.rule-toolbar {
  margin-bottom: 16px;
  align-items: flex-start;
}

.rule-toolbar-copy {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 12px;
  flex-wrap: wrap;
}

.rule-toolbar-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.allocation-summary-grid {
  display: flex;
  flex-wrap: nowrap;
  gap: 12px;
  margin-bottom: 16px;
  overflow-x: auto;
}

.allocation-summary-card {
  flex: 1 0 0;
  min-width: 160px;
  padding: 14px 16px;
  border: 1px solid #e6ebf2;
  border-radius: 14px;
  background: linear-gradient(180deg, #fbfcfe 0%, #f4f7fb 100%);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.allocation-summary-card :deep(.n-tag) {
  align-self: flex-start;
}

.allocation-summary-card strong {
  color: #1e2430;
  font-size: 24px;
  line-height: 1;
}

.allocation-summary-label {
  color: #667089;
  font-size: 13px;
  font-weight: 600;
}

.allocation-alert {
  margin-bottom: 16px;
}

.allocation-table {
  overflow-x: auto;
}

.allocation-table table {
  width: 100%;
  min-width: 1040px;
  border-collapse: collapse;
}

.allocation-table th,
.allocation-table td {
  padding: 14px 12px;
  border-bottom: 1px solid #edf1f5;
  text-align: left;
  vertical-align: middle;
}

.allocation-table th {
  color: #667089;
  font-size: 13px;
  font-weight: 600;
  background: #f7f9fc;
}

.allocation-name-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
}

.allocation-secondary {
  color: #8a94a7;
  font-size: 12px;
}

.percent-input-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.percent-suffix {
  color: #667089;
  font-size: 13px;
  font-weight: 600;
}

.list-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.auto-run-trigger {
  cursor: not-allowed;
}

.auto-run-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.auto-run-label {
  color: #4a5568;
  font-size: 14px;
  font-weight: 600;
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

.build-config-alert {
  margin-bottom: 16px;
}

.collapse-header-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.column-header-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 6px;
}

.column-header-link {
  padding: 0;
  font-size: 13px;
  font-weight: 600;
  color: #2080f0;
  --n-color: transparent;
  --n-color-hover: transparent;
  --n-color-pressed: transparent;
  --n-color-focus: transparent;
  --n-ripple-color: transparent;
}

.column-header-link:deep(.n-button__content) {
  font-size: 13px;
  line-height: 1;
}

.column-header-link:deep(.n-button__content),
.action-link-button:deep(.n-button__content) {
  color: #2080f0;
}

.column-header-link:deep(.n-button__state-border),
.column-header-link:deep(.n-button__border) {
  display: none;
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

.rule-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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
  vertical-align: middle;
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

.drama-id-column {
  position: relative;
}

.drama-id-cell {
  position: relative;
  min-width: 220px;
}

.drama-id-cell :deep(.n-input) {
  flex: 1;
}

.drama-id-refresh-button {
  color: #2080f0;
}

.row-error {
  margin-top: 8px;
  color: #d03050;
  font-size: 12px;
  line-height: 1.5;
}

.row-error-inline {
  margin-top: 0;
}

.drama-id-feedback {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-stack,
.progress-cell {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-cell {
  min-width: 180px;
}

.inline-progress-block {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inline-progress-label {
  width: 28px;
  flex: 0 0 28px;
  color: #667089;
  font-size: 12px;
  font-weight: 600;
}

.inline-progress-block :deep(.n-progress) {
  flex: 1;
}

.inline-progress-block :deep(.n-progress-graph-line-rail) {
  background: #e8edf5;
}

.inline-progress-block :deep(.n-progress-graph-line-fill) {
  transition: width 0.2s ease;
}

.inline-progress-block :deep(.n-progress-text) {
  font-size: 11px;
  font-weight: 600;
}

.operation-actions {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.action-link-button {
  padding: 0;
  font-size: 13px;
  font-weight: 600;
  --n-color: transparent;
  --n-color-hover: transparent;
  --n-color-pressed: transparent;
  --n-color-focus: transparent;
  --n-ripple-color: transparent;
}

.action-link-button:deep(.n-button__border),
.action-link-button:deep(.n-button__state-border),
.remove-icon-button:deep(.n-button__border),
.remove-icon-button:deep(.n-button__state-border) {
  display: none;
}

.remove-icon-button {
  padding: 0;
  min-width: auto;
  color: #d03050;
  --n-color: transparent;
  --n-color-hover: transparent;
  --n-color-pressed: transparent;
  --n-color-focus: transparent;
  --n-ripple-color: transparent;
  --n-text-color: #d03050;
  --n-text-color-hover: #d03050;
  --n-text-color-pressed: #d03050;
  --n-text-color-focus: #d03050;
}

.remove-icon-button:deep(.n-button__content) {
  color: #d03050;
  font-size: 13px;
  line-height: 1;
}

.remove-icon-button:deep(.n-button__icon) {
  color: #d03050;
}

.remove-icon-button:deep(.n-icon) {
  font-size: 13px;
  color: #d03050;
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

  .setup-strip {
    grid-template-columns: 1fr;
  }

  .directory-row {
    flex-wrap: wrap;
  }

  .section-collapse :deep(.n-collapse-item__content-inner) {
    padding-left: 6px;
    padding-right: 6px;
    padding-bottom: 8px;
  }

  .collapse-card :deep(.n-card__content),
  .collapse-card :deep(.n-card__footer) {
    padding-left: 16px;
    padding-right: 16px;
  }

  .table-card :deep(.n-card__content) {
    padding-bottom: 16px;
  }

  .advanced-config :deep(.n-collapse-item) {
    margin-top: 8px;
    padding-bottom: 10px;
  }

  .advanced-config :deep(.n-collapse-item__content-inner) {
    padding-left: 10px;
    padding-right: 10px;
  }

  .rule-toolbar,
  .rule-toolbar-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .drama-id-field {
    flex-wrap: wrap;
  }

  .allocation-table table {
    min-width: 880px;
  }
}
</style>
