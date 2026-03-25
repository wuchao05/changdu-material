import { createRouter, createWebHashHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/home", // 临时重定向，会在 AppContent 中根据权限重新路由
  },
  {
    path: "/home",
    name: "Home",
    component: () => import("../views/Home.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/login",
    name: "Login",
    component: () => import("../views/Login.vue"),
    meta: { requiresAuth: false },
  },
  {
    path: "/upload",
    name: "Upload",
    component: () => import("../views/Upload.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/download",
    name: "Download",
    component: () => import("../views/Download.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/settings",
    name: "Settings",
    component: () => import("../views/Settings.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/juliang",
    name: "Juliang",
    component: () => import("../views/JuliangUpload.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/upload-build",
    name: "UploadBuild",
    component: () => import("../views/UploadBuild.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/juliang-build",
    name: "JuliangBuild",
    component: () => import("../views/JuliangBuild.vue"),
    meta: { requiresAuth: true, requiresJuliangBuild: true },
  },
  {
    path: "/material-clip",
    name: "MaterialClip",
    component: () => import("../views/MaterialClip.vue"),
    meta: { requiresAuth: true, requiresMaterialClip: true },
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// 路由守卫
router.beforeEach(async (to, _from, next) => {
  const isLoggedIn = localStorage.getItem("auth-token");
  const userText = localStorage.getItem("auth-user");
  const darenCacheText = localStorage.getItem("daren-list-cache");
  let isAdmin = false;
  let currentUserId = "";
  let canMaterialClip = false;
  let canJuliangBuild = false;

  if (userText) {
    try {
      const user = JSON.parse(userText) as { isAdmin?: boolean; id?: string };
      isAdmin = user.isAdmin === true;
      currentUserId = user.id || "";
    } catch {
      isAdmin = false;
      currentUserId = "";
    }
  }

  if (darenCacheText && currentUserId) {
    try {
      const cache = JSON.parse(darenCacheText) as {
        list?: Array<{ id: string; enableMaterialClip?: boolean }>;
      };
      const currentDaren = cache.list?.find(
        (item) => item.id === currentUserId,
      );
      canMaterialClip = currentDaren?.enableMaterialClip === true;
      canJuliangBuild = currentDaren?.enableJuliangBuild === true;
    } catch {
      canMaterialClip = false;
      canJuliangBuild = false;
    }
  }

  if (
    (to.meta.requiresMaterialClip || to.meta.requiresJuliangBuild) &&
    !isAdmin &&
    currentUserId
  ) {
    try {
      const latestConfig = await window.api.getDarenConfig();
      const currentDaren = latestConfig.darenList?.find(
        (item) => item.id === currentUserId,
      );
      canMaterialClip = currentDaren?.enableMaterialClip === true;
      canJuliangBuild = currentDaren?.enableJuliangBuild === true;
    } catch {}
  }

  if (to.meta.requiresAuth && !isLoggedIn) {
    next("/login");
  } else if (to.meta.requiresAdmin && !isAdmin) {
    next("/home");
  } else if (to.meta.requiresJuliangBuild && !(isAdmin || canJuliangBuild)) {
    next("/home");
  } else if (to.meta.requiresMaterialClip && !(isAdmin || canMaterialClip)) {
    next("/home");
  } else if (to.path === "/login" && isLoggedIn) {
    next("/home"); // 让 Home 页面根据权限重定向
  } else {
    next();
  }
});

export default router;
