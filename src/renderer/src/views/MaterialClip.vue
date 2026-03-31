<script setup lang="ts">
defineOptions({ name: "MaterialClip" });

import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NInput,
  NSelect,
  NSpace,
  NSwitch,
  NTooltip,
  useMessage,
} from "naive-ui";
import QueueRuleTooltip from "../components/QueueRuleTooltip.vue";
import { useAuthStore } from "../stores/auth";
import { useDarenStore } from "../stores/daren";

interface MaterialClipVideoConfig {
  hw_codec: string;
  sw_codec: string;
  bitrate: string;
  max_rate: string;
  buffer_size: string;
  soft_crf: string;
  preset: string;
  profile: string;
  level: string;
  hw_level: string;
  sw_level: string;
  tag: string;
  pixel_format: string;
  faststart: boolean;
}

interface MaterialClipAudioConfig {
  codec: string;
  bitrate: string;
  sample_rate: number;
}

interface MaterialClipBrandTextRange {
  range: string;
  text: string;
}

interface MaterialClipBrandTextMapping {
  mode: string;
  ranges: MaterialClipBrandTextRange[] | null;
  cycle_texts: string[] | null;
  default_text: string;
}

interface MaterialClipFeishuConfig {
  app_id: string;
  app_secret: string;
  app_token: string;
  table_id: string;
  base_url: string;
  field_names: string[];
  status_field_name: string;
  pending_status_value: string;
  completed_status_value: string;
  processing_status_value: string;
  missing_source_status_value: string;
  failed_status_value: string;
  remark_field_name: string;
  rating_field_name: string;
  priority_rating_value: string;
  upload_time_sort_desc: boolean;
  douyin_material_field_name: string;
  highlight_start_field_name: string;
  page_size: number;
  token_refresh_interval: number;
}

interface MaterialClipFeishuWatcherConfig {
  enabled: boolean;
  poll_interval: number;
  max_dates_per_cycle: number;
  settle_seconds: number;
  settle_rounds: number;
  idle_exit_minutes: number | null;
  state_dir: string;
  date_whitelist: string[];
  date_blacklist: string[];
  status_filter: string | null;
}

interface MaterialClipDateDeduplicationConfig {
  enabled: boolean;
  storage_dir: string;
  skip_processed_by_default: boolean;
}

interface MaterialClipAiHighlightConfig {
  enabled: boolean;
  script_path: string;
  only_priority_rating: boolean;
  dashscope_api_key: string;
  model_name: string;
  group_count: number;
  target_highlights_per_drama: number;
  group_highlight_buffer: number;
  video_fps: number;
  analyze_first_portion_only: boolean;
  analyze_portion_ratio: number;
  auto_retry_insufficient_groups: boolean;
  max_auto_retry_rounds: number;
  use_dashscope_proxy: boolean;
}

interface MaterialClipConfig {
  target_fps: number;
  smart_fps: boolean;
  fast_mode: boolean;
  filter_threads: number;
  verbose: boolean;
  min_duration: number;
  max_duration: number;
  count: number;
  material_code: string;
  date_str: string | null;
  exclude_last_episodes: number;
  title_font_size: number;
  brand_font_size: number;
  disclaimer_font_size: number;
  disclaimer_text: string;
  enable_brand_text: boolean;
  enable_disclaimer_text: boolean;
  title_opacity: number;
  bottom_opacity: number;
  title_position: string;
  title_colors: string[];
  enable_hook_text: boolean;
  hook_texts: string[];
  hook_font_size: number;
  hook_duration: number;
  hook_text_color: string;
  random_start: boolean;
  seed: number | null;
  use_hardware: boolean;
  keep_temp: boolean;
  jobs: number;
  canvas: string | null;
  reference_resolution: [number, number] | null;
  default_source_dir: string;
  backup_source_dir: string;
  temp_dir: string | null;
  output_dir: string;
  tail_cache_dir: string | null;
  tail_file: string | null;
  refresh_tail_cache: boolean;
  font_file: string | null;
  brand_text: string;
  brand_text_mapping: MaterialClipBrandTextMapping | null;
  enable_floating_watermark: boolean;
  floating_watermark_font_size: number;
  floating_watermark_alpha: number;
  floating_watermark_speed_range: number[];
  include: string[] | null;
  exclude: string[] | null;
  full: boolean;
  no_interactive: boolean;
  enable_deduplication: boolean;
  auto_delete_source_after_completion: boolean;
  video: MaterialClipVideoConfig;
  audio: MaterialClipAudioConfig;
  enable_feishu_features: boolean;
  feishu: MaterialClipFeishuConfig;
  feishu_watcher: MaterialClipFeishuWatcherConfig;
  feishu_webhook_url: string | null;
  enable_feishu_notification: boolean;
  date_deduplication: MaterialClipDateDeduplicationConfig;
  ai_highlight: MaterialClipAiHighlightConfig;
  highlight_start_points_by_drama: Record<string, string> | null;
}

interface MaterialClipLogEntry {
  time: string;
  message: string;
}

interface MaterialClipEnvironmentStatus {
  ready: boolean;
  installSupported: boolean;
  platform: string;
  processorRoot: string | null;
  pythonCommand: string | null;
  activeUser: string | null;
  runtimeSource: "managed" | "dev-fallback" | "missing";
  checks: Array<{
    key: string;
    label: string;
    passed: boolean;
    detail: string;
  }>;
  error?: string;
}

interface MaterialClipRunState {
  running: boolean;
  status: "idle" | "running" | "stopping" | "stopped" | "completed" | "failed";
  mode: "idle" | "auto" | "manual";
  message: string;
  pid: number | null;
  pendingDramas: Array<{
    order: number;
    date: string;
    dramaName: string;
    rating: string | null;
    recordId: string;
    fullDate: string | null;
    uploadTime: number | null;
    plannedMaterials: number | null;
    highlightStartPoints: string | null;
  }>;
  processedDramas: Array<{
    order: number;
    date: string;
    dramaName: string;
    rating: string | null;
    recordId: string;
    fullDate: string | null;
    plannedMaterials: number | null;
    completedMaterials: number;
    completedAt: string;
    elapsedSeconds: number | null;
  }>;
  currentDramaName: string | null;
  currentDramaDate: string | null;
  currentDramaRating: string | null;
  currentRecordId: string | null;
  currentDramaStartedAt: string | null;
  totalMaterials: number;
  completedMaterials: number;
  remainingMaterials: number;
  startedAt: string | null;
  lastUpdatedAt: string | null;
  pollIntervalSeconds: number | null;
  lastPollAt: string | null;
  nextPollAt: string | null;
}

interface MaterialClipAiHighlightDrama {
  order: number;
  dramaName: string;
  recordId: string;
  date: string;
  fullDate: string | null;
  rating: string | null;
  sourceDir: string | null;
  sourceMatched: boolean;
  highlightStartPoints: string | null;
  status: "pending" | "running" | "success" | "failed" | "unmatched";
  message: string;
  highlightCount: number;
  updatedAt: string | null;
}

interface MaterialClipAiHighlightState {
  running: boolean;
  status: "idle" | "running" | "completed" | "failed";
  message: string;
  totalPending: number;
  matchedCount: number;
  unmatchedCount: number;
  dramas: MaterialClipAiHighlightDrama[];
  startedAt: string | null;
  lastUpdatedAt: string | null;
}

const importingRuntime = ref(false);

const message = useMessage();
const authStore = useAuthStore();
const darenStore = useDarenStore();

const resolutionOptions = [
  { label: "跟随源视频", value: "auto" },
  { label: "720x1280（720p 竖屏）", value: "720x1280" },
  { label: "1080x1920（1080p 竖屏）", value: "1080x1920" },
];

const aiModelOptions = [
  { label: "qwen3-vl-flash", value: "qwen3-vl-flash" },
  { label: "qwen3-vl-plus", value: "qwen3-vl-plus" },
  { label: "qwen3-vl-max", value: "qwen3-vl-max" },
];

