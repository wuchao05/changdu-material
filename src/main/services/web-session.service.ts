import { app } from "electron";
import fs from "fs/promises";
import path from "path";
import axios, { type AxiosRequestConfig } from "axios";

const WEB_API_BASE_URL = "https://cxyy.top/api";

export interface DesktopMenus {
  download: boolean;
  materialClip: boolean;
  upload: boolean;
  juliangUpload: boolean;
  uploadBuild: boolean;
  juliangBuild: boolean;
}

export interface RuntimePermissions {
  syncAccount: boolean;
  desktopMenus: DesktopMenus;
}

export interface RuntimeFeishuConfig {
  dramaListTableId: string;
  dramaStatusTableId: string;
  accountTableId: string;
}

export interface RuntimeChannelSummary {
  id: string;
  name: string;
}

export interface RuntimeChangduChannelConfig {
  cookie: string;
  distributorId: string;
  adUserId: string;
  rootAdUserId: string;
  appId: string;
}

export interface RuntimeBuildConfig {
  secretKey: string;
  source: string;
  productId: string;
  productPlatformId: string;
  landingUrl: string;
  microAppName: string;
  microAppId: string;
  microAppInstanceId: string;
  ccId: string;
  rechargeTemplateId: string;
  adCallbackConfigId?: string;
  advanceHoursAfterTen: string;
  advanceHoursBeforeTen: string;
}

export interface RuntimeUserProfile {
  id: string;
  nickname: string;
  account: string;
  userType: "admin" | "normal";
  channelIds: string[];
  defaultChannelId: string;
  xtToken?: string;
  permissions?: RuntimePermissions;
  feishu?: RuntimeFeishuConfig;
  douyinMaterialMatches?: Array<{
    id: string;
    douyinAccount: string;
    douyinAccountId: string;
    percent?: number;
    maxPercent?: number;
    locked?: boolean;
    weight?: number;
    order?: number;
    materialRange?: string;
    materialRatio?: number;
    createdAt?: string;
    updatedAt?: string;
  }>;
}

export interface SessionRuntimeData {
  user: RuntimeUserProfile;
  runtimeUser: RuntimeUserProfile | null;
  channel: RuntimeChannelSummary | null;
  availableChannels: RuntimeChannelSummary[];
  platforms: {
    changdu: {
      channel: RuntimeChangduChannelConfig;
    };
    juliang: {
      channel: string;
    };
    adx?: {
      cookie: string;
    };
  };
  feishu: RuntimeFeishuConfig;
  buildConfig: RuntimeBuildConfig;
}

export interface ChangduSeriesSearchItem {
  bookId: string;
  seriesName: string;
}

interface ChangduSeriesListItemPayload {
  book_id?: string;
  series_name?: string;
}

interface ChangduSeriesListResponse {
  data?: ChangduSeriesListItemPayload[];
  total?: number;
}

interface PersistedSessionState {
  token: string;
  selectedChannelId: string;
}

function normalizeDesktopMenus(menus?: Partial<DesktopMenus>): DesktopMenus {
  return {
    download: Boolean(menus?.download),
    materialClip: Boolean(menus?.materialClip),
    upload: Boolean(menus?.upload),
    juliangUpload: Boolean(menus?.juliangUpload),
    uploadBuild: Boolean(menus?.uploadBuild),
    juliangBuild: Boolean(menus?.juliangBuild),
  };
}

function normalizeRuntimeUser(
  user?: Partial<RuntimeUserProfile> | null,
): RuntimeUserProfile | null {
  if (!user) {
    return null;
  }

  return {
    id: String(user.id || "").trim(),
    nickname: String(user.nickname || "").trim(),
    account: String(user.account || "").trim(),
    userType: user.userType === "admin" ? "admin" : "normal",
    channelIds: Array.isArray(user.channelIds)
      ? user.channelIds.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    defaultChannelId: String(user.defaultChannelId || "").trim(),
    xtToken: String(user.xtToken || "").trim(),
    permissions: {
      syncAccount: Boolean(user.permissions?.syncAccount),
      desktopMenus: normalizeDesktopMenus(user.permissions?.desktopMenus),
    },
    feishu: {
      dramaListTableId: String(user.feishu?.dramaListTableId || "").trim(),
      dramaStatusTableId: String(user.feishu?.dramaStatusTableId || "").trim(),
      accountTableId: String(user.feishu?.accountTableId || "").trim(),
    },
    douyinMaterialMatches: Array.isArray(user.douyinMaterialMatches)
      ? user.douyinMaterialMatches.map((item) => ({
          id: String(item.id || "").trim(),
          douyinAccount: String(item.douyinAccount || "").trim(),
          douyinAccountId: String(item.douyinAccountId || "").trim(),
          percent: Number(item.percent ?? item.materialRatio ?? 0),
          maxPercent: Number(item.maxPercent ?? 100),
          locked: Boolean(item.locked),
          weight: Math.max(0, Math.round(Number(item.weight ?? 1))),
          order: Math.max(1, Math.round(Number(item.order ?? 1))),
          materialRange: String(item.materialRange || "").trim(),
          materialRatio: Math.max(
            0,
            Math.min(100, Math.round(Number(item.materialRatio ?? 0))),
          ),
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        }))
      : [],
  };
}

