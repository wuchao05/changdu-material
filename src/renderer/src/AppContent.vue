<script setup lang="ts">
import { ref, computed, onMounted, watch, h, KeepAlive } from "vue";
import type { Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  NLayout,
  NLayoutSider,
  NLayoutContent,
  NMenu,
  NIcon,
  NButton,
  NSelect,
  useMessage,
} from "naive-ui";
import {
  CloudUploadOutline,
  CutOutline,
  DownloadOutline,
  EyeOffOutline,
  HammerOutline,
  LayersOutline,
  LogOutOutline,
  OptionsOutline,
  RefreshOutline,
  RocketOutline,
} from "@vicons/ionicons5";
import { useAuthStore } from "./stores/auth";
import { useApiConfigStore } from "./stores/apiConfig";
import { useDarenStore } from "./stores/daren";
import { useSessionStore } from "./stores/session";

const router = useRouter();
const route = useRoute();
const message = useMessage();
const authStore = useAuthStore();
const darenStore = useDarenStore();
const sessionStore = useSessionStore();
const apiConfigStore = useApiConfigStore();

const collapsed = ref(false);
const activeKey = ref("upload");
const refreshing = ref(false);
const switchingChannel = ref(false);

function renderMenuIcon(icon: Component) {
  return h("span", { class: "menu-icon-shell" }, [
    h(NIcon, { size: 17 }, { default: () => h(icon) }),
  ]);
}

// 根据权限动态生成菜单选项
const menuOptions = computed(() => {
  const options: Array<{
    label: string;
    key: string;
    icon: () => ReturnType<typeof h>;
  }> = [];

  // 剧目下载 - 跟随当前渠道菜单权限
  if (darenStore.canDownload) {
    options.push({
      label: "剧目下载",
      key: "download",
      icon: () => renderMenuIcon(DownloadOutline),
    });
  }

  // 素材剪辑 - 跟随当前渠道菜单权限
  if (darenStore.canMaterialClip) {
    options.push({
      label: "素材剪辑",
      key: "material-clip",
      icon: () => renderMenuIcon(CutOutline),
    });
  }

  // 形天上传 - 跟随当前渠道菜单权限
  if (darenStore.canUpload) {
    options.push({
      label: "形天上传",
      key: "upload",
      icon: () => renderMenuIcon(CloudUploadOutline),
    });
  }

  // 巨量上传 - 跟随当前渠道菜单权限
  if (darenStore.canJuliang) {
    options.push({
      label: "巨量上传",
      key: "juliang",
      icon: () => renderMenuIcon(RocketOutline),
    });
  }

  // 上传搭建 - 跟随当前渠道菜单权限
  if (darenStore.canUploadBuild) {
    options.push({
      label: "上传搭建",
      key: "upload-build",
      icon: () => renderMenuIcon(HammerOutline),
    });
  }

  // 巨量搭建 - 跟随当前渠道菜单权限
  if (darenStore.canJuliangBuild) {
    options.push({
      label: "巨量搭建",
      key: "juliang-build",
      icon: () => renderMenuIcon(LayersOutline),
    });
  }

  // 系统设置 - 仅管理员可见
  if (authStore.isAdmin) {
    options.push({
      label: "菜单配置",
      key: "settings",
      icon: () => renderMenuIcon(OptionsOutline),
    });
  }

  return options;
});

// 获取默认路由
const defaultRoute = computed(() => {
  if (darenStore.canDownload) return "/download";
  if (darenStore.canMaterialClip) return "/material-clip";
  if (darenStore.canUpload) return "/upload";
  if (darenStore.canJuliang) return "/juliang";
  if (darenStore.canUploadBuild) return "/upload-build";
  if (darenStore.canJuliangBuild) return "/juliang-build";
  if (authStore.isAdmin) return "/settings";
  return "/login";
});

const channelOptions = computed(() =>
  sessionStore.availableChannels.map((item) => ({
    label: item.name,
    value: item.id,
  })),
);

const currentChannelId = computed(() => sessionStore.currentChannel?.id || "");
const currentUserChannelLabel = computed(() => {
  const userLabel = authStore.currentUser?.label || authStore.currentUser?.id || "";
  const channelName = sessionStore.currentChannel?.name || "";

  if (userLabel && channelName) {
    return `${userLabel}-${channelName}`;
  }

  return userLabel || channelName;
});

// 处理菜单选择
function handleMenuSelect(key: string) {
  activeKey.value = key;
  router.push(`/${key}`);
}

