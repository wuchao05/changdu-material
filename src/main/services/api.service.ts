import axios, { AxiosRequestConfig } from 'axios'
import fs from 'fs'
import FormData from 'form-data'
import type { ConfigService, ApiConfig } from './config.service'

export interface UploadProgress {
  fileName: string
  uploadedBytes: number
  totalBytes: number
  percent: string
}

export class ApiService {
  private feishuTokenCache: { token: string | null; expireTime: number } = {
    token: null,
    expireTime: 0
  }

  // ==================== 飞书 API ====================

  async feishuRequest(
    endpoint: string,
    data: unknown,
    method: string = 'POST',
    configService: ConfigService
  ): Promise<unknown> {
    console.log('[ApiService] 飞书请求开始')
    console.log('[ApiService] Endpoint:', endpoint)
    console.log('[ApiService] Method:', method)
    console.log('[ApiService] Request Data:', JSON.stringify(data, null, 2))

    const apiConfig = await configService.getApiConfig()
    const token = await this.getFeishuToken(apiConfig)

    const config: AxiosRequestConfig = {
      method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
      url: `https://open.feishu.cn${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }

    if (method === 'GET') {
      config.params = data
    } else {
      config.data = data
    }

    console.log('[ApiService] 完整请求 URL:', config.url)
    console.log('[ApiService] 请求头:', {
      ...config.headers,
      Authorization: token ? `Bearer ${token.substring(0, 20)}...` : 'no token'
    })

    const response = await axios(config)
    
    console.log('[ApiService] 飞书响应状态:', response.status)
    console.log('[ApiService] 飞书响应数据:', JSON.stringify(response.data, null, 2))
    
    return response.data
  }

  /**
   * 查询待上传的剧集列表
   * @param tableId 可选的表格 ID，如果不传则使用系统配置
   */
  async getPendingUploadDramas(
    configService: ConfigService,
    tableId?: string
  ): Promise<{
    code: number
    msg?: string
    data?: {
      items: Array<{
        record_id: string
        fields: Record<string, unknown>
      }>
    }
  }> {
    const apiConfig = await configService.getApiConfig()
    
    // 如果没有传入 tableId，使用系统配置
    const finalTableId = tableId || apiConfig.feishuDramaStatusTableId
    
    if (!finalTableId) {
      throw new Error('请先配置飞书剧集状态表 ID')
    }

    const token = await this.getFeishuToken(apiConfig)

    const response = await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${apiConfig.feishuAppToken}/tables/${finalTableId}/records/search`,
      {
        field_names: ['剧名', '日期', '当前状态'],
        page_size: 100,
        filter: {
          conjunction: 'and',
          conditions: [
            {
              field_name: '当前状态',
              operator: 'is',
              value: ['待上传']
            },
            {
              field_name: '主体',
              operator: 'isNot',
              value: ['每日']
            }
          ]
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }
    )

    if (response.data.code !== 0) {
      throw new Error(response.data.msg || '查询待上传剧集失败')
    }

    return response.data
  }

  /**
   * 按日期查询待上传的剧集列表
   * @param configService 配置服务
   * @param tableId 表格 ID
   * @param dateTimestamp 日期时间戳（毫秒）
   */
  async getPendingUploadDramasByDate(
    configService: ConfigService,
    tableId: string | undefined,
    dateTimestamp: number
  ): Promise<{
    code: number
    msg?: string
    data?: {
      items: Array<{
        record_id: string
        fields: Record<string, unknown>
      }>
    }
  }> {
    const apiConfig = await configService.getApiConfig()
    
    const finalTableId = tableId || apiConfig.feishuDramaStatusTableId
    
    if (!finalTableId) {
      throw new Error('请先配置飞书剧集状态表 ID')
    }

    const token = await this.getFeishuToken(apiConfig)

    // 将时间戳转换为当天 00:00:00 的时间戳（飞书日期字段使用 ExactDate 格式）
    const dateObj = new Date(dateTimestamp)
    dateObj.setHours(0, 0, 0, 0)
    const exactDateTimestamp = dateObj.getTime()

    console.log(`[ApiService] 查询日期: ${dateObj.toLocaleDateString()}, 时间戳: ${exactDateTimestamp}`)

    const response = await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${apiConfig.feishuAppToken}/tables/${finalTableId}/records/search`,
      {
        field_names: ['剧名', '日期', '当前状态', '主体'],
        page_size: 100,
        filter: {
          conjunction: 'and',
          conditions: [
            {
              field_name: '当前状态',
              operator: 'is',
              value: ['待上传']
            },
            {
              field_name: '主体',
              operator: 'isNot',
              value: ['每日']
            }
          ]
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }
    )

    console.log(`[ApiService] 飞书返回: code=${response.data.code}, items=${response.data.data?.items?.length || 0}`)

    if (response.data.code !== 0) {
      throw new Error(response.data.msg || '查询待上传剧集失败')
    }

    // 如果返回了数据，在前端按日期筛选
    if (response.data.data?.items) {
      const filteredItems = response.data.data.items.filter((item: any) => {
        const itemDate = item.fields['日期']
        if (!itemDate) return false

        // 处理日期字段（可能是时间戳或字符串）
        let itemDateTimestamp: number
        if (typeof itemDate === 'number') {
          itemDateTimestamp = itemDate
        } else if (typeof itemDate === 'string') {
          // 如果是字符串，尝试解析
          itemDateTimestamp = new Date(itemDate).getTime()
        } else {
          return false
        }

        // 检查是否是同一天
        const itemDateObj = new Date(itemDateTimestamp)
        itemDateObj.setHours(0, 0, 0, 0)
        return itemDateObj.getTime() === exactDateTimestamp
      })

      response.data.data.items = filteredItems
      console.log(`[ApiService] 日期筛选后剩余: ${filteredItems.length} 条记录`)
    }

    return response.data
  }

  /**
   * 更新飞书记录状态
   * @param recordId 记录 ID
   * @param newStatus 新状态（待上传、上传中、待搭建、上传失败等）
   * @param tableId 表格 ID
   */
  async updateFeishuRecordStatus(
    recordId: string,
    newStatus: string,
    configService: ConfigService,
    tableId?: string
  ): Promise<boolean> {
    try {
      const apiConfig = await configService.getApiConfig()
      const finalTableId = tableId || apiConfig.feishuDramaStatusTableId

      if (!finalTableId) {
        console.error('[ApiService] 更新飞书状态失败: 未配置表格 ID')
        return false
      }

      const token = await this.getFeishuToken(apiConfig)

      console.log(`[ApiService] 更新飞书记录状态: ${recordId} -> ${newStatus}`)

      const response = await axios.put(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${apiConfig.feishuAppToken}/tables/${finalTableId}/records/${recordId}`,
        {
          fields: {
            '当前状态': newStatus
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        }
      )

      if (response.data.code !== 0) {
        console.error(`[ApiService] 更新飞书状态失败: ${response.data.msg}`)
        return false
      }

      console.log(`[ApiService] 飞书状态更新成功: ${recordId} -> ${newStatus}`)
      return true
    } catch (error) {
      console.error(`[ApiService] 更新飞书状态异常: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  private async getFeishuToken(apiConfig: ApiConfig): Promise<string> {
    // 检查缓存
    if (this.feishuTokenCache.token && Date.now() < this.feishuTokenCache.expireTime) {
      return this.feishuTokenCache.token
    }

    // 获取新 token
    const response = await axios.post(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        app_id: apiConfig.feishuAppId,
        app_secret: apiConfig.feishuAppSecret
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )

    if (response.data.code !== 0) {
      throw new Error(`获取飞书 Token 失败: ${response.data.msg}`)
    }

    this.feishuTokenCache.token = response.data.tenant_access_token
    this.feishuTokenCache.expireTime = Date.now() + (response.data.expire - 300) * 1000

    return this.feishuTokenCache.token!
  }

  // ==================== 常读平台 API ====================

  /**
   * 常读下载中心接口请求（不需要签名）
   * 域名: www.changdunovel.com
   * @param configType 使用哪套常读配置，默认使用散柔配置
   */
  async changduRequest(
    endpoint: string,
    params: Record<string, string | number>,
    headers: Record<string, string> = {},
    configService: ConfigService,
    configType: 'sanrou' | 'meiri' = 'sanrou'
  ): Promise<unknown> {
    console.log('[ApiService] 常读请求开始')
    console.log('[ApiService] Endpoint:', endpoint)
    console.log('[ApiService] Config Type:', configType)
    console.log('[ApiService] Params:', JSON.stringify(params, null, 2))

    const apiConfig = await configService.getApiConfig()
    
    // 根据 configType 选择配置
    const changduConfig = configType === 'meiri' 
      ? apiConfig.meiriChangdu 
      : apiConfig.sanrouChangdu

    const url = new URL(`https://www.changdunovel.com${endpoint}`)
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, String(value))
    })

