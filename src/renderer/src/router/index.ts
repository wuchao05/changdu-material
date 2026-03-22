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
    path: "/material-clip",
    name: "MaterialClip",
    component: () => import("../views/MaterialClip.vue"),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// 路由守卫
router.beforeEach((to, _from, next) => {
  const isLoggedIn = localStorage.getItem("auth-token");
  const userText = localStorage.getItem("auth-user");
  let isAdmin = false;

  if (userText) {
    try {
      const user = JSON.parse(userText) as { isAdmin?: boolean };
      isAdmin = user.isAdmin === true;
    } catch {
      isAdmin = false;
    }
  }

  if (to.meta.requiresAuth && !isLoggedIn) {
    next("/login");
  } else if (to.meta.requiresAdmin && !isAdmin) {
    next("/home");
  } else if (to.path === "/login" && isLoggedIn) {
    next("/home"); // 让 Home 页面根据权限重定向
  } else {
    next();
  }
});

export default router;
