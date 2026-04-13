import type { BrowserWindow } from "electron";
import axios, { type AxiosInstance } from "axios";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

const PREVIEW_RETRY_MAX_ATTEMPTS = 3;
const PREVIEW_RETRY_BASE_DELAY_MS = 1000;
const PREVIEW_RETRY_MAX_DELAY_MS = 4000;

interface PreviewAdItem {
  promotion_id: string;
  promotion_name?: string;
  create_time?: string;
}

interface PreviewMaterialItem {
  promotion_id: string;
  material_id: string;
  cdp_material_id?: string;
  material_status_first_name?: string;
  material_status_second_name?: string[];
  material_reject_reason_type?: number;
}

interface PreviewAdsListResponse {
  code?: number;
  msg?: string;
  data?: {
    ads?: PreviewAdItem[];
    pagination?: {
      total_page?: number;
    };
  };
}

interface PreviewMaterialsListResponse {
  code?: number;
  msg?: string;
  data?: {
    materials?: PreviewMaterialItem[];
    pagination?: {
      total_page?: number;
    };
  };
}

interface PreviewCommonResponse {
  code?: number;
  msg?: string;
  message?: string;
}

interface ScheduledMaterialPreviewTask {
  accountId: string;
  dramaName: string;
  awemeWhiteList: string[];
  cookieHeader: string;
  delaysMinutes: number[];
}

interface MaterialPreviewAccountConfig {
  aadvid: string;
  dramaName: string;
  awemeWhiteList: string[];
  cookieHeader: string;
}

interface MaterialPreviewAnalysisResult {
  needPreview: PreviewMaterialItem[];
  needDelete: PreviewMaterialItem[];
  canDeletePromotions: string[];
  totalAds: number;
  filteredAds: number;
}

export interface MaterialPreviewScheduleResult {
  scheduledCount: number;
  delaysMinutes: number[];
}

