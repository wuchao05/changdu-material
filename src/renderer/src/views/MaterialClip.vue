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
  NSpace,
  NSwitch,
  useMessage,
} from "naive-ui";

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

interface MaterialClipConfig {
  active_user: string | null;
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
  }>;
  currentDramaName: string | null;
  currentDramaDate: string | null;
  currentDramaRating: string | null;
  currentRecordId: string | null;
  totalMaterials: number;
  completedMaterials: number;
  remainingMaterials: number;
  startedAt: string | null;
  lastUpdatedAt: string | null;
}

const importingRuntime = ref(false);

const message = useMessage();

const envChecking = ref(true);
const installingEnvironment = ref(false);
const isAutoRunning = ref(false);
const isManualRunning = ref(false);
const saving = ref(false);
const showLogs = ref(true);
const manualDramaNames = ref("");
const logs = ref<MaterialClipLogEntry[]>([]);
const config = ref<MaterialClipConfig | null>(null);
const configEditorText = ref("");
const environmentStatus = ref<MaterialClipEnvironmentStatus | null>(null);

const runState = ref<MaterialClipRunState>({
  running: false,
  status: "idle",
  mode: "idle",
  message: "",
  pid: null,
  pendingDramas: [],
  currentDramaName: null,
  currentDramaDate: null,
  currentDramaRating: null,
  currentRecordId: null,
  totalMaterials: 0,
  completedMaterials: 0,
  remainingMaterials: 0,
  startedAt: null,
  lastUpdatedAt: null,
});

const hasQueueData = computed(() => runState.value.pendingDramas.length > 0);

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
    return state.mode === "auto" ? "自动剪辑运行中..." : "手动剪辑运行中...";
  }

  if (hasQueueData.value) {
    return `已同步待剪辑队列，共 ${state.pendingDramas.length} 部剧`;
  }

  return "等待开始剪辑";
});

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

const prettyConfig = computed(() => configEditorText.value.trim());

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

