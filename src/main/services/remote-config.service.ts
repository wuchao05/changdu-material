import axios from "axios";
import type { ApiConfig, DarenInfo } from "./config.service";

/**
 * 远程配置结构
 * POST 请求直接发送此对象
 * GET 请求返回 { code: 0, data: RemoteConfig }
 */
export interface RemoteConfig {
  version: number;
  updatedAt: string;
  apiConfig: ApiConfig;
  darenList: DarenInfo[];
}

export class RemoteConfigService {
  private readonly configUrl = "https://ad-runner.cxyy.top/api/electron-config";

  /**
   * 拉取远程配置
   * GET https://ad-runner.cxyy.top/api/electron-config
   * 返回: { code: 0, data: { version, updatedAt, apiConfig, darenList } }
   */
  async fetchConfig(): Promise<RemoteConfig | null> {
    try {
      console.log("[RemoteConfig] 拉取远程配置...");
      console.log("[RemoteConfig] URL:", this.configUrl);

      const response = await axios.get(this.configUrl, {
        timeout: 15000,
        headers: {
          "Content-Type": "application/json",
        },
      });

      console.log("[RemoteConfig] 响应状态:", response.status);
      console.log(
        "[RemoteConfig] 响应数据:",
        JSON.stringify(response.data, null, 2)
      );

      // 响应格式: { code: 0, data: RemoteConfig }
      if (response.data?.code === 0 && response.data?.data) {
        const data = response.data.data as RemoteConfig;
        console.log("[RemoteConfig] ✓ 拉取成功，版本:", data.version);
        return data;
      }

      console.log("[RemoteConfig] 远程配置为空或格式不正确");
      return null;
    } catch (error) {
      console.error("[RemoteConfig] ✗ 拉取失败:", error);
      return null;
    }
  }

  /**
   * 推送配置到服务器
   * POST https://ad-runner.cxyy.top/api/electron-config
   * 请求体: { version, updatedAt, apiConfig, darenList }
   * 返回: { code: 0, msg: "success" }
   */
  async pushConfig(
    apiConfig: ApiConfig,
    darenList: DarenInfo[]
  ): Promise<boolean> {
    try {
      console.log("[RemoteConfig] 推送配置到服务器...");
      console.log("[RemoteConfig] URL:", this.configUrl);

      // 直接发送配置对象
      const config: RemoteConfig = {
        version: Date.now(),
        updatedAt: new Date().toISOString(),
        apiConfig,
        darenList,
      };

      console.log(
        "[RemoteConfig] 推送数据:",
        JSON.stringify(
          {
            version: config.version,
            updatedAt: config.updatedAt,
            apiConfigKeys: Object.keys(config.apiConfig),
            darenCount: config.darenList.length,
          },
          null,
          2
        )
      );

      const response = await axios.post(this.configUrl, config, {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
      });

      console.log("[RemoteConfig] 响应状态:", response.status);
      console.log("[RemoteConfig] 响应数据:", response.data);

      // 响应格式: { code: 0, msg: "success" }
      if (response.data?.code === 0) {
        console.log("[RemoteConfig] ✓ 推送成功");
        return true;
      }

      console.log("[RemoteConfig] ✗ 推送失败，响应:", response.data);
      return false;
    } catch (error) {
      console.error("[RemoteConfig] ✗ 推送失败:", error);
      return false;
    }
  }
}
