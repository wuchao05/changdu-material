import { computed, ref } from "vue";
import { defineStore, storeToRefs } from "pinia";
import {
  buildEqualPercentages,
  normalizeAllocationMaxPercent,
  normalizeAllocationOrder,
  normalizeAllocationPercent,
  normalizeAllocationWeight,
} from "../../../shared/material-allocation";
import { useApiConfigStore } from "./apiConfig";
import { useSessionStore } from "./session";

export interface UploadBuildParams {
  distributorId: string;
  secretKey: string;
  source: string;
  bid: number | string;
  productId: string;
  productPlatformId: string;
  landingUrl: string;
  microAppName: string;
  microAppId: string;
  microAppInstanceId: string;
  ccId: string;
  rechargeTemplateId: string;
}

export type MaterialAllocationMode = "average" | "ratio";

export interface DouyinMaterialRule {
  id: string;
  douyinAccount: string;
  douyinAccountId: string;
  shortName: string;
  percent?: number;
  maxPercent?: number;
  locked?: boolean;
  weight?: number;
  order?: number;
  materialRange?: string;
  materialRatio?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface UploadBuildSettings {
  buildParams: UploadBuildParams;
  darenName?: string;
  materialFilenameTemplate: string;
  materialDateValue?: string;
  materialAllocationMode: MaterialAllocationMode;
  douyinMaterialRules: DouyinMaterialRule[];
}

export interface DarenInfo {
  id: string;
  label: string;
  feishuDramaStatusTableId?: string;
  enableUpload?: boolean;
  enableDownload?: boolean;
  enableJuliang?: boolean;
  enableJuliangBuild?: boolean;
  enableUploadBuild?: boolean;
  enableMaterialClip?: boolean;
  uploadBuildSettings?: UploadBuildSettings;
}

function createDefaultBuildSettings(nickname = "小鱼"): UploadBuildSettings {
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
    darenName: nickname,
    materialFilenameTemplate: "{日期}-{剧名}-{简称}-{序号}.mp4",
    materialDateValue: "",
    materialAllocationMode: "ratio",
    douyinMaterialRules: [],
  };
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
    order: normalizeAllocationOrder(rule?.order, 1),
    materialRange: rule?.materialRange?.trim() || "",
    materialRatio: normalizeAllocationPercent(
      rule?.materialRatio ?? rule?.percent ?? 0,
    ),
    createdAt: rule?.createdAt || now,
    updatedAt: rule?.updatedAt || now,
  };
}

function normalizeBuildSettings(
  settings: Partial<UploadBuildSettings> | undefined,
  nickname: string,
): UploadBuildSettings {
  const defaults = createDefaultBuildSettings(nickname);
  const normalizedRules = Array.isArray(settings?.douyinMaterialRules)
    ? settings.douyinMaterialRules.map((rule, index) => ({
        ...normalizeRule(rule),
        order: normalizeAllocationOrder(rule?.order, index + 1),
      }))
    : [];

  const shouldBackfillEqualPercentages =
    normalizedRules.length > 0 &&
    normalizedRules.every(
      (rule) => normalizeAllocationPercent(rule.percent) === 0,
    ) &&
    settings?.materialAllocationMode === "average";

  if (shouldBackfillEqualPercentages) {
    const equalPercentages = buildEqualPercentages(normalizedRules.length);
    normalizedRules.forEach((rule, index) => {
      rule.percent = equalPercentages[index] || 0;
      rule.materialRatio = rule.percent;
    });
  }

  return {
    buildParams: {
      ...defaults.buildParams,
      ...(settings?.buildParams || {}),
    },
    darenName: settings?.darenName?.trim() || defaults.darenName,
    materialFilenameTemplate:
      settings?.materialFilenameTemplate?.trim() ||
      defaults.materialFilenameTemplate,
    materialDateValue: settings?.materialDateValue?.trim() || "",
    materialAllocationMode: "ratio",
    douyinMaterialRules: normalizedRules,
  };
}

function buildSettingsStorageKey(userId: string, channelId: string) {
  return `upload-build-settings:${userId}:${channelId}`;
}

