import { BrowserWindow } from "electron";
import crypto from "crypto";
import FormData from "form-data";
import type {
  ConfigService,
  DouyinMaterialRule,
  UploadBuildSettings,
} from "./config.service";
import {
  allocateMaterialCountsByPercent,
  normalizeAllocationPercent,
} from "../../shared/material-allocation";
import { juliangService } from "./juliang.service";
import { materialPreviewService } from "./material-preview.service";
import type { WebSessionService } from "./web-session.service";

const DAILY_BUILD_CONFIG = {
  changduBaseUrl: "https://www.changdupingtai.com/novelsale/openapi",
  promotion: {
    index: 1,
    mediaSource: 1,
    price: 150,
    startChapter: 10,
  },
  event: {
    linkName: "其他",
    eventEnum: "14",
    eventType: "active_pay",
    eventName: "付费",
    trackTypes: [12],
    statisticalMethodType: 2,
  },
  project: {
    budget: 300,
    inventoryCatalog: 5,
    flowControlMode: 0,
    budgetMode: 0,
  },
  promotionMaterial: {
    productName: "热播短剧",
    sellingPoint: "爆款短剧推荐",
    callToAction: "精彩继续",
  },
  coverImageUrl: "https://cxyy.top/api/build-workflow/cover-image",
};

export type DailyBuildTaskStatus =
  | "assetizing"
  | "building"
  | "completed"
  | "failed"
  | "cancelled";

export interface DailyBuildTaskPayload {
  taskId: string;
  drama: string;
  dramaId: string;
  accountId: string;
  files: string[];
  darenId: string;
  buildSettings: UploadBuildSettings;
  postBuildPreview?: {
    enabled?: boolean;
    delaysMinutes?: number[];
  };
}

export interface DailyBuildMaterialPreviewSchedule {
  enabled: boolean;
  scheduledCount: number;
  delaysMinutes: number[];
  error?: string;
}

export interface DailyBuildProgress {
  taskId: string;
  drama: string;
  status: DailyBuildTaskStatus;
  message: string;
  currentRuleIndex: number;
  totalRules: number;
  successRuleCount: number;
  failedRuleCount: number;
}

export interface DailyBuildTaskState extends DailyBuildProgress {
  updatedAt: string;
}

export interface DailyBuildSkippedRule {
  ruleId: string;
  douyinAccount: string;
  error: string;
}

export interface DailyBuildResult {
  success: boolean;
  cancelled?: boolean;
  taskId: string;
  drama: string;
  totalRules: number;
  successRuleCount: number;
  failedRuleCount: number;
  skippedRules: DailyBuildSkippedRule[];
  error?: string;
  materialPreviewSchedule?: DailyBuildMaterialPreviewSchedule;
}

interface CoverImageInfo {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

interface MicroAppInfo {
  micro_app_instance_id: string;
  app_id?: string;
  start_page?: string;
  status?: number;
  instance_id?: string;
}

interface MicroAppAssetInfo {
  assets_id: string | number;
  micro_app_instance_id?: string;
  micro_app_id?: string;
}

interface DailyBuildInitData {
  assets_id: string | number;
  micro_app_instance_id: string;
  app_id: string;
  start_page: string;
  app_type: number;
  start_params: string;
  link: string;
  product_image_width: number;
  product_image_height: number;
  product_image_uri: string;
}

interface GiantMaterial {
  video_id: string;
  filename: string;
  video_name?: string;
  image_info?: Array<{
    width?: number;
    height?: number;
    web_uri?: string;
    sign_url?: string;
  }>;
  video_info?: {
    width?: number;
    height?: number;
    bitrate?: number;
    thumb_height?: number;
    thumb_width?: number;
    duration?: number;
    status?: number;
    initial_size?: number;
    file_md5?: string;
  };
  cover_uri?: string;
  video_poster_uri?: string;
  sign_url?: string;
  [key: string]: unknown;
}

interface RuleMaterialAllocationPlan {
  rule: DouyinMaterialRule;
  sequences: string[];
}

interface PrefetchedRuleBuildData {
  iesCoreId: string;
  materials: GiantMaterial[];
}

interface DailyBuildTaskRuntime {
  controller: AbortController;
  payload: DailyBuildTaskPayload;
}

function md5Lower(value: string): string {
  return crypto
    .createHash("md5")
    .update(value, "utf8")
    .digest("hex")
    .toLowerCase();
}

function buildChangduPostHeaders(
  body: Record<string, unknown>,
  distributorId: string,
  secretKey: string,
): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const paramsValue = JSON.stringify(body);
  const sign = md5Lower(`${distributorId}${secretKey}${ts}${paramsValue}`);
  return {
    "header-sign": sign,
    "header-ts": String(ts),
  };
}

function sanitizeDramaName(name: string): string {
  return name.replace(
    /[，。：；！？、''""（）《》【】……—·\s,.:;!?()\[\]{}'"<>\/\\|~`@#$%^&*+=]/g,
    "",
  );
}

function formatBuildDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function resolveDarenName(buildSettings: UploadBuildSettings): string {
  return String(buildSettings.darenName || "").trim() || "小鱼";
}

function parsePromotionUrl(url: string): {
  launchPage: string;
  launchParams: string;
} {
  if (!url) {
    return { launchPage: "", launchParams: "" };
  }
  const [page, params] = url.split("?");
  return {
    launchPage: page,
    launchParams: params || "",
  };
}

function extractAppIdFromParams(params: string): string {
  const match = params.match(/app_id=([^&]+)/);
  return match ? match[1] : "";
}

function generateRandomString(length: number): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateUniqId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  const timestamp = `${year}${month}${day}${hour}${minute}${second}`;
  const threeDigits = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `W${timestamp}${threeDigits}${generateRandomString(8)}`;
}

function generateBdpsum(): string {
  return generateRandomString(7);
}

