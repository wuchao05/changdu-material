<script setup lang="ts">
import { ref, computed, onMounted, watch, h, KeepAlive } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  NLayout,
  NLayoutSider,
  NLayoutContent,
  NMenu,
  NIcon,
  NButton,
  useMessage,
} from "naive-ui";
import {
  CloudUploadOutline,
  CloudDownloadOutline,
  SettingsOutline,
  LogOutOutline,
  RefreshOutline,
  EyeOffOutline,
  RocketOutline,
  ConstructOutline,
  CutOutline,
  FlashOutline,
} from "@vicons/ionicons5";
import { useAuthStore } from "./stores/auth";
import { useDarenStore } from "./stores/daren";

const router = useRouter();
const route = useRoute();
const message = useMessage();
const authStore = useAuthStore();
const darenStore = useDarenStore();

const collapsed = ref(false);
const activeKey = ref("upload");
const refreshing = ref(false);

// 根据权限动态生成菜单选项
const menuOptions = computed(() => {
  const options: Array<{
    label: string;
    key: string;
    icon: () => ReturnType<typeof h>;
  }> = [];

  // 管理员可以看到所有菜单
  const isAdmin = authStore.isAdmin;

  // 剧目下载 - 管理员或有下载权限的达人可见
  if (isAdmin || darenStore.canDownload) {
    options.push({
      label: "剧目下载",
      key: "download",
      icon: () => h(NIcon, null, { default: () => h(CloudDownloadOutline) }),
    });
  }

  // 素材剪辑 - 管理员或有素材剪辑权限的达人可见
  if (isAdmin || darenStore.canMaterialClip) {
    options.push({
      label: "素材剪辑",
      key: "material-clip",
      icon: () => h(NIcon, null, { default: () => h(CutOutline) }),
    });
  }

  // 形天上传 - 管理员或有上传权限的达人可见
  if (isAdmin || darenStore.canUpload) {
    options.push({
      label: "形天上传",
      key: "upload",
      icon: () => h(NIcon, null, { default: () => h(CloudUploadOutline) }),
    });
  }

  // 巨量上传 - 管理员或有巨量上传权限的达人可见
  if (isAdmin || darenStore.canJuliang) {
    options.push({
      label: "巨量上传",
      key: "juliang",
      icon: () => h(NIcon, null, { default: () => h(RocketOutline) }),
    });
  }

  // 上传搭建 - 管理员或有上传搭建权限的达人可见
  if (isAdmin || darenStore.canUploadBuild) {
    options.push({
      label: "上传搭建",
      key: "upload-build",
      icon: () => h(NIcon, null, { default: () => h(ConstructOutline) }),
    });
  }

  // 巨量搭建 - 管理员或有巨量搭建权限的达人可见
  if (isAdmin || darenStore.canJuliangBuild) {
    options.push({
      label: "巨量搭建",
      key: "juliang-build",
      icon: () => h(NIcon, null, { default: () => h(FlashOutline) }),
    });
  }

  // 系统设置 - 仅管理员可见
  if (isAdmin) {
    options.push({
      label: "达人配置",
      key: "settings",
      icon: () => h(NIcon, null, { default: () => h(SettingsOutline) }),
    });
  }

  return options;
});

// 获取默认路由
const defaultRoute = computed(() => {
  if (darenStore.canDownload) return "/download";
  if (darenStore.canMaterialClip) return "/material-clip";
  if (authStore.isAdmin) return "/download";
  if (darenStore.canUpload) return "/upload";
  if (darenStore.canJuliang) return "/juliang";
  if (darenStore.canJuliangBuild) return "/juliang-build";
  if (darenStore.canUploadBuild) return "/upload-build";
  return "/login";
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
  authStore.logout();
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
    console.log("[AppContent] 开始刷新...");

    // 1. 获取 Auth 配置（常读配置 + 素材库 Token）
    const authResult = await window.api.fetchAuthConfig();
    if (authResult.success) {
      console.log("[AppContent] ✓ Auth 配置获取成功");
      message.info("配置已更新");
    } else {
      console.warn("[AppContent] Auth 配置获取失败:", authResult.error);
    }

    // 2. 重新加载达人配置（强制刷新）
    await darenStore.loadFromServer(true);
    console.log("[AppContent] ✓ 达人配置已刷新");

    // 3. 重新加载当前页面（使用浏览器原生刷新）
    window.location.reload();
  } catch (error) {
    console.error("[AppContent] 刷新失败:", error);
    message.error("刷新失败");
    refreshing.value = false;
  }
}

