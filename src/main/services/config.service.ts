import { app } from "electron";
import fs from "fs/promises";
import path from "path";
import { RemoteConfigService } from "./remote-config.service";
import type {
  SessionRuntimeData,
  WebSessionService,
} from "./web-session.service";
import {
  FIXED_FEISHU_APP_ID,
  FIXED_FEISHU_APP_SECRET,
  FIXED_FEISHU_APP_TOKEN,
  FIXED_TOS_BUCKET,
  FIXED_TOS_REGION,
} from "../constants/fixed-config";

export interface DarenInfo {
  id: string; // 账户
  label: string; // 名称
  password?: string; // 登录密码
  feishuDramaStatusTableId?: string; // 飞书剧集状态表 ID
  enableUpload?: boolean; // 启用上传功能
  enableDownload?: boolean; // 启用下载功能
  enableJuliang?: boolean; // 启用巨量上传功能
  enableJuliangBuild?: boolean; // 启用巨量搭建功能
  enableUploadBuild?: boolean; // 启用上传搭建功能
  enableMaterialClip?: boolean;
  changduConfigType?: "sanrou" | "meiri" | "custom"; // 常读配置类型：散柔/每日/定制
  customChangduConfig?: ChangduConfig; // 定制的常读配置（当 changduConfigType 为 'custom' 时使用）
  uploadBuildSettings?: UploadBuildSettings; // 上传搭建配置（按达人隔离）
}

export interface DarenConfig {
  darenList: DarenInfo[];
}

// 常读平台配置
export interface ChangduConfig {
  cookie: string;
  distributorId: string;
  changduAppId: string;
  changduAdUserId: string;
  changduRootAdUserId: string;
}

export interface DownloadCenterRequestConfig extends ChangduConfig {
  appType: string;
}

export interface ApiConfig {
  // 常读平台配置（两套）
  sanrouChangdu: ChangduConfig; // 散柔-常读配置
  meiriChangdu: ChangduConfig; // 每日-常读配置
  // 飞书配置
  feishuAppId: string;
  feishuAppSecret: string;
  feishuAppToken: string;
  // TOS 存储配置
  tosAccessKeyId: string;
  tosAccessKeySecret: string;
  tosBucket: string;
  tosRegion: string;
  // 素材库配置
  xtToken: string;
}

import {
  buildEqualPercentages,
  normalizeAllocationMaxPercent,
  normalizeAllocationOrder,
  normalizeAllocationPercent,
  normalizeAllocationWeight,
} from "../../shared/material-allocation";

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

export class ConfigService {
  private darenConfigPath: string;
  private apiConfigPath: string;
  private remoteConfigService: RemoteConfigService;
  private webSessionService: WebSessionService;
  private downloadCenterConfigCache: {
    data: DownloadCenterRequestConfig | null;
    expireAt: number;
  } = {
    data: null,
    expireAt: 0,
  };

  constructor(webSessionService: WebSessionService) {
    const userDataPath = app.getPath("userData");
    this.darenConfigPath = path.join(userDataPath, "daren-config.json");
    this.apiConfigPath = path.join(userDataPath, "api-config.json");
    this.remoteConfigService = new RemoteConfigService();
    this.webSessionService = webSessionService;
  }

  // ==================== 远程配置同步 ====================