function generateMicroAppLink(params: {
  appId: string;
  startPage: string;
  startParams: string;
}): string {
  const { appId, startPage, startParams } = params;
  const uniqId = generateUniqId();
  const bdpsum = generateBdpsum();
  const paramsMap = new Map<string, string>();

  startParams.split("&").forEach((pair) => {
    const [key, value] = pair.split("=");
    if (key && value) {
      paramsMap.set(key, value);
    }
  });

  const orderedKeys = [
    "advertiser_id",
    "aid",
    "click_id",
    "code",
    "item_source",
    "media_source",
    "mid1",
    "mid2",
    "mid3",
    "mid4",
    "mid5",
    "request_id",
    "tt_album_id",
    "tt_episode_id",
  ];

  const orderedParams: string[] = [];
  orderedKeys.forEach((key) => {
    if (paramsMap.has(key)) {
      orderedParams.push(`${key}=${paramsMap.get(key)}`);
    }
  });
  paramsMap.forEach((value, key) => {
    if (!orderedKeys.includes(key)) {
      orderedParams.push(`${key}=${value}`);
    }
  });

  const bdpLog = encodeURIComponent('{"launch_from":"ad","location":""}');
  const startPageValue = encodeURIComponent(
    `${startPage}?${orderedParams.join("&")}`,
  );

  return (
    `sslocal://microapp?app_id=${appId}` +
    `&bdp_log=${bdpLog}` +
    `&scene=0` +
    `&start_page=${startPageValue}` +
    `&uniq_id=${uniqId}` +
    `&version=v2` +
    `&version_type=current` +
    `&bdpsum=${bdpsum}`
  );
}

function getConfiguredMicroApp(
  buildSettings: UploadBuildSettings,
): MicroAppInfo {
  const microAppInstanceId = String(
    buildSettings.buildParams.microAppInstanceId || "",
  ).trim();
  const microAppId = String(buildSettings.buildParams.microAppId || "").trim();

  if (!microAppInstanceId) {
    throw new Error("当前未配置小程序实例 ID");
  }

  return {
    micro_app_instance_id: microAppInstanceId,
    app_id: microAppId,
    start_page: "",
  };
}

function findConfiguredMicroAppAsset(
  assets: unknown,
  buildSettings: UploadBuildSettings,
): MicroAppAssetInfo | null {
  const microApps = Array.isArray(assets)
    ? (assets as Array<Partial<MicroAppAssetInfo>>)
    : [];
  const targetInstanceId = String(
    buildSettings.buildParams.microAppInstanceId || "",
  ).trim();
  const targetMicroAppId = String(
    buildSettings.buildParams.microAppId || "",
  ).trim();

  if (targetInstanceId) {
    const matched = microApps.find(
      (item) =>
        String(item.micro_app_instance_id || "").trim() === targetInstanceId,
    );
    return matched?.assets_id
      ? {
          assets_id: matched.assets_id,
          micro_app_instance_id: matched.micro_app_instance_id,
          micro_app_id: matched.micro_app_id,
        }
      : null;
  }

  if (!targetMicroAppId) {
    return null;
  }

  const matched = microApps.find(
    (item) => String(item.micro_app_id || "").trim() === targetMicroAppId,
  );
  return matched?.assets_id
    ? {
        assets_id: matched.assets_id,
        micro_app_instance_id: matched.micro_app_instance_id,
        micro_app_id: matched.micro_app_id,
      }
    : null;
}

function resolveMaterialDateValue(dateValue?: string): string {
  const normalizedDateValue = String(dateValue || "").trim();
  if (normalizedDateValue) {
    return normalizedDateValue;
  }

  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(new Date());
  const month =
    parts.find((part) => part.type === "month")?.value ||
    String(new Date().getMonth() + 1);
  const day =
    parts.find((part) => part.type === "day")?.value ||
    String(new Date().getDate());
  return `${month}.${day}`;
}

function normalizeTemplateFileName(fileName: string): string {
  return fileName
    .replace(/-{2,}/g, "-")
    .replace(/-+\./g, ".")
    .replace(/^-+/g, "")
    .trim();
}

function formatStepError(step: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith(`${step}失败：`)) {
    return new Error(message);
  }
  return new Error(`${step}失败：${message}`);
}

function buildExpectedMaterialNames(params: {
  template: string;
  dramaName: string;
  sequences: string[];
  materialDateValue?: string;
  shortName?: string;
}): string[] {
  const { template, dramaName, sequences, materialDateValue, shortName } =
    params;
  const resolvedDateValue = resolveMaterialDateValue(materialDateValue);

  return sequences.map((sequence) =>
    normalizeTemplateFileName(
      template
        .replaceAll("{剧名}", dramaName)
        .replaceAll("{日期}", resolvedDateValue)
        .replaceAll("{简称}", String(shortName || "").trim())
        .replaceAll("{序号}", sequence),
    ),
  );
}

function buildRuleMaterialAllocationPlans(
  rules: DouyinMaterialRule[],
  totalMaterialCount: number,
): RuleMaterialAllocationPlan[] {
  if (totalMaterialCount <= 0 || rules.length === 0) {
    return [];
  }

  const allocationCounts = allocateMaterialCountsByPercent(
    totalMaterialCount,
    rules.map((rule, index) => ({
      id: rule.id,
      percent: normalizeAllocationPercent(rule.percent),
      order: Number(rule.order || index + 1),
    })),
  );

  let currentSequence = 1;
  const plans: RuleMaterialAllocationPlan[] = [];

  rules.forEach((rule) => {
    const count =
      allocationCounts.find((item) => item.id === rule.id)?.count || 0;
    if (count <= 0) {
      return;
    }

    const sequences = Array.from({ length: count }, () => {
      const sequence = String(currentSequence).padStart(2, "0");
      currentSequence += 1;
      return sequence;
    });

    plans.push({ rule, sequences });
  });

  return plans;
}

function inferMaterialCountFromMaterials(params: {
  materials: GiantMaterial[];
  template: string;
  dramaName: string;
  materialDateValue?: string;
}): number {
  const materialMap = new Map<string, GiantMaterial>();
  for (const material of params.materials) {
    const filename = String(
      material.filename || material.video_name || "",
    ).trim();
    if (!filename) {
      continue;
    }
    materialMap.set(filename.toLowerCase(), material);
  }

  let matchedCount = 0;
  for (let index = 1; index <= params.materials.length; index += 1) {
    const sequence = String(index).padStart(2, "0");
    const expectedName = buildExpectedMaterialNames({
      template: params.template,
      dramaName: params.dramaName,
      sequences: [sequence],
      materialDateValue: params.materialDateValue,
    })[0];
    if (expectedName && materialMap.has(expectedName.toLowerCase())) {
      matchedCount += 1;
    }
  }

  return matchedCount;
}

