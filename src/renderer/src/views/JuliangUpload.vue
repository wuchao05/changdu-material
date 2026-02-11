<script setup lang="ts">
defineOptions({ name: "JuliangUpload" });
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  NCard,
  NButton,
  NSpace,
  NAlert,
  NSpin,
  NStatistic,
  NGrid,
  NGi,
  NProgress,
  NTag,
  NEmpty,
  NInput,
  NInputNumber,
  NSwitch,
  NCollapse,
  NCollapseItem,
  NDescriptions,
  NDescriptionsItem,
  useMessage,
} from "naive-ui";

const message = useMessage();

// 状态
const isInitializing = ref(false);
const isReady = ref(false);
const isUploading = ref(false);
const needLogin = ref(false);

// 配置
const config = ref({
  baseUploadUrl: "",
  batchSize: 20,
  batchDelayMin: 3000,
  batchDelayMax: 5000,
  headless: false,
  slowMo: 50,
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

// 测试用任务配置
const testAccountId = ref("");
const testDrama = ref("");
const testFilesPath = ref("");

// 日志
const logs = ref<Array<{ time: string; message: string }>>([]);
const showLogs = ref(false);

// 进度监听器
let unsubscribeProgress: (() => void) | null = null;
let unsubscribeLog: (() => void) | null = null;

// 初始化浏览器
async function initializeBrowser() {
  if (isInitializing.value) return;

  isInitializing.value = true;
  try {
    const result = await window.api.juliangInitialize();
    if (result.success) {
      isReady.value = true;
      message.success("浏览器初始化成功");

      // 检查登录状态
      await checkLoginStatus();
    } else {
      message.error(`初始化失败: ${result.error}`);
    }
  } catch (error) {
    message.error(`初始化失败: ${error}`);
  } finally {
    isInitializing.value = false;
  }
}

// 关闭浏览器
async function closeBrowser() {
  try {
    await window.api.juliangClose();
    isReady.value = false;
    needLogin.value = false;
    message.info("浏览器已关闭");
  } catch (error) {
    message.error(`关闭失败: ${error}`);
  }
}

// 检查登录状态
async function checkLoginStatus() {
  if (!isReady.value) return;

  try {
    // 先导航到上传页面
    if (testAccountId.value) {
      await window.api.juliangNavigate(testAccountId.value);
    }

    const result = await window.api.juliangCheckLogin();
    needLogin.value = result.needLogin;

    if (result.isLoggedIn) {
      message.success("已检测到登录状态");
    } else {
      message.warning("请在浏览器窗口中登录巨量创意后台");
    }
  } catch (error) {
    message.error(`检查登录状态失败: ${error}`);
  }
}

// 加载配置
async function loadConfig() {
  try {
    const cfg = await window.api.juliangGetConfig();
    config.value = { ...config.value, ...cfg };
  } catch (error) {
    console.error("加载配置失败:", error);
  }
}

// 保存配置
async function saveConfig() {
  try {
    await window.api.juliangUpdateConfig(config.value);
    message.success("配置已保存");
  } catch (error) {
    message.error(`保存配置失败: ${error}`);
  }
}

// 选择文件夹
async function selectFolder() {
  try {
    const folder = await window.api.selectFolder();
    if (folder) {
      testFilesPath.value = folder;
    }
  } catch (error) {
    message.error(`选择文件夹失败: ${error}`);
  }
}

// 开始测试上传
async function startTestUpload() {
  if (!isReady.value) {
    message.warning("请先初始化浏览器");
    return;
  }

  if (!testAccountId.value) {
    message.warning("请输入账户 ID");
    return;
  }

  if (!testFilesPath.value) {
    message.warning("请选择素材文件夹");
    return;
  }

  isUploading.value = true;

  try {
    // 扫描文件夹获取视频文件
    const materials = await window.api.scanVideos(testFilesPath.value);
    if (materials.length === 0) {
      message.warning("文件夹中没有找到视频文件");
      return;
    }

    const filePaths = materials.map((m: { filePath: string }) => m.filePath);

    // 创建任务
    const task = {
      id: `test-${Date.now()}`,
      drama: testDrama.value || "测试剧集",
      date: new Date().toISOString().split("T")[0],
      account: "测试账户",
      accountId: testAccountId.value,
      files: filePaths,
      recordId: "",
      status: "pending",
    };

    message.info(`开始上传 ${filePaths.length} 个文件`);

    // 执行上传
    const result = await window.api.juliangUploadTask(task);

    if (result.success) {
      message.success(
        `上传完成: ${result.successCount}/${result.totalFiles} 个文件成功`
      );
    } else {
      message.error(`上传失败: ${result.error}`);
    }
  } catch (error) {
    message.error(`上传失败: ${error}`);
  } finally {
    isUploading.value = false;
    currentTask.value = null;
  }
}

// 获取截图
async function getScreenshot() {
  try {
    const base64 = await window.api.juliangGetScreenshot();
    if (base64) {
      // 创建一个新窗口显示截图
      const img = document.createElement("img");
      img.src = `data:image/png;base64,${base64}`;
      img.style.maxWidth = "100%";

      const win = window.open("", "_blank");
      if (win) {
        win.document.body.appendChild(img);
      }
    } else {
      message.warning("无法获取截图");
    }
  } catch (error) {
    message.error(`获取截图失败: ${error}`);
  }
}

// 状态文本
const statusText = computed(() => {
  if (isInitializing.value) return "正在初始化...";
  if (!isReady.value) return "未初始化";
  if (needLogin.value) return "需要登录";
  if (isUploading.value) return "上传中";
  return "就绪";
});

// 状态类型
const statusType = computed(() => {
  if (isInitializing.value) return "info";
  if (!isReady.value) return "default";
  if (needLogin.value) return "warning";
  if (isUploading.value) return "info";
  return "success";
});

// 加载历史日志
async function loadLogs() {
  try {
    logs.value = await window.api.juliangGetLogs();
  } catch (error) {
    console.error("加载日志失败:", error);
  }
}

// 清空日志
async function clearLogs() {
  try {
    await window.api.juliangClearLogs();
    logs.value = [];
    message.success("日志已清空");
  } catch (error) {
    message.error(`清空日志失败: ${error}`);
  }
}

// 切换日志显示
async function toggleLogs() {
  showLogs.value = !showLogs.value;
  if (showLogs.value) {
    await loadLogs();
  }
}

onMounted(async () => {
  // 加载配置
  await loadConfig();

  // 检查是否已初始化
  const ready = await window.api.juliangIsReady();
  isReady.value = ready;

  // 监听上传进度
  unsubscribeProgress = window.api.onJuliangUploadProgress((progress) => {
    currentTask.value = progress;
  });

  // 监听实时日志
  unsubscribeLog = window.api.onJuliangLog((log) => {
    logs.value.push(log);
    // 限制日志数量
    if (logs.value.length > 500) {
      logs.value.shift();
    }
  });
});

onUnmounted(() => {
  if (unsubscribeProgress) {
    unsubscribeProgress();
  }
  if (unsubscribeLog) {
    unsubscribeLog();
  }
});
</script>

<template>
  <div class="juliang-page">
    <NCard title="巨量创意上传" size="small">
      <template #header-extra>
        <NSpace>
          <NTag :type="statusType">{{ statusText }}</NTag>
        </NSpace>
      </template>

      <!-- 状态统计 -->
      <NGrid :cols="4" :x-gap="12" style="margin-bottom: 20px">
        <NGi>
          <NStatistic label="浏览器状态">
            <template #default>
              <span :style="{ color: isReady ? '#18a058' : '#999' }">
                {{ isReady ? "已就绪" : "未启动" }}
              </span>
            </template>
          </NStatistic>
        </NGi>
        <NGi>
          <NStatistic label="登录状态">
            <template #default>
              <span :style="{ color: needLogin ? '#f0a020' : '#18a058' }">
                {{ needLogin ? "需登录" : "已登录" }}
              </span>
            </template>
          </NStatistic>
        </NGi>
        <NGi>
          <NStatistic label="当前任务">
            <template #default>
              {{ currentTask?.drama || "-" }}
            </template>
          </NStatistic>
        </NGi>
        <NGi>
          <NStatistic label="上传进度">
            <template #default>
              {{
                currentTask
                  ? `${currentTask.successCount}/${currentTask.totalFiles}`
                  : "-"
              }}
            </template>
          </NStatistic>
        </NGi>
      </NGrid>

      <!-- 当前任务进度 -->
      <div v-if="currentTask" style="margin-bottom: 20px">
        <NAlert type="info" :title="`正在上传: ${currentTask.drama}`">
          <div style="margin-top: 8px">
            <div>{{ currentTask.message }}</div>
            <div style="margin-top: 8px">
              批次进度: {{ currentTask.currentBatch }}/{{ currentTask.totalBatches }}
            </div>
            <NProgress
              type="line"
              :percentage="
                currentTask.totalFiles > 0
                  ? Math.round(
                      (currentTask.successCount / currentTask.totalFiles) * 100
                    )
                  : 0
              "
              :indicator-placement="'inside'"
              style="margin-top: 8px"
            />
          </div>
        </NAlert>
      </div>

      <!-- 控制按钮 -->
      <NSpace style="margin-bottom: 20px">
        <NButton
          type="primary"
          :loading="isInitializing"
          :disabled="isReady"
          @click="initializeBrowser"
        >
          启动浏览器
        </NButton>
        <NButton :disabled="!isReady" @click="closeBrowser"> 关闭浏览器 </NButton>
        <NButton :disabled="!isReady" @click="checkLoginStatus">
          检查登录
        </NButton>
        <NButton @click="toggleLogs">
          {{ showLogs ? "隐藏日志" : "查看日志" }}
        </NButton>
      </NSpace>

      <!-- 日志面板 -->
      <div v-if="showLogs" style="margin-bottom: 20px">
        <NCard size="small" title="运行日志">
          <template #header-extra>
            <NButton size="small" @click="clearLogs">清空</NButton>
          </template>
          <div
            ref="logContainer"
            style="
              height: 200px;
              overflow-y: auto;
              background: #1e1e1e;
              color: #d4d4d4;
              padding: 8px;
              border-radius: 4px;
              font-family: monospace;
              font-size: 12px;
            "
          >
            <div v-if="logs.length === 0" style="color: #888">暂无日志</div>
            <div v-for="(log, index) in logs" :key="index">
              <span style="color: #6a9955">[{{ log.time }}]</span>
              <span style="margin-left: 8px">{{ log.message }}</span>
            </div>
          </div>
        </NCard>
      </div>

      <!-- 需要登录提示 -->
      <NAlert
        v-if="isReady && needLogin"
        type="warning"
        title="需要登录"
        style="margin-bottom: 20px"
      >
        请在弹出的浏览器窗口中登录巨量创意后台，登录完成后点击"检查登录"按钮。
      </NAlert>

      <!-- 测试上传 -->
      <NCollapse>
        <NCollapseItem title="测试上传" name="test">
          <NSpace vertical style="width: 100%">
            <div style="display: flex; gap: 12px; align-items: center">
              <span style="width: 80px">账户 ID:</span>
              <NInput
                v-model:value="testAccountId"
                placeholder="输入巨量创意账户 ID"
                style="flex: 1"
              />
            </div>
            <div style="display: flex; gap: 12px; align-items: center">
              <span style="width: 80px">剧集名称:</span>
              <NInput
                v-model:value="testDrama"
                placeholder="输入剧集名称（可选）"
                style="flex: 1"
              />
            </div>
            <div style="display: flex; gap: 12px; align-items: center">
              <span style="width: 80px">素材目录:</span>
              <NInput
                v-model:value="testFilesPath"
                placeholder="选择素材文件夹"
                style="flex: 1"
                readonly
              />
              <NButton @click="selectFolder">选择</NButton>
            </div>
            <NButton
              type="primary"
              :disabled="!isReady || needLogin || isUploading"
              @click="startTestUpload"
            >
              {{ isUploading ? "上传中..." : "开始上传" }}
            </NButton>
          </NSpace>
        </NCollapseItem>

        <NCollapseItem title="上传配置" name="config">
          <NSpace vertical style="width: 100%">
            <div style="display: flex; gap: 12px; align-items: center">
              <span style="width: 120px">每批文件数:</span>
              <NInputNumber
                v-model:value="config.batchSize"
                :min="1"
                :max="50"
                style="width: 120px"
              />
            </div>
            <div style="display: flex; gap: 12px; align-items: center">
              <span style="width: 120px">批次间隔(ms):</span>
              <NInputNumber
                v-model:value="config.batchDelayMin"
                :min="1000"
                :max="30000"
                :step="1000"
                style="width: 120px"
              />
              <span>-</span>
              <NInputNumber
                v-model:value="config.batchDelayMax"
                :min="1000"
                :max="30000"
                :step="1000"
                style="width: 120px"
              />
            </div>
            <div style="display: flex; gap: 12px; align-items: center">
              <span style="width: 120px">操作延迟(ms):</span>
              <NInputNumber
                v-model:value="config.slowMo"
                :min="0"
                :max="500"
                :step="10"
                style="width: 120px"
              />
            </div>
            <div style="display: flex; gap: 12px; align-items: center">
              <span style="width: 120px">无头模式:</span>
              <NSwitch v-model:value="config.headless" />
              <span style="color: #999; font-size: 12px">
                (开启后浏览器窗口不可见)
              </span>
            </div>
            <NButton type="primary" @click="saveConfig">保存配置</NButton>
          </NSpace>
        </NCollapseItem>
      </NCollapse>
    </NCard>
  </div>
</template>

<style scoped>
.juliang-page {
  padding: 20px;
  height: 100%;
  overflow-y: auto;
}
</style>
