import { app } from "electron";
import fs from "fs/promises";
import path from "path";
import { RemoteConfigService } from "./remote-config.service";

export interface DarenInfo {
  id: string; // 账户
  label: string; // 名称
  password?: string; // 登录密码
  feishuDramaStatusTableId?: string; // 飞书剧集状态表 ID
  enableUpload?: boolean; // 启用上传功能
  enableDownload?: boolean; // 启用下载功能
  enableJuliang?: boolean; // 启用巨量上传功能
  changduConfigType?: 'sanrou' | 'meiri' | 'custom'; // 常读配置类型：散柔/每日/定制
  customChangduConfig?: ChangduConfig; // 定制的常读配置（当 changduConfigType 为 'custom' 时使用）
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

export interface ApiConfig {
  // 常读平台配置（两套）
  sanrouChangdu: ChangduConfig; // 散柔-常读配置
  meiriChangdu: ChangduConfig; // 每日-常读配置
  // 飞书配置
  feishuAppId: string;
  feishuAppSecret: string;
  feishuAppToken: string;
  feishuDramaStatusTableId: string; // 管理员用的剧集状态表 ID
  // TOS 存储配置
  tosAccessKeyId: string;
  tosAccessKeySecret: string;
  tosBucket: string;
  tosRegion: string;
  // 素材库配置
  xtToken: string;
}

export class ConfigService {
  private darenConfigPath: string;
  private apiConfigPath: string;
  private remoteConfigService: RemoteConfigService;

  constructor() {
    const userDataPath = app.getPath("userData");
    this.darenConfigPath = path.join(userDataPath, "daren-config.json");
    this.apiConfigPath = path.join(userDataPath, "api-config.json");
    this.remoteConfigService = new RemoteConfigService();
  }

  // ==================== Auth 配置获取 ====================

  /**
   * 从 cxyy.top/api/auth/config 获取常读配置和素材库 Token
   * 只覆盖常读配置和 xtToken，不影响飞书、TOS 等其他配置
   */
  async fetchAuthConfig(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log("[ConfigService] 开始获取 Auth 配置...");
      const axios = (await import("axios")).default;
      const response = await axios.get("https://cxyy.top/api/auth/config", {
        timeout: 15000,
      });

      const data = response.data;
      if (!data) {
        return { success: false, error: "响应数据为空" };
      }

      // 读取当前本地配置
      const localConfig = await this.getApiConfig();

      // 映射 tokens.xh → xtToken
      if (!data.tokens?.xh) {
        localConfig.xtToken = "";
        await this.saveApiConfig(localConfig);
        console.warn("[ConfigService] Auth 配置缺少 tokens.xh，已清空 xtToken");
        return { success: false, error: "Auth 配置缺少 tokens.xh" };
      }
      localConfig.xtToken = data.tokens.xh;

      // 映射 platforms.changdu.sr → sanrouChangdu
      const sr = data.platforms?.changdu?.sr;
      if (sr) {
        if (sr.cookie) localConfig.sanrouChangdu.cookie = sr.cookie;
        if (sr.distributorId) localConfig.sanrouChangdu.distributorId = sr.distributorId;
        if (sr.appId) localConfig.sanrouChangdu.changduAppId = sr.appId;
        if (sr.adUserId) localConfig.sanrouChangdu.changduAdUserId = sr.adUserId;
        if (sr.rootAdUserId) localConfig.sanrouChangdu.changduRootAdUserId = sr.rootAdUserId;
      }

      // 映射 platforms.changdu.mr → meiriChangdu
      const mr = data.platforms?.changdu?.mr;
      if (mr) {
        if (mr.cookie) localConfig.meiriChangdu.cookie = mr.cookie;
        if (mr.distributorId) localConfig.meiriChangdu.distributorId = mr.distributorId;
        if (mr.appId) localConfig.meiriChangdu.changduAppId = mr.appId;
        if (mr.adUserId) localConfig.meiriChangdu.changduAdUserId = mr.adUserId;
        if (mr.rootAdUserId) localConfig.meiriChangdu.changduRootAdUserId = mr.rootAdUserId;
      }

      await this.saveApiConfig(localConfig);
      console.log("[ConfigService] Auth 配置获取并保存成功");
      return { success: true };
    } catch (error) {
      console.error("[ConfigService] Auth 配置获取失败:", error);
      return { success: false, error: String(error) };
    }
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

      // 保存 API 配置
      if (remoteConfig.apiConfig) {
        console.log("[ConfigService] 同步 API 配置...");
        const syncedApiConfig: ApiConfig = {
          ...remoteConfig.apiConfig,
          // xtToken 只允许由 fetchAuthConfig(cxyy) 更新，远程配置同步时强制清空
          xtToken: "",
        };
        await this.saveApiConfig(syncedApiConfig);
      }

      // 保存达人列表
      if (remoteConfig.darenList && remoteConfig.darenList.length > 0) {
        console.log(
          "[ConfigService] 同步达人列表，数量:",
          remoteConfig.darenList.length
        );
        await this.saveDarenConfig({ darenList: remoteConfig.darenList });
      }

      console.log(
        "[ConfigService] ✓ 远程配置同步完成，版本:",
        remoteConfig.version
      );
      // 远程同步后，立即从 Auth 接口回填 xtToken，避免使用远程旧值
      const authResult = await this.fetchAuthConfig();
      if (!authResult.success) {
        console.warn("[ConfigService] 远程同步后获取 Auth 配置失败:", authResult.error);
      }
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
        darenConfig.darenList
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
      "utf-8"
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
    updates: Partial<DarenInfo>
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
      changduConfigType: daren.changduConfigType || 'sanrou', // 默认使用散柔配置
      customChangduConfig: daren.customChangduConfig || undefined, // 定制配置
    };
  }

  // ==================== API 配置 ====================

  async getApiConfig(): Promise<ApiConfig> {
    try {
      const data = await fs.readFile(this.apiConfigPath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      // 如果文件不存在，返回默认配置
      const defaultConfig: ApiConfig = {
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
      };
      await this.saveApiConfig(defaultConfig);
      return defaultConfig;
    }
  }

  async saveApiConfig(config: ApiConfig): Promise<void> {
    await fs.writeFile(
      this.apiConfigPath,
      JSON.stringify(config, null, 2),
      "utf-8"
    );
  }
}
