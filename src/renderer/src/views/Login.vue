<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { NCard, NForm, NFormItem, NInput, NButton, useMessage } from "naive-ui";
import { useAuthStore } from "../stores/auth";
import { useDarenStore } from "../stores/daren";

const router = useRouter();
const message = useMessage();
const authStore = useAuthStore();
const darenStore = useDarenStore();

const loading = ref(false);
const loginMode = ref<"admin" | "daren">("daren");
const formData = ref({
  userId: "",
  password: "",
});

// 加载达人列表（先同步远程配置）
async function loadDarenList() {
  loading.value = true;
  try {
    // 先从远程同步配置
    console.log("[Login] 开始同步远程配置...");
    const syncResult = await window.api.syncRemoteConfig();
    if (syncResult.synced) {
      console.log("[Login] ✓ 远程配置同步成功，版本:", syncResult.version);
    } else {
      console.log(
        "[Login] 远程配置同步跳过:",
        syncResult.error || "无远程配置",
      );
    }

    // 加载达人列表（强制刷新，避免缓存导致新达人不可见）
    await darenStore.loadFromServer(true);
    console.log(
      "[Login] ✓ 达人列表加载完成，数量:",
      darenStore.darenList.length,
    );
  } catch (error) {
    console.error("[Login] 加载失败:", error);
    message.error("加载达人列表失败");
  } finally {
    loading.value = false;
  }
}

// 通过账户或名称查找达人
function findDarenByIdOrLabel(input: string) {
  return darenStore.darenList.find((d) => d.id === input || d.label === input);
}

// 登录
async function handleLogin() {
  if (!formData.value.userId) {
    message.warning("请输入账户或名称");
    return;
  }

  loading.value = true;
  try {
    if (loginMode.value === "admin") {
      // 管理员登录（简单密码验证）
      if (formData.value.password !== "admin123") {
        message.error("密码错误");
        return;
      }

      authStore.login(
        {
          id: formData.value.userId,
          label: "管理员",
          isAdmin: true,
        },
        `admin-${Date.now()}`,
      );

      message.success("登录成功");
      router.push("/upload");
    } else {
      // 达人登录 - 支持账户或名称登录
      const daren = findDarenByIdOrLabel(formData.value.userId);
      if (!daren) {
        message.error("用户不存在");
        return;
      }

      // 验证密码
      if (daren.password && daren.password !== formData.value.password) {
        message.error("密码错误");
        return;
      }

      // 设置当前达人
      darenStore.setSelectedDaren(daren.id);

      authStore.login(
        {
          id: daren.id,
          label: daren.label,
          isAdmin: false,
        },
        `daren-${Date.now()}`,
      );

      message.success("登录成功");

      // 根据权限跳转到对应页面
      if (daren.enableUpload) {
        router.push("/upload");
      } else if (daren.enableDownload) {
        router.push("/download");
      } else if (daren.enableJuliang) {
        router.push("/juliang");
      } else if (daren.enableUploadBuild) {
        router.push("/upload-build");
      } else if (daren.enableMaterialClip) {
        router.push("/material-clip");
      } else {
        message.warning("该账号没有任何功能权限，请联系管理员");
        authStore.logout();
        return;
      }
    }
  } catch (error) {
    message.error("登录失败");
  } finally {
    loading.value = false;
  }
}

// 初始化
loadDarenList();
</script>

<template>
  <div class="login-container">
    <div class="login-background">
      <div class="bg-circle bg-circle-1"></div>
      <div class="bg-circle bg-circle-2"></div>
      <div class="bg-circle bg-circle-3"></div>
    </div>

    <NCard class="login-card" :bordered="false">
      <div class="login-header">
        <div class="app-logo">📺</div>
        <h1 class="app-title">常读素材管理工具</h1>
        <p class="app-subtitle">视频素材上传下载一站式管理</p>
      </div>

      <div class="login-mode-tabs">
        <button
          :class="['mode-tab', { active: loginMode === 'daren' }]"
          @click="loginMode = 'daren'"
        >
          达人登录
        </button>
        <button
          :class="['mode-tab', { active: loginMode === 'admin' }]"
          @click="loginMode = 'admin'"
        >
          管理员登录
        </button>
      </div>

      <NForm class="login-form" :model="formData">
        <NFormItem v-if="loginMode === 'daren'" label="账户/名称">
          <NInput
            v-model:value="formData.userId"
            placeholder="请输入账户或名称"
          />
        </NFormItem>

        <NFormItem v-else label="管理员账号">
          <NInput
            v-model:value="formData.userId"
            placeholder="请输入管理员账号"
          />
        </NFormItem>

        <NFormItem label="密码">
          <NInput
            v-model:value="formData.password"
            type="password"
            placeholder="请输入密码"
            show-password-on="click"
            @keyup.enter="handleLogin"
          />
        </NFormItem>

        <NButton
          type="primary"
          block
          :loading="loading"
          @click="handleLogin"
          class="login-button"
        >
          登录
        </NButton>
      </NForm>

      <div class="login-footer">
        <p>© 2024 GuaZai. All rights reserved.</p>
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.bg-circle {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
}

.bg-circle-1 {
  width: 400px;
  height: 400px;
  top: -100px;
  left: -100px;
}

.bg-circle-2 {
  width: 300px;
  height: 300px;
  bottom: -50px;
  right: -50px;
}

.bg-circle-3 {
  width: 200px;
  height: 200px;
  top: 50%;
  right: 20%;
}

.login-card {
  width: 420px;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  position: relative;
  z-index: 1;
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.app-logo {
  font-size: 56px;
  margin-bottom: 16px;
}

.app-title {
  font-size: 28px;
  font-weight: 700;
  color: #333;
  margin-bottom: 8px;
}

.app-subtitle {
  font-size: 14px;
  color: #888;
}

.login-mode-tabs {
  display: flex;
  margin-bottom: 24px;
  border-radius: 8px;
  background: #f5f5f5;
  padding: 4px;
}

.mode-tab {
  flex: 1;
  padding: 10px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  font-size: 14px;
  color: #666;
  transition: all 0.3s;
}

.mode-tab.active {
  background: white;
  color: #667eea;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.login-form {
  margin-bottom: 24px;
}

.login-button {
  height: 44px;
  font-size: 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
}

.login-button:hover {
  opacity: 0.9;
}

.login-footer {
  text-align: center;
  font-size: 12px;
  color: #999;
}
</style>
