import TosSDK from '@volcengine/tos-sdk'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { ConfigService } from './config.service'

// 兼容不同的模块导出方式
const TOS = (TosSDK as any).default || TosSDK

// 分片大小配置（字节）
export const CHUNK_SIZE = {
  SMALL: 5 * 1024 * 1024, // 5MB
  MEDIUM: 10 * 1024 * 1024, // 10MB
  LARGE: 20 * 1024 * 1024, // 20MB
  XLARGE: 40 * 1024 * 1024 // 40MB
} as const

// 并发分片数配置
export const CONCURRENT_CHUNKS = {
  SMALL: 4,
  MEDIUM: 6,
  LARGE: 8,
  XLARGE: 10
} as const

// 文件大小阈值（字节）
export const FILE_SIZE_THRESHOLD = {
  SMALL: 50 * 1024 * 1024, // 50MB
  MEDIUM: 200 * 1024 * 1024, // 200MB
  LARGE: 500 * 1024 * 1024 // 500MB
} as const

export interface UploadProgress {
  fileName: string
  percent: number
  uploadedBytes: number
  totalBytes: number
  status: 'pending' | 'uploading' | 'success' | 'error'
  error?: string
}

export interface UploadResult {
  success: boolean
  fileName: string
  url?: string
  error?: string
}

export interface TosCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
}

// 根据文件大小获取最优分片配置
export function getChunkConfig(fileSize: number) {
  if (fileSize > FILE_SIZE_THRESHOLD.LARGE) {
    return {
      partSize: CHUNK_SIZE.XLARGE,
      taskNum: CONCURRENT_CHUNKS.XLARGE
    }
  } else if (fileSize > FILE_SIZE_THRESHOLD.MEDIUM) {
    return {
      partSize: CHUNK_SIZE.LARGE,
      taskNum: CONCURRENT_CHUNKS.LARGE
    }
  } else if (fileSize > FILE_SIZE_THRESHOLD.SMALL) {
    return {
      partSize: CHUNK_SIZE.MEDIUM,
      taskNum: CONCURRENT_CHUNKS.MEDIUM
    }
  } else {
    return {
      partSize: CHUNK_SIZE.SMALL,
      taskNum: CONCURRENT_CHUNKS.SMALL
    }
  }
}

// 生成按年月日分类的文件路径
export function generateFilePath(fileName: string): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `material/${year}/${month}/${day}/${fileName}`
}

// 将文件名处理为 md5 命名
export function getMd5FileName(originalName: string): string {
  const dotIndex = originalName.lastIndexOf('.')
  const ext = dotIndex !== -1 ? originalName.slice(dotIndex) : ''
  const nameOnly = dotIndex !== -1 ? originalName.slice(0, dotIndex) : originalName
  const md5Name = crypto.createHash('md5').update(nameOnly).digest('hex')
  return `${md5Name}${ext}`
}

export class TosService {
  private tosClient: TOS | null = null
  private credentialsExpireTime = 0
  private uploadCancelTokens: Map<string, { cancel: () => void }> = new Map()
  private activeUploads: Map<string, boolean> = new Map()

  // 上传队列管理
  private uploadQueue: string[] = []
  private uploadingCount = 0
  private maxConcurrentUploads = 5
  private totalStartTime = 0

  async initTosClient(configService: ConfigService, force = false): Promise<TOS> {
    // 检查是否需要刷新凭证
    if (this.tosClient && !force && Date.now() < this.credentialsExpireTime) {
      return this.tosClient
    }

    const apiConfig = await configService.getApiConfig()
    if (!apiConfig.xtToken) {
      throw new Error('请先配置 XT Token')
    }

    // 获取 TOS 临时凭证
    const credentials = await this.getTosCredentials(apiConfig.xtToken)

    // 创建 TOS 客户端
    this.tosClient = new TOS({
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.secretAccessKey,
      stsToken: credentials.sessionToken,
      region: 'cn-beijing',
      endpoint: 'tos-cn-beijing.volces.com',
      bucket: 'ylc-material-beijing',
      secure: true
    })

    // 凭证有效期设置为 50 分钟（实际 1 小时，提前 10 分钟刷新）
    this.credentialsExpireTime = Date.now() + 50 * 60 * 1000

    console.log('[TosService] TOS 客户端初始化成功')
    return this.tosClient
  }

  private async getTosCredentials(xtToken: string): Promise<TosCredentials> {
    // 调用素材库 API 获取 TOS 临时凭证
    const axios = (await import('axios')).default

    const response = await axios.get('https://splay-admin.lnkaishi.cn/material/getTosKey', {
      headers: {
        token: xtToken
      },
      params: {
        team_id: 1 // 默认团队 ID
      },
      timeout: 10000
    })

    if (response.data.code !== 0 && response.data.code !== undefined) {
      throw new Error(response.data.message || '获取 TOS 凭证失败')
    }

    // 兼容不同的返回格式
    const resultData = response.data.data?.Result || response.data.Result || response.data
    const credentials = resultData?.Credentials
    if (!credentials) {
      throw new Error('TOS 凭证数据格式不正确')
    }

    return {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.SessionToken
    }
  }