// 监听路由变化
watch(
  () => route.path,
  (path) => {
    const key = path.slice(1) || "upload";
    // 检查当前路由是否在可用菜单中
    const availableKeys = menuOptions.value.map((opt) => opt.key);
    if (availableKeys.includes(key)) {
      activeKey.value = key;
    }
  },
  { immediate: true },
);

// 退出登录
async function handleLogout() {
  await authStore.logout();
  apiConfigStore.resetConfig();
  message.success("已退出登录");
  router.push("/login");
}

// 最小化窗口
function handleMinimize() {
  window.api.minimize();
}

// 最大化窗口
function handleMaximize() {
  window.api.maximize();
}

// 关闭窗口（隐藏到托盘）
function handleClose() {
  window.api.close();
}

// 后台运行（隐藏窗口到托盘）
async function handleHideToTray() {
  await window.api.hideWindow();
}

// 刷新页面和配置
async function handleRefresh() {
  if (refreshing.value) return;

  refreshing.value = true;

  try {
    await sessionStore.loadSession(true);
    apiConfigStore.applySessionData(sessionStore.session);
    await darenStore.loadFromServer(true);
    message.info("配置已更新");
    window.location.reload();
  } catch (error) {
    console.error("[AppContent] 刷新失败:", error);
    message.error("刷新失败");
  } finally {
    refreshing.value = false;
  }
}

async function handleChannelChange(channelId: string) {
  if (!channelId || channelId === currentChannelId.value || switchingChannel.value) {
    return;
  }

  switchingChannel.value = true;
  try {
    const session = await sessionStore.switchChannel(channelId);
    apiConfigStore.applySessionData(session);
    await darenStore.loadFromServer(true);
    message.success(`已切换到渠道：${session.channel?.name || channelId}`);

    const currentKey = route.path.slice(1);
    const availableKeys = menuOptions.value.map((opt) => opt.key);
    if (!availableKeys.includes(currentKey)) {
      await router.push(defaultRoute.value);
      return;
    }

    window.location.reload();
  } catch (error) {
    console.error("[AppContent] 切换渠道失败:", error);
    message.error(error instanceof Error ? error.message : "切换渠道失败");
  } finally {
    switchingChannel.value = false;
  }
}

onMounted(async () => {
  await sessionStore.loadSession();
  apiConfigStore.applySessionData(sessionStore.session);

  if (!authStore.isLoggedIn) {
    router.push("/login");
    return;
  }

  await darenStore.loadFromServer(true);

  const currentKey = route.path.slice(1);
  const availableKeys = menuOptions.value.map((opt) => opt.key);
  if (currentKey && !availableKeys.includes(currentKey) && currentKey !== "login") {
    router.push(defaultRoute.value);
  }
});
</script>

<template>
  <div class="app-container">
    <!-- 自定义标题栏 -->
    <div class="title-bar" style="-webkit-app-region: drag">
      <div class="title-bar-text">
        <span class="product-logo product-logo--title" aria-hidden="true">
          <span class="product-logo-card">
            <span class="product-logo-play"></span>
          </span>
        </span>
        <span class="brand-text">番茄挂载工具</span>
        <span v-if="currentUserChannelLabel" class="user-info">
          {{ currentUserChannelLabel }}
        </span>
      </div>
      <div class="title-bar-actions" style="-webkit-app-region: no-drag">
        <NSelect
          v-if="authStore.isLoggedIn && channelOptions.length > 1"
          :value="currentChannelId"
          :options="channelOptions"
          size="small"
          style="width: 180px"
          :loading="switchingChannel"
          @update:value="handleChannelChange"
        />
        <NButton
          v-if="authStore.isLoggedIn"
          quaternary
          size="small"
          @click="handleHideToTray"
          title="后台运行（隐藏到系统托盘）"
        >
          <template #icon>
            <NIcon><EyeOffOutline /></NIcon>
          </template>
        </NButton>
        <NButton
          v-if="authStore.isLoggedIn"
          quaternary
          size="small"
          :loading="refreshing"
          :disabled="refreshing"
          @click="handleRefresh"
          title="刷新页面和配置"
        >
          <template #icon>
            <NIcon><RefreshOutline /></NIcon>
          </template>
        </NButton>
      </div>
      <div class="title-bar-buttons" style="-webkit-app-region: no-drag">
        <NButton quaternary size="small" @click="handleMinimize">
          <template #icon>─</template>
        </NButton>
        <NButton quaternary size="small" @click="handleMaximize">
          <template #icon>□</template>
        </NButton>
        <NButton quaternary size="small" @click="handleClose">
          <template #icon>✕</template>
        </NButton>
      </div>
    </div>

    <!-- 登录页面 -->
    <template v-if="route.path === '/login'">
      <router-view />
    </template>

    <!-- 主布局 -->
    <template v-else>
      <NLayout has-sider class="main-layout">
        <NLayoutSider
          bordered
          class="app-sider"
          collapse-mode="width"
          :collapsed-width="64"
          :width="200"
          :collapsed="collapsed"
          show-trigger
          @collapse="collapsed = true"
          @expand="collapsed = false"
        >
          <NMenu
            :collapsed="collapsed"
            :collapsed-width="64"
            :collapsed-icon-size="22"
            :options="menuOptions"
            :value="activeKey"
            @update:value="handleMenuSelect"
          />
          <div class="sider-footer">
            <NButton v-if="!collapsed" quaternary block @click="handleLogout">
              <template #icon>
                <NIcon><LogOutOutline /></NIcon>
              </template>
              退出登录
            </NButton>
            <NButton v-else quaternary @click="handleLogout">
              <template #icon>
                <NIcon><LogOutOutline /></NIcon>
              </template>
            </NButton>
          </div>
        </NLayoutSider>
        <NLayoutContent class="main-content">
          <router-view v-slot="{ Component }">
            <KeepAlive include="Upload,Download,JuliangUpload,MaterialClip">
              <component :is="Component" />
            </KeepAlive>
          </router-view>
        </NLayoutContent>
      </NLayout>
    </template>
  </div>