function normalizeSessionRuntimeData(
  data?: Partial<SessionRuntimeData> | null,
): SessionRuntimeData | null {
  if (!data?.user) {
    return null;
  }

  const normalizedUser = normalizeRuntimeUser(data.user);
  const normalizedRuntimeUser = normalizeRuntimeUser(data.runtimeUser);
  if (!normalizedUser) {
    return null;
  }

  return {
    user: normalizedUser,
    runtimeUser: normalizedRuntimeUser,
    channel: data.channel
      ? {
          id: String(data.channel.id || "").trim(),
          name: String(data.channel.name || "").trim(),
        }
      : null,
    availableChannels: Array.isArray(data.availableChannels)
      ? data.availableChannels.map((item) => ({
          id: String(item.id || "").trim(),
          name: String(item.name || "").trim(),
        }))
      : [],
    platforms: {
      changdu: {
        channel: {
          cookie: String(data.platforms?.changdu?.channel?.cookie || "").trim(),
          distributorId: String(
            data.platforms?.changdu?.channel?.distributorId || "",
          ).trim(),
          adUserId: String(
            data.platforms?.changdu?.channel?.adUserId || "",
          ).trim(),
          rootAdUserId: String(
            data.platforms?.changdu?.channel?.rootAdUserId || "",
          ).trim(),
          appId: String(data.platforms?.changdu?.channel?.appId || "").trim(),
        },
      },
      juliang: {
        channel: String(data.platforms?.juliang?.channel || "").trim(),
      },
      adx: {
        cookie: String(data.platforms?.adx?.cookie || "").trim(),
      },
    },
    feishu: {
      dramaListTableId: String(data.feishu?.dramaListTableId || "").trim(),
      dramaStatusTableId: String(data.feishu?.dramaStatusTableId || "").trim(),
      accountTableId: String(data.feishu?.accountTableId || "").trim(),
    },
    buildConfig: {
      secretKey: String(data.buildConfig?.secretKey || "").trim(),
      source: String(data.buildConfig?.source || "").trim(),
      productId: String(data.buildConfig?.productId || "").trim(),
      productPlatformId: String(
        data.buildConfig?.productPlatformId || "",
      ).trim(),
      landingUrl: String(data.buildConfig?.landingUrl || "").trim(),
      microAppName: String(data.buildConfig?.microAppName || "").trim(),
      microAppId: String(data.buildConfig?.microAppId || "").trim(),
      microAppInstanceId: String(
        data.buildConfig?.microAppInstanceId || "",
      ).trim(),
      ccId: String(data.buildConfig?.ccId || "").trim(),
      rechargeTemplateId: String(
        data.buildConfig?.rechargeTemplateId || "",
      ).trim(),
      adCallbackConfigId: String(
        data.buildConfig?.adCallbackConfigId || "",
      ).trim(),
      advanceHoursAfterTen: String(
        data.buildConfig?.advanceHoursAfterTen || "0",
      ).trim(),
      advanceHoursBeforeTen: String(
        data.buildConfig?.advanceHoursBeforeTen || "0",
      ).trim(),
    },
  };
}

export class WebSessionService {
  private stateFilePath: string;
  private token = "";
  private selectedChannelId = "";
  private runtimeData: SessionRuntimeData | null = null;
  private loaded = false;

  constructor() {
    this.stateFilePath = path.join(app.getPath("userData"), "web-session.json");
  }

  private async ensureLoaded() {
    if (this.loaded) {
      return;
    }

    this.loaded = true;

    try {
      const content = await fs.readFile(this.stateFilePath, "utf-8");
      const parsed = JSON.parse(content) as Partial<PersistedSessionState>;
      this.token = String(parsed.token || "").trim();
      this.selectedChannelId = String(parsed.selectedChannelId || "").trim();
    } catch {
      this.token = "";
      this.selectedChannelId = "";
    }
  }

  private async persistState() {
    const payload: PersistedSessionState = {
      token: this.token,
      selectedChannelId: this.selectedChannelId,
    };
    await fs.writeFile(
      this.stateFilePath,
      JSON.stringify(payload, null, 2),
      "utf-8",
    );
  }

  private async request<T>(
    pathName: string,
    config: AxiosRequestConfig = {},
  ): Promise<T> {
    await this.ensureLoaded();

    const headers: Record<string, string> = {
      ...(config.headers as Record<string, string> | undefined),
    };

    if (this.token) {
      headers["X-Studio-Token"] = this.token;
    }

    if (this.selectedChannelId) {
      headers["X-Studio-Channel-Id"] = this.selectedChannelId;
    }

    const response = await axios({
      baseURL: WEB_API_BASE_URL,
      timeout: 20000,
      validateStatus: () => true,
      ...config,
      url: pathName,
      headers,
    });

    const payload = response.data as {
      code?: number;
      message?: string;
      data?: T;
      error?: string;
    };

    if (response.status === 401) {
      await this.clearState();
      throw new Error(payload?.message || "登录已失效");
    }

    if (
      response.status >= 400 ||
      (payload?.code !== undefined && payload.code !== 0)
    ) {
      throw new Error(payload?.message || payload?.error || "请求失败");
    }

    return payload.data as T;
  }