  async uploadFile(
    filePath: string,
    configService: ConfigService,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    const fileName = path.basename(filePath)

    try {
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`)
      }

      // 初始化 TOS 客户端
      const tosClient = await this.initTosClient(configService)

      // 获取文件大小
      const fileSize = fs.statSync(filePath).size

      // 获取分片配置
      const { partSize, taskNum } = getChunkConfig(fileSize)

      // 生成 TOS 路径
      const tosFilePath = generateFilePath(getMd5FileName(fileName))
      console.log(`[TosService] 开始上传: ${fileName} -> ${tosFilePath}`)

      // 创建取消令牌
      const cancelTokenSource = TOS.CancelToken.source()
      this.uploadCancelTokens.set(fileName, {
        cancel: () => cancelTokenSource.cancel('用户取消上传')
      })
      this.activeUploads.set(fileName, true)

      // 发送开始上传通知
      onProgress?.({
        fileName,
        percent: 0,
        uploadedBytes: 0,
        totalBytes: fileSize,
        status: 'uploading'
      })

      // 节流：限制进度回调频率（至少间隔 500ms）
      let lastProgressTime = 0
      let lastPercent = 0
      const PROGRESS_THROTTLE_MS = 500

      // 执行上传（直接传文件路径，避免读入内存）
      await tosClient.uploadFile({
        key: tosFilePath,
        file: filePath, // 使用文件路径而非 Buffer，TOS SDK 支持流式读取
        partSize,
        taskNum,
        cancelToken: cancelTokenSource.token,
        progress: (p: number) => {
          const now = Date.now()
          const percent = Math.min(Math.round(p * 100), 98)
          
          // 节流：只有进度变化超过 2% 或时间间隔超过 500ms 才发送
          if (percent - lastPercent >= 2 || now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
            lastProgressTime = now
            lastPercent = percent
            onProgress?.({
              fileName,
              percent,
              uploadedBytes: Math.round(fileSize * p),
              totalBytes: fileSize,
              status: 'uploading'
            })
          }
        }
      })

      // 上传成功
      const url = `/${tosFilePath}`
      console.log(`[TosService] 上传成功: ${fileName} -> ${url}`)

      // 清理状态
      this.uploadCancelTokens.delete(fileName)
      this.activeUploads.delete(fileName)

      onProgress?.({
        fileName,
        percent: 100,
        uploadedBytes: fileSize,
        totalBytes: fileSize,
        status: 'success'
      })

      return {
        success: true,
        fileName,
        url
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '上传失败'

      // 清理状态
      this.uploadCancelTokens.delete(fileName)
      this.activeUploads.delete(fileName)

      // 检查是否是取消操作
      if (errorMessage === '用户取消上传' || errorMessage === 'cancel uploadFile') {
        console.log(`[TosService] 上传已取消: ${fileName}`)
        return {
          success: false,
          fileName,
          error: '上传已取消'
        }
      }

      console.error(`[TosService] 上传失败: ${fileName}`, error)

      onProgress?.({
        fileName,
        percent: 0,
        uploadedBytes: 0,
        totalBytes: 0,
        status: 'error',
        error: errorMessage
      })

      return {
        success: false,
        fileName,
        error: errorMessage
      }
    }
  }

  // 批量上传（支持并发控制）
  async uploadBatch(
    filePaths: string[],
    configService: ConfigService,
    maxConcurrent: number,
    onProgress: (fileName: string, progress: UploadProgress) => void,
    onComplete: (fileName: string, result: UploadResult) => void
  ): Promise<void> {
    this.maxConcurrentUploads = maxConcurrent
    this.uploadQueue = [...filePaths]
    this.uploadingCount = 0
    this.totalStartTime = performance.now()

    // 初始化 TOS 客户端（在开始批量上传前）
    await this.initTosClient(configService, true)

    // 启动并发上传
    const processQueue = async (): Promise<void> => {
      while (this.uploadQueue.length > 0 && this.uploadingCount < this.maxConcurrentUploads) {
        const filePath = this.uploadQueue.shift()
        if (!filePath) break

        this.uploadingCount++

        // 异步处理单个文件，不阻塞队列
        this.uploadFile(filePath, configService, (progress) => {
          const fileName = path.basename(filePath)
          onProgress(fileName, progress)
        })
          .then((result) => {
            const fileName = path.basename(filePath)
            onComplete(fileName, result)
          })
          .finally(() => {
            this.uploadingCount--
            // 继续处理队列
            if (this.uploadQueue.length > 0) {
              processQueue()
            }
          })
      }
    }

    // 启动初始批次
    const startBatch = Math.min(maxConcurrent, filePaths.length)
    for (let i = 0; i < startBatch; i++) {
      processQueue()
    }
  }

  // 取消上传
  cancelUpload(fileName: string): boolean {
    const cancelToken = this.uploadCancelTokens.get(fileName)
    if (cancelToken) {
      cancelToken.cancel()
      this.uploadCancelTokens.delete(fileName)
      this.activeUploads.delete(fileName)
      return true
    }
    return false
  }

  // 取消所有上传
  cancelAllUploads(): void {
    for (const [fileName, cancelToken] of this.uploadCancelTokens) {
      cancelToken.cancel()
      this.activeUploads.delete(fileName)
    }
    this.uploadCancelTokens.clear()
    this.uploadQueue = []
    this.uploadingCount = 0
  }

  // 检查是否正在上传
  isUploading(fileName: string): boolean {
    return this.activeUploads.get(fileName) === true
  }

  // 获取上传总耗时
  getUploadDuration(): string {
    if (this.totalStartTime === 0) return '0'
    const duration = ((performance.now() - this.totalStartTime) / 1000).toFixed(2)
    return duration
  }

  // 更新最大并发数
  updateMaxConcurrent(newMax: number): void {
    if (newMax >= 1 && newMax <= 10) {
      this.maxConcurrentUploads = newMax
      console.log(`[TosService] 并发数已更新为: ${newMax}`)
    }
  }

  // 获取队列状态
  getQueueStatus(): { total: number; active: number; pending: number; maxConcurrent: number } {
    return {
      total: this.uploadQueue.length + this.uploadingCount,
      active: this.uploadingCount,
      pending: this.uploadQueue.length,
      maxConcurrent: this.maxConcurrentUploads
    }
  }
}
