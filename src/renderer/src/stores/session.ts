import { computed, ref } from "vue";
import { defineStore } from "pinia";

function createEmptyDesktopMenus(): DesktopMenus {
  return {
    download: false,
    materialClip: false,
    upload: false,
    juliangUpload: false,
    uploadBuild: false,
    juliangBuild: false,
  };
}

const ADMIN_DESKTOP_MENUS: DesktopMenus = {
  download: true,
  materialClip: true,
  upload: true,
  juliangUpload: true,
  uploadBuild: true,
  juliangBuild: true,
};

export const useSessionStore = defineStore("session", () => {
  const session = ref<SessionRuntimeData | null>(null);
  const loading = ref(false);
  const initialized = ref(false);

  const isAuthenticated = computed(() => Boolean(session.value?.user?.id));
  const isAdmin = computed(() => session.value?.user?.userType === "admin");
  const currentUser = computed(() => session.value?.user || null);
  const currentRuntimeUser = computed(() => session.value?.runtimeUser || null);
  const currentChannel = computed(() => session.value?.channel || null);
  const availableChannels = computed(() => session.value?.availableChannels || []);
  const desktopMenus = computed<DesktopMenus>(() => {
    if (isAdmin.value) {
      return ADMIN_DESKTOP_MENUS;
    }

    return (
      currentRuntimeUser.value?.permissions?.desktopMenus || createEmptyDesktopMenus()
    );
  });

  async function loadSession(force = false) {
    if (loading.value && !force) {
      return session.value;
    }

    loading.value = true;
    try {
      session.value = await window.api.sessionGet();
      return session.value;
    } finally {
      loading.value = false;
      initialized.value = true;
    }
  }

  async function login(account: string, password: string) {
    loading.value = true;
    try {
      session.value = await window.api.sessionLogin(account, password);
      initialized.value = true;
      return session.value;
    } finally {
      loading.value = false;
    }
  }

  async function switchChannel(channelId: string) {
    loading.value = true;
    try {
      session.value = await window.api.sessionSwitchChannel(channelId);
      return session.value;
    } finally {
      loading.value = false;
    }
  }

  async function logout() {
    try {
      await window.api.sessionLogout();
    } finally {
      session.value = null;
      initialized.value = true;
    }
  }

  return {
    session,
    loading,
    initialized,
    isAuthenticated,
    isAdmin,
    currentUser,
    currentRuntimeUser,
    currentChannel,
    availableChannels,
    desktopMenus,
    loadSession,
    login,
    switchChannel,
    logout,
  };
});
