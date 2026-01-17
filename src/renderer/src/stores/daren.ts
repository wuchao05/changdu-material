import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'
import { useAuthStore } from './auth'

export interface DarenInfo {
  id: string // 账户
  label: string // 名称
  password?: string // 登录密码
  feishuDramaStatusTableId?: string // 飞书剧集状态表 ID
  enableUpload?: boolean // 启用上传功能
  enableDownload?: boolean // 启用下载功能
}

export const useDarenStore = defineStore('daren', () => {
  const authStore = useAuthStore()

  // State
  const darenList = ref<DarenInfo[]>([])
  const selectedDarenId = ref<string | null>(null)
  const loading = ref(false)

  // Computed
  const currentDaren = computed(() => {
    const userId = selectedDarenId.value || authStore.currentUser?.id
    return darenList.value.find(d => d.id === userId) || null
  })

  // 功能权限
  const canUpload = computed(() => {
    // 管理员默认拥有所有权限
    if (authStore.currentUser?.role === 'admin') {
      return true
    }
    // 达人根据配置判断
    return currentDaren.value?.enableUpload === true
  })

  const canDownload = computed(() => {
    // 管理员默认拥有所有权限
    if (authStore.currentUser?.role === 'admin') {
      return true
    }
    // 达人根据配置判断
    return currentDaren.value?.enableDownload === true
  })

  // Actions
  async function loadFromServer(forceRefresh = false) {
    if (loading.value) return
    
    // 尝试从缓存加载
    if (!forceRefresh) {
      const cached = localStorage.getItem('daren-list-cache')
      if (cached) {
        try {
          const data = JSON.parse(cached)
          if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
            darenList.value = data.list
            return
          }
        } catch {
          // 忽略缓存错误
        }
      }
    }

    loading.value = true
    try {
      const result = await window.api.getDarenConfig()
      darenList.value = result.darenList || []
      
      // 缓存到本地
      localStorage.setItem('daren-list-cache', JSON.stringify({
        timestamp: Date.now(),
        list: darenList.value
      }))
    } catch (error) {
      console.error('加载达人配置失败:', error)
    } finally {
      loading.value = false
    }
  }

  async function addDaren(daren: DarenInfo) {
    // 转换为纯对象，避免 IPC 克隆错误
    const plainDaren = JSON.parse(JSON.stringify(toRaw(daren)))
    const result = await window.api.addDaren(plainDaren)
    darenList.value.push(result)
    updateCache()
    return result
  }

  async function updateDaren(id: string, updates: Partial<DarenInfo>) {
    // 转换为纯对象，避免 IPC 克隆错误
    const plainUpdates = JSON.parse(JSON.stringify(toRaw(updates)))
    const result = await window.api.updateDaren(id, plainUpdates)
    const index = darenList.value.findIndex(d => d.id === id)
    if (index >= 0) {
      if (updates.id && updates.id !== id) {
        darenList.value.splice(index, 1)
        darenList.value.push(result)
      } else {
        darenList.value[index] = result
      }
    }
    updateCache()
    return result
  }

  async function deleteDaren(id: string) {
    await window.api.deleteDaren(id)
    const index = darenList.value.findIndex(d => d.id === id)
    if (index >= 0) {
      darenList.value.splice(index, 1)
    }
    if (selectedDarenId.value === id) {
      selectedDarenId.value = null
    }
    updateCache()
  }

  function setSelectedDaren(id: string | null) {
    selectedDarenId.value = id
    if (id) {
      localStorage.setItem('selected-daren-id', id)
    } else {
      localStorage.removeItem('selected-daren-id')
    }
  }

  function findDarenById(id: string): DarenInfo | undefined {
    return darenList.value.find(d => d.id === id)
  }

  function updateCache() {
    localStorage.setItem('daren-list-cache', JSON.stringify({
      timestamp: Date.now(),
      list: darenList.value
    }))
  }

  // 初始化时加载选中的达人 ID
  const savedSelectedId = localStorage.getItem('selected-daren-id')
  if (savedSelectedId) {
    selectedDarenId.value = savedSelectedId
  }

  return {
    darenList,
    selectedDarenId,
    loading,
    currentDaren,
    canUpload,
    canDownload,
    loadFromServer,
    addDaren,
    updateDaren,
    deleteDaren,
    setSelectedDaren,
    findDarenById
  }
})