const envChecking = ref(true);
const installingEnvironment = ref(false);
const isAutoRunning = ref(false);
const isManualRunning = ref(false);
const runningImmediateQuery = ref(false);
const refreshingPending = ref(false);
const refreshingAiHighlight = ref(false);
const runningAiHighlight = ref(false);
const resolvingConfig = ref(false);
const showLogs = ref(true);
const dramaTablesExpanded = ref(["pending", "processed"]);
const manualDramaNames = ref("");
const logs = ref<MaterialClipLogEntry[]>([]);
const config = ref<MaterialClipConfig | null>(null);
const configEditorText = ref("");
const environmentStatus = ref<MaterialClipEnvironmentStatus | null>(null);
const aiHighlightState = ref<MaterialClipAiHighlightState>({
  running: false,
  status: "idle",
  message: "等待开始高光识别",
  totalPending: 0,
  matchedCount: 0,
  unmatchedCount: 0,
  dramas: [],
  startedAt: null,
  lastUpdatedAt: null,
});

const runState = ref<MaterialClipRunState>({
  running: false,
  status: "idle",
  mode: "idle",
  message: "",
  pid: null,
  pendingDramas: [],
  processedDramas: [],
  currentDramaName: null,
  currentDramaDate: null,
  currentDramaRating: null,
  currentRecordId: null,
  currentDramaStartedAt: null,
  totalMaterials: 0,
  completedMaterials: 0,
  remainingMaterials: 0,
  startedAt: null,
  lastUpdatedAt: null,
  pollIntervalSeconds: null,
  lastPollAt: null,
  nextPollAt: null,
});

const hasQueueData = computed(() => runState.value.pendingDramas.length > 0);
const hasProcessedData = computed(
  () => runState.value.processedDramas.length > 0,
);
const showAiHighlightCard = computed(() =>
  Boolean(config.value?.ai_highlight.enabled),
);
const matchedAiHighlightDramas = computed(() =>
  aiHighlightState.value.dramas.filter((item) => item.sourceMatched),
);
const isAiHighlightReadonly = computed(() => !authStore.isAdmin);
const nowMs = ref(Date.now());

function formatPollingTime(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatPollInterval(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) {
    return null;
  }

  if (seconds % 60 === 0) {
    return `${seconds / 60}分钟`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes <= 0) {
    return `${remainSeconds}秒`;
  }
  return `${minutes}分${remainSeconds}秒`;
}

const statusSummary = computed(() => {
  const state = runState.value;
  if (state.status === "failed" && state.message) {
    return state.message;
  }

  if (state.status === "completed" && state.message) {
    return state.message;
  }

  if (state.status === "stopped" && state.message) {
    return state.message;
  }

  if (state.status === "stopping") {
    return state.message || "正在停止自动剪辑...";
  }

  if (state.status === "running") {
    if (state.currentDramaName) {
      return `正在处理《${state.currentDramaName}》`;
    }
    return state.mode === "auto" ? "轮询剪辑运行中..." : "手动剪辑运行中...";
  }

  if (hasQueueData.value) {
    return `已同步待剪辑队列，共 ${state.pendingDramas.length} 部剧`;
  }

  return "等待开始剪辑";
});

const aiHighlightSummary = computed(() => {
  const state = aiHighlightState.value;
  if (state.running) {
    return state.message || "AI 高光识别运行中...";
  }
  if (state.status === "failed") {
    return state.message || "AI 高光识别失败";
  }
  if (state.status === "completed") {
    return state.message || "AI 高光识别已完成";
  }
  if (state.matchedCount > 0) {
    return `已匹配 ${state.matchedCount} 部待识别剧`;
  }
  return state.message || "等待开始高光识别";
});

const showClipPollingMeta = computed(() => {
  const state = runState.value;
  return (
    state.mode === "auto" &&
    state.running &&
    state.status === "running" &&
    !state.currentDramaName
  );
});

const clipPollIntervalText = computed(() =>
  formatPollInterval(runState.value.pollIntervalSeconds),
);

const clipLastPollText = computed(() =>
  formatPollingTime(runState.value.lastPollAt),
);

const clipNextPollText = computed(() =>
  formatPollingTime(runState.value.nextPollAt),
);

const currentDramaDateLabel = computed(() => {
  const date = runState.value.currentDramaDate?.trim();
  if (!date || date === "未知" || date === "未知日期") {
    return null;
  }
  return date;
});

const currentDramaRatingLabel = computed(() => {
  const rating = runState.value.currentDramaRating?.trim();
  return rating || null;
});

const clipPriorityRatingLabel = computed(
  () => config.value?.feishu.priority_rating_value?.trim() || "红标",
);

const clipRuleItems = computed(() => [
  {
    index: 1,
    title: "先剪优先评级的剧",
    parts: [
      { text: "系统会先把评级是 " },
      {
        text: clipPriorityRatingLabel.value,
        tone: getRatingTone(clipPriorityRatingLabel.value),
      },
      { text: " 的剧挑出来先剪。" },
    ],
  },
  {
    index: 2,
    title: "多个优先评级时，先看上架时间",
    desc: "如果优先评级的剧不止一部，就先剪上架时间更晚的；如果上架时间一样，再按飞书日期从早到晚排。",
  },
  {
    index: 3,
    title: "优先评级剪完后，再看非优先评级",
    desc: "非优先评级的剧会先按飞书日期从早到晚排，日期更早的会更先处理。",
  },
  {
    index: 4,
    title: "同一天先绿标，再黄标",
    parts: [
      { text: "如果飞书日期一样，就先看评级：" },
      { text: "绿标", tone: "green" },
      { text: " 会排在 " },
      { text: "黄标", tone: "yellow" },
      { text: " 前面。" },
    ],
  },
  {
    index: 5,
    title: "同评级再看上架时间和剧名",
    desc: "同一天、同评级时，先剪上架时间更晚的；如果上架时间也一样，再按剧名字典序排序。",
  },
]);

const currentDramaTimerText = computed(() => {
  if (
    (runState.value.status !== "running" &&
      runState.value.status !== "stopping") ||
    !runState.value.currentDramaStartedAt
  ) {
    return null;
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor(
      (nowMs.value - new Date(runState.value.currentDramaStartedAt).getTime()) /
        1000,
    ),
  );
  return formatElapsedTimer(elapsedSeconds);
});

function getRatingClass(rating: string | null | undefined): string {
  const normalized = rating?.trim();
  if (!normalized) {
    return "default";
  }

  if (normalized.includes("红")) {
    return "red";
  }

  if (normalized.includes("黄")) {
    return "yellow";
  }

  if (normalized.includes("绿")) {
    return "green";
  }

  const upper = normalized.toUpperCase();
  if (upper === "S") {
    return "red";
  }
  if (upper === "A") {
    return "yellow";
  }
  if (upper === "B") {
    return "green";
  }

  return "default";
}

function getRatingTone(rating: string | null | undefined) {
  const normalized = getRatingClass(rating);
  if (
    normalized === "red" ||
    normalized === "yellow" ||
    normalized === "green"
  ) {
    return normalized;
  }
  return "blue";
}

function formatElapsedTimer(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((item) => String(item).padStart(2, "0"))
    .join(":");
}

function formatCompletedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatElapsedMinutes(value: number | null): string {
  if (!value || value <= 0) {
    return "-";
  }

  if (value < 60) {
    return "1分钟";
  }

  return `${Math.floor(value / 60)}分钟`;
}

