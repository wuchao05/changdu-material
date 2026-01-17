import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface UserInfo {
  id: string
  label: string
  isAdmin: boolean
}

export const useAuthStore = defineStore('auth', () => {
  // State
  const token = ref<string | null>(localStorage.getItem('auth-token'))
  const currentUser = ref<UserInfo | null>(null)

  // Computed
  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => currentUser.value?.isAdmin === true)

  // Actions
  function login(user: UserInfo, authToken: string) {
    token.value = authToken
    currentUser.value = user
    localStorage.setItem('auth-token', authToken)
    localStorage.setItem('auth-user', JSON.stringify(user))
  }

  function logout() {
    token.value = null
    currentUser.value = null
    localStorage.removeItem('auth-token')
    localStorage.removeItem('auth-user')
  }

  function loadFromStorage() {
    const savedToken = localStorage.getItem('auth-token')
    const savedUser = localStorage.getItem('auth-user')
    
    if (savedToken && savedUser) {
      token.value = savedToken
      try {
        currentUser.value = JSON.parse(savedUser)
      } catch {
        currentUser.value = null
      }
    }
  }

  // 初始化时从 localStorage 加载
  loadFromStorage()

  return {
    token,
    currentUser,
    isLoggedIn,
    isAdmin,
    login,
    logout,
    loadFromStorage
  }
}, {
  persist: false // 我们手动处理持久化
})