async function loadConfig() {
  try {
    config.value = await window.api.getClipConfig();
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

async function saveConfig(): Promise<boolean> {
  if (!prettyConfig.value) {
    message.warning("配置内容不能为空");
    return false;
  }

  saving.value = true;
  try {
    const parsed = JSON.parse(prettyConfig.value) as MaterialClipConfig;
    config.value = await window.api.saveClipConfig(parsed);
    syncEditorFromConfig();
    message.success("素材剪辑配置已保存");
    return true;
  } catch (error) {
    message.error(`保存配置失败: ${error}`);
    return false;
  } finally {
    saving.value = false;
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

async function startAutoClip() {
  if (isAutoRunning.value) {
    return;
  }

  const saved = await saveConfig();
  if (!saved || !config.value) {
    return;
  }

  isAutoRunning.value = true;
  try {
    const result = await window.api.clipAutoRun();
    if (result.success) {
      message.success("自动剪辑任务已启动");
      showLogs.value = true;
    } else {
      message.error(result.error || "自动剪辑启动失败");
    }
  } catch (error) {
    message.error(`自动剪辑启动失败: ${error}`);
  } finally {
    // isAutoRunning will be updated by state listener
  }
}

async function stopAutoClip() {
  try {
    const result = await window.api.clipStopAutoRun();
    if (!result.success) {
      message.error(result.error || "停止自动剪辑失败");
      return;
    }
    message.success("已发送停止指令，等待当前任务完成...");
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

  const saved = await saveConfig();
  if (!saved) {
    return;
  }

  isManualRunning.value = true;
  try {
    const result = await window.api.clipManualRun(input);
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
  await loadLogs();
  await loadEnvironmentStatus();
  if (environmentStatus.value?.ready) {
    await loadConfig();
  }
  await loadRunState();

  unsubscribeLog = window.api.onClipLog((log) => {
    logs.value.push(log);
    if (logs.value.length > 500) {
      logs.value.shift();
    }
  });

  unsubscribeState = window.api.onClipState((state) => {
    runState.value = state;
    isAutoRunning.value =
      (state.status === "running" || state.status === "stopping") &&
      state.mode === "auto";
    isManualRunning.value =
      state.status === "running" && state.mode === "manual";
  });
});

onUnmounted(() => {
  if (unsubscribeLog) {
    unsubscribeLog();
  }
  if (unsubscribeState) {
    unsubscribeState();
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
          <div>
            <div class="hero-title">素材剪辑</div>
            <div class="hero-subtitle">
              复用当前客户端的飞书配置，调用 `dramas_processor`
              完成待剪辑查询、本地源视频匹配和批量剪辑。
            </div>
          </div>
          <NSpace>
            <NButton @click="loadEnvironmentStatus">重新检测</NButton>
            <NButton
              :loading="importingRuntime"
              :disabled="installingEnvironment || isAutoRunning || isManualRunning"
              @click="importRuntime"
            >
              重新导入运行时
            </NButton>
            <NButton :loading="saving" @click="saveConfig">保存配置</NButton>
            <NButton
              v-if="!isAutoRunning"
              type="primary"
              @click="startAutoClip"
            >
              自动剪辑
            </NButton>
            <NButton
              v-else
              type="error"
              :loading="runState.status === 'stopping'"
              @click="stopAutoClip"
            >
              停止自动剪辑
            </NButton>
          </NSpace>
        </div>
      </NCard>

      <template v-if="runState.status !== 'idle' || hasQueueData">
        <NCard class="status-card" title="运行状态">
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
              <div class="progress-text">
                <span
                  >素材进度: {{ runState.completedMaterials }} /
                  {{ runState.totalMaterials }}</span
                >
                <span v-if="runState.remainingMaterials > 0" class="remaining"
                  >剩余: {{ runState.remainingMaterials }}</span
                >
              </div>
              <div class="progress-bar-container">
                <div
                  class="progress-bar"
                  :style="{ width: `${progressPercent}%` }"
                ></div>
              </div>
            </div>
          </div>

          <div
            v-if="runState.pendingDramas && runState.pendingDramas.length > 0"
            class="pending-dramas-section"
          >
            <div class="section-title">
              待处理剧目 ({{ runState.pendingDramas.length }})
            </div>
            <div class="table-container">
              <table class="beautiful-table">
                <thead>
                  <tr>
                    <th width="60">序号</th>
                    <th width="120">日期</th>
                    <th>剧名</th>
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
          </div>
        </NCard>
      </template>

      <NCard class="quick-card" title="快捷配置">
        <div v-if="config" class="config-groups">
          <div class="config-group-row">
            <div class="config-group half">
              <div class="group-header">
                <div class="group-title">基础路径与飞书</div>
                <div class="group-desc">设置本地视频源及飞书多维表格关联</div>
              </div>
              <div class="group-content">
                <NForm
                  label-placement="left"
                  label-width="120"
                  require-mark-placement="right-hanging"
                >
                  <NFormItem label="本地源目录">
                    <NInput
                      :value="config.default_source_dir"
                      readonly
                      placeholder="选择本地源视频目录"
                    />
                    <NButton
                      style="margin-left: 12px"
                      @click="selectDirectory('default_source_dir')"
                      >选择</NButton
                    >
                  </NFormItem>
                  <NFormItem label="飞书 Table ID">
                    <NInput
                      :value="config.feishu.table_id"
                      placeholder="自动剪辑要查询的飞书多维表格 ID"
                      @update:value="
                        (value) =>
                          updateConfig((draft) => {
                            draft.feishu.table_id = value;
                          })
                      "
                    />
                  </NFormItem>
                </NForm>
              </div>
            </div>

            <div class="config-group half">
              <div class="group-header">
                <div class="group-title">功能开关与文本</div>
                <div class="group-desc">附加功能及视频内嵌文本设置</div>
              </div>
              <div class="group-content">
                <NForm
                  label-placement="left"
                  label-width="120"
                  require-mark-placement="right-hanging"
                >
                  <NFormItem label="浮动水印">
                    <NSwitch
                      :value="config.enable_floating_watermark"
                      @update:value="
                        (value) =>
                          updateConfig((draft) => {
                            draft.enable_floating_watermark = value;
                          })
                      "
                    />
                  </NFormItem>
                  <NFormItem label="首屏文案">
                    <NSwitch
                      :value="config.enable_hook_text"
                      @update:value="
                        (value) =>
                          updateConfig((draft) => {
                            draft.enable_hook_text = value;
                          })
                      "
                    />
                  </NFormItem>
                  <NFormItem label="启用免责声明">
                    <NSwitch
                      :value="config.enable_disclaimer_text"
                      @update:value="
                        (value) =>
                          updateConfig((draft) => {
                            draft.enable_disclaimer_text = value;
                          })
                      "
                    />
                  </NFormItem>
                  <NFormItem label="删除源视频">
                    <NSwitch
                      :value="config.auto_delete_source_after_completion"
                      @update:value="
                        (value) =>
                          updateConfig((draft) => {
                            draft.auto_delete_source_after_completion = value;
                          })
                      "
                    />
                  </NFormItem>
                  <NFormItem label="免责声明文案">
                    <NInput
                      type="textarea"
                      :rows="3"
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
                  </NFormItem>
                </NForm>
              </div>
            </div>
          </div>
        </div>
      </NCard>

      <NCard class="manual-card" title="手动剪辑">
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
            @click="startManualClip"
          >
            开始剪辑
          </NButton>
        </div>
      </NCard>

      <NCollapse class="advanced-collapse" :default-expanded-names="['logs']">
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
            <div class="editor-actions">
              <NButton :loading="saving" type="primary" @click="saveConfig"
                >保存完整配置</NButton
              >
            </div>
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
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

.config-group :deep(.n-form-item-label__text) {
  white-space: nowrap;
}

/* Status Card Styles */
.status-header {
  margin-bottom: 16px;
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
  gap: 8px;
}

.progress-text {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #64748b;
}

.progress-text .remaining {
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

@media (max-width: 900px) {
  .hero-row,
  .manual-row {
    grid-template-columns: 1fr;
    display: grid;
  }

  .config-group-row {
    flex-direction: column;
  }

  .quick-grid {
    grid-template-columns: 1fr;
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
