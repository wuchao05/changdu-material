import { createRouter, createWebHashHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/home",
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
    meta: { requiresAuth: true, menuKey: "upload" },
  },
  {
    path: "/download",
    name: "Download",
    component: () => import("../views/Download.vue"),
    meta: { requiresAuth: true, menuKey: "download" },
  },
  {
    path: "/settings",
    name: "Settings",
    component: () => import("../views/Settings.vue"),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: "/juliang",
    name: "Juliang",
    component: () => import("../views/JuliangUpload.vue"),
    meta: { requiresAuth: true, menuKey: "juliangUpload" },
  },
  {
    path: "/upload-build",
    name: "UploadBuild",
    component: () => import("../views/UploadBuild.vue"),
    meta: { requiresAuth: true, menuKey: "uploadBuild" },
  },
  {
    path: "/juliang-build",
    name: "JuliangBuild",
    component: () => import("../views/JuliangBuild.vue"),
    meta: { requiresAuth: true, menuKey: "juliangBuild" },
  },
  {
    path: "/material-clip",
    name: "MaterialClip",
    component: () => import("../views/MaterialClip.vue"),
    meta: { requiresAuth: true, menuKey: "materialClip" },
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

function resolveDefaultRoute(session: SessionRuntimeData | null): string {
  if (!session) {
    return "/login";
  }

  const menus = session.runtimeUser?.permissions?.desktopMenus;
  if (menus?.download) return "/download";
  if (menus?.materialClip) return "/material-clip";
  if (menus?.upload) return "/upload";
  if (menus?.juliangUpload) return "/juliang";
  if (menus?.uploadBuild) return "/upload-build";
  if (menus?.juliangBuild) return "/juliang-build";
  if (session.user.userType === "admin") return "/settings";
  return "/login";
}

router.beforeEach(async (to) => {
  const session = await window.api.sessionGet();
  const isLoggedIn = Boolean(session?.user?.id);
  const isAdmin = session?.user?.userType === "admin";
  const desktopMenus = session?.runtimeUser?.permissions?.desktopMenus;

  if (to.meta.requiresAuth && !isLoggedIn) {
    return "/login";
  }

  if (to.path === "/login" && isLoggedIn) {
    return resolveDefaultRoute(session);
  }

  if (to.meta.requiresAdmin && !isAdmin) {
    return resolveDefaultRoute(session || null);
  }

  if (!isLoggedIn) {
    return true;
  }

  const menuKey = typeof to.meta.menuKey === "string" ? to.meta.menuKey : "";
  if (menuKey && !desktopMenus?.[menuKey as keyof DesktopMenus]) {
    return resolveDefaultRoute(session || null);
  }

  return true;
});

export default router;