  /**
   * 从远程同步配置（覆盖本地）
   */
  async syncFromRemote(): Promise<{
    synced: boolean;
    version?: number;
    error?: string;
  }> {
    try {
      console.log("[ConfigService] 开始从远程同步配置...");
      const remoteConfig = await this.remoteConfigService.fetchConfig();

      if (!remoteConfig) {
        console.log("[ConfigService] 远程配置为空，跳过同步");
        return { synced: false, error: "远程配置为空" };
      }

      // 远程 API 配置不再落地，避免覆盖当前登录渠道的运行时配置与固定值
      if (remoteConfig.apiConfig) {
        console.log(
          "[ConfigService] 检测到远程 API 配置，已按策略忽略（常读/XT Token 走当前登录渠道，飞书/TOS 走固定值）",
        );
      }

      // 保存达人列表
      if (remoteConfig.darenList && remoteConfig.darenList.length > 0) {
        console.log(
          "[ConfigService] 同步达人列表，数量:",
          remoteConfig.darenList.length,
        );
        await this.saveDarenConfig({ darenList: remoteConfig.darenList });
      }

      console.log(
        "[ConfigService] ✓ 远程配置同步完成，版本:",
        remoteConfig.version,
      );
      return { synced: true, version: remoteConfig.version };
    } catch (error) {
      console.error("[ConfigService] ✗ 远程配置同步失败:", error);
      return { synced: false, error: String(error) };
    }
  }