    const requestHeaders = {
      ...headers,
      Cookie: changduConfig.cookie,
      Appid: changduConfig.changduAppId || '40012555',
      Apptype: '7',
      Distributorid: changduConfig.distributorId,
      Aduserid: changduConfig.changduAdUserId,
      Rootaduserid: changduConfig.changduRootAdUserId
    }

    console.log('[ApiService] 完整请求 URL:', url.toString())
    console.log('[ApiService] 请求头:', {
      ...requestHeaders,
      Cookie: changduConfig.cookie ? `${changduConfig.cookie.substring(0, 50)}...` : 'no cookie'
    })

    const response = await axios.get(url.toString(), {
      headers: requestHeaders
    })

    console.log('[ApiService] 常读响应状态:', response.status)
    console.log('[ApiService] 常读响应数据:', JSON.stringify(response.data, null, 2))

    return response.data
  }


  // ==================== TOS 上传 ====================

  async uploadToTos(
    filePath: string,
    options: {
      bucket?: string
      region?: string
      folder?: string
    },
    configService: ConfigService,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<{ success: boolean; url: string }> {
    const apiConfig = await configService.getApiConfig()
    const fileName = filePath.split(/[/\\]/).pop() || 'video.mp4'
    const fileSize = fs.statSync(filePath).size

    // 获取上传凭证
    const uploadAuth = await this.getTosUploadAuth(apiConfig, fileName)
    
    // 上传文件
    const formData = new FormData()
    formData.append('key', uploadAuth.key)
    formData.append('policy', uploadAuth.policy)
    formData.append('x-tos-signature', uploadAuth.signature)
    formData.append('x-tos-algorithm', 'TOS4-HMAC-SHA256')
    formData.append('x-tos-credential', uploadAuth.credential)
    formData.append('x-tos-date', uploadAuth.date)
    
    const fileStream = fs.createReadStream(filePath)
    let uploadedBytes = 0

    fileStream.on('data', (chunk: Buffer) => {
      uploadedBytes += chunk.length
      if (onProgress) {
        onProgress({
          fileName,
          uploadedBytes,
          totalBytes: fileSize,
          percent: ((uploadedBytes / fileSize) * 100).toFixed(2)
        })
      }
    })

    formData.append('file', fileStream)

    const response = await axios.post(uploadAuth.uploadUrl, formData, {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    })

    if (response.status === 204 || response.status === 200) {
      return {
        success: true,
        url: uploadAuth.fileUrl
      }
    }

    throw new Error(`上传失败，状态码: ${response.status}`)
  }

  private async getTosUploadAuth(
    apiConfig: ApiConfig,
    fileName: string
  ): Promise<{
    uploadUrl: string
    key: string
    policy: string
    signature: string
    credential: string
    date: string
    fileUrl: string
  }> {
    // 这里需要调用后端接口获取上传凭证
    // 简化示例，实际需要根据 TOS SDK 实现
    const bucket = apiConfig.tosBucket || 'your-bucket'
    const region = apiConfig.tosRegion || 'cn-beijing'
    const key = `uploads/${Date.now()}_${fileName}`

    return {
      uploadUrl: `https://${bucket}.tos-${region}.volces.com`,
      key,
      policy: '', // 需要后端生成
      signature: '', // 需要后端生成
      credential: '', // 需要后端生成
      date: new Date().toISOString(),
      fileUrl: `https://${bucket}.tos-${region}.volces.com/${key}`
    }
  }

  // ==================== 素材库 ====================

  async submitToMaterialLibrary(
    materials: Array<{
      name: string
      url: string
      type: number
      width: number
      height: number
      duration: number
      size: number
      contentName?: string
      editor?: string
      remark?: string
    }>,
    configService: ConfigService
  ): Promise<unknown> {
    const apiConfig = await configService.getApiConfig()

    if (!apiConfig.xtToken) {
      throw new Error('请先配置 XT Token')
    }

    console.log(`[ApiService] 开始提交素材到素材库，共 ${materials.length} 个素材`)

    const requestData = {
      category_id: 36243,
      content_type: 0,
      list: materials.map(m => ({
        name: m.name,
        content_name: m.contentName || '',
        editor: m.editor || '',
        url: m.url,
        type: m.type,
        width: m.width,
        height: m.height,
        duration: Math.round(m.duration),
        size: Math.ceil(m.size / 1024 / 1024), // 转为 MB 并取整
        remark: m.remark || '',
        from: 0
      }))
    }

    console.log(`[ApiService] 素材库请求 URL: https://splay-admin.lnkaishi.cn/material/add?team_id=500039`)
    console.log(`[ApiService] 提交素材列表:`, materials.map(m => m.name).join(', '))

    const response = await axios.post(
      'https://splay-admin.lnkaishi.cn/material/add',
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          token: apiConfig.xtToken
        },
        params: {
          team_id: '500039'
        },
        timeout: 10000
      }
    )

    console.log(`[ApiService] 素材库响应状态: ${response.status}`)
    console.log(`[ApiService] 素材库响应数据:`, JSON.stringify(response.data, null, 2))

    if (response.data.code !== 0) {
      throw new Error(`素材库提交失败: ${response.data.msg || '未知错误'}`)
    }

    console.log(`[ApiService] ✓ 素材库提交成功`)

    return response.data
  }
}
