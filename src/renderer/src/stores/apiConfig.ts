import { defineStore } from "pinia";
import { ref, toRaw } from "vue";

// 常读平台配置
export interface ChangduConfig {
  cookie: string;
  distributorId: string;
  changduAppId: string; // 常读应用 ID
  changduAdUserId: string; // 常读广告用户 ID
  changduRootAdUserId: string; // 常读根广告用户 ID
}

export interface ApiConfig {
  // 常读平台配置（两套）
  sanrouChangdu: ChangduConfig; // 散柔-常读配置
  meiriChangdu: ChangduConfig; // 每日-常读配置
  // 飞书配置
  feishuAppId: string;
  feishuAppSecret: string;
  feishuAppToken: string; // 飞书多维表格 App Token
  feishuDramaStatusTableId: string; // 飞书剧集状态表 ID（管理员用）
  // TOS 存储配置
  tosAccessKeyId: string;
  tosAccessKeySecret: string;
  tosBucket: string;
  tosRegion: string;
  // 素材库配置
  xtToken: string;
}

export const useApiConfigStore = defineStore("apiConfig", () => {
  // State
  const config = ref<ApiConfig>({
    // 常读平台配置（两套）
    sanrouChangdu: {
      cookie: "",
      distributorId: "1842236883646506",
      changduAppId: "40012555",
      changduAdUserId: "380892546610362",
      changduRootAdUserId: "380892546610362",
    },
    meiriChangdu: {
      cookie: "",
      distributorId: "",
      changduAppId: "",
      changduAdUserId: "",
      changduRootAdUserId: "",
    },
    // 飞书配置
    feishuAppId: "cli_a870f7611b7b1013",
    feishuAppSecret: "NTwHbZG8rpOQyMEnXGPV6cNQ84KEqE8z",
    feishuAppToken: "WdWvbGUXXaokk8sAS94c00IZnsf",
    feishuDramaStatusTableId: "",
    // TOS 存储配置（AccessKeyId/Secret 通过 API 动态获取）
    tosAccessKeyId: "",
    tosAccessKeySecret: "",
    tosBucket: "ylc-material-beijing",
    tosRegion: "cn-beijing",
    // 素材库配置
    xtToken: "",
  });
  const loading = ref(false);
  const loaded = ref(false);

  // Actions
  async function loadConfig() {
    if (loading.value) return;

    loading.value = true;
    try {
      const result = await window.api.getApiConfig();
      config.value = result;
      loaded.value = true;
    } catch (error) {
      console.error("加载 API 配置失败:", error);
    } finally {
      loading.value = false;
    }
  }

  async function saveConfig(newConfig: Partial<ApiConfig>) {
    const updatedConfig = { ...toRaw(config.value), ...toRaw(newConfig) };
    // 转换为纯对象，避免 IPC 克隆错误
    const plainConfig = JSON.parse(JSON.stringify(updatedConfig));
    await window.api.saveApiConfig(plainConfig);
    config.value = updatedConfig;
  }

  async function updateCookie(cookie: string) {
    // 保持向后兼容：默认更新散柔配置的 cookie
    await saveConfig({ 
      sanrouChangdu: {
        ...config.value.sanrouChangdu,
        cookie
      }
    });
  }

  function isConfigured(): boolean {
    return !!(
      (config.value.sanrouChangdu.cookie || config.value.meiriChangdu.cookie) &&
      config.value.feishuAppId &&
      config.value.feishuAppSecret
    );
  }

  return {
    config,
    loading,
    loaded,
    loadConfig,
    saveConfig,
    updateCookie,
    isConfigured,
  };
});