function formatUploadTime(value: number | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatMaterialCount(
  plannedMaterials: number | null,
  completedMaterials?: number,
): string {
  if (
    completedMaterials !== undefined &&
    plannedMaterials &&
    completedMaterials !== plannedMaterials
  ) {
    return `${completedMaterials} / ${plannedMaterials}`;
  }

  if (plannedMaterials) {
    return String(plannedMaterials);
  }

  if (completedMaterials !== undefined) {
    return String(completedMaterials);
  }

  return "-";
}

function getAiHighlightStatusLabel(
  status: MaterialClipAiHighlightDrama["status"],
): string {
  switch (status) {
    case "running":
      return "识别中";
    case "success":
      return "已写回";
    case "failed":
      return "失败";
    case "unmatched":
      return "未匹配";
    default:
      return "待识别";
  }
}

function getAiHighlightStatusClass(
  status: MaterialClipAiHighlightDrama["status"],
): string {
  if (status === "success") {
    return "success";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "unmatched") {
    return "muted";
  }
  return "pending";
}

const progressPercent = computed(() => {
  if (runState.value.totalMaterials <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.round(
      (runState.value.completedMaterials / runState.value.totalMaterials) * 100,
    ),
  );
});

let unsubscribeLog: (() => void) | null = null;
let unsubscribeState: (() => void) | null = null;
let unsubscribeAiHighlightState: (() => void) | null = null;
let currentDramaTimer: number | null = null;

const prettyConfig = computed(() => configEditorText.value.trim());
const currentClipTableId = computed(
  () => darenStore.currentDaren?.feishuDramaStatusTableId?.trim() || "",
);

function applyClipFixedFields(draft: MaterialClipConfig): MaterialClipConfig {
  const next = JSON.parse(JSON.stringify(draft)) as MaterialClipConfig;
  if (currentClipTableId.value) {
    next.feishu.table_id = currentClipTableId.value;
  }
  return next;
}

function syncEditorFromConfig() {
  if (!config.value) {
    configEditorText.value = "";
    return;
  }
  configEditorText.value = JSON.stringify(config.value, null, 2);
}

function updateConfig(updater: (draft: MaterialClipConfig) => void) {
  if (!config.value) {
    return;
  }
  updater(config.value);
  syncEditorFromConfig();
}

function updateAiHighlightConfig(updater: (draft: MaterialClipConfig) => void) {
  if (isAiHighlightReadonly.value) {
    return;
  }
  updateConfig(updater);
}

function ensureAiHighlightAdminAccess(): boolean {
  if (!isAiHighlightReadonly.value) {
    return true;
  }

  message.warning("AI 智能高光暂仅管理员可操作");
  return false;
}

const selectedResolution = computed(() => {
  if (!config.value?.canvas || !config.value.reference_resolution) {
    return "auto";
  }
  const [width, height] = config.value.reference_resolution;
  const resolution = `${width}x${height}`;
  return config.value.canvas === resolution ? resolution : "auto";
});

function updateResolution(value: string | null) {
  updateConfig((draft) => {
    if (!value || value === "auto") {
      draft.canvas = null;
      draft.reference_resolution = null;
      return;
    }

    const [widthText, heightText] = value.split("x");
    const width = Number(widthText);
    const height = Number(heightText);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return;
    }

    draft.canvas = value;
    draft.reference_resolution = [width, height];
  });
}

function getBitrateInputValue(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .replace(/k$/i, "");
}

function formatBitrateValue(value: string): string {
  const normalized = value.replace(/[^0-9.]/g, "").trim();
  if (!normalized) {
    return "";
  }
  return `${normalized}k`;
}

function formatBufferSizeValue(value: string): string {
  const normalized = value.replace(/[^0-9.]/g, "").trim();
  if (!normalized) {
    return "";
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    return "";
  }

  const result = numeric * 2;
  return `${Number.isInteger(result) ? result : result.toString()}k`;
}

function updateVideoBitrate(value: string) {
  updateConfig((draft) => {
    const bitrate = formatBitrateValue(value);
    draft.video.bitrate = bitrate;
    draft.video.max_rate = bitrate;
    draft.video.buffer_size = formatBufferSizeValue(value);
  });
}

function updateAudioBitrate(value: string) {
  updateConfig((draft) => {
    draft.audio.bitrate = formatBitrateValue(value);
  });
}

async function loadConfig() {
  try {
    config.value = applyClipFixedFields(await window.api.getClipConfig());
    syncEditorFromConfig();
  } catch (error) {
    console.error("加载素材剪辑配置失败:", error);
    message.error(`加载配置失败: ${error}`);
  }
}

async function loadEnvironmentStatus(showSuccess = false) {
  envChecking.value = true;
  try {
    environmentStatus.value = await window.api.getClipEnvironmentStatus();
    if (showSuccess && environmentStatus.value.ready) {
      message.success("素材剪辑环境已就绪");
    }
  } catch (error) {
    message.error(`环境检测失败: ${error}`);
  } finally {
    envChecking.value = false;
  }
}

async function installEnvironment() {
  if (installingEnvironment.value) {
    return;
  }

  installingEnvironment.value = true;
  try {
    const result = await window.api.installClipEnvironment();
    if (!result.success) {
      message.error(result.error || "环境安装失败");
      return;
    }
    await loadEnvironmentStatus(true);
    if (environmentStatus.value?.ready) {
      await loadConfig();
    }
  } catch (error) {
    message.error(`环境安装失败: ${error}`);
  } finally {
    installingEnvironment.value = false;
  }
}

async function importRuntime() {
  if (importingRuntime.value) {
    return;
  }

  importingRuntime.value = true;
  try {
    const result = await window.api.importClipRuntime();
    if (!result.success) {
      if (result.error && result.error !== "已取消导入") {
        message.error(result.error);
      }
      return;
    }

    message.success("素材剪辑运行时已导入");
    await loadEnvironmentStatus();
    if (environmentStatus.value?.ready) {
      await loadConfig();
    }
  } catch (error) {
    message.error(`导入运行时失败: ${error}`);
  } finally {
    importingRuntime.value = false;
  }
}

async function resolveEditorConfig(): Promise<MaterialClipConfig | null> {
  if (!prettyConfig.value) {
    message.warning("配置内容不能为空");
    return null;
  }

  resolvingConfig.value = true;
  try {
    const parsed = JSON.parse(prettyConfig.value) as unknown;
    const normalizedConfig = applyClipFixedFields(
      await window.api.getClipConfig(parsed),
    );
    config.value = normalizedConfig;
    syncEditorFromConfig();
    return JSON.parse(JSON.stringify(normalizedConfig)) as MaterialClipConfig;
  } catch (error) {
    message.error(`配置解析失败: ${error}`);
    return null;
  } finally {
    resolvingConfig.value = false;
  }
}

async function resetConfigToDefault() {
  if (resolvingConfig.value) {
    return;
  }

  resolvingConfig.value = true;
  try {
    config.value = applyClipFixedFields(await window.api.getClipConfig());
    syncEditorFromConfig();
    message.success("已恢复默认配置");
  } catch (error) {
    message.error(`恢复默认配置失败: ${error}`);
  } finally {
    resolvingConfig.value = false;
  }
}

async function selectDirectory(field: "default_source_dir" | "output_dir") {
  try {
    const selected = await window.api.selectFolder();
    if (!selected) {
      return;
    }
    updateConfig((draft) => {
      draft[field] = selected;
    });
  } catch (error) {
    message.error(`选择目录失败: ${error}`);
  }
}

async function refreshPendingQueue() {
  if (refreshingPending.value || runState.value.running) {
    return;
  }

  refreshingPending.value = true;
  try {
    const resolvedConfig = await resolveEditorConfig();
    if (!resolvedConfig) {
      return;
    }
    runState.value = await window.api.clipRefreshPending(resolvedConfig);
    message.success("待剪辑列表已更新");
  } catch (error) {
    message.error(`查询待剪辑失败: ${error}`);
  } finally {
    refreshingPending.value = false;
  }
}

async function loadAiHighlightState() {
  try {
    aiHighlightState.value = await window.api.clipGetAiHighlightState();
    runningAiHighlight.value = aiHighlightState.value.running;
  } catch (error) {
    console.error("加载 AI 高光状态失败:", error);
  }
}

async function refreshAiHighlightQueue() {
  if (refreshingAiHighlight.value || runningAiHighlight.value) {
    return;
  }

  if (!ensureAiHighlightAdminAccess()) {
    return;
  }

  refreshingAiHighlight.value = true;
  try {
    const resolvedConfig = await resolveEditorConfig();
    if (!resolvedConfig) {
      return;
    }
    aiHighlightState.value =
      await window.api.clipRefreshAiHighlight(resolvedConfig);
    message.success("AI 高光待识别列表已更新");
  } catch (error) {
    message.error(`刷新 AI 高光列表失败: ${error}`);
  } finally {
    refreshingAiHighlight.value = false;
  }
}

async function startAiHighlightRecognition() {
  if (runningAiHighlight.value) {
    return;
  }

  if (!ensureAiHighlightAdminAccess()) {
    return;
  }

  const resolvedConfig = await resolveEditorConfig();
  if (!resolvedConfig) {
    return;
  }

  runningAiHighlight.value = true;
  try {
    const result = await window.api.clipRunAiHighlight(resolvedConfig);
    if (result.success) {
      message.success("AI 高光识别任务已启动");
    } else {
      runningAiHighlight.value = false;
      message.error(result.error || "AI 高光识别启动失败");
    }
  } catch (error) {
    runningAiHighlight.value = false;
    message.error(`AI 高光识别启动失败: ${error}`);
  }
}

