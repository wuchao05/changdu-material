import { defineStore } from "pinia";
import { computed, ref } from "vue";

export interface ApiConfig {
  cookie: string;
  distributorId: string;
  adUserId: string;
  rootAdUserId: string;
  appId: string;
  feishuAppToken: string;
  dramaListTableId: string;
  dramaStatusTableId: string;
  accountTableId: string;
  userId: string;
  userType: "admin" | "normal";
  channelId: string;
  channelName: string;
  nickname: string;
  juliangCookie: string;
  advanceHoursAfterTen: string;
  advanceHoursBeforeTen: string;
}

const DEFAULT_API_CONFIG: ApiConfig = {
  cookie: "",
  distributorId: "",
  adUserId: "",
  rootAdUserId: "",
  appId: "",
  feishuAppToken: "WdWvbGUXXaokk8sAS94c00IZnsf",
  dramaListTableId: "",
  dramaStatusTableId: "",
  accountTableId: "",
  userId: "",
  userType: "normal",
  channelId: "",
  channelName: "",
  nickname: "",
  juliangCookie: "",
  advanceHoursAfterTen: "0",
  advanceHoursBeforeTen: "0",
};

export const useApiConfigStore = defineStore("apiConfig", () => {
  const runtimeConfig = ref<ApiConfig>({ ...DEFAULT_API_CONFIG });
  const loading = ref(false);
  const loaded = ref(false);
  const config = computed<ApiConfig>(() => runtimeConfig.value);

  function applySessionData(session: SessionRuntimeData | null) {
    if (!session) {
      runtimeConfig.value = { ...DEFAULT_API_CONFIG };
      loaded.value = true;
      return;
    }

    runtimeConfig.value = {
      ...DEFAULT_API_CONFIG,
      cookie: String(session.platforms?.changdu?.channel?.cookie || "").trim(),
      distributorId: String(
        session.platforms?.changdu?.channel?.distributorId || "",
      ).trim(),
      adUserId: String(session.platforms?.changdu?.channel?.adUserId || "").trim(),
      rootAdUserId: String(
        session.platforms?.changdu?.channel?.rootAdUserId || "",
      ).trim(),
      appId: String(session.platforms?.changdu?.channel?.appId || "").trim(),
      dramaListTableId: String(session.feishu?.dramaListTableId || "").trim(),
      dramaStatusTableId: String(session.feishu?.dramaStatusTableId || "").trim(),
      accountTableId: String(session.feishu?.accountTableId || "").trim(),
      userId: String(session.runtimeUser?.id || session.user?.id || "").trim(),
      userType: session.user?.userType === "admin" ? "admin" : "normal",
      channelId: String(session.channel?.id || "").trim(),
      channelName: String(session.channel?.name || "").trim(),
      nickname: String(
        session.runtimeUser?.nickname || session.user?.nickname || "",
      ).trim(),
      juliangCookie: String(session.platforms?.juliang?.channel || "").trim(),
      advanceHoursAfterTen: String(
        session.buildConfig?.advanceHoursAfterTen || "0",
      ).trim(),
      advanceHoursBeforeTen: String(
        session.buildConfig?.advanceHoursBeforeTen || "0",
      ).trim(),
    };
    loaded.value = true;
  }

  async function loadConfig() {
    if (loading.value) {
      return;
    }

    loading.value = true;
    try {
      const session = await window.api.sessionGet();
      applySessionData(session);
    } finally {
      loading.value = false;
    }
  }

  function resetConfig() {
    runtimeConfig.value = { ...DEFAULT_API_CONFIG };
    loaded.value = false;
  }

  function isConfigured(): boolean {
    return Boolean(
      runtimeConfig.value.cookie &&
        runtimeConfig.value.distributorId &&
        runtimeConfig.value.appId &&
        runtimeConfig.value.channelId,
    );
  }

  return {
    config,
    loading,
    loaded,
    loadConfig,
    applySessionData,
    resetConfig,
    isConfigured,
  };
});
