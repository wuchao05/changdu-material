<script setup lang="ts">
defineOptions({ name: "JuliangBuild" });

import { computed, h, onMounted, onUnmounted, ref, watch } from "vue";
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NSelect,
  NSpace,
  NTag,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { useAuthStore } from "../stores/auth";
import { useDarenStore, type DarenInfo } from "../stores/daren";
import { useApiConfigStore } from "../stores/apiConfig";

interface PendingDramaRecord {
  record_id: string;
  _tableId?: string;
  fields: Record<string, unknown>;
}

interface SchedulerTaskHistory {
  dramaName: string;
  status: "success" | "failed" | "skipped";
  rating?: string | null;
  date?: number | null;
  publishTime?: number | null;
  error?: string;
  completedAt: string;
}

interface SchedulerStatus {
  enabled: boolean;
  intervalMinutes: number | null;
  nextRunTime: string | null;
  lastRunTime: string | null;
  stats: {
    totalBuilt: number;
    successCount: number;
    failCount: number;
  };
  currentTask: {
    status: "running" | "building";
    dramaName?: string;
    startTime: string;
  } | null;
  taskHistory: SchedulerTaskHistory[];
}

interface HistoryRow extends SchedulerTaskHistory {
  account: string;
}

const message = useMessage();
const authStore = useAuthStore();
const darenStore = useDarenStore();
const apiConfigStore = useApiConfigStore();

const pendingDramas = ref<PendingDramaRecord[]>([]);
const schedulerStatus = ref<SchedulerStatus | null>(null);
const historyAccountMap = ref<Record<string, string>>({});
const loadingPending = ref(false);
const loadingStatus = ref(false);
const refreshing = ref(false);
const startingScheduler = ref(false);
const stoppingScheduler = ref(false);
const manualBuildingId = ref<string | null>(null);
const selectedInterval = ref<number | null>(null);

let refreshTimer: ReturnType<typeof setInterval> | null = null;

const intervalOptions = [
  { label: "10 分钟", value: 10 },
  { label: "15 分钟", value: 15 },
  { label: "20 分钟", value: 20 },
  { label: "30 分钟", value: 30 },
  { label: "40 分钟", value: 40 },
  { label: "50 分钟", value: 50 },
  { label: "1 小时", value: 60 },
  { label: "1.5 小时", value: 90 },
  { label: "2 小时", value: 120 },
];

const adminDarenOptions = computed(() =>
  darenStore.darenList
    .filter((item) => item.feishuDramaStatusTableId?.trim())
    .map((item) => ({
      label: `${item.label} (${item.id})`,
      value: item.id,
    })),
);

const currentDaren = computed<DarenInfo | null>(() => darenStore.currentDaren);
const currentTableId = computed(
  () => currentDaren.value?.feishuDramaStatusTableId?.trim() || "",
);
const schedulerRunning = computed(
  () => schedulerStatus.value?.enabled === true,
);
const hasRunningTask = computed(
  () => Boolean(schedulerStatus.value?.currentTask),
);
const historyRows = computed<HistoryRow[]>(() =>
  (schedulerStatus.value?.taskHistory || []).map((item) => ({
    ...item,
    account:
      historyAccountMap.value[buildHistoryKey(item.dramaName, item.date)] || "-",
  })),
);

function parseTextField(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value[0];
    if (
      first &&
      typeof first === "object" &&
      "text" in first &&
      typeof first.text === "string"
    ) {
      return first.text;
    }
  }
  return "";
}

function parseDateTimestamp(record: PendingDramaRecord): number | null {
  const value = record.fields["日期"];
  return typeof value === "number" ? value : null;
}

function parsePublishTimestamp(record: PendingDramaRecord): number | null {
  const value = record.fields["上架时间"];
  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    Array.isArray(value.value) &&
    typeof value.value[0] === "number"
  ) {
    return value.value[0];
  }
  return null;
}