async function startAutoClip() {
  if (isAutoRunning.value) {
    return;
  }

  const resolvedConfig = await resolveEditorConfig();
  if (!resolvedConfig) {
    return;
  }

  isAutoRunning.value = true;
  try {
    const result = await window.api.clipAutoRun(resolvedConfig);
    if (result.success) {
      message.success("轮询剪辑已启动");
      showLogs.value = true;
    } else {
      message.error(result.error || "轮询剪辑启动失败");
    }
  } catch (error) {
    message.error(`轮询剪辑启动失败: ${error}`);
  } finally {
    // isAutoRunning will be updated by state listener
  }
}

async function startImmediateQueryClip() {
  if (runningImmediateQuery.value || runState.value.running) {
    return;
  }

  const resolvedConfig = await resolveEditorConfig();
  if (!resolvedConfig) {
    return;
  }

  runningImmediateQuery.value = true;
  try {
    const result = await window.api.clipRunOnce(resolvedConfig);
    if (result.success) {
      message.success("已启动立即查询剪辑");
      showLogs.value = true;
    } else {
      runningImmediateQuery.value = false;
      message.error(result.error || "立即查询剪辑启动失败");
    }
  } catch (error) {
    runningImmediateQuery.value = false;
    message.error(`立即查询剪辑启动失败: ${error}`);
  }
}

async function stopAutoClip() {
  try {
    const result = await window.api.clipStopAutoRun();
    if (!result.success) {
      message.error(result.error || "停止轮询剪辑失败");
      return;
    }
    message.success("已发送停止指令，等待轮询进程退出...");
  } catch (error) {
    message.error(`停止失败: ${error}`);
  }
}

async function startManualClip() {
  const input = manualDramaNames.value.trim();
  if (!input) {
    message.warning("请输入要剪辑的剧名");
    return;
  }

  if (isManualRunning.value) {
    return;
  }

  const resolvedConfig = await resolveEditorConfig();
  if (!resolvedConfig) {
    return;
  }

  isManualRunning.value = true;
  try {
    const result = await window.api.clipManualRun(input, resolvedConfig);
    if (result.success) {
      message.success("手动剪辑任务已启动");
      manualDramaNames.value = "";
      showLogs.value = true;
    } else {
      message.error(result.error || "手动剪辑启动失败");
    }
  } catch (error) {
    message.error(`手动剪辑启动失败: ${error}`);
  } finally {
    // isManualRunning will be updated by state listener
  }
}

async function loadLogs() {
  try {
    logs.value = await window.api.clipGetLogs();
  } catch (error) {
    console.error("加载素材剪辑日志失败:", error);
  }
}

async function clearLogs() {
  try {
    await window.api.clipClearLogs();
    logs.value = [];
    message.success("日志已清空");
  } catch (error) {
    message.error(`清空日志失败: ${error}`);
  }
}

async function clearProcessedDramas() {
  try {
    await window.api.clipClearProcessedDramas();
    runState.value = {
      ...runState.value,
      processedDramas: [],
    };
    message.success("已处理剧目已清空");
  } catch (error) {
    message.error(`清空已处理剧目失败: ${error}`);
  }
}

async function toggleLogs() {
  showLogs.value = !showLogs.value;
  if (showLogs.value) {
    await loadLogs();
  }
}

async function loadRunState() {
  try {
    const state = await window.api.clipGetRunState();
    if (state) {
      runState.value = state;
      isAutoRunning.value =
        (state.status === "running" || state.status === "stopping") &&
        state.mode === "auto";
      isManualRunning.value =
        state.status === "running" && state.mode === "manual";
    }
  } catch (error) {
    console.error("加载运行状态失败:", error);
  }
}

onMounted(async () => {
  currentDramaTimer = window.setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);

  if (!darenStore.darenList.length) {
    await darenStore.loadFromServer();
  }

  await loadLogs();
  await loadEnvironmentStatus();
  if (environmentStatus.value?.ready) {
    await loadConfig();
  }
  await loadRunState();
  await loadAiHighlightState();

  unsubscribeLog = window.api.onClipLog((log) => {
    logs.value.push(log);
    if (logs.value.length > 500) {
      logs.value.shift();
    }
  });

  unsubscribeState = window.api.onClipState((state) => {
    runState.value = state;
    runningImmediateQuery.value = false;
    isAutoRunning.value =
      (state.status === "running" || state.status === "stopping") &&
      state.mode === "auto";
    isManualRunning.value =
      state.status === "running" && state.mode === "manual";
  });

  unsubscribeAiHighlightState = window.api.onClipAiHighlightState((state) => {
    aiHighlightState.value = state;
    runningAiHighlight.value = state.running;
  });
});

onUnmounted(() => {
  if (currentDramaTimer !== null) {
    window.clearInterval(currentDramaTimer);
  }
  if (unsubscribeLog) {
    unsubscribeLog();
  }
  if (unsubscribeState) {
    unsubscribeState();
  }
  if (unsubscribeAiHighlightState) {
    unsubscribeAiHighlightState();
  }
});
</script>