// 初始化
onMounted(async () => {
  // 检查登录状态
  if (!authStore.isLoggedIn) {
    router.push("/login");
    return;
  }

  // 获取 Auth 配置
  try {
    console.log("[AppContent] 获取 Auth 配置...");
    const authResult = await window.api.fetchAuthConfig();
    if (authResult.success) {
      console.log("[AppContent] ✓ Auth 配置获取成功");
    } else {
      console.log("[AppContent] Auth 配置获取失败:", authResult.error);
    }
  } catch (error) {
    console.warn("[AppContent] Auth 配置获取失败:", error);
  }

  // 加载达人配置（强制刷新，避免缓存导致新达人不可见）
  await darenStore.loadFromServer(true);

  // 如果当前路由没有权限，重定向到默认路由
  const currentKey = route.path.slice(1);
  const availableKeys = menuOptions.value.map((opt) => opt.key);
  if (
    currentKey &&
    !availableKeys.includes(currentKey) &&
    currentKey !== "login"
  ) {
    router.push(defaultRoute.value);
  }
});
</script>

<template>
  <div class="app-container">
    <!-- 自定义标题栏 -->
    <div class="title-bar" style="-webkit-app-region: drag">
      <div class="title-bar-text">
        <span class="app-icon">📺</span>
        <span>常读素材管理工具</span>
        <span v-if="authStore.currentUser" class="user-info">
          - {{ authStore.currentUser.label || authStore.currentUser.id }}
        </span>
      </div>
      <div class="title-bar-actions" style="-webkit-app-region: no-drag">
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
          collapse-mode="width"
          :collapsed-width="64"
          :width="200"
          :collapsed="collapsed"
          show-trigger
          @collapse="collapsed = true"
          @expand="collapsed = false"
        >
          <div class="sider-header">
            <span v-if="!collapsed" class="logo-text">素材管理</span>
            <span v-else>📺</span>
          </div>
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
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 12px;
  color: white;
  gap: 12px;
}

.title-bar-text {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  flex: 1;
}

.title-bar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.title-bar-actions :deep(.n-button) {
  color: white;
  padding: 0 8px;
}

.title-bar-actions :deep(.n-button:hover) {
  background: rgba(255, 255, 255, 0.1);
}

.app-icon {
  font-size: 18px;
}

.user-info {
  font-size: 12px;
  opacity: 0.9;
}

.title-bar-buttons {
  display: flex;
  gap: 4px;
}

.title-bar-buttons :deep(.n-button) {
  color: white;
  padding: 0 8px;
}

.title-bar-buttons :deep(.n-button:hover) {
  background: rgba(255, 255, 255, 0.1);
}

.main-layout {
  flex: 1;
  overflow: hidden;
}

.sider-header {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 600;
  color: #333;
  border-bottom: 1px solid #e8e8e8;
}

.logo-text {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
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
  border-radius: 999px;
  box-shadow: none;
  border-color: #d8e1ec;
  background: #ffffff;
  color: #334155;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}

.main-content :deep(.n-button:not(.n-button--disabled):hover) {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #0f172a;
}

.main-content :deep(.n-button.n-button--primary-type) {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #2563eb;
}

.main-content :deep(.n-button.n-button--primary-type:not(.n-button--disabled):hover) {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.main-content :deep(.n-button.n-button--error-type) {
  background: #fef2f2;
  border-color: #fecaca;
  color: #dc2626;
}

.main-content :deep(.n-button.n-button--error-type:not(.n-button--disabled):hover) {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #b91c1c;
}

.main-content :deep(.n-button.n-button--warning-type) {
  background: #fff7ed;
  border-color: #fed7aa;
  color: #ea580c;
}

.main-content :deep(.n-button.n-button--success-type) {
  background: #ecfdf5;
  border-color: #bbf7d0;
  color: #16a34a;
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