export const useDarenStore = defineStore("daren", () => {
  const sessionStore = useSessionStore();
  const apiConfigStore = useApiConfigStore();
  const { currentRuntimeUser, currentChannel, desktopMenus, currentUser } =
    storeToRefs(sessionStore);

  const loading = ref(false);
  const buildSettings = ref<UploadBuildSettings | null>(null);
  const darenList = ref<DarenInfo[]>([]);
  const selectedDarenId = ref<string | null>(null);

  const currentDaren = computed<DarenInfo | null>(() => {
    const runtimeUser = currentRuntimeUser.value;
    if (!runtimeUser || !currentChannel.value) {
      return null;
    }

    return {
      id: runtimeUser.id,
      label: runtimeUser.nickname || runtimeUser.account || runtimeUser.id,
      feishuDramaStatusTableId: apiConfigStore.config.dramaStatusTableId,
      enableUpload: desktopMenus.value.upload,
      enableDownload: desktopMenus.value.download,
      enableJuliang: desktopMenus.value.juliangUpload,
      enableJuliangBuild: desktopMenus.value.juliangBuild,
      enableUploadBuild: desktopMenus.value.uploadBuild,
      enableMaterialClip: desktopMenus.value.materialClip,
      uploadBuildSettings: buildSettings.value || undefined,
    };
  });

  const canUpload = computed(() => desktopMenus.value.upload);
  const canDownload = computed(() => desktopMenus.value.download);
  const canJuliang = computed(() => desktopMenus.value.juliangUpload);
  const canUploadBuild = computed(() => desktopMenus.value.uploadBuild);
  const canJuliangBuild = computed(() => desktopMenus.value.juliangBuild);
  const canMaterialClip = computed(() => desktopMenus.value.materialClip);

  function loadBuildSettingsFromStorage() {
    const userId = currentRuntimeUser.value?.id || currentUser.value?.id || "";
    const channelId = currentChannel.value?.id || "";
    const nickname =
      currentRuntimeUser.value?.nickname ||
      currentUser.value?.nickname ||
      "小鱼";

    if (!userId || !channelId) {
      buildSettings.value = normalizeBuildSettings(undefined, nickname);
      return;
    }

    try {
      const raw = localStorage.getItem(
        buildSettingsStorageKey(userId, channelId),
      );
      if (!raw) {
        buildSettings.value = normalizeBuildSettings(undefined, nickname);
        return;
      }
      buildSettings.value = normalizeBuildSettings(
        JSON.parse(raw) as Partial<UploadBuildSettings>,
        nickname,
      );
    } catch (error) {
      console.warn("加载上传搭建本地配置失败:", error);
      buildSettings.value = normalizeBuildSettings(undefined, nickname);
    }
  }

  function saveBuildSettingsToStorage(
    nextSettings?: Partial<UploadBuildSettings>,
  ) {
    const userId = currentRuntimeUser.value?.id || currentUser.value?.id || "";
    const channelId = currentChannel.value?.id || "";
    const nickname =
      currentRuntimeUser.value?.nickname ||
      currentUser.value?.nickname ||
      "小鱼";

    if (!userId || !channelId) {
      buildSettings.value = normalizeBuildSettings(nextSettings, nickname);
      return buildSettings.value;
    }

    const normalizedSettings = normalizeBuildSettings(nextSettings, nickname);
    localStorage.setItem(
      buildSettingsStorageKey(userId, channelId),
      JSON.stringify(normalizedSettings),
    );
    buildSettings.value = normalizedSettings;
    return normalizedSettings;
  }

  async function loadFromServer(forceRefresh = false) {
    if (loading.value && !forceRefresh) {
      return;
    }

    loading.value = true;
    try {
      const session = await sessionStore.loadSession(forceRefresh);
      apiConfigStore.applySessionData(session);
      loadBuildSettingsFromStorage();
      darenList.value = currentDaren.value ? [currentDaren.value] : [];
      selectedDarenId.value = currentDaren.value?.id || null;
    } finally {
      loading.value = false;
    }
  }

  async function updateDaren(id: string, updates: Partial<DarenInfo>) {
    if (id !== currentDaren.value?.id) {
      throw new Error("当前只支持更新当前登录用户在当前渠道下的本地配置");
    }

    const nextSettings = saveBuildSettingsToStorage(
      updates.uploadBuildSettings || currentDaren.value?.uploadBuildSettings,
    );
    const nextDaren = {
      ...currentDaren.value,
      ...updates,
      uploadBuildSettings: nextSettings,
    } as DarenInfo;
    darenList.value = [nextDaren];
    return nextDaren;
  }

  function setSelectedDaren(id: string | null) {
    selectedDarenId.value = id;
  }

  function findDarenById(id: string): DarenInfo | undefined {
    return darenList.value.find((item) => item.id === id);
  }

  return {
    darenList,
    selectedDarenId,
    loading,
    currentDaren,
    canUpload,
    canDownload,
    canJuliang,
    canJuliangBuild,
    canUploadBuild,
    canMaterialClip,
    loadFromServer,
    updateDaren,
    setSelectedDaren,
    findDarenById,
  };
});