export interface MaterialPreviewExecutionResult {
  status: "success" | "skipped";
  previewCount: number;
  deleteCount: number;
  deletePromotionsCount: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function runConcurrent<T>(
  items: T[],
  limit: number,
  runner: (item: T, groupIndex: number) => Promise<void>,
): Promise<void> {
  const groups = chunk(items, limit);
  for (const [groupIndex, group] of groups.entries()) {
    await Promise.all(group.map((item) => runner(item, groupIndex)));
  }
}

async function withRetry<T>(
  runner: () => Promise<T>,
  label: string,
  retries = 3,
  delayMs = 600,
): Promise<T> {
  let lastError: unknown;

  for (let index = 0; index < retries; index += 1) {
    try {
      return await runner();
    } catch (error) {
      lastError = error;
      console.warn(
        `[素材预览] ${label} 失败重试 ${index + 1}/${retries}:`,
        error instanceof Error ? error.message : error,
      );
      await sleep(delayMs * (index + 1));
    }
  }

  throw lastError;
}

function getBackoffDelayMs(
  attemptIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  return Math.min(baseDelayMs * 2 ** attemptIndex, maxDelayMs);
}

async function withBackoffRetry<T>(
  runner: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: unknown;

  for (
    let attemptIndex = 0;
    attemptIndex < PREVIEW_RETRY_MAX_ATTEMPTS;
    attemptIndex += 1
  ) {
    try {
      return await runner();
    } catch (error) {
      lastError = error;
      if (attemptIndex >= PREVIEW_RETRY_MAX_ATTEMPTS - 1) {
        break;
      }

      const delayMs = getBackoffDelayMs(
        attemptIndex,
        PREVIEW_RETRY_BASE_DELAY_MS,
        PREVIEW_RETRY_MAX_DELAY_MS,
      );
      console.warn(
        `[素材预览] ${label} 失败，${Math.round(delayMs / 1000)} 秒后重试 ${attemptIndex + 1}/${PREVIEW_RETRY_MAX_ATTEMPTS - 1}:`,
        error instanceof Error ? error.message : error,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function createClient(cookieHeader: string): AxiosInstance {
  return axios.create({
    baseURL: "https://ad.oceanengine.com",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36",
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
      Cookie: cookieHeader,
    },
    timeout: 20000,
  });
}

async function fetchAllAds(
  client: AxiosInstance,
  aadvid: string,
): Promise<PreviewAdItem[]> {
  const all: PreviewAdItem[] = [];
  let page = 1;

  while (true) {
    const response = await withRetry(
      () =>
        client.post<PreviewAdsListResponse>(
          "/ad/api/promotion/ads/list",
          {
            sort_stat: "create_time",
            project_status: [-1],
            promotion_status: [-1],
            limit: 10,
            page,
            sort_order: 1,
            campaign_type: [1],
          },
          {
            params: { aadvid },
          },
        ),
      `fetchAds(page=${page})`,
    );

    if ((response.data.code ?? 0) !== 0) {
      throw new Error(
        `fetch ads code=${response.data.code}, msg=${response.data.msg || "unknown"}`,
      );
    }

    const ads = Array.isArray(response.data.data?.ads)
      ? response.data.data?.ads
      : [];
    all.push(...ads);

    const pagination = response.data.data?.pagination;
    if (!pagination || page >= Number(pagination.total_page || 1)) {
      break;
    }
    page += 1;
  }

  return all;
}

function filterAndDedupAds(
  ads: PreviewAdItem[],
  dramaName: string,
  awemeWhiteList: string[],
): PreviewAdItem[] {
  const filteredAds = ads.filter(
    (ad) => dramaName && String(ad.promotion_name || "").includes(dramaName),
  );

  const pickAwemeFromTitle = (title: string): string | null => {
    if (!title || !awemeWhiteList.length) {
      return null;
    }

    const hits = awemeWhiteList.filter((name) => title.includes(name));
    if (!hits.length) {
      return null;
    }

    return hits.sort((left, right) => right.length - left.length)[0] || null;
  };

  const getCreateTs = (ad: PreviewAdItem): number => {
    const timestamp = dayjs(
      ad.create_time || "",
      "YYYY-MM-DD HH:mm:ss",
      true,
    ).valueOf();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const bestByAweme = new Map<string, PreviewAdItem>();
  for (const ad of filteredAds) {
    const aweme = pickAwemeFromTitle(String(ad.promotion_name || ""));
    if (!aweme) {
      continue;
    }

    const previous = bestByAweme.get(aweme);
    if (!previous) {
      bestByAweme.set(aweme, ad);
      continue;
    }

    const currentTs = getCreateTs(ad);
    const previousTs = getCreateTs(previous);
    if (
      currentTs > previousTs ||
      (currentTs === previousTs && ad.promotion_id > previous.promotion_id)
    ) {
      bestByAweme.set(aweme, ad);
    }
  }

  return [...bestByAweme.values()].sort(
    (left, right) => getCreateTs(right) - getCreateTs(left),
  );
}

async function fetchMaterialsByPromotions(
  client: AxiosInstance,
  aadvid: string,
  promotionIds: string[],
): Promise<PreviewMaterialItem[]> {
  const results: PreviewMaterialItem[] = [];
  const groups = chunk(promotionIds, 50);

  await runConcurrent(groups, 3, async (ids, chunkIndex) => {
    let page = 1;
    while (true) {
      const response = await withRetry(
        () =>
          client.post<PreviewMaterialsListResponse>(
            "/ad/api/promotion/materials/list",
            {
              promotion_ids: ids,
              page,
              limit: 50,
              fields: [
                "stat_cost",
                "show_cnt",
                "cpm_platform",
                "click_cnt",
                "ctr",
                "cpc_platform",
                "convert_cnt",
                "conversion_rate",
                "conversion_cost",
                "deep_convert_cnt",
                "deep_convert_cost",
                "deep_convert_rate",
              ],
              sort_stat: "create_time",
              sort_order: 1,
              delivery_package: [],
              delivery_mode: [3],
              delivery_mode_internal: [3],
              quick_delivery: [],
              isAigc: false,
              isAutoStar: false,
            },
            {
              params: { aadvid },
            },
          ),
        `fetchMaterials(chunk=${chunkIndex}, page=${page})`,
      );

      if ((response.data.code ?? 0) !== 0) {
        throw new Error(
          `fetch materials code=${response.data.code}, msg=${response.data.msg || "unknown"}`,
        );
      }

      const materials = Array.isArray(response.data.data?.materials)
        ? response.data.data.materials
        : [];
      results.push(...materials);

      const pagination = response.data.data?.pagination;
      if (!pagination || page >= Number(pagination.total_page || 1)) {
        break;
      }
      page += 1;
    }
  });

  return results;
}

function ensureStatusArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function isPendingMaterial(material: PreviewMaterialItem): boolean {
  return material.material_status_first_name === "未投放";
}

function isDeliveringMaterial(material: PreviewMaterialItem): boolean {
  return material.material_status_first_name === "投放中";
}

function isOnlyBalanceInsufficient(material: PreviewMaterialItem): boolean {
  const secondNames = ensureStatusArray(material.material_status_second_name);
  return secondNames.length === 1 && secondNames[0] === "账户余额不足";
}

function containsRejectStatus(material: PreviewMaterialItem): boolean {
  return ensureStatusArray(material.material_status_second_name).includes(
    "审核不通过",
  );
}

function isPendingPreviewMaterial(material: PreviewMaterialItem): boolean {
  return (
    isPendingMaterial(material) &&
    isOnlyBalanceInsufficient(material) &&
    Number(material.material_reject_reason_type ?? 0) === 0
  );
}

function isPendingDeleteMaterial(material: PreviewMaterialItem): boolean {
  return (
    isPendingMaterial(material) &&
    ((isOnlyBalanceInsufficient(material) &&
      Number(material.material_reject_reason_type ?? 0) === 1) ||
      (containsRejectStatus(material) &&
        Number(material.material_reject_reason_type ?? 0) === 1))
  );
}

function isDeliveringPreviewMaterial(material: PreviewMaterialItem): boolean {
  return (
    isDeliveringMaterial(material) &&
    ensureStatusArray(material.material_status_second_name).length === 0 &&
    Number(material.material_reject_reason_type ?? 0) === 0
  );
}

function isDeliveringDeleteMaterial(material: PreviewMaterialItem): boolean {
  return (
    isDeliveringMaterial(material) &&
    Number(material.material_reject_reason_type ?? 0) === 1
  );
}

function classifyMaterialsByType(materials: PreviewMaterialItem[]): {
  needPreview: PreviewMaterialItem[];
  needDelete: PreviewMaterialItem[];
} {
  return {
    needPreview: materials.filter(
      (material) =>
        isPendingPreviewMaterial(material) ||
        isDeliveringPreviewMaterial(material),
    ),
    needDelete: materials.filter(
      (material) =>
        isPendingDeleteMaterial(material) ||
        isDeliveringDeleteMaterial(material),
    ),
  };
}

function groupByPromotion(
  materials: PreviewMaterialItem[],
): Record<string, PreviewMaterialItem[]> {
  return materials.reduce<Record<string, PreviewMaterialItem[]>>(
    (accumulator, item) => {
      const key = String(item.promotion_id || "").trim();
      if (!key) {
        return accumulator;
      }
      accumulator[key] ||= [];
      accumulator[key].push(item);
      return accumulator;
    },
    {},
  );
}

function promotionsToDeleteByType(materials: PreviewMaterialItem[]): string[] {
  const grouped = groupByPromotion(materials);
  const promotionIds: string[] = [];

  for (const [promotionId, items] of Object.entries(grouped)) {
    const deliveringMaterials = items.filter(isDeliveringMaterial);
    const pendingMaterials = items.filter(isPendingMaterial);
    const hasOtherType = items.some(
      (item) => !isDeliveringMaterial(item) && !isPendingMaterial(item),
    );
    const hasPreviewMaterial = items.some(
      (item) =>
        isPendingPreviewMaterial(item) || isDeliveringPreviewMaterial(item),
    );

    const deliveringCanDelete =
      deliveringMaterials.length === 0 ||
      (!deliveringMaterials.some(isDeliveringPreviewMaterial) &&
        !deliveringMaterials.some((item) =>
          ensureStatusArray(item.material_status_second_name).includes(
            "新建审核中",
          ),
        ));

    const pendingCanDelete =
      pendingMaterials.length === 0 ||
      (!pendingMaterials.some(isPendingPreviewMaterial) &&
        pendingMaterials.every(isPendingDeleteMaterial));

    if (
      !hasOtherType &&
      !hasPreviewMaterial &&
      deliveringCanDelete &&
      pendingCanDelete
    ) {
      promotionIds.push(promotionId);
    }
  }

  return promotionIds;
}

async function previewOne(
  client: AxiosInstance,
  aadvid: string,
  materialId: string,
  promotionId: string,
): Promise<void> {
  const response = await withBackoffRetry(
    () =>
      client.get<PreviewCommonResponse>("/ad/api/agw/ad/preview_url", {
        params: {
          IdType: "ID_TYPE_MATERIAL",
          MaterialId: materialId,
          PromotionId: promotionId,
          aadvid,
        },
        headers: { "Accept-Encoding": "gzip, deflate, br" },
      }),
    `preview(material=${materialId}, promotion=${promotionId})`,
  );

  if ((response.data?.code ?? 0) !== 0) {
    throw new Error(`preview failed code=${response.data?.code}`);
  }
}

async function deleteMaterialsBatch(
  client: AxiosInstance,
  aadvid: string,
  promotionId: string,
  cdpIds: string[],
): Promise<void> {
  const response = await withRetry(
    () =>
      client.post<PreviewCommonResponse>(
        "/superior/api/promote/materials/del",
        { ids: cdpIds, promotion_id: promotionId },
        {
          params: { aadvid },
        },
      ),
    `deleteMaterials(promotion=${promotionId}, count=${cdpIds.length})`,
  );

  if ((response.data?.code ?? 0) !== 0) {
    throw new Error(`delete materials failed code=${response.data?.code}`);
  }
}

async function deletePromotion(
  client: AxiosInstance,
  aadvid: string,
  promotionId: string,
): Promise<void> {
  const response = await withRetry(
    () =>
      client.post<PreviewCommonResponse>(
        "/ad/api/promotion/ads/delete",
        { ids: [promotionId] },
        {
          params: { aadvid },
        },
      ),
    `deletePromotion(${promotionId})`,
  );

  if ((response.data?.code ?? 0) !== 0) {
    throw new Error(`delete promotion failed code=${response.data?.code}`);
  }
}

export class MaterialPreviewService {
  private mainWindow: BrowserWindow | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private logs: Array<{ time: string; message: string }> = [];
  private maxLogs = 500;

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }

  getLogs(): Array<{ time: string; message: string }> {
    return [...this.logs];
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
      this.mainWindow.webContents.send("material-preview:log", entry);
    }
    console.log(`[MaterialPreview] ${message}`);
  }

  private buildTaskKey(
    accountId: string,
    dramaName: string,
    delayMinutes: number,
  ): string {
    return `${accountId}::${dramaName}::${delayMinutes}`;
  }

  private clearExistingSchedule(accountId: string, dramaName: string) {
    for (const [key, timer] of this.timers.entries()) {
      if (key.startsWith(`${accountId}::${dramaName}::`)) {
        clearTimeout(timer);
        this.timers.delete(key);
        this.log(`已取消旧的素材预览定时任务：${dramaName} (${accountId})`);
      }
    }
  }

  private async analyzeAccount(
    config: MaterialPreviewAccountConfig,
  ): Promise<MaterialPreviewAnalysisResult> {
    const client = createClient(config.cookieHeader);
    this.log(`开始分析素材预览：${config.dramaName} (${config.aadvid})`);
    const adsAll = await fetchAllAds(client, config.aadvid);
    const adsFiltered = filterAndDedupAds(
      adsAll,
      config.dramaName,
      config.awemeWhiteList,
    );

    if (!adsFiltered.length) {
      return {
        needPreview: [],
        needDelete: [],
        canDeletePromotions: [],
        totalAds: adsAll.length,
        filteredAds: 0,
      };
    }

    const promotionIds = adsFiltered.map((ad) => ad.promotion_id);
    const materials = await fetchMaterialsByPromotions(
      client,
      config.aadvid,
      promotionIds,
    );
    const classified = classifyMaterialsByType(materials);
    const canDeletePromotions = promotionsToDeleteByType(materials);
    const canDeletePromotionSet = new Set(canDeletePromotions);

    this.log(
      `分析完成：${config.dramaName} (${config.aadvid})，广告 ${adsAll.length} 条，命中 ${adsFiltered.length} 条，待预览 ${classified.needPreview.length} 条，待删素材 ${classified.needDelete.length} 条，待删广告 ${canDeletePromotions.length} 条`,
    );

    return {
      needPreview: classified.needPreview.filter(
        (material) => !canDeletePromotionSet.has(material.promotion_id),
      ),
      needDelete: classified.needDelete.filter(
        (material) => !canDeletePromotionSet.has(material.promotion_id),
      ),
      canDeletePromotions,
      totalAds: adsAll.length,
      filteredAds: adsFiltered.length,
    };
  }

  private async executePreview(
    config: MaterialPreviewAccountConfig,
    materials: PreviewMaterialItem[],
    delayMs = 400,
  ): Promise<void> {
    const client = createClient(config.cookieHeader);
    for (const material of materials) {
      this.log(
        `触发素材预览：${config.dramaName} (${config.aadvid}) material=${material.material_id} promotion=${material.promotion_id}`,
      );
      await previewOne(
        client,
        config.aadvid,
        material.material_id,
        material.promotion_id,
      );
      await sleep(delayMs);
    }
  }

  private async stopPreview(
    config: MaterialPreviewAccountConfig,
    materials: PreviewMaterialItem[],
  ): Promise<void> {
    const client = createClient(config.cookieHeader);
    const groups = groupByPromotion(
      materials.filter((material) => Boolean(material.cdp_material_id)),
    );

    for (const [promotionId, items] of Object.entries(groups)) {
      const materialIds = items
        .map((item) => String(item.cdp_material_id || "").trim())
        .filter(Boolean);
      if (!materialIds.length) {
        continue;
      }

      this.log(
        `删除问题素材：${config.dramaName} (${config.aadvid}) promotion=${promotionId} count=${materialIds.length}`,
      );
      await deleteMaterialsBatch(
        client,
        config.aadvid,
        promotionId,
        materialIds,
      );
      await sleep(300);
    }
  }

  private async deletePromotions(
    config: MaterialPreviewAccountConfig,
    promotionIds: string[],
  ): Promise<void> {
    const client = createClient(config.cookieHeader);

    for (const promotionId of promotionIds) {
      this.log(
        `删除问题广告：${config.dramaName} (${config.aadvid}) promotion=${promotionId}`,
      );
      await deletePromotion(client, config.aadvid, promotionId);
      await sleep(300);
    }
  }

  async executeForBuild(
    config: MaterialPreviewAccountConfig,
  ): Promise<MaterialPreviewExecutionResult> {
    const analysis = await this.analyzeAccount(config);

    if (analysis.filteredAds === 0) {
      this.log(
        `跳过素材预览：${config.dramaName} (${config.aadvid}) 没有命中广告`,
      );
      return {
        status: "skipped",
        previewCount: 0,
        deleteCount: 0,
        deletePromotionsCount: 0,
      };
    }

    if (analysis.needPreview.length > 0) {
      await this.executePreview(config, analysis.needPreview, 400);
    }

    if (analysis.needDelete.length > 0) {
      await this.stopPreview(config, analysis.needDelete);
    }

    if (analysis.canDeletePromotions.length > 0) {
      await this.deletePromotions(config, analysis.canDeletePromotions);
    }

    this.log(
      `素材预览执行完成：${config.dramaName} (${config.aadvid})，预览 ${analysis.needPreview.length} 条，删除素材 ${analysis.needDelete.length} 条，删除广告 ${analysis.canDeletePromotions.length} 条`,
    );

    return {
      status: "success",
      previewCount: analysis.needPreview.length,
      deleteCount: analysis.needDelete.length,
      deletePromotionsCount: analysis.canDeletePromotions.length,
    };
  }

  async scheduleAfterBuild(
    task: ScheduledMaterialPreviewTask,
  ): Promise<MaterialPreviewScheduleResult> {
    const normalizedDramaName = String(task.dramaName || "").trim();
    const normalizedAccountId = String(task.accountId || "").trim();
    const normalizedCookieHeader = String(task.cookieHeader || "").trim();
    const awemeWhiteList = Array.from(
      new Set(
        task.awemeWhiteList
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      ),
    );
    const delaysMinutes: number[] = Array.from(
      new Set(
        task.delaysMinutes.map((item) =>
          Math.max(1, Math.floor(Number(item || 0))),
        ),
      ),
    ).sort((left, right) => left - right);

    if (!normalizedDramaName || !normalizedAccountId) {
      throw new Error("缺少素材预览所需的剧名或账户");
    }
    if (!normalizedCookieHeader) {
      throw new Error("缺少素材预览所需的巨量 Cookie");
    }
    if (!awemeWhiteList.length) {
      throw new Error("缺少素材预览所需的抖音号白名单");
    }
    if (!delaysMinutes.length) {
      throw new Error("缺少素材预览定时配置");
    }

    this.clearExistingSchedule(normalizedAccountId, normalizedDramaName);

    for (const delayMinutes of delaysMinutes) {
      const taskKey = this.buildTaskKey(
        normalizedAccountId,
        normalizedDramaName,
        delayMinutes,
      );
      const timer = setTimeout(
        async () => {
          try {
            this.log(
              `开始执行素材预览定时任务：${normalizedDramaName} (${normalizedAccountId})，延迟 ${delayMinutes} 分钟`,
            );
            const result = await this.executeForBuild({
              aadvid: normalizedAccountId,
              dramaName: normalizedDramaName,
              awemeWhiteList,
              cookieHeader: normalizedCookieHeader,
            });
            this.log(
              `素材预览定时任务完成：${normalizedDramaName} (${normalizedAccountId})，状态 ${result.status}，预览 ${result.previewCount} 条，删除素材 ${result.deleteCount} 条，删除广告 ${result.deletePromotionsCount} 条`,
            );
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            this.log(
              `素材预览定时任务失败：${normalizedDramaName} (${normalizedAccountId})，延迟 ${delayMinutes} 分钟，${errorMessage}`,
            );
            console.error(
              `[素材预览] 定时任务失败：drama=${normalizedDramaName}, aadvid=${normalizedAccountId}, delay=${delayMinutes}分钟`,
              error,
            );
          } finally {
            this.timers.delete(taskKey);
          }
        },
        delayMinutes * 60 * 1000,
      );

      this.timers.set(taskKey, timer);
    }

    this.log(
      `已安排素材预览任务：${normalizedDramaName} (${normalizedAccountId})，${delaysMinutes.join("/")} 分钟后执行`,
    );

    return {
      scheduledCount: delaysMinutes.length,
      delaysMinutes,
    };
  }
}

export const materialPreviewService = new MaterialPreviewService();