</template>

<style scoped>
.app-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.title-bar {
  height: 36px;
  background: linear-gradient(135deg, #f8fbff 0%, #eef4ff 55%, #f7f8fc 100%);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 12px;
  color: #1f2937;
  gap: 12px;
  border-bottom: 1px solid #dbe5f1;
  box-shadow: 0 6px 18px rgba(148, 163, 184, 0.08);
}

.title-bar-text {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  flex: 1;
}

.title-bar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.title-bar-actions :deep(.n-button) {
  color: #334155;
  padding: 0 8px;
  border-radius: 10px;
  background: transparent;
  border-color: transparent;
}

.title-bar-actions :deep(.n-button:hover) {
  background: rgba(148, 163, 184, 0.14);
  color: #0f172a;
}

.product-logo {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 12px;
  background:
    radial-gradient(circle at 68% 24%, rgba(255, 255, 255, 0.95) 0 2px, transparent 3px),
    linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%);
  box-shadow:
    0 10px 24px rgba(234, 88, 12, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
}

.product-logo::before {
  content: "";
  position: absolute;
  width: 48%;
  height: 42%;
  top: 26%;
  left: 23%;
  border-radius: 7px;
  background: linear-gradient(135deg, #fb923c 0%, #ef4444 100%);
  opacity: 0.58;
  transform: rotate(-12deg);
  box-shadow: 0 4px 10px rgba(239, 68, 68, 0.16);
}

.product-logo--title {
  width: 28px;
  height: 28px;
}

.product-logo-card {
  position: absolute;
  width: 50%;
  height: 46%;
  right: 20%;
  bottom: 21%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: linear-gradient(135deg, #fb923c 0%, #ef4444 100%);
  transform: rotate(5deg);
  box-shadow: 0 4px 10px rgba(239, 68, 68, 0.2);
}

.product-logo-play {
  width: 0;
  height: 0;
  margin-left: 1px;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 6px solid rgba(255, 255, 255, 0.96);
}

.brand-text {
  color: #0f172a;
}

.user-info {
  font-size: 12px;
  color: #475569;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 999px;
  padding: 2px 8px;
}

.title-bar-buttons {
  display: flex;
  gap: 4px;
}

.title-bar-buttons :deep(.n-button) {
  color: #334155;
  padding: 0 8px;
  border-radius: 10px;
  background: transparent;
  border-color: transparent;
}

.title-bar-buttons :deep(.n-button:hover) {
  background: rgba(148, 163, 184, 0.14);
  color: #0f172a;
}

.main-layout {
  flex: 1;
  overflow: hidden;
}

.app-sider {
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}

.app-sider :deep(.n-layout-sider-scroll-container) {
  padding: 14px 10px 76px;
}

.app-sider :deep(.n-menu) {
  --n-item-height: 42px;
}

.app-sider :deep(.n-menu-item) {
  margin: 3px 0;
}

.app-sider :deep(.n-menu-item-content) {
  border-radius: 14px;
  color: #475569;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}

.app-sider :deep(.n-menu-item-content::before) {
  left: 0;
  right: 0;
  border-radius: 14px;
}

.app-sider :deep(.n-menu-item-content:not(.n-menu-item-content--selected):hover) {
  color: #0f172a;
}

.app-sider :deep(.n-menu-item-content:not(.n-menu-item-content--selected):hover::before) {
  background: #f1f5f9;
}

.app-sider :deep(.n-menu-item-content.n-menu-item-content--selected) {
  color: #0f172a;
  font-weight: 700;
}

.app-sider :deep(.n-menu-item-content.n-menu-item-content--selected::before) {
  background: linear-gradient(135deg, #eff6ff 0%, #e0f2fe 100%);
  box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.12);
}

.app-sider :deep(.n-menu-item-content-header) {
  font-size: 14px;
  letter-spacing: 0.01em;
}

.menu-icon-shell {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
  color: #64748b;
  transition:
    color 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.app-sider :deep(.n-menu-item-content:not(.n-menu-item-content--selected):hover .menu-icon-shell) {
  background: transparent;
  border-color: transparent;
  color: #334155;
}

.app-sider :deep(.n-menu-item-content.n-menu-item-content--selected .menu-icon-shell) {
  background: transparent;
  border-color: transparent;
  color: #2563eb;
  box-shadow: none;
}

.app-sider :deep(.n-menu--collapsed .menu-icon-shell) {
  width: 32px;
  height: 32px;
}

.sider-footer {
  position: absolute;
  bottom: 12px;
  left: 12px;
  right: 12px;
}

.main-content {
  padding: 20px;
  overflow: auto;
  background: #f5f7fa;
}

.main-content :deep(.n-card) {
  border-radius: 18px;
  border: 1px solid #e2e8f0;
  box-shadow: none;
  background: #ffffff;
}

.main-content :deep(.n-card > .n-card-header) {
  padding: 18px 20px 0;
}

.main-content :deep(.n-card > .n-card__content),
.main-content :deep(.n-card > .n-card__footer) {
  padding: 18px 20px;
}

.main-content :deep(.n-button) {
  border-radius: 10px;
  box-shadow: none;
  border: none;
  border-color: transparent;
  background: #f1f5f9;
  color: #334155;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}

.main-content :deep(.n-button:not(.n-button--disabled):hover) {
  background: #e2e8f0;
  border-color: transparent;
  color: #0f172a;
}

.main-content :deep(.n-button.n-button--primary-type) {
  background: #eff6ff;
  border: none;
  border-color: transparent;
  color: #2563eb;
}

.main-content :deep(.n-button.n-button--primary-type:not(.n-button--disabled):hover) {
  background: #dbeafe;
  border-color: transparent;
  color: #1d4ed8;
}

.main-content :deep(.n-button.n-button--error-type) {
  background: #fef2f2;
  border: none;
  border-color: transparent;
  color: #dc2626;
}

.main-content :deep(.n-button.n-button--error-type:not(.n-button--disabled):hover) {
  background: #fee2e2;
  border-color: transparent;
  color: #b91c1c;
}

.main-content :deep(.n-button.n-button--warning-type) {
  background: #fff7ed;
  border: none;
  border-color: transparent;
  color: #ea580c;
}

.main-content :deep(.n-button.n-button--success-type) {
  background: #ecfdf5;
  border: none;
  border-color: transparent;
  color: #16a34a;
}

.main-content :deep(.n-button.n-button--quaternary-type),
.main-content :deep(.n-button.n-button--text-type) {
  background: transparent;
  border: none;
  border-color: transparent;
  box-shadow: none;
}

.main-content :deep(.n-button.n-button--quaternary-type:not(.n-button--disabled):hover),
.main-content :deep(.n-button.n-button--text-type:not(.n-button--disabled):hover) {
  background: transparent;
  border-color: transparent;
  color: #475569;
}

.main-content :deep(.n-input-number .n-button),
.main-content :deep(.n-input-number-button) {
  background: transparent;
  border: none;
  border-color: transparent;
  box-shadow: none;
  color: #94a3b8;
}

.main-content :deep(.n-input-number .n-button:not(.n-button--disabled):hover),
.main-content :deep(.n-input-number-button:not(.n-button--disabled):hover) {
  background: transparent;
  color: #64748b;
}

.main-content :deep(.n-input .n-input-wrapper),
.main-content :deep(.n-input-number),
.main-content :deep(.n-base-selection) {
  border-radius: 14px;
  box-shadow: none;
}

.main-content :deep(.n-collapse) {
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
}

.main-content :deep(.n-collapse-item) {
  background: transparent;
}

.main-content :deep(.n-collapse-item__header) {
  padding: 16px 18px !important;
  font-weight: 600;
  color: #334155;
}

.main-content :deep(.n-collapse-item-arrow) {
  margin-right: 10px;
}

.main-content :deep(.n-collapse-item__header-main) {
  min-width: 0;
}
</style>