  /**
   * 推送配置到远程
   */
  async pushToRemote(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log("[ConfigService] 开始推送配置到远程...");
      const apiConfig = await this.getApiConfig();
      const darenConfig = await this.getDarenConfig();

      const success = await this.remoteConfigService.pushConfig(
        apiConfig,
        darenConfig.darenList,
      );

      if (success) {
        console.log("[ConfigService] ✓ 配置推送成功");
        return { success: true };
      } else {
        return { success: false, error: "推送失败" };
      }
    } catch (error) {
      console.error("[ConfigService] ✗ 配置推送失败:", error);
      return { success: false, error: String(error) };
    }
  }

  // ==================== 达人配置 ====================

  async getDarenConfig(): Promise<DarenConfig> {
    const runtimeConfig = await this.getCurrentRuntimeConfig();
    if (runtimeConfig?.runtimeUser) {
      return {
        darenList: [this.mapRuntimeToDarenInfo(runtimeConfig)],
      };
    }

    try {
      const data = await fs.readFile(this.darenConfigPath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      // 如果文件不存在，返回默认配置
      const defaultConfig: DarenConfig = { darenList: [] };
      await this.saveDarenConfig(defaultConfig);
      return defaultConfig;
    }
  }

  async saveDarenConfig(config: DarenConfig): Promise<void> {
    await fs.writeFile(
      this.darenConfigPath,
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  }

  async addDaren(daren: DarenInfo): Promise<DarenInfo> {
    const config = await this.getDarenConfig();

    // 检查是否已存在
    const exists = config.darenList.some((d) => d.id === daren.id);
    if (exists) {
      throw new Error(`达人 ID ${daren.id} 已存在`);
    }

    // 规范化数据
    const normalizedDaren = this.normalizeDarenData(daren);
    config.darenList.push(normalizedDaren);

    await this.saveDarenConfig(config);
    return normalizedDaren;
  }

  async updateDaren(
    id: string,
    updates: Partial<DarenInfo>,
  ): Promise<DarenInfo> {
    const config = await this.getDarenConfig();
    const index = config.darenList.findIndex((d) => d.id === id);

    if (index === -1) {
      throw new Error(`达人 ID ${id} 不存在`);
    }

    // 如果更新了 ID，检查新 ID 是否已存在
    if (updates.id && updates.id !== id) {
      const newIdExists = config.darenList.some((d) => d.id === updates.id);
      if (newIdExists) {
        throw new Error(`新 ID ${updates.id} 已被使用`);
      }
    }

    const updatedDaren = this.normalizeDarenData({
      ...config.darenList[index],
      ...updates,
    });

    config.darenList[index] = updatedDaren;
    await this.saveDarenConfig(config);
    return updatedDaren;
  }

  async deleteDaren(id: string): Promise<void> {
    const config = await this.getDarenConfig();
    const index = config.darenList.findIndex((d) => d.id === id);

    if (index === -1) {
      throw new Error(`达人 ID ${id} 不存在`);
    }

    config.darenList.splice(index, 1);
    await this.saveDarenConfig(config);
  }

  findDarenById(darenList: DarenInfo[], userId: string): DarenInfo | undefined {
    return darenList.find((d) => d.id === userId);
  }

  private normalizeDarenData(daren: Partial<DarenInfo>): DarenInfo {
    return {
      id: daren.id || "",
      label: daren.label || "",
      password: daren.password || "",
      feishuDramaStatusTableId: daren.feishuDramaStatusTableId || "",
      enableUpload: daren.enableUpload ?? true,
      enableDownload: daren.enableDownload ?? true,
      enableJuliang: daren.enableJuliang ?? false, // 默认不启用巨量上传
      enableJuliangBuild: daren.enableJuliangBuild ?? false, // 默认不启用巨量搭建
      enableUploadBuild: daren.enableUploadBuild ?? false, // 默认不启用上传搭建
      enableMaterialClip: daren.enableMaterialClip ?? false,
      changduConfigType: daren.changduConfigType || "sanrou", // 默认使用散柔配置
      customChangduConfig: daren.customChangduConfig || undefined, // 定制配置
      uploadBuildSettings: this.normalizeUploadBuildSettings(
        daren.uploadBuildSettings,
      ),
    };
  }

  private createDefaultUploadBuildSettings(): UploadBuildSettings {
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
      darenName: "小鱼",
      materialFilenameTemplate: "{日期}-{剧名}-{简称}-{序号}.mp4",
      materialDateValue: "",
      materialAllocationMode: "ratio",
      douyinMaterialRules: [],
    };
  }

  private normalizeUploadBuildSettings(
    settings?: Partial<UploadBuildSettings>,
  ): UploadBuildSettings {
    const defaultSettings = this.createDefaultUploadBuildSettings();
    const rules = Array.isArray(settings?.douyinMaterialRules)
      ? settings!.douyinMaterialRules
      : [];
    const normalizedRules = rules.map((rule, index) => ({
      ...this.normalizeDouyinMaterialRule(rule),
      order: normalizeAllocationOrder(rule?.order, index + 1),
    }));

    if (
      normalizedRules.length > 0 &&
      normalizedRules.every(
        (rule) => normalizeAllocationPercent(rule.percent) === 0,
      ) &&
      settings?.materialAllocationMode === "average"
    ) {
      const equalPercentages = buildEqualPercentages(normalizedRules.length);
      normalizedRules.forEach((rule, index) => {
        rule.percent = equalPercentages[index] || 0;
        rule.materialRatio = rule.percent;
      });
    }

    return {
      buildParams: {
        ...defaultSettings.buildParams,
        ...(settings?.buildParams || {}),
      },
      darenName: settings?.darenName?.trim() || defaultSettings.darenName,
      materialFilenameTemplate:
        settings?.materialFilenameTemplate?.trim() ||
        defaultSettings.materialFilenameTemplate,
      materialDateValue: settings?.materialDateValue?.trim() || "",
      materialAllocationMode: "ratio",
      douyinMaterialRules: normalizedRules,
    };
  }

  private normalizeDouyinMaterialRule(
    rule?: Partial<DouyinMaterialRule>,
  ): DouyinMaterialRule {
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
      updatedAt: now,
    };
  }

  // ==================== API 配置 ====================

  private createDefaultApiConfig(): ApiConfig {
    return {
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
      // 飞书配置（固定值）
      feishuAppId: FIXED_FEISHU_APP_ID,
      feishuAppSecret: FIXED_FEISHU_APP_SECRET,
      feishuAppToken: FIXED_FEISHU_APP_TOKEN,
      // TOS 存储配置（桶和地域固定；AccessKeyId/Secret 通过 API 动态获取）
      tosAccessKeyId: "",
      tosAccessKeySecret: "",
      tosBucket: FIXED_TOS_BUCKET,
      tosRegion: FIXED_TOS_REGION,
      // 素材库配置
      xtToken: "",
    };
  }

  private normalizeApiConfig(config: Partial<ApiConfig>): ApiConfig {
    const defaultConfig = this.createDefaultApiConfig();
    return {
      ...defaultConfig,
      ...config,
      sanrouChangdu: {
        ...defaultConfig.sanrouChangdu,
        ...(config.sanrouChangdu || {}),
      },
      meiriChangdu: {
        ...defaultConfig.meiriChangdu,
        ...(config.meiriChangdu || {}),
      },
      // 固定配置始终以代码常量为准，不读取远程同步值
      feishuAppId: FIXED_FEISHU_APP_ID,
      feishuAppSecret: FIXED_FEISHU_APP_SECRET,
      feishuAppToken: FIXED_FEISHU_APP_TOKEN,
      tosBucket: FIXED_TOS_BUCKET,
      tosRegion: FIXED_TOS_REGION,
      xtToken: String(config.xtToken || defaultConfig.xtToken || "").trim(),
    };
  }

  async getApiConfig(): Promise<ApiConfig> {
    const runtimeConfig = await this.getCurrentRuntimeConfig();
    if (runtimeConfig) {
      return this.mapRuntimeToApiConfig(runtimeConfig);
    }

    try {
      const data = await fs.readFile(this.apiConfigPath, "utf-8");
      const parsed = JSON.parse(data) as Partial<ApiConfig>;
      return this.normalizeApiConfig(parsed);
    } catch (error) {
      // 如果文件不存在，返回默认配置
      const defaultConfig = this.createDefaultApiConfig();
      await this.saveApiConfig(defaultConfig);
      return defaultConfig;
    }
  }

  async saveApiConfig(config: ApiConfig): Promise<void> {
    const normalizedConfig = this.normalizeApiConfig(config);
    await fs.writeFile(
      this.apiConfigPath,
      JSON.stringify(normalizedConfig, null, 2),
      "utf-8",
    );
  }

  async getCurrentRuntimeConfig(): Promise<SessionRuntimeData | null> {
    return await this.webSessionService.getSession();
  }

  getWebSessionHeaders(
    extraHeaders: Record<string, string> = {},
  ): Record<string, string> {
    const headers: Record<string, string> = { ...extraHeaders };
    const token = this.webSessionService.getToken().trim();
    const channelId = this.webSessionService.getSelectedChannelId().trim();

    if (token) {
      headers["X-Studio-Token"] = token;
    }

    if (channelId) {
      headers["X-Studio-Channel-Id"] = channelId;
    }

    return headers;
  }

  async getDownloadCenterRequestConfig(
    fallbackConfig: ChangduConfig,
  ): Promise<DownloadCenterRequestConfig> {
    const now = Date.now();
    if (
      this.downloadCenterConfigCache.data &&
      this.downloadCenterConfigCache.expireAt > now
    ) {
      return this.downloadCenterConfigCache.data;
    }

    try {
      const axios = (await import("axios")).default;
      const response = await axios.get(
        "https://cxyy.top/api/public/download-center/default",
        {
          timeout: 15000,
        },
      );

      const raw = response.data;
      const data = raw?.data && typeof raw.data === "object" ? raw.data : raw;

      if (!data || typeof data !== "object") {
        throw new Error("响应数据为空");
      }

      const remoteConfig: DownloadCenterRequestConfig = {
        cookie: String(data.cookie || "").trim(),
        distributorId: String(data.distributorId || "").trim(),
        changduAppId: String(data.appId || "").trim(),
        changduAdUserId: String(data.adUserId || "").trim(),
        changduRootAdUserId: String(
          data.rootAdUserId || data.adUserId || "",
        ).trim(),
        appType: String(data.appType || "7").trim() || "7",
      };

      if (
        !remoteConfig.cookie ||
        !remoteConfig.distributorId ||
        !remoteConfig.changduAppId ||
        !remoteConfig.changduAdUserId
      ) {
        throw new Error("默认下载中心配置字段不完整");
      }

      this.downloadCenterConfigCache = {
        data: remoteConfig,
        expireAt: now + 5 * 60 * 1000,
      };

      console.log("[ConfigService] 已加载远程下载中心默认配置");
      return remoteConfig;
    } catch (error) {
      console.warn(
        "[ConfigService] 获取远程下载中心默认配置失败，回退当前常读配置:",
        error,
      );

      return {
        ...fallbackConfig,
        appType: "7",
      };
    }
  }

  private mapRuntimeToApiConfig(runtimeConfig: SessionRuntimeData): ApiConfig {
    const channelConfig = runtimeConfig.platforms?.changdu?.channel;
    const mappedChangduConfig: ChangduConfig = {
      cookie: String(channelConfig?.cookie || "").trim(),
      distributorId: String(channelConfig?.distributorId || "").trim(),
      changduAppId: String(channelConfig?.appId || "").trim(),
      changduAdUserId: String(channelConfig?.adUserId || "").trim(),
      changduRootAdUserId: String(channelConfig?.rootAdUserId || "").trim(),
    };

    return this.normalizeApiConfig({
      sanrouChangdu: mappedChangduConfig,
      meiriChangdu: mappedChangduConfig,
      feishuAppId: FIXED_FEISHU_APP_ID,
      feishuAppSecret: FIXED_FEISHU_APP_SECRET,
      feishuAppToken: FIXED_FEISHU_APP_TOKEN,
      tosAccessKeyId: "",
      tosAccessKeySecret: "",
      tosBucket: FIXED_TOS_BUCKET,
      tosRegion: FIXED_TOS_REGION,
      xtToken: String(runtimeConfig.runtimeUser?.xtToken || "").trim(),
    });
  }

  private mapRuntimeToDarenInfo(runtimeConfig: SessionRuntimeData): DarenInfo {
    const runtimeUser = runtimeConfig.runtimeUser;
    const desktopMenus = runtimeUser?.permissions?.desktopMenus;
    const buildConfig = runtimeConfig.buildConfig;
    const douyinMaterialRules = Array.isArray(
      runtimeUser?.douyinMaterialMatches,
    )
      ? runtimeUser.douyinMaterialMatches.map((item) =>
          this.normalizeDouyinMaterialRule({
            id: item.id,
            douyinAccount: item.douyinAccount,
            douyinAccountId: item.douyinAccountId,
            percent: item.percent,
            maxPercent: item.maxPercent,
            locked: item.locked,
            weight: item.weight,
            order: item.order,
            materialRange: item.materialRange,
            materialRatio: item.materialRatio,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          }),
        )
      : [];

    return this.normalizeDarenData({
      id: runtimeUser?.id || runtimeConfig.user.id,
      label: runtimeUser?.nickname || runtimeConfig.user.nickname,
      feishuDramaStatusTableId: runtimeConfig.feishu.dramaStatusTableId,
      enableUpload: desktopMenus?.upload,
      enableDownload: desktopMenus?.download,
      enableJuliang: desktopMenus?.juliangUpload,
      enableJuliangBuild: desktopMenus?.juliangBuild,
      enableUploadBuild: desktopMenus?.uploadBuild,
      enableMaterialClip: desktopMenus?.materialClip,
      uploadBuildSettings: {
        buildParams: {
          distributorId: runtimeConfig.platforms.changdu.channel.distributorId,
          secretKey: buildConfig.secretKey,
          source: buildConfig.source,
          bid: 5,
          productId: buildConfig.productId,
          productPlatformId: buildConfig.productPlatformId,
          landingUrl: buildConfig.landingUrl,
          microAppName: buildConfig.microAppName,
          microAppId: buildConfig.microAppId,
          microAppInstanceId: buildConfig.microAppInstanceId,
          ccId: buildConfig.ccId,
          rechargeTemplateId: buildConfig.rechargeTemplateId,
        },
        darenName: runtimeUser?.nickname || runtimeConfig.user.nickname,
        materialFilenameTemplate: "{日期}-{剧名}-{简称}-{序号}.mp4",
        materialDateValue: "",
        materialAllocationMode: "ratio",
        douyinMaterialRules,
      },
    });
  }
}