function filterMaterialsByTemplate(
  materials: GiantMaterial[],
  expectedNames: string[],
): GiantMaterial[] {
  const materialMap = new Map<string, GiantMaterial>();

  for (const material of materials) {
    const filename = String(
      material.filename || material.video_name || "",
    ).trim();
    if (!filename) {
      continue;
    }
    materialMap.set(filename.toLowerCase(), {
      ...material,
      filename,
    });
  }

  return expectedNames
    .map((name) => materialMap.get(name.toLowerCase()))
    .filter((material): material is GiantMaterial => Boolean(material));
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

export class DailyBuildService {
  private mainWindow: BrowserWindow | null = null;
  private tasks = new Map<string, DailyBuildTaskRuntime>();
  private logs: Array<{ time: string; message: string }> = [];
  private maxLogs = 500;
  private recentTaskStates = new Map<string, DailyBuildTaskState>();
  private maxRecentTaskStates = 200;
  private webSessionService: WebSessionService;

  constructor(
    _configService: ConfigService,
    webSessionService: WebSessionService,
  ) {
    this.webSessionService = webSessionService;
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  getLogs(): Array<{ time: string; message: string }> {
    return [...this.logs];
  }

  getTaskStates(): DailyBuildTaskState[] {
    return Array.from(this.recentTaskStates.values());
  }

  clearLogs() {
    this.logs = [];
  }

  private log(message: string) {
    const entry = {
      time: new Date().toLocaleTimeString(),
      message,
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("daily-build:log", entry);
    }
    console.log(`[DailyBuild] ${message}`);
  }

  private emitProgress(progress: DailyBuildProgress) {
    this.recentTaskStates.set(progress.taskId, {
      ...progress,
      updatedAt: new Date().toISOString(),
    });
    if (this.recentTaskStates.size > this.maxRecentTaskStates) {
      const oldestTaskId = this.recentTaskStates.keys().next().value;
      if (oldestTaskId) {
        this.recentTaskStates.delete(oldestTaskId);
      }
    }
    this.log(`${progress.drama} - ${progress.message}`);
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("daily-build:progress", progress);
    }
  }

  private ensureNotCancelled(signal: AbortSignal) {
    if (signal.aborted) {
      throw new Error("搭建已取消");
    }
  }

  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw new Error("搭建已取消");
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("搭建已取消"));
      };

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private validatePayload(payload: DailyBuildTaskPayload): void {
    if (!payload.taskId) {
      throw new Error("缺少搭建任务 ID");
    }
    if (!payload.drama.trim()) {
      throw new Error("缺少剧名");
    }
    if (!payload.dramaId.trim()) {
      throw new Error("缺少短剧 ID");
    }
    if (!payload.accountId.trim()) {
      throw new Error("缺少巨量账户 ID");
    }

    const { buildParams, materialFilenameTemplate, douyinMaterialRules } =
      payload.buildSettings;
    const requiredParams: Array<keyof UploadBuildSettings["buildParams"]> = [
      "distributorId",
      "secretKey",
      "source",
      "bid",
      "productId",
      "productPlatformId",
      "landingUrl",
      "microAppName",
      "microAppId",
      "microAppInstanceId",
      "ccId",
      "rechargeTemplateId",
    ];

    for (const field of requiredParams) {
      if (!String(buildParams[field] ?? "").trim()) {
        throw new Error(`缺少搭建参数：${field}`);
      }
    }

    if (!materialFilenameTemplate.trim()) {
      throw new Error("缺少素材名称模板");
    }

    if (
      !materialFilenameTemplate.includes("{剧名}") ||
      !materialFilenameTemplate.includes("{序号}")
    ) {
      throw new Error("素材名称模板必须包含 {剧名}、{序号}");
    }

    if (!douyinMaterialRules.length) {
      throw new Error("请先配置抖音号匹配素材规则");
    }

    for (const rule of douyinMaterialRules) {
      if (!rule.douyinAccount.trim() || !rule.douyinAccountId.trim()) {
        throw new Error("请先完善每条抖音号配置");
      }
    }

    const totalPercent = douyinMaterialRules.reduce(
      (sum, rule) => sum + normalizeAllocationPercent(rule.percent),
      0,
    );
    if (totalPercent > 100) {
      throw new Error("所有抖音号比例之和不能超过 100%");
    }
  }

  private getExecutableRules(
    settings: UploadBuildSettings,
  ): DouyinMaterialRule[] {
    return settings.douyinMaterialRules.filter(
      (rule) =>
        rule.douyinAccount.trim() &&
        rule.douyinAccountId.trim() &&
        normalizeAllocationPercent(rule.percent) > 0,
    );
  }

  private emitState(
    payload: DailyBuildTaskPayload,
    status: DailyBuildTaskStatus,
    message: string,
    totalRules: number,
    currentRuleIndex = 0,
    successRuleCount = 0,
    failedRuleCount = 0,
  ) {
    this.emitProgress({
      taskId: payload.taskId,
      drama: payload.drama,
      status,
      message,
      currentRuleIndex,
      totalRules,
      successRuleCount,
      failedRuleCount,
    });
  }

  private async fetchCoverImage(signal: AbortSignal): Promise<CoverImageInfo> {
    this.ensureNotCancelled(signal);
    const authHeaders = await this.webSessionService.getAuthHeaders();
    const response = await fetch(DAILY_BUILD_CONFIG.coverImageUrl, {
      method: "GET",
      headers: authHeaders,
      signal,
    });
    if (!response.ok) {
      throw new Error(`获取封面图失败: HTTP ${response.status}`);
    }

    const mimeType = response.headers.get("content-type") || "image/png";
    const extension =
      mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
      fileName: `cover.${extension}`,
    };
  }

  private async createPromotionLink(
    payload: DailyBuildTaskPayload,
    distributorId: string,
    signal: AbortSignal,
    promotionName?: string,
  ): Promise<{ promotion_url: string; promotion_name: string }> {
    const darenName = resolveDarenName(payload.buildSettings);
    const requestBody = {
      distributor_id: Number(distributorId),
      book_id: payload.dramaId.trim(),
      index: DAILY_BUILD_CONFIG.promotion.index,
      promotion_name:
        promotionName || `${darenName}-${sanitizeDramaName(payload.drama)}`,
      recharge_template_id: Number(
        payload.buildSettings.buildParams.rechargeTemplateId,
      ),
      media_source: DAILY_BUILD_CONFIG.promotion.mediaSource,
      price: DAILY_BUILD_CONFIG.promotion.price,
      start_chapter: DAILY_BUILD_CONFIG.promotion.startChapter,
    };

    const response = await fetch(
      `${DAILY_BUILD_CONFIG.changduBaseUrl}/promotion/create/v1`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildChangduPostHeaders(
            requestBody,
            distributorId,
            payload.buildSettings.buildParams.secretKey.trim(),
          ),
        },
        body: JSON.stringify(requestBody),
        signal,
      },
    );

    const result = await parseJsonResponse<{
      code?: number;
      message?: string;
      data?: { promotion_url?: string; promotion_name?: string };
      promotion_url?: string;
      promotion_name?: string;
    }>(response);
    if (result.code !== 200) {
      throw new Error(result.message || "创建推广链接失败");
    }

    const promotionUrl =
      result.promotion_url || result.data?.promotion_url || "";
    const finalName =
      result.promotion_name ||
      result.data?.promotion_name ||
      requestBody.promotion_name;

    if (!promotionUrl) {
      throw new Error("创建推广链接失败：返回结果中缺少 promotion_url");
    }

    return {
      promotion_url: promotionUrl,
      promotion_name: finalName,
    };
  }

  private async waitForConfiguredMicroAppAsset(
    accountId: string,
    buildSettings: UploadBuildSettings,
    cookieHeader: string,
    signal: AbortSignal,
    options?: {
      attempts?: number;
      intervalMs?: number;
    },
  ): Promise<MicroAppAssetInfo | null> {
    const attempts = Math.max(1, Number(options?.attempts || 4));
    const intervalMs = Math.max(0, Number(options?.intervalMs || 1500));

    for (let index = 0; index < attempts; index += 1) {
      const assetsList = await this.listMicroAppAssets(
        accountId,
        cookieHeader,
        signal,
      );
      const matchedAsset = findConfiguredMicroAppAsset(
        assetsList?.data?.micro_app,
        buildSettings,
      );

      if (matchedAsset) {
        return matchedAsset;
      }

      if (index < attempts - 1 && intervalMs > 0) {
        this.log(
          `暂未查到指定小程序资产，${intervalMs}ms 后进行第 ${index + 2} 次重试`,
        );
        await this.sleep(intervalMs, signal);
      }
    }

    return null;
  }

  private async listMicroAppAssets(
    accountId: string,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<any> {
    const response = await fetch(
      `https://ad.oceanengine.com/event_manager/v2/api/assets/ad/list?aadvid=${accountId}`,
      {
        method: "POST",
        headers: {
          platform: "ad",
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assets_types: [1, 3, 2, 7, 4, 5],
          role: 1,
        }),
        signal,
      },
    );

    return parseJsonResponse<any>(response);
  }

  private async createMicroAppAsset(
    accountId: string,
    microAppInstanceId: string,
    buildSettings: UploadBuildSettings,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<any> {
    const response = await fetch(
      `https://ad.oceanengine.com/event_manager/api/assets/create?aadvid=${accountId}`,
      {
        method: "POST",
        headers: {
          platform: "ad",
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assets_type: 4,
          micro_app: {
            assets_name: buildSettings.buildParams.microAppName.trim(),
            micro_app_id: buildSettings.buildParams.microAppId.trim(),
            micro_app_name: buildSettings.buildParams.microAppName.trim(),
            micro_app_type: 1,
            micro_app_instance_id: microAppInstanceId,
          },
        }),
        signal,
      },
    );

    const result = await parseJsonResponse<any>(response);
    if (result?.code !== 0) {
      throw new Error(result?.msg || "创建小程序资产失败");
    }
    return result;
  }

  private async checkEventStatus(
    accountId: string,
    assetsId: string | number,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<{ hasPaymentEvent: boolean }> {
    const response = await fetch(
      `https://ad.oceanengine.com/event_manager/v2/api/event/track/status/${assetsId}?aadvid=${accountId}`,
      {
        method: "GET",
        headers: {
          platform: "ad",
          Cookie: cookieHeader,
        },
        signal,
      },
    );

    const result = await parseJsonResponse<any>(response);
    const hasPaymentEvent = Array.isArray(result?.data?.track_status)
      ? result.data.track_status.some(
          (event: any) => event.event_name === "付费",
        )
      : false;
    return { hasPaymentEvent };
  }

  private async addPaymentEvent(
    accountId: string,
    assetsId: string | number,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await fetch(
      `https://ad.oceanengine.com/event_manager/v2/api/event/config/create?aadvid=${accountId}`,
      {
        method: "POST",
        headers: {
          platform: "ad",
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          link_name: DAILY_BUILD_CONFIG.event.linkName,
          events: [
            {
              event_enum: DAILY_BUILD_CONFIG.event.eventEnum,
              event_type: DAILY_BUILD_CONFIG.event.eventType,
              event_name: DAILY_BUILD_CONFIG.event.eventName,
              track_types: DAILY_BUILD_CONFIG.event.trackTypes,
              statistical_method_type:
                DAILY_BUILD_CONFIG.event.statisticalMethodType,
              discrimination_value: { value_type: 0, dimension: 0, groups: [] },
            },
          ],
          assets_id: assetsId,
        }),
        signal,
      },
    );

    const result = await parseJsonResponse<any>(response);
    if (result?.code !== 0) {
      throw new Error(result?.msg || "添加付费事件失败");
    }
  }

  private async uploadAvatarImage(
    accountId: string,
    coverImage: CoverImageInfo,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<{ webUri: string }> {
    const formData = new FormData();
    formData.append("file", coverImage.buffer, {
      filename: coverImage.fileName,
      contentType: coverImage.mimeType,
    });
    formData.append("width", "300");
    formData.append("height", "300");

    const response = await fetch(
      `https://ad.oceanengine.com/aadv/api/account/upload_image_v2?aadvid=${accountId}`,
      {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "content-type": formData.getHeaders()["content-type"],
        },
        body: formData.getBuffer() as unknown as BodyInit,
        signal,
      },
    );

    const result = await parseJsonResponse<any>(response);
    if (result?.code !== 200) {
      throw new Error(result?.message || "上传头像图片失败");
    }

    const webUri = result?.data?.image_info?.web_uri;
    if (!webUri) {
      throw new Error("上传头像图片失败：未返回 web_uri");
    }

    return { webUri };
  }

  private async saveAvatar(
    accountId: string,
    webUri: string,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await fetch(
      `https://ad.oceanengine.com/account/api/v2/adv/saveAvatar?accountId=${accountId}&aadvid=${accountId}`,
      {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          avatarInfo: {
            webUri,
            width: 300,
            height: 300,
          },
        }),
        signal,
      },
    );

    const result = await parseJsonResponse<any>(response);
    if (result?.code !== 200 && result?.code !== 410001) {
      throw new Error(result?.message || "保存头像失败");
    }
  }

  private async uploadProductImage(
    accountId: string,
    coverImage: CoverImageInfo,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<{ width: number; height: number; webUri: string }> {
    const formData = new FormData();
    formData.append("fileData", coverImage.buffer, {
      filename: coverImage.fileName,
      contentType: coverImage.mimeType,
    });

    const response = await fetch(
      `https://ad.oceanengine.com/superior/api/v2/creative/material/picture/upload?aadvid=${accountId}`,
      {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "content-type": formData.getHeaders()["content-type"],
        },
        body: formData.getBuffer() as unknown as BodyInit,
        signal,
      },
    );

    const result = await parseJsonResponse<any>(response);
    if (result?.code !== 0) {
      throw new Error(result?.msg || "上传主图失败");
    }

    if (!result?.data?.web_uri) {
      throw new Error("上传主图失败：未返回图片地址");
    }

    return {
      width: Number(result.data.width || 108),
      height: Number(result.data.height || 108),
      webUri: result.data.web_uri,
    };
  }

  private async createProject(
    params: {
      accountId: string;
      dramaName: string;
      douyinAccountName: string;
      assetsId: string | number;
      microAppInstanceId: string;
      projectName: string;
    },
    payload: DailyBuildTaskPayload,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<string> {
    const buildParams = payload.buildSettings.buildParams;
    const response = await fetch(
      `https://ad.oceanengine.com/superior/api/v2/project/create?aadvid=${params.accountId}`,
      {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          track_url_group_info: {},
          track_url: [],
          action_track_url: [],
          first_frame: [],
          last_frame: [],
          effective_frame: [],
          track_url_send_type: "2",
          smart_bid_type: 0,
          bid: Number(buildParams.bid),
          is_search_speed_phase_four: false,
          budget: DAILY_BUILD_CONFIG.project.budget,
          inventory_catalog: DAILY_BUILD_CONFIG.project.inventoryCatalog,
          flow_control_mode: DAILY_BUILD_CONFIG.project.flowControlMode,
          delivery_mode: 3,
          delivery_package: 0,
          landing_type: 16,
          delivery_related_num: 1,
          name: params.projectName,
          schedule_type: 1,
          week_schedule_type: 0,
          pricing_type: 9,
          product_platform_id: buildParams.productPlatformId.trim(),
          product_id: buildParams.productId.trim(),
          district: "all",
          gender: "0",
          age: [["0", "17"]],
          retargeting_tags: [],
          platform: ["0"],
          hide_if_converted: "1",
          cdp_marketing_goal: 1,
          asset_ids: [String(params.assetsId)],
          external_action: "14",
          budget_mode: DAILY_BUILD_CONFIG.project.budgetMode,
          campaign_type: 1,
          micro_promotion_type: 4,
          asset_name: "",
          smart_inventory: 3,
          auto_ad_type: 1,
          micro_app_instance_id: params.microAppInstanceId,
          products: [],
          aigc_dynamic_creative_switch: 0,
          is_search_3_online: true,
        }),
        signal,
      },
    );

    const result = await parseJsonResponse<any>(response);
    if (result?.code !== 0) {
      throw new Error(result?.msg || "创建项目失败");
    }
    const projectId = String(result?.data?.id || "").trim();
    if (!projectId) {
      throw new Error("创建项目失败：未返回项目ID");
    }
    return projectId;
  }

  private async getDouyinAccountInfo(
    accountId: string,
    douyinAccountId: string,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<{ iesCoreId: string }> {
    const response = await fetch(
      `https://ad.oceanengine.com/superior/api/v2/ad/authorize/list?aadvid=${accountId}`,
      {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_index: 1,
          page_size: 100,
          uniq_id_or_short_id: douyinAccountId,
          need_limits_info: true,
          need_limit_scenes: [4],
          level: [1, 4, 5, 7],
          need_auth_extra_info: true,
          dpa_id: "",
        }),
        signal,
      },
    );

    const result = await parseJsonResponse<any>(response);
    if (result?.code !== 0) {
      throw new Error(result?.msg || "获取抖音号信息失败");
    }

    const accountInfo = Array.isArray(result?.data) ? result.data[0] : null;
    if (!accountInfo?.ies_core_id) {
      throw new Error("找不到对应抖音号信息");
    }

    return { iesCoreId: String(accountInfo.ies_core_id) };
  }

  private async getMaterialList(
    accountId: string,
    douyinAccountId: string,
    iesCoreId: string,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<GiantMaterial[]> {
    const queryParams = new URLSearchParams({
      aadvid: accountId,
      image_mode: "5,15",
      sort_type: "desc",
      metric_names: "create_time,stat_cost,ctr",
      aweme_id: douyinAccountId,
      aweme_account: iesCoreId,
      "auth_level[]": "5",
      landing_type: "16",
      external_action: "14",
      page: "1",
      limit: "100",
      version: "v2",
      operation_platform: "1",
    });

    const response = await fetch(
      `https://ad.oceanengine.com/superior/api/v2/video/list?${queryParams.toString()}`,
      {
        method: "GET",
        headers: {
          Cookie: cookieHeader,
        },
        signal,
      },
    );

    const result = await parseJsonResponse<any>(response);
    if (result?.code !== 0) {
      throw new Error(result?.msg || "获取素材列表失败");
    }

    return Array.isArray(result?.data?.videos)
      ? result.data.videos.map((video: any) => ({
          ...video,
          filename: String(video.video_name || video.filename || "").trim(),
        }))
      : [];
  }

  private async createPromotion(
    params: {
      accountId: string;
      projectId: string;
      adName: string;
      iesCoreId: string;
      materials: GiantMaterial[];
      initData: DailyBuildInitData;
    },
    payload: DailyBuildTaskPayload,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<void> {
    const buildParams = payload.buildSettings.buildParams;
    const videoMaterialInfo = params.materials.map((material) => {
      const imageInfo =
        Array.isArray(material.image_info) && material.image_info.length > 0
          ? material.image_info.map((image) => ({
              width: image.width || material.video_info?.width || 1080,
              height: image.height || material.video_info?.height || 1920,
              web_uri: image.web_uri || material.cover_uri || "",
              sign_url: image.sign_url || material.sign_url || "",
            }))
          : [
              {
                width: material.video_info?.width || 1080,
                height: material.video_info?.height || 1920,
                web_uri: material.cover_uri || material.video_poster_uri || "",
                sign_url: material.sign_url || "",
              },
            ];

      return {
        image_info: imageInfo,
        video_info: {
          height: material.video_info?.height || 1920,
          width: material.video_info?.width || 1080,
          bitrate: material.video_info?.bitrate || 0,
          thumb_height: material.video_info?.thumb_height || 1920,
          thumb_width: material.video_info?.thumb_width || 1080,
          duration: material.video_info?.duration || 0,
          status: material.video_info?.status || 10,
          initial_size: material.video_info?.initial_size || 0,
          file_md5: material.video_info?.file_md5 || "",
          video_id: material.video_id,
          cover_uri: material.cover_uri || material.video_poster_uri || "",
          vid: material.video_id,
        },
        is_ebp_share: false,
        image_mode: 15,
        f_f_see_setting: 1,
        cover_type: 1,
      };
    });
    const requestBody = {
      promotion_data: {
        client_settings: { is_comment_disable: "0" },
        native_info: {
          is_feed_and_fav_see: 2,
          anchor_related_type: 0,
          ies_core_user_id: params.iesCoreId,
        },
        enable_personal_action: true,
        micro_app_info: {
          app_id: params.initData.app_id,
          start_path: params.initData.start_page || "",
          micro_app_type: params.initData.app_type || 2,
          params: params.initData.start_params || "",
          url: params.initData.link || "",
        },
        source: buildParams.source.trim(),
      },
      material_group: {
        playable_material_info: [],
        video_material_info: videoMaterialInfo,
        image_material_info: [],
        aweme_photo_material_info: [],
        external_material_info: [
          { external_url: buildParams.landingUrl.trim() },
        ],
        component_material_info: [],
        call_to_action_material_info: [
          {
            call_to_action: DAILY_BUILD_CONFIG.promotionMaterial.callToAction,
            suggestion_usage_type: 0,
          },
        ],
        product_info: {
          product_name: {
            name: DAILY_BUILD_CONFIG.promotionMaterial.productName,
          },
          product_images: [
            {
              image_uri: params.initData.product_image_uri,
              width: params.initData.product_image_width || 108,
              height: params.initData.product_image_height || 108,
            },
          ],
          product_selling_points: [
            {
              selling_point: DAILY_BUILD_CONFIG.promotionMaterial.sellingPoint,
              suggestion_usage_type: 0,
            },
          ],
        },
        title_material_info: [
          {
            title: `#短剧推荐#${payload.drama}`,
            word_list: [],
            bidword_list: [],
            dpa_word_list: [],
            is_dynamic: 0,
            suggestion_usage_type: 0,
            request_id: "0",
          },
        ],
      },
      name: params.adName,
      project_id: params.projectId,
      check_hash: Date.now().toString(),
      is_auto_delivery_mode: false,
    };

    const maxRetries = 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        this.log(
          `创建广告请求: ${params.adName}，项目 ${params.projectId}，素材 ${params.materials.length} 个，尝试 ${attempt + 1}/${maxRetries + 1}`,
        );
        this.log(
          `创建广告参数: ${JSON.stringify({
            account_id: params.accountId,
            project_id: params.projectId,
            ad_name: params.adName,
            ies_core_user_id: params.iesCoreId,
            matched_materials: params.materials.map((material) => ({
              file_name: material.filename,
              video_id: material.video_id,
            })),
            request_body: requestBody,
          })}`,
        );
        const response = await fetch(
          `https://ad.oceanengine.com/superior/api/v2/promotion/create_promotion?aadvid=${params.accountId}`,
          {
            method: "POST",
            headers: {
              Cookie: cookieHeader,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal,
          },
        );

        const result = await parseJsonResponse<any>(response);
        if (result?.code !== 0) {
          throw new Error(result?.msg || "创建广告失败");
        }

        this.log(`创建广告成功: ${params.adName}`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          this.log(
            `创建广告失败，准备重试: ${params.adName} - ${lastError.message}`,
          );
          await this.sleep(2000, signal);
          continue;
        }
      }
    }

    throw lastError || new Error("创建广告失败");
  }

  private async executeAssetization(
    payload: DailyBuildTaskPayload,
    coverImage: CoverImageInfo,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<DailyBuildInitData> {
    let avatar: { webUri: string };
    try {
      avatar = await this.uploadAvatarImage(
        payload.accountId,
        coverImage,
        cookieHeader,
        signal,
      );
    } catch (error) {
      throw formatStepError("上传头像", error);
    }

    try {
      await this.saveAvatar(
        payload.accountId,
        avatar.webUri,
        cookieHeader,
        signal,
      );
    } catch (error) {
      throw formatStepError("保存头像", error);
    }

    let microApp: MicroAppInfo;
    try {
      microApp = getConfiguredMicroApp(payload.buildSettings);
    } catch (error) {
      throw formatStepError("读取小程序配置", error);
    }

    const assetsList = await this.listMicroAppAssets(
      payload.accountId,
      cookieHeader,
      signal,
    );
    let assetMicroApp = findConfiguredMicroAppAsset(
      assetsList?.data?.micro_app,
      payload.buildSettings,
    );
    let assetsId = assetMicroApp?.assets_id;

    if (!assetsId) {
      try {
        await this.createMicroAppAsset(
          payload.accountId,
          microApp.micro_app_instance_id,
          payload.buildSettings,
          cookieHeader,
          signal,
        );
      } catch (error) {
        throw formatStepError("创建小程序资产", error);
      }

      assetMicroApp = await this.waitForConfiguredMicroAppAsset(
        payload.accountId,
        payload.buildSettings,
        cookieHeader,
        signal,
        {
          attempts: 4,
          intervalMs: 1500,
        },
      );
      if (!assetMicroApp) {
        throw new Error("小程序资产创建成功后，未查询到指定实例对应的资产");
      }
      assetsId = assetMicroApp.assets_id;
    }

    microApp = {
      micro_app_instance_id:
        String(assetMicroApp?.micro_app_instance_id || "").trim() ||
        microApp.micro_app_instance_id,
      app_id:
        String(assetMicroApp?.micro_app_id || "").trim() ||
        microApp.app_id ||
        "",
      start_page: "",
    };

    const eventStatus = await this.checkEventStatus(
      payload.accountId,
      assetsId,
      cookieHeader,
      signal,
    );
    if (!eventStatus.hasPaymentEvent) {
      try {
        await this.addPaymentEvent(
          payload.accountId,
          assetsId,
          cookieHeader,
          signal,
        );
      } catch (error) {
        throw formatStepError("添加付费事件", error);
      }
    }

    let productImage: { width: number; height: number; webUri: string };
    try {
      productImage = await this.uploadProductImage(
        payload.accountId,
        coverImage,
        cookieHeader,
        signal,
      );
    } catch (error) {
      throw formatStepError("上传主图", error);
    }

    return {
      assets_id: assetsId,
      micro_app_instance_id: microApp.micro_app_instance_id,
      app_id: String(microApp.app_id || ""),
      start_page: String(microApp.start_page || ""),
      app_type: 2,
      start_params: "",
      link: "",
      product_image_width: productImage.width,
      product_image_height: productImage.height,
      product_image_uri: productImage.webUri,
    };
  }

  private async loadRuleBuildData(
    payload: DailyBuildTaskPayload,
    rule: DouyinMaterialRule,
    cookieHeader: string,
    signal: AbortSignal,
  ): Promise<PrefetchedRuleBuildData> {
    let accountInfo: { iesCoreId: string };
    try {
      accountInfo = await this.getDouyinAccountInfo(
        payload.accountId,
        rule.douyinAccountId,
        cookieHeader,
        signal,
      );
    } catch (error) {
      throw formatStepError("获取抖音号信息", error);
    }

    let materials: GiantMaterial[];
    try {
      materials = await this.getMaterialList(
        payload.accountId,
        rule.douyinAccountId,
        accountInfo.iesCoreId,
        cookieHeader,
        signal,
      );
    } catch (error) {
      throw formatStepError("获取素材列表", error);
    }

    return {
      iesCoreId: accountInfo.iesCoreId,
      materials,
    };
  }

  private async buildSingleRule(
    payload: DailyBuildTaskPayload,
    rule: DouyinMaterialRule,
    sequences: string[],
    initData: DailyBuildInitData,
    distributorId: string,
    cookieHeader: string,
    signal: AbortSignal,
    prefetched?: PrefetchedRuleBuildData,
  ): Promise<void> {
    const darenName = resolveDarenName(payload.buildSettings);
    const promotionName = `${darenName}-${rule.douyinAccount}-${sanitizeDramaName(payload.drama)}-${payload.accountId}`;
    let promotionResult: { promotion_url: string; promotion_name: string };
    try {
      promotionResult = await this.createPromotionLink(
        payload,
        distributorId,
        signal,
        promotionName,
      );
    } catch (error) {
      throw formatStepError("创建推广链接", error);
    }
    const parsed = parsePromotionUrl(promotionResult.promotion_url);
    const appId = extractAppIdFromParams(parsed.launchParams);
    if (!appId) {
      throw new Error("无法从推广链接中提取 app_id");
    }

    const cleanedParams = parsed.launchParams
      .split("&")
      .filter((item) => item && !item.startsWith("app_id="))
      .join("&");
    const link = generateMicroAppLink({
      appId,
      startPage: parsed.launchPage,
      startParams: cleanedParams,
    });

    const nextInitData: DailyBuildInitData = {
      ...initData,
      app_id: appId,
      start_page: parsed.launchPage,
      start_params: cleanedParams,
      link,
    };

    let projectId: string;
    try {
      projectId = await this.createProject(
        {
          accountId: payload.accountId,
          dramaName: payload.drama,
          douyinAccountName: rule.douyinAccount,
          assetsId: initData.assets_id,
          microAppInstanceId: initData.micro_app_instance_id,
          projectName: `${darenName}-${rule.douyinAccount}-${payload.drama}-${formatBuildDate()}`,
        },
        payload,
        cookieHeader,
        signal,
      );
    } catch (error) {
      throw formatStepError("创建项目", error);
    }

    const ruleBuildData =
      prefetched ||
      (await this.loadRuleBuildData(payload, rule, cookieHeader, signal));

    const expectedNames = buildExpectedMaterialNames({
      template: payload.buildSettings.materialFilenameTemplate,
      dramaName: payload.drama,
      materialDateValue: payload.buildSettings.materialDateValue,
      shortName: rule.shortName,
      sequences,
    });
    const matchedMaterials = filterMaterialsByTemplate(
      ruleBuildData.materials,
      expectedNames,
    );
    this.log(
      `素材匹配期望: ${rule.douyinAccount} -> ${expectedNames.join("、")}`,
    );
    this.log(
      `素材匹配结果: ${rule.douyinAccount} -> 命中 ${matchedMaterials.length} 个：${
        matchedMaterials.map((material) => material.filename).join("、") || "无"
      }`,
    );

    if (!matchedMaterials.length) {
      throw new Error(`未匹配到素材：${expectedNames.join("、")}`);
    }

    if (matchedMaterials.length !== expectedNames.length) {
      const missingNames = expectedNames.filter(
        (name) =>
          !matchedMaterials.some(
            (material) =>
              material.filename.toLowerCase() === name.toLowerCase(),
          ),
      );
      throw new Error(`素材不完整，缺少：${missingNames.join("、")}`);
    }

    try {
      await this.createPromotion(
        {
          accountId: payload.accountId,
          projectId,
          adName: `${darenName}-${rule.douyinAccount}-${payload.drama}-${formatBuildDate()}`,
          iesCoreId: ruleBuildData.iesCoreId,
          materials: matchedMaterials,
          initData: nextInitData,
        },
        payload,
        cookieHeader,
        signal,
      );
    } catch (error) {
      throw formatStepError("创建广告", error);
    }
  }

  async startTask(payload: DailyBuildTaskPayload): Promise<DailyBuildResult> {
    this.validatePayload(payload);

    if (this.tasks.size > 0) {
      throw new Error("当前已有搭建任务在执行，请稍后再试");
    }

    const controller = new AbortController();
    this.tasks.set(payload.taskId, { controller, payload });
    const signal = controller.signal;
    const skippedRules: DailyBuildSkippedRule[] = [];
    let successRuleCount = 0;
    let totalRules = 0;

    try {
      const distributorId = String(
        payload.buildSettings.buildParams.distributorId || "",
      ).trim();
      if (!distributorId) {
        throw new Error("当前达人缺少搭建参数 distributorId 配置");
      }

      const cookieHeader = await juliangService.getCookieHeader();

      const executableRules = this.getExecutableRules(payload.buildSettings);
      if (!executableRules.length) {
        throw new Error("当前分配方式下没有可执行的抖音号规则");
      }

      let prefetchedFirstRuleData: PrefetchedRuleBuildData | undefined;
      let totalMaterialCount = payload.files.length;

      if (totalMaterialCount <= 0) {
        prefetchedFirstRuleData = await this.loadRuleBuildData(
          payload,
          executableRules[0],
          cookieHeader,
          signal,
        );
        totalMaterialCount = inferMaterialCountFromMaterials({
          materials: prefetchedFirstRuleData.materials,
          template: payload.buildSettings.materialFilenameTemplate,
          dramaName: payload.drama,
          materialDateValue: payload.buildSettings.materialDateValue,
        });
        if (totalMaterialCount <= 0) {
          throw new Error("未在巨量素材中匹配到可分配素材");
        }
      }

      const allocationPlans = buildRuleMaterialAllocationPlans(
        executableRules,
        totalMaterialCount,
      );
      if (!allocationPlans.length) {
        throw new Error("根据当前素材数量和分配方式，没有可执行的搭建规则");
      }
      totalRules = allocationPlans.length;

      this.emitState(
        payload,
        "assetizing",
        "正在准备封面图并执行资产化",
        totalRules,
      );
      const coverImage = await this.fetchCoverImage(signal);
      const initData = await this.executeAssetization(
        payload,
        coverImage,
        cookieHeader,
        signal,
      );

      for (let index = 0; index < allocationPlans.length; index += 1) {
        const plan = allocationPlans[index];
        const rule = plan.rule;
        this.emitState(
          payload,
          "building",
          `正在搭建抖音号 ${rule.douyinAccount}`,
          totalRules,
          index + 1,
          successRuleCount,
          skippedRules.length,
        );

        try {
          await this.buildSingleRule(
            payload,
            rule,
            plan.sequences,
            initData,
            distributorId,
            cookieHeader,
            signal,
            index === 0 && prefetchedFirstRuleData
              ? prefetchedFirstRuleData
              : undefined,
          );
          successRuleCount += 1;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          skippedRules.push({
            ruleId: rule.id,
            douyinAccount: rule.douyinAccount,
            error: errorMessage,
          });
        }
      }

      if (!successRuleCount) {
        const error = skippedRules.length
          ? `所有抖音号搭建失败：${skippedRules
              .map((item) => `${item.douyinAccount}：${item.error}`)
              .join("；")}`
          : "没有成功的抖音号搭建结果";
        throw new Error(error);
      }

      let materialPreviewSchedule:
        | DailyBuildMaterialPreviewSchedule
        | undefined;
      if (payload.postBuildPreview?.enabled) {
        const previewAwemeWhiteList = Array.from(
          new Set(
            executableRules
              .map((rule) => String(rule.douyinAccount || "").trim())
              .filter(Boolean),
          ),
        );

        try {
          const scheduleResult =
            await materialPreviewService.scheduleAfterBuild({
              accountId: payload.accountId,
              dramaName: payload.drama,
              awemeWhiteList: previewAwemeWhiteList,
              cookieHeader,
              delaysMinutes: payload.postBuildPreview.delaysMinutes || [20, 30],
            });
          materialPreviewSchedule = {
            enabled: true,
            scheduledCount: scheduleResult.scheduledCount,
            delaysMinutes: scheduleResult.delaysMinutes,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.log(`素材预览定时任务创建失败：${errorMessage}`);
          materialPreviewSchedule = {
            enabled: true,
            scheduledCount: 0,
            delaysMinutes: payload.postBuildPreview.delaysMinutes || [20, 30],
            error: errorMessage,
          };
        }
      }

      this.emitState(
        payload,
        "completed",
        `搭建完成（成功 ${successRuleCount}/${totalRules}）`,
        totalRules,
        totalRules,
        successRuleCount,
        skippedRules.length,
      );

      return {
        success: true,
        taskId: payload.taskId,
        drama: payload.drama,
        totalRules,
        successRuleCount,
        failedRuleCount: skippedRules.length,
        skippedRules,
        materialPreviewSchedule,
      };
    } catch (error) {
      const cancelled = signal.aborted;
      const errorMessage = cancelled
        ? "搭建已取消"
        : error instanceof Error
          ? error.message
          : String(error);

      this.emitState(
        payload,
        cancelled ? "cancelled" : "failed",
        errorMessage,
        totalRules,
        0,
        successRuleCount,
        skippedRules.length,
      );

      return {
        success: false,
        cancelled,
        taskId: payload.taskId,
        drama: payload.drama,
        totalRules,
        successRuleCount,
        failedRuleCount: skippedRules.length,
        skippedRules,
        error: errorMessage,
      };
    } finally {
      this.tasks.delete(payload.taskId);
    }
  }

  cancelTask(taskId: string): { success: boolean; error?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: "当前任务不存在或已结束" };
    }

    task.controller.abort();
    return { success: true };
  }
}