  private async clearState() {
    this.token = "";
    this.selectedChannelId = "";
    this.runtimeData = null;
    await this.persistState();
  }

  async getAuthHeaders(): Promise<Record<string, string>> {
    await this.ensureLoaded();

    const headers: Record<string, string> = {};
    if (this.token) {
      headers["X-Studio-Token"] = this.token;
    }
    if (this.selectedChannelId) {
      headers["X-Studio-Channel-Id"] = this.selectedChannelId;
    }
    return headers;
  }

  async login(account: string, password: string): Promise<SessionRuntimeData> {
    await this.ensureLoaded();

    const payload = await this.request<{
      token: string;
      user: RuntimeUserProfile;
      channel: RuntimeChannelSummary | null;
    }>("/session/login", {
      method: "POST",
      data: { account, password },
    });

    this.token = String(payload.token || "").trim();
    this.selectedChannelId = String(payload.channel?.id || "").trim();
    await this.persistState();

    return await this.refreshSession();
  }

  async logout(): Promise<void> {
    await this.ensureLoaded();

    try {
      if (this.token) {
        await this.request<void>("/session/logout", {
          method: "POST",
        });
      }
    } catch (error) {
      console.warn("[WebSession] 退出登录请求失败，执行本地清理:", error);
    } finally {
      await this.clearState();
    }
  }

  async refreshSession(): Promise<SessionRuntimeData> {
    const data = await this.request<SessionRuntimeData>("/session/me", {
      method: "GET",
    });

    const normalizedData = normalizeSessionRuntimeData(data);
    if (!normalizedData) {
      throw new Error("会话数据不完整");
    }

    const availableChannels = normalizedData.availableChannels;
    if (
      this.selectedChannelId &&
      !availableChannels.some((item) => item.id === this.selectedChannelId)
    ) {
      this.selectedChannelId =
        normalizedData.channel?.id ||
        normalizedData.user.defaultChannelId ||
        "";
      await this.persistState();
      return this.refreshSession();
    }

    if (!this.selectedChannelId && normalizedData.channel?.id) {
      this.selectedChannelId = normalizedData.channel.id;
      await this.persistState();
    }

    this.runtimeData = normalizedData;
    return normalizedData;
  }

  async getSession(): Promise<SessionRuntimeData | null> {
    await this.ensureLoaded();

    if (!this.token) {
      this.runtimeData = null;
      return null;
    }

    if (this.runtimeData) {
      return this.runtimeData;
    }

    try {
      return await this.refreshSession();
    } catch (error) {
      console.warn("[WebSession] 获取会话失败:", error);
      return null;
    }
  }

  async switchChannel(channelId: string): Promise<SessionRuntimeData> {
    await this.ensureLoaded();
    this.selectedChannelId = String(channelId || "").trim();
    await this.persistState();
    return await this.refreshSession();
  }

  async listUsers() {
    return await this.request<Array<RuntimeUserProfile>>("/admin/users", {
      method: "GET",
    });
  }

  async updateUser(id: string, payload: Record<string, unknown>) {
    return await this.request<RuntimeUserProfile>(`/admin/users/${id}`, {
      method: "PUT",
      data: payload,
    });
  }

  async searchChangduSeries(
    query: string,
  ): Promise<ChangduSeriesSearchItem | null> {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      return null;
    }

    const searchType = /^\d+$/.test(normalizedQuery) ? 1 : 2;
    const response = await this.request<ChangduSeriesListResponse>(
      "/novelsale/distributor/content/series/list/v1",
      {
        method: "GET",
        params: {
          delivery_status: 1,
          permission_statuses: "3,4",
          page_index: 0,
          page_size: 10,
          query: normalizedQuery,
          search_type: searchType,
        },
      },
    );

    const items = Array.isArray(response?.data)
      ? response.data
          .map((item) => ({
            bookId: String(item?.book_id || "").trim(),
            seriesName: String(item?.series_name || "").trim(),
          }))
          .filter((item) => item.bookId && item.seriesName)
      : [];

    if (!items.length) {
      return null;
    }

    if (searchType === 1) {
      return items.find((item) => item.bookId === normalizedQuery) || null;
    }

    const normalizedQueryText = normalizedQuery.replace(/\s+/g, "");
    return (
      items.find(
        (item) => item.seriesName.replace(/\s+/g, "") === normalizedQueryText,
      ) || null
    );
  }

  getSelectedChannelId(): string {
    return this.selectedChannelId;
  }

  getToken(): string {
    return this.token;
  }
}