<template>
  <div class="material-clip-page">
    <NCard v-if="envChecking" class="overview-card">
      <div class="hero-title">正在检测素材剪辑环境</div>
      <div class="hero-subtitle">
        正在检查素材剪辑运行时、FFmpeg、Python 和本地运行环境，请稍候。
      </div>
    </NCard>

    <template v-else-if="environmentStatus && !environmentStatus.ready">
      <NCard class="overview-card">
        <div class="hero-row">
          <div>
            <div class="hero-title">素材剪辑环境未就绪</div>
            <div class="hero-subtitle">
              当前还不能展示正式剪辑界面。请先导入独立运行时，再完成环境安装。
            </div>
          </div>
          <NSpace>
            <NButton @click="loadEnvironmentStatus">重新检测</NButton>
            <NButton
              :loading="importingRuntime"
              :disabled="installingEnvironment"
              @click="importRuntime"
            >
              导入运行时
            </NButton>
            <NButton
              type="primary"
              :disabled="!environmentStatus.installSupported"
              :loading="installingEnvironment"
              @click="installEnvironment"
            >
              自动安装
            </NButton>
          </NSpace>
        </div>
      </NCard>

      <NAlert type="warning" class="hint-card">
        <template v-if="environmentStatus.runtimeSource === 'missing'">
          先导入 `dramas_processor` 的独立运行时包。支持直接选择打包产物
          zip，或选择已经解压好的运行时目录。
        </template>
        <template v-else-if="environmentStatus.installSupported">
          运行时已找到，但环境还没准备完成。Windows 会复用运行时里的
          `install.ps1`，macOS 会在该运行时目录里补齐 Python 虚拟环境、依赖和
          FFmpeg。
        </template>
        <template v-else>
          当前平台暂不支持自动安装，请根据日志和检测结果手动准备环境。
        </template>
      </NAlert>

      <NCard class="quick-card" title="检测结果">
        <div class="check-list">
          <div
            v-for="item in environmentStatus.checks"
            :key="item.key"
            class="check-item"
          >
            <div class="check-badge" :class="item.passed ? 'passed' : 'failed'">
              {{ item.passed ? "已通过" : "未通过" }}
            </div>
            <div class="check-content">
              <div class="check-label">{{ item.label }}</div>
              <div class="check-detail">{{ item.detail }}</div>
            </div>
          </div>
        </div>
      </NCard>

      <NCard class="log-card">
        <template #header>安装日志</template>
        <template #header-extra>
          <NSpace>
            <NButton size="small" quaternary @click="toggleLogs">
              {{ showLogs ? "隐藏" : "展开" }}
            </NButton>
            <NButton size="small" quaternary @click="clearLogs">清空</NButton>
          </NSpace>
        </template>
        <div v-show="showLogs" class="log-container">
          <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
          <div v-for="(log, index) in logs" :key="index" class="log-item">
            <span class="log-time">[{{ log.time }}]</span>
            <span class="log-message">{{ log.message }}</span>
          </div>
        </div>
      </NCard>
    </template>

    <template v-else>
      <NCard class="overview-card">
        <div class="hero-row">
          <div class="hero-title">素材剪辑</div>
          <NSpace class="hero-actions" wrap>
            <NButton
              quaternary
              class="hero-action-btn"
              @click="loadEnvironmentStatus"
              >重新检测</NButton
            >
            <NButton
              quaternary
              class="hero-action-btn"
              :loading="importingRuntime"
              :disabled="
                installingEnvironment ||
                resolvingConfig ||
                isAutoRunning ||
                isManualRunning
              "
              @click="importRuntime"
            >
              重新导入运行时
            </NButton>
            <NButton
              quaternary
              class="hero-action-btn"
              :loading="resolvingConfig"
              :disabled="importingRuntime || installingEnvironment"
              @click="resetConfigToDefault"
              >恢复默认配置</NButton
            >
            <NButton
              v-if="!runState.running"
              type="primary"
              secondary
              class="hero-action-btn"
              :loading="runningImmediateQuery"
              :disabled="resolvingConfig"
              @click="startImmediateQueryClip"
            >
              立即查询
            </NButton>
            <NButton
              v-if="!isAutoRunning"
              type="primary"
              secondary
              strong
              class="hero-action-btn hero-action-btn-primary"
              :disabled="resolvingConfig"
              @click="startAutoClip"
            >
              启动轮询剪辑
            </NButton>
            <NButton
              v-else
              type="error"
              secondary
              strong
              class="hero-action-btn hero-action-btn-danger"
              :loading="runState.status === 'stopping'"
              @click="stopAutoClip"
            >
              停止轮询剪辑
            </NButton>
          </NSpace>
        </div>
        <div v-if="showClipPollingMeta" class="polling-meta-row">
          <div class="progress-chip">
            <span class="progress-chip-label">状态</span>
            <span class="progress-chip-value">等待飞书下一轮查询</span>
          </div>
          <div v-if="clipPollIntervalText" class="progress-chip">
            <span class="progress-chip-label">轮询时间</span>
            <span class="progress-chip-value">{{ clipPollIntervalText }}</span>
          </div>
          <div v-if="clipLastPollText" class="progress-chip">
            <span class="progress-chip-label">上一轮轮询</span>
            <span class="progress-chip-value">{{ clipLastPollText }}</span>
          </div>
          <div v-if="clipNextPollText" class="progress-chip">
            <span class="progress-chip-label">下一轮轮询</span>
            <span class="progress-chip-value">{{ clipNextPollText }}</span>
          </div>
        </div>
      </NCard>

      <template
        v-if="runState.status !== 'idle' || hasQueueData || hasProcessedData"
      >
        <NCard class="status-card">
          <template #header>运行状态</template>
          <template #header-extra>
            <NButton
              quaternary
              class="hero-action-btn"
              :disabled="runState.running || resolvingConfig"
              :loading="refreshingPending"
              @click="refreshPendingQueue"
            >
              查询待剪辑
            </NButton>
          </template>
          <div class="status-header">
            <div class="status-message">
              {{ statusSummary }}
            </div>
          </div>

          <div v-if="runState.currentDramaName" class="current-drama-section">
            <div class="section-title">当前处理剧目</div>
            <div class="drama-info">
              <span class="drama-name">{{ runState.currentDramaName }}</span>
              <span v-if="currentDramaDateLabel" class="drama-tag">{{
                currentDramaDateLabel
              }}</span>
              <span
                v-if="currentDramaRatingLabel"
                class="drama-tag rating"
                :class="getRatingClass(currentDramaRatingLabel)"
              >
                {{ currentDramaRatingLabel }}
              </span>
            </div>
            <div class="progress-info">
              <div class="progress-meta">
                <div class="progress-chip">
                  <span class="progress-chip-label">素材进度</span>
                  <span class="progress-chip-value"
                    >{{ runState.completedMaterials }} /
                    {{ runState.totalMaterials }}</span
                  >
                  <span v-if="runState.remainingMaterials > 0" class="remaining"
                    >剩余 {{ runState.remainingMaterials }}</span
                  >
                </div>
                <div v-if="currentDramaTimerText" class="progress-chip">
                  <span class="progress-chip-label">剪辑时长</span>
                  <span class="progress-chip-value">{{
                    currentDramaTimerText
                  }}</span>
                </div>
              </div>
              <div class="progress-bar-container">
                <div
                  class="progress-bar"
                  :style="{ width: `${progressPercent}%` }"
                ></div>
              </div>
            </div>
          </div>

          <NCollapse
            v-if="hasQueueData || hasProcessedData"
            v-model:expanded-names="dramaTablesExpanded"
            class="status-collapse"
          >
            <NCollapseItem
              v-if="runState.pendingDramas && runState.pendingDramas.length > 0"
              name="pending"
            >
              <template #header>
                <div class="queue-header">
                  <span>待处理剧目 ({{ runState.pendingDramas.length }})</span>
                  <QueueRuleTooltip
                    title="待剪辑优先级规则"
                    description="系统会按下面这 4 步逐层比较，前一条只要已经分出先后，就不会继续比较下一条。"
                    :items="clipRuleItems"
                  />
                </div>
              </template>
              <div class="table-container">
                <table class="beautiful-table">
                  <thead>
                    <tr>
                      <th width="60">序号</th>
                      <th width="120">日期</th>
                      <th>剧名</th>
                      <th width="160">上架时间</th>
                      <th width="80">评级</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="drama in runState.pendingDramas"
                      :key="drama.order"
                    >
                      <td class="text-center">{{ drama.order }}</td>
                      <td>
                        {{
                          drama.date === "未知" || drama.date === "未知日期"
                            ? "-"
                            : drama.date
                        }}
                      </td>
                      <td class="font-medium">{{ drama.dramaName }}</td>
                      <td>{{ formatUploadTime(drama.uploadTime) }}</td>
                      <td>
                        <span
                          class="rating-badge"
                          :class="getRatingClass(drama.rating)"
                          >{{ drama.rating || "-" }}</span
                        >
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </NCollapseItem>

            <NCollapseItem
              v-if="
                runState.processedDramas && runState.processedDramas.length > 0
              "
              :title="`已处理剧目 (${runState.processedDramas.length})`"
              name="processed"
            >
              <template #header-extra>
                <NButton
                  quaternary
                  size="tiny"
                  @click.stop="clearProcessedDramas"
                >
                  清空
                </NButton>
              </template>
              <div class="table-container">
                <table class="beautiful-table">
                  <thead>
                    <tr>
                      <th width="60">序号</th>
                      <th width="120">日期</th>
                      <th>剧名</th>
                      <th width="90">素材数</th>
                      <th width="80">评级</th>
                      <th width="160">完成时间</th>
                      <th width="100">剪辑时长</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="drama in runState.processedDramas"
                      :key="`${drama.recordId}-${drama.order}`"
                    >
                      <td class="text-center">{{ drama.order }}</td>
                      <td>
                        {{
                          drama.date === "未知" || drama.date === "未知日期"
                            ? "-"
                            : drama.date
                        }}
                      </td>
                      <td class="font-medium">{{ drama.dramaName }}</td>
                      <td>
                        {{
                          formatMaterialCount(
                            drama.plannedMaterials,
                            drama.completedMaterials,
                          )
                        }}
                      </td>
                      <td>
                        <span
                          class="rating-badge"
                          :class="getRatingClass(drama.rating)"
                          >{{ drama.rating || "-" }}</span
                        >
                      </td>
                      <td>{{ formatCompletedAt(drama.completedAt) }}</td>
                      <td>{{ formatElapsedMinutes(drama.elapsedSeconds) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </NCollapseItem>
          </NCollapse>
        </NCard>
      </template>

      <NCard class="quick-card" title="快捷配置">
        <div v-if="config" class="config-groups">
          <div class="config-group-row">
            <div class="config-group half">
              <div class="group-header">
                <div class="group-title">基础路径、编码与输出</div>
                <div class="group-desc">
                  设置本地源目录与导出分辨率、音视频码率
                </div>
              </div>
              <div class="compact-grid">
                <div class="compact-field compact-field-wide">
                  <div class="compact-label">本地源目录</div>
                  <div class="compact-control compact-control-inline">
                    <NInput
                      :value="config.default_source_dir"
                      readonly
                      placeholder="选择本地源视频目录"
                    />
                    <NButton @click="selectDirectory('default_source_dir')"
                      >选择</NButton
                    >
                  </div>
                </div>
                <div class="compact-field compact-field-wide">
                  <div class="compact-label">输出分辨率</div>
                  <div class="compact-control">
                    <NSelect
                      :value="selectedResolution"
                      :options="resolutionOptions"
                      @update:value="updateResolution"
                    />
                  </div>
                </div>
                <div class="compact-field">
                  <div class="compact-label">视频码率</div>
                  <div class="compact-control">
                    <NInput
                      :value="getBitrateInputValue(config.video.bitrate)"
                      placeholder="例如 1104"
                      @update:value="updateVideoBitrate"
                    >
                      <template #suffix>K</template>
                    </NInput>
                  </div>
                </div>
                <div class="compact-field">
                  <div class="compact-label">音频码率</div>
                  <div class="compact-control">
                    <NInput
                      :value="getBitrateInputValue(config.audio.bitrate)"
                      placeholder="例如 128"
                      @update:value="updateAudioBitrate"
                    >
                      <template #suffix>K</template>
                    </NInput>
                  </div>
                </div>
              </div>
            </div>
            <div class="config-group half">
              <div class="group-header">
                <div class="group-title">功能开关与文本</div>
                <div class="group-desc">附加功能及视频内嵌文本设置</div>
              </div>
              <div class="compact-grid">
                <div class="switch-grid compact-field-wide">
                  <div class="switch-chip">
                    <span class="switch-chip-label">浮动水印</span>
                    <NSwitch
                      :value="config.enable_floating_watermark"
                      @update:value="
                        (value) =>
                          updateConfig((draft) => {
                            draft.enable_floating_watermark = value;
                          })
                      "
                    />
                  </div>
                  <div class="switch-chip">
                    <span class="switch-chip-label">首屏文案</span>
                    <NSwitch
                      :value="config.enable_hook_text"
                      @update:value="
                        (value) =>
                          updateConfig((draft) => {
                            draft.enable_hook_text = value;
                          })
                      "
                    />
                  </div>
                  <div class="switch-chip">
                    <span class="switch-chip-label">启用免责声明</span>
                    <NSwitch
                      :value="config.enable_disclaimer_text"
                      @update:value="
                        (value) =>
                          updateConfig((draft) => {
                            draft.enable_disclaimer_text = value;
                          })
                      "
                    />
                  </div>
                  <div class="switch-chip">
                    <span class="switch-chip-label">删除源视频</span>
                    <NSwitch
                      :value="config.auto_delete_source_after_completion"
                      @update:value="
                        (value) =>
                          updateConfig((draft) => {
                            draft.auto_delete_source_after_completion = value;
                          })
                      "
                    />
                  </div>
                  <div class="switch-chip">
                    <span class="switch-chip-label">AI 智能高光</span>
                    <NSwitch
                      :disabled="isAiHighlightReadonly"
                      :value="config.ai_highlight.enabled"
                      @update:value="
                        (value) =>
                          updateAiHighlightConfig((draft) => {
                            draft.ai_highlight.enabled = value;
                          })
                      "
                    />
                  </div>
                </div>

                <div class="compact-field compact-field-wide">
                  <div class="compact-label">免责声明文案</div>
                  <div class="compact-control">
                    <NInput
                      :value="config.disclaimer_text"
                      placeholder="剧情纯属虚构 请勿模仿"
                      @update:value="
                        (value) =>
                          updateConfig((draft) => {
                            draft.disclaimer_text = value;
                            if (value.trim()) {
                              draft.enable_disclaimer_text = true;
                            }
                          })
                      "
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </NCard>

      <NCard
        v-if="config && showAiHighlightCard"
        class="quick-card ai-highlight-card"
        title="AI 智能高光"
      >
        <template #header-extra>
          <NSpace>
            <NButton
              quaternary
              :disabled="
                isAiHighlightReadonly || runningAiHighlight || resolvingConfig
              "
              :loading="refreshingAiHighlight"
              @click="refreshAiHighlightQueue"
            >
              刷新待识别
            </NButton>
            <NButton
              type="primary"
              secondary
              :loading="runningAiHighlight"
              :disabled="isAiHighlightReadonly || resolvingConfig"
              @click="startAiHighlightRecognition"
            >
              开始识别
            </NButton>
          </NSpace>
        </template>

        <NAlert
          v-if="isAiHighlightReadonly"
          type="warning"
          :show-icon="false"
          style="margin-bottom: 16px"
        >
          AI 智能高光当前仅管理员可配置和启动。
        </NAlert>

        <div class="ai-highlight-hero">
          <div class="ai-highlight-summary">{{ aiHighlightSummary }}</div>
        </div>

        <div class="ai-highlight-stats">
          <div class="ai-stat-chip">
            <span class="ai-stat-label">待剪辑剧</span>
            <span class="ai-stat-value">{{
              aiHighlightState.totalPending
            }}</span>
          </div>
          <div class="ai-stat-chip">
            <span class="ai-stat-label">已匹配本地</span>
            <span class="ai-stat-value">{{
              aiHighlightState.matchedCount
            }}</span>
          </div>
          <div class="ai-stat-chip">
            <span class="ai-stat-label">未匹配</span>
            <span class="ai-stat-value">{{
              aiHighlightState.unmatchedCount
            }}</span>
          </div>
          <div class="ai-stat-chip ai-stat-chip-wide">
            <span class="ai-stat-label">最近更新</span>
            <span class="ai-stat-value">{{
              formatDateTime(aiHighlightState.lastUpdatedAt)
            }}</span>
          </div>
        </div>

        <div class="ai-highlight-panels">
          <div class="config-group-row">
            <div class="config-group half ai-highlight-panel">
              <div class="group-header ai-highlight-panel-header">
                <div class="group-title">模型与鉴权</div>
              </div>
              <div class="compact-grid">
                <div class="compact-field compact-field-wide">
                  <div class="label-row">
                    <div class="compact-label">分析模型</div>
                    <NTooltip trigger="hover">
                      <template #trigger>
                        <span class="tip-trigger">?</span>
                      </template>
                      `flash` 更快，`plus` 更均衡，`max` 更偏向效果。
                    </NTooltip>
                  </div>
                  <div class="compact-control">
                    <NSelect
                      class="rounded-select"
                      :disabled="isAiHighlightReadonly"
                      :value="config.ai_highlight.model_name"
                      :options="aiModelOptions"
                      @update:value="
                        (value) =>
                          updateAiHighlightConfig((draft) => {
                            draft.ai_highlight.model_name =
                              value || 'qwen3-vl-plus';
                          })
                      "
                    />
                  </div>
                </div>
                <div class="compact-field compact-field-wide">
                  <div class="label-row">
                    <div class="compact-label">API-KEY</div>
                    <NTooltip trigger="hover">
                      <template #trigger>
                        <span class="tip-trigger">?</span>
                      </template>
                      用于调用 DashScope 视频理解模型；未填写时不会启动识别。
                    </NTooltip>
                  </div>
                  <div class="compact-control">
                    <NInput
                      :disabled="isAiHighlightReadonly"
                      type="password"
                      show-password-on="click"
                      :value="config.ai_highlight.dashscope_api_key"
                      placeholder="用于调用模型分析视频"
                      @update:value="
                        (value) =>
                          updateAiHighlightConfig((draft) => {
                            draft.ai_highlight.dashscope_api_key = value;
                          })
                      "
                    />
                  </div>
                </div>
              </div>
            </div>

            <div class="config-group half ai-highlight-panel">
              <div class="group-header ai-highlight-panel-header">
                <div class="group-title">识别参数</div>
              </div>
              <div class="compact-grid">
                <div class="switch-grid compact-field-wide">
                  <div class="switch-chip">
                    <div class="switch-chip-copy">
                      <span class="switch-chip-label">仅识别红标剧</span>
                      <NTooltip trigger="hover">
                        <template #trigger>
                          <span class="tip-trigger">?</span>
                        </template>
                        开启后，只从飞书待剪辑且评级为红标的剧中做匹配。
                      </NTooltip>
                    </div>
                    <NSwitch
                      :disabled="isAiHighlightReadonly"
                      :value="config.ai_highlight.only_priority_rating"
                      @update:value="
                        (value) =>
                          updateAiHighlightConfig((draft) => {
                            draft.ai_highlight.only_priority_rating = value;
                          })
                      "
                    />
                  </div>
                </div>
                <div class="compact-field">
                  <div class="label-row">
                    <div class="compact-label">目标起始点数</div>
                    <NTooltip trigger="hover">
                      <template #trigger>
                        <span class="tip-trigger">?</span>
                      </template>
                      最终希望每部剧保留下来的高光起始点数量。
                    </NTooltip>
                  </div>
                  <div class="compact-control">
                    <NInput
                      :disabled="isAiHighlightReadonly"
                      :value="
                        String(config.ai_highlight.target_highlights_per_drama)
                      "
                      @update:value="
                        (value) =>
                          updateAiHighlightConfig((draft) => {
                            draft.ai_highlight.target_highlights_per_drama =
                              Number(value) || 1;
                          })
                      "
                    />
                  </div>
                </div>
                <div class="compact-field">
                  <div class="label-row">
                    <div class="compact-label">每组额外候选数</div>
                    <NTooltip trigger="hover">
                      <template #trigger>
                        <span class="tip-trigger">?</span>
                      </template>
                      每组分析时会额外多要几个候选点，防止后面去重后数量不够。
                    </NTooltip>
                  </div>
                  <div class="compact-control">
                    <NInput
                      :disabled="isAiHighlightReadonly"
                      :value="
                        String(config.ai_highlight.group_highlight_buffer)
                      "
                      @update:value="
                        (value) =>
                          updateAiHighlightConfig((draft) => {
                            draft.ai_highlight.group_highlight_buffer =
                              Number(value) || 0;
                          })
                      "
                    />
                  </div>
                </div>
                <div class="compact-field">
                  <div class="label-row">
                    <div class="compact-label">采样 FPS</div>
                    <NTooltip trigger="hover">
                      <template #trigger>
                        <span class="tip-trigger">?</span>
                      </template>
                      模型看视频时的采样密度，越高越细，但识别会更慢。
                    </NTooltip>
                  </div>
                  <div class="compact-control">
                    <NInput
                      :disabled="isAiHighlightReadonly"
                      :value="String(config.ai_highlight.video_fps)"
                      @update:value="
                        (value) =>
                          updateAiHighlightConfig((draft) => {
                            draft.ai_highlight.video_fps = Number(value) || 1;
                          })
                      "
                    />
                  </div>
                </div>
                <div class="compact-field">
                  <div class="label-row">
                    <div class="compact-label">前段分析比例</div>
                    <NTooltip trigger="hover">
                      <template #trigger>
                        <span class="tip-trigger">?</span>
                      </template>
                      仅在“只看每集前半段”开启时生效，表示每集前多少比例会送去分析。
                    </NTooltip>
                  </div>
                  <div class="compact-control">
                    <NInput
                      :disabled="
                        isAiHighlightReadonly ||
                        !config.ai_highlight.analyze_first_portion_only
                      "
                      :value="String(config.ai_highlight.analyze_portion_ratio)"
                      @update:value="
                        (value) =>
                          updateAiHighlightConfig((draft) => {
                            draft.ai_highlight.analyze_portion_ratio =
                              Number(value) || 0.3;
                          })
                      "
                    />
                  </div>
                </div>
                <div class="compact-field">
                  <div class="label-row">
                    <div class="compact-label">最多补跑轮数</div>
                    <NTooltip trigger="hover">
                      <template #trigger>
                        <span class="tip-trigger">?</span>
                      </template>
                      自动补跑开启后，如果候选点不足，最多再补跑多少轮。
                    </NTooltip>
                  </div>
                  <div class="compact-control">
                    <NInput
                      :disabled="
                        isAiHighlightReadonly ||
                        !config.ai_highlight.auto_retry_insufficient_groups
                      "
                      :value="String(config.ai_highlight.max_auto_retry_rounds)"
                      @update:value="
                        (value) =>
                          updateAiHighlightConfig((draft) => {
                            draft.ai_highlight.max_auto_retry_rounds =
                              Number(value) || 0;
                          })
                      "
                    />
                  </div>
                </div>
                <div class="switch-grid compact-field-wide">
                  <div class="switch-chip">
                    <div class="switch-chip-copy">
                      <span class="switch-chip-label">只看每集前半段</span>
                      <NTooltip trigger="hover">
                        <template #trigger>
                          <span class="tip-trigger">?</span>
                        </template>
                        更适合短剧开场型高光，能减少上传体积并加快识别。
                      </NTooltip>
                    </div>
                    <NSwitch
                      :disabled="isAiHighlightReadonly"
                      :value="config.ai_highlight.analyze_first_portion_only"
                      @update:value="
                        (value) =>
                          updateAiHighlightConfig((draft) => {
                            draft.ai_highlight.analyze_first_portion_only =
                              value;
                          })
                      "
                    />
                  </div>
                  <div class="switch-chip">
                    <div class="switch-chip-copy">
                      <span class="switch-chip-label">自动补跑缺口组</span>
                      <NTooltip trigger="hover">
                        <template #trigger>
                          <span class="tip-trigger">?</span>
                        </template>
                        某些分组返回候选点太少时，自动拆小组再补跑一轮。
                      </NTooltip>
                    </div>
                    <NSwitch
                      :disabled="isAiHighlightReadonly"
                      :value="
                        config.ai_highlight.auto_retry_insufficient_groups
                      "
                      @update:value="
                        (value) =>
                          updateAiHighlightConfig((draft) => {
                            draft.ai_highlight.auto_retry_insufficient_groups =
                              value;
                          })
                      "
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="table-container ai-highlight-table">
          <table class="beautiful-table">
            <thead>
              <tr>
                <th width="60">序号</th>
                <th width="100">日期</th>
                <th>剧名</th>
                <th width="90">状态</th>
                <th width="90">起始点数</th>
                <th>结果 / 消息</th>
                <th width="180">最近更新</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="matchedAiHighlightDramas.length === 0">
                <td colspan="7" class="text-center" style="color: #8c8f97">
                  当前没有匹配到本地源素材目录的待剪辑剧
                </td>
              </tr>
              <tr
                v-for="drama in matchedAiHighlightDramas"
                :key="`${drama.recordId}-${drama.order}`"
              >
                <td class="text-center">{{ drama.order }}</td>
                <td>
                  {{
                    drama.date === "未知" || drama.date === "未知日期"
                      ? "-"
                      : drama.date
                  }}
                </td>
                <td class="font-medium">{{ drama.dramaName }}</td>
                <td>
                  <span
                    class="ai-status-badge"
                    :class="getAiHighlightStatusClass(drama.status)"
                  >
                    {{ getAiHighlightStatusLabel(drama.status) }}
                  </span>
                </td>
                <td>{{ drama.highlightCount || "-" }}</td>
                <td style="white-space: pre-line">
                  {{ drama.highlightStartPoints || drama.message }}
                </td>
                <td>{{ formatDateTime(drama.updatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </NCard>

      <NCollapse class="advanced-collapse" :default-expanded-names="[]">
        <NCollapseItem title="手动剪辑" name="manual">
          <NCard class="manual-card" :bordered="false">
            <div
              v-if="config"
              class="manual-config-row"
              style="margin-bottom: 16px"
            >
              <NForm inline>
                <NFormItem label="输出目录">
                  <NInput
                    :value="config.output_dir"
                    readonly
                    placeholder="选择素材输出目录"
                    style="width: 300px"
                  />
                  <NButton
                    style="margin-left: 12px"
                    @click="selectDirectory('output_dir')"
                    >选择</NButton
                  >
                </NFormItem>
              </NForm>
            </div>
            <div class="manual-row">
              <NInput
                v-model:value="manualDramaNames"
                type="textarea"
                :rows="3"
                placeholder="输入要剪辑的剧名，支持逗号或换行分隔"
              />
              <NButton
                type="primary"
                secondary
                :loading="isManualRunning"
                :disabled="resolvingConfig"
                @click="startManualClip"
              >
                开始剪辑
              </NButton>
            </div>
          </NCard>
        </NCollapseItem>

        <NCollapseItem
          title="完整配置 JSON（所有配置项开放）"
          name="json-config"
        >
          <div class="editor-panel">
            <NInput
              v-model:value="configEditorText"
              type="textarea"
              :rows="28"
              placeholder="在这里直接编辑完整配置 JSON"
            />
          </div>
        </NCollapseItem>

        <NCollapseItem title="运行日志" name="logs">
          <NCard class="log-card" :bordered="false">
            <template #header-extra>
              <NSpace>
                <NButton size="small" quaternary @click="toggleLogs">
                  {{ showLogs ? "隐藏" : "展开" }}
                </NButton>
                <NButton size="small" quaternary @click="clearLogs"
                  >清空</NButton
                >
              </NSpace>
            </template>
            <div v-show="showLogs" class="log-container">
              <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
              <div v-for="(log, index) in logs" :key="index" class="log-item">
                <span class="log-time">[{{ log.time }}]</span>
                <span class="log-message">{{ log.message }}</span>
              </div>
            </div>
          </NCard>
        </NCollapseItem>
      </NCollapse>
    </template>
  </div>
</template>

<style scoped>
.material-clip-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.overview-card,
.quick-card,
.manual-card,
.status-card,
.advanced-collapse {
  background: #fff;
}

.hero-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.hero-actions {
  justify-content: flex-end;
}

.hero-action-btn {
  border-radius: 999px;
}

.hero-title {
  font-size: 24px;
  font-weight: 700;
  color: #1f2937;
}

.hero-subtitle {
  margin-top: 8px;
  max-width: 780px;
  color: #667085;
  line-height: 1.6;
}

.polling-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}

.hint-card {
  border-radius: 12px;
}

.check-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.check-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f8fafc;
}

.check-badge {
  min-width: 56px;
  border-radius: 999px;
  padding: 4px 10px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
}

.check-badge.passed {
  background: #dcfce7;
  color: #166534;
}

.check-badge.failed {
  background: #fee2e2;
  color: #991b1b;
}

.check-content {
  flex: 1;
}

.check-label {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.check-detail {
  margin-top: 4px;
  color: #6b7280;
  line-height: 1.6;
  word-break: break-all;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.field-row-wide {
  grid-column: 1 / -1;
}

.field-row-switch {
  justify-content: space-between;
  padding-right: 12px;
}

.field-label {
  width: 92px;
  flex-shrink: 0;
  color: #344054;
  font-size: 14px;
  font-weight: 500;
}

.queue-header {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.manual-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.advanced-collapse {
  border-radius: 12px;
}

.advanced-collapse :deep(.n-collapse-item__header) {
  padding: 16px 18px !important;
  font-weight: 600;
}

.editor-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.editor-panel :deep(textarea) {
  font-family: "SFMono-Regular", "Monaco", "Menlo", monospace;
  font-size: 12px;
  line-height: 1.6;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
}

.log-card {
  background: transparent;
}

.log-container {
  max-height: 320px;
  overflow-y: auto;
  border-radius: 10px;
  background: #111827;
  color: #e5e7eb;
  padding: 14px;
  font-family: "SFMono-Regular", "Monaco", "Menlo", monospace;
  font-size: 12px;
  line-height: 1.7;
}

.log-empty {
  color: #6b7280;
  text-align: center;
  padding: 24px 0;
}

.log-item {
  margin-bottom: 2px;
}

.log-time {
  color: #34d399;
}

.log-message {
  margin-left: 8px;
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
  display: flex;
  flex-direction: column;
}

.config-group-row {
  display: flex;
  gap: 24px;
  align-items: stretch;
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

.config-group :deep(.n-form-item-label__text) {
  white-space: nowrap;
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
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  letter-spacing: 0.02em;
}

.label-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
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

.switch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.switch-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 54px;
  padding: 10px 14px;
  border: 1px solid #e8eef6;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.switch-chip-copy {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.switch-chip-label {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.ai-highlight-card {
  background:
    radial-gradient(
      circle at top right,
      rgba(59, 130, 246, 0.06),
      transparent 22%
    ),
    linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
}

.ai-highlight-hero {
  margin-bottom: 18px;
  padding: 18px 20px 16px;
  border: 1px solid #e6edf8;
  border-radius: 18px;
  background: linear-gradient(135deg, #fcfdff 0%, #f4f8ff 100%);
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.04);
}

.ai-highlight-summary {
  font-size: 18px;
  font-weight: 700;
  color: #1e40af;
}

.ai-highlight-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.ai-stat-chip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid #e8eef6;
  background: #ffffff;
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.035);
}

.ai-stat-chip-wide {
  min-width: 0;
}

.ai-stat-label {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}

.ai-stat-value {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}

.ai-highlight-panels {
  margin-bottom: 18px;
}

.ai-highlight-panel {
  border: 1px solid #e8eef6;
  border-radius: 18px;
  background: linear-gradient(180deg, #ffffff 0%, #fcfdff 100%);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.035);
  padding: 22px 22px 20px;
}

.ai-highlight-panel-header {
  margin-bottom: 18px;
}

.tip-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid #d8e2f0;
  background: #f8fbff;
  color: #7c8aa5;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  cursor: help;
  transition:
    border-color 0.2s ease,
    color 0.2s ease,
    background 0.2s ease;
}

.tip-trigger:hover {
  border-color: #93c5fd;
  color: #2563eb;
  background: #eff6ff;
}

.ai-highlight-table {
  margin-top: 0;
}

/* Status Card Styles */
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
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
}

.drama-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.drama-name {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}

.drama-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  background: #e2e8f0;
  color: #475569;
}

.drama-tag.rating.default {
  background: #f1f5f9;
  color: #64748b;
}

.drama-tag.rating.yellow {
  background: #fef3c7;
  color: #d97706;
}

.drama-tag.rating.red {
  background: #fee2e2;
  color: #dc2626;
}

.drama-tag.rating.green {
  background: #dcfce7;
  color: #16a34a;
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

.progress-chip .remaining {
  color: #f59e0b;
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

.pending-dramas-section {
  margin-top: 20px;
}

.status-collapse {
  margin-top: 20px;
  background: transparent;
}

.status-collapse :deep(.n-collapse-item) {
  background: transparent;
}

.status-collapse :deep(.n-collapse-item__header) {
  padding: 8px 6px 12px !important;
  font-size: 14px;
  font-weight: 600;
  color: #475569;
}

.status-collapse :deep(.n-collapse-item-arrow) {
  margin-right: 12px;
}

.status-collapse :deep(.n-collapse-item__header-main) {
  min-width: 0;
}

.status-collapse :deep(.n-collapse-item__content-inner) {
  padding-top: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}

.table-container {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.beautiful-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
}

.beautiful-table th {
  background: #f8fafc;
  padding: 12px 16px;
  font-weight: 600;
  color: #475569;
  border-bottom: 1px solid #e2e8f0;
}

.beautiful-table td {
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  color: #1e293b;
}

.beautiful-table tr:last-child td {
  border-bottom: none;
}

.beautiful-table tr:hover td {
  background: #f1f5f9;
}

.text-center {
  text-align: center;
}

.font-medium {
  font-weight: 500;
}

.rating-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  background: #f1f5f9;
  color: #64748b;
}

.rating-badge.red {
  background: #fee2e2;
  color: #dc2626;
}

.rating-badge.yellow {
  background: #ffedd5;
  color: #f59e0b;
}

.rating-badge.green {
  background: #dcfce7;
  color: #10b981;
}

.ai-status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 64px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.ai-status-badge.pending {
  background: rgba(15, 23, 42, 0.08);
  color: #475569;
}

.ai-status-badge.running {
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}

.ai-status-badge.success {
  background: rgba(24, 160, 88, 0.12);
  color: #166534;
}

.ai-status-badge.failed {
  background: rgba(220, 38, 38, 0.12);
  color: #b91c1c;
}

.ai-status-badge.muted {
  background: rgba(100, 116, 139, 0.12);
  color: #64748b;
}

.rounded-select :deep(.n-base-selection) {
  border-radius: 12px;
}

.rounded-select :deep(.n-base-selection-label),
.rounded-select :deep(.n-base-selection-placeholder) {
  border-radius: 12px;
}

.rounded-select :deep(.n-base-selection) {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

@media (max-width: 900px) {
  .hero-row,
  .manual-row {
    grid-template-columns: 1fr;
    display: grid;
  }

  .config-group-row {
    flex-direction: column;
  }

  .compact-grid,
  .switch-grid,
  .compact-control-inline {
    grid-template-columns: 1fr;
  }

  .ai-highlight-stats {
    grid-template-columns: 1fr 1fr;
  }

  .quick-grid {
    grid-template-columns: 1fr;
  }

  .progress-meta {
    flex-direction: column;
    align-items: stretch;
  }

  .field-row,
  .field-row-switch {
    align-items: flex-start;
    flex-direction: column;
  }

  .field-label {
    width: auto;
  }
}
</style>
