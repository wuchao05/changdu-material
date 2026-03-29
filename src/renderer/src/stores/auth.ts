import { computed } from "vue";
import { defineStore } from "pinia";
import { storeToRefs } from "pinia";
import { useSessionStore } from "./session";

export interface UserInfo {
  id: string;
  label: string;
  isAdmin: boolean;
}

export const useAuthStore = defineStore("auth", () => {
  const sessionStore = useSessionStore();
  const { isAuthenticated, isAdmin, currentUser } = storeToRefs(sessionStore);

  const token = computed<string | null>(() =>
    isAuthenticated.value ? "session-authenticated" : null,
  );

  const normalizedCurrentUser = computed<UserInfo | null>(() => {
    if (!currentUser.value) {
      return null;
    }

    return {
      id: currentUser.value.id,
      label: currentUser.value.nickname || currentUser.value.account || currentUser.value.id,
      isAdmin: isAdmin.value,
    };
  });

  async function logout() {
    await sessionStore.logout();
  }

  async function loadFromStorage() {
    await sessionStore.loadSession();
  }

  return {
    token,
    currentUser: normalizedCurrentUser,
    isLoggedIn: isAuthenticated,
    isAdmin,
    logout,
    loadFromStorage,
  };
});