function formatDate(value?: string | number | null): string {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(value?: string | number | null): string {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function getAdvanceHours(publishTime: Date): number {
  return publishTime.getHours() >= 10 ? 10 : 1;
}

function getEarliestBuildTime(record: PendingDramaRecord): Date | null {
  const publishTimestamp = parsePublishTimestamp(record);
  if (!publishTimestamp) return null;
  const publishTime = new Date(publishTimestamp);
  return new Date(
    publishTime.getTime() - getAdvanceHours(publishTime) * 60 * 60 * 1000,
  );
}

function canBuildDramaNow(record: PendingDramaRecord): boolean {
  const earliestBuildTime = getEarliestBuildTime(record);
  if (!earliestBuildTime) return false;
  return Date.now() >= earliestBuildTime.getTime();
}

function buildHistoryKey(dramaName: string, date?: number | null): string {
  return `${dramaName}__${date || 0}`;
}

async function ensureBaseConfigLoaded() {
  if (!apiConfigStore.loaded) {
    await apiConfigStore.loadConfig();
  }
}

async function ensureCurrentDarenSelected() {
  if (!authStore.isAdmin) return;
  const selectedId = darenStore.selectedDarenId;
  const hasSelected = selectedId
    ? darenStore.darenList.some((item) => item.id === selectedId)
    : false;

  if (hasSelected) return;

  const fallbackDaren =
    darenStore.darenList.find((item) => item.enableJuliangBuild) ||
    darenStore.darenList.find((item) => item.feishuDramaStatusTableId?.trim()) ||
    null;

  if (fallbackDaren) {
    darenStore.setSelectedDaren(fallbackDaren.id);
  }
}

async function loadPendingDramas(showLoading = true) {
  if (!currentTableId.value) {
    pendingDramas.value = [];
    return;
  }

  if (showLoading) {
    loadingPending.value = true;
  }

  try {
    const result = await window.api.juliangBuildGetPendingDramas(
      currentTableId.value,
    );
    pendingDramas.value = [...(result.data?.items || [])].sort((a, b) => {
      return (parseDateTimestamp(a) || 0) - (parseDateTimestamp(b) || 0);
    });
  } catch (error) {
    console.error("加载待搭建剧集失败:", error);
    pendingDramas.value = [];
    message.error(error instanceof Error ? error.message : "加载待搭建剧集失败");
  } finally {
    if (showLoading) {
      loadingPending.value = false;
    }
  }
}

async function enrichHistoryAccounts(taskHistory: SchedulerTaskHistory[]) {
  if (!currentTableId.value || !taskHistory.length) {
    historyAccountMap.value = {};
    return;
  }

  await ensureBaseConfigLoaded();

  const appToken = apiConfigStore.config.feishuAppToken;
  if (!appToken) {
    historyAccountMap.value = {};
    return;
  }

  const nextMap: Record<string, string> = {};

  await Promise.all(
    taskHistory.map(async (item) => {
      try {
        const conditions: Array<{
          field_name: string;
          operator: string;
          value: string[];
        }> = [
          {
            field_name: "剧名",
            operator: "is",
            value: [item.dramaName],
          },
        ];

        if (item.date) {
          conditions.push({
            field_name: "日期",
            operator: "is",
            value: ["ExactDate", String(item.date)],
          });
        }

        const result = (await window.api.feishuRequest(
          `/open-apis/bitable/v1/apps/${appToken}/tables/${currentTableId.value}/records/search`,
          {
            field_names: ["剧名", "账户", "日期"],
            page_size: 1,
            filter: {
              conjunction: "and",
              conditions,
            },
          },
          "POST",
        )) as {
          code?: number;
          data?: {
            items?: Array<{ fields: Record<string, unknown> }>;
          };
        };

        const account = parseTextField(result.data?.items?.[0]?.fields?.["账户"]);
        nextMap[buildHistoryKey(item.dramaName, item.date)] = account || "-";
      } catch (error) {
        console.warn("补充最近搭建记录账户信息失败:", error);
        nextMap[buildHistoryKey(item.dramaName, item.date)] = "-";
      }
    }),
  );

  historyAccountMap.value = nextMap;
}

async function loadSchedulerStatus(showLoading = true) {
  if (showLoading) {
    loadingStatus.value = true;
  }

  try {
    const result = await window.api.juliangBuildGetSchedulerStatus();
    schedulerStatus.value = result.data;

    if (schedulerStatus.value?.intervalMinutes) {
      selectedInterval.value = schedulerStatus.value.intervalMinutes;
    }

    await enrichHistoryAccounts(result.data.taskHistory || []);
    syncRefreshTimer();
  } catch (error) {
    console.error("加载智能搭建状态失败:", error);
    message.error(error instanceof Error ? error.message : "加载智能搭建状态失败");
  } finally {
    if (showLoading) {
      loadingStatus.value = false;
    }
  }
}

async function refreshAll(showLoading = true) {
  if (showLoading) {
    refreshing.value = true;
  }

  try {
    await Promise.all([
      loadPendingDramas(showLoading),
      loadSchedulerStatus(showLoading),
    ]);
  } finally {
    if (showLoading) {
      refreshing.value = false;
    }
  }
}

function stopRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function startRefreshTimer() {
  stopRefreshTimer();
  refreshTimer = setInterval(() => {
    void refreshAll(false);
  }, 60_000);
}

function syncRefreshTimer() {
  if (schedulerStatus.value?.enabled) {
    startRefreshTimer();
  } else {
    stopRefreshTimer();
  }
}

async function handleStartScheduler() {
  if (!selectedInterval.value) {
    message.warning("请先选择轮询间隔时间");
    return;
  }

  startingScheduler.value = true;
  try {
    const result = await window.api.juliangBuildStartScheduler(
      selectedInterval.value,
    );
    schedulerStatus.value = result.data;
    syncRefreshTimer();
    message.success(result.message || "智能搭建已启动");
    await refreshAll(false);
  } catch (error) {
    console.error("启动智能搭建失败:", error);
    message.error(error instanceof Error ? error.message : "启动智能搭建失败");
  } finally {
    startingScheduler.value = false;
  }
}

async function handleStopScheduler() {
  stoppingScheduler.value = true;
  try {
    const result = await window.api.juliangBuildStopScheduler();
    schedulerStatus.value = result.data;
    syncRefreshTimer();
    message.success(result.message || "智能搭建已停止");
    await refreshAll(false);
  } catch (error) {
    console.error("停止智能搭建失败:", error);
    message.error(error instanceof Error ? error.message : "停止智能搭建失败");
  } finally {
    stoppingScheduler.value = false;
  }
}

async function handleTriggerDrama(record: PendingDramaRecord) {
  if (!schedulerRunning.value) {
    message.warning("请先启动智能搭建，再手动触发单个剧集");
    return;
  }

  if (!canBuildDramaNow(record)) {
    const earliestBuildTime = getEarliestBuildTime(record);
    message.warning(
      earliestBuildTime
        ? `未到可搭建时间，最早可在 ${formatDateTime(earliestBuildTime.getTime())} 提交搭建`
        : "未到可搭建时间",
    );
    return;
  }

  manualBuildingId.value = record.record_id;
  try {
    const result = await window.api.juliangBuildTriggerScheduler(record.record_id);
    schedulerStatus.value = result.data;
    syncRefreshTimer();
    message.success(result.message || "已触发搭建任务");
    await refreshAll(false);
  } catch (error) {
    console.error("触发单个剧集搭建失败:", error);
    message.error(error instanceof Error ? error.message : "触发单个剧集搭建失败");
  } finally {
    manualBuildingId.value = null;
  }
}

const pendingColumns: DataTableColumns<PendingDramaRecord> = [
  {
    title: "剧名",
    key: "drama",
    minWidth: 220,
    ellipsis: { tooltip: true },
    render: (row) => parseTextField(row.fields["剧名"]) || "-",
  },
  {
    title: "账户",
    key: "account",
    width: 180,
    render: (row) => parseTextField(row.fields["账户"]) || "-",
  },
  {
    title: "日期",
    key: "date",
    width: 120,
    render: (row) => formatDate(parseDateTimestamp(row)),
  },
  {
    title: "上架时间",
    key: "publishTime",
    width: 170,
    render: (row) => formatDateTime(parsePublishTimestamp(row)),
  },
  {
    title: "最早可搭建时间",
    key: "earliestBuildTime",
    width: 180,
    render: (row) => {
      const earliestBuildTime = getEarliestBuildTime(row);
      return earliestBuildTime
        ? formatDateTime(earliestBuildTime.getTime())
        : "-";
    },
  },
  {
    title: "当前状态",
    key: "status",
    width: 110,
    render: (row) =>
      h(
        NTag,
        { type: "warning", size: "small" },
        { default: () => parseTextField(row.fields["当前状态"]) || "待搭建" },
      ),
  },
  {
    title: "操作",
    key: "actions",
    width: 150,
    render: (row) => {
      const buildable = canBuildDramaNow(row);
      const disabled =
        !schedulerRunning.value ||
        hasRunningTask.value ||
        !buildable ||
        manualBuildingId.value === row.record_id;

      return h(
        NButton,
        {
          text: true,
          type: "primary",
          size: "small",
          disabled,
          loading: manualBuildingId.value === row.record_id,
          onClick: () => handleTriggerDrama(row),
        },
        {
          default: () =>
            !schedulerRunning.value
              ? "先启动智能搭建"
              : buildable
                ? "开始搭建"
                : "未到时间",
        },
      );
    },
  },
];

const historyColumns: DataTableColumns<HistoryRow> = [
  {
    title: "剧名",
    key: "dramaName",
    minWidth: 220,
    ellipsis: { tooltip: true },
  },
  {
    title: "账户",
    key: "account",
    width: 180,
  },
  {
    title: "日期",
    key: "date",
    width: 120,
    render: (row) => formatDate(row.date),
  },
  {
    title: "上架时间",
    key: "publishTime",
    width: 170,
    render: (row) => formatDateTime(row.publishTime),
  },
  {
    title: "搭建时间",
    key: "completedAt",
    width: 170,
    render: (row) => formatDateTime(row.completedAt),
  },
  {
    title: "结果",
    key: "status",
    width: 100,
    render: (row) => {
      const map = {
        success: { type: "success" as const, text: "成功" },
        failed: { type: "error" as const, text: "失败" },
        skipped: { type: "default" as const, text: "跳过" },
      };
      const current = map[row.status] || map.failed;
      return h(
        NTag,
        { type: current.type, size: "small" },
        { default: () => current.text },
      );
    },
  },
  {
    title: "失败原因",
    key: "error",
    minWidth: 220,
    ellipsis: { tooltip: true },
    render: (row) => row.error || "-",
  },
];

watch(
  () => currentTableId.value,
  async () => {
    historyAccountMap.value = {};
    await refreshAll(false);
  },
);

watch(
  () => schedulerStatus.value?.enabled,
  () => {
    syncRefreshTimer();
  },
);

onMounted(async () => {
  await ensureBaseConfigLoaded();
  await darenStore.loadFromServer(true);
  await ensureCurrentDarenSelected();
  await refreshAll();
});

onUnmounted(() => {
  stopRefreshTimer();
});
</script>

<template>
  <div class="juliang-build-page">
    <div class="page-header">
      <h2 class="page-title">巨量搭建</h2>
      <NSpace>
        <NSelect
          v-if="authStore.isAdmin"
          v-model:value="darenStore.selectedDarenId"
          class="daren-select"
          placeholder="请选择达人"
          :options="adminDarenOptions"
          clearable
          @update:value="darenStore.setSelectedDaren"
        />
        <NButton :loading="refreshing" @click="refreshAll()">刷新</NButton>
      </NSpace>
    </div>

    <NCard class="control-card" :bordered="false">
      <template #header>
        <div class="card-title-row">
          <span>智能搭建控制台</span>
          <span
            class="status-chip"
            :class="{ running: schedulerRunning, idle: !schedulerRunning }"
          >
            {{ schedulerRunning ? "运行中" : "未启动" }}
          </span>
        </div>
      </template>

      <div class="control-toolbar">
        <div class="interval-block">
          <span class="field-label">轮询间隔</span>
          <NSelect
            v-model:value="selectedInterval"
            class="interval-select"
            placeholder="请选择轮询间隔"
            :options="intervalOptions"
            :disabled="schedulerRunning || startingScheduler || stoppingScheduler"
          />
        </div>

        <NSpace>
          <NButton
            type="primary"
            :disabled="!selectedInterval || schedulerRunning"
            :loading="startingScheduler"
            @click="handleStartScheduler"
          >
            智能搭建
          </NButton>
          <NButton
            type="error"
            :disabled="!schedulerRunning"
            :loading="stoppingScheduler"
            @click="handleStopScheduler"
          >
            停止
          </NButton>
        </NSpace>
      </div>

      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-label">轮询间隔</span>
          <span class="stat-value">
            {{ schedulerStatus?.intervalMinutes ? `${schedulerStatus.intervalMinutes} 分钟` : "-" }}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label">上次运行时间</span>
          <span class="stat-value">{{ formatDateTime(schedulerStatus?.lastRunTime || null) }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">下次运行时间</span>
          <span class="stat-value">{{ formatDateTime(schedulerStatus?.nextRunTime || null) }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">已搭建数量</span>
          <span class="stat-value">{{ schedulerStatus?.stats.totalBuilt ?? 0 }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">失败数量</span>
          <span class="stat-value">{{ schedulerStatus?.stats.failCount ?? 0 }}</span>
        </div>
      </div>

      <div v-if="schedulerStatus?.currentTask" class="current-task">
        当前任务：{{ schedulerStatus.currentTask.dramaName || "查询中..." }}，
        开始时间 {{ formatDateTime(schedulerStatus.currentTask.startTime) }}
      </div>
    </NCard>

    <NCard class="table-card" :bordered="false">
      <template #header>
        <div class="card-title-row">
          <span>待搭建剧集列表</span>
          <span class="table-count">共 {{ pendingDramas.length }} 部</span>
        </div>
      </template>

      <NDataTable
        :columns="pendingColumns"
        :data="pendingDramas"
        :loading="loadingPending || loadingStatus"
        :pagination="{ pageSize: 10 }"
        :bordered="false"
        :single-line="false"
        size="small"
      />

      <NEmpty
        v-if="!loadingPending && !pendingDramas.length"
        description="当前没有待搭建剧集"
        class="empty-block"
      />
    </NCard>

    <NCard class="table-card" :bordered="false">
      <template #header>
        <div class="card-title-row">
          <span>最近搭建记录</span>
          <span class="table-count">共 {{ historyRows.length }} 条</span>
        </div>
      </template>

      <NDataTable
        :columns="historyColumns"
        :data="historyRows"
        :loading="loadingStatus"
        :pagination="{ pageSize: 10 }"
        :bordered="false"
        :single-line="false"
        size="small"
      />

      <NEmpty
        v-if="!loadingStatus && !historyRows.length"
        description="最近还没有搭建记录"
        class="empty-block"
      />
    </NCard>
  </div>
</template>

<style scoped>
.juliang-build-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.page-title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: #1f2937;
}

.daren-select {
  width: 280px;
}

.control-card,
.table-card {
  border-radius: 18px;
}

.card-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.status-chip.running {
  color: #166534;
  background: #dcfce7;
}

.status-chip.idle {
  color: #374151;
  background: #f3f4f6;
}

.control-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 16px;
  flex-wrap: wrap;
}

.interval-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-size: 13px;
  color: #6b7280;
}

.interval-select {
  width: 220px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, #f8fafc, #eef2ff);
}

.stat-label {
  font-size: 12px;
  color: #6b7280;
}

.stat-value {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
}

.current-task {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 13px;
}

.table-count {
  font-size: 12px;
  color: #6b7280;
}

.empty-block {
  padding: 24px 0 8px;
}

@media (max-width: 1100px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .daren-select,
  .interval-select {
    width: 100%;
  }

  .control-toolbar {
    align-items: stretch;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
