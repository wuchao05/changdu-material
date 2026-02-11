<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useDarenStore } from "../stores/daren";
import { NSpin } from "naive-ui";

const router = useRouter();
const authStore = useAuthStore();
const darenStore = useDarenStore();

onMounted(async () => {
  // 等待权限信息加载
  if (!darenStore.currentDaren && !authStore.isAdmin) {
    await darenStore.loadFromServer(true);
  }

  // 根据权限重定向到正确的页面
  if (authStore.isAdmin || darenStore.canUpload) {
    router.replace("/upload");
  } else if (darenStore.canDownload) {
    router.replace("/download");
  } else if (darenStore.canJuliang) {
    router.replace("/juliang");
  } else {
    // 没有任何权限，跳转到登录页
    router.replace("/login");
  }
});
</script>

<template>
  <div class="home-loading">
    <NSpin size="large" />
    <p>正在加载...</p>
  </div>
</template>

<style scoped>
.home-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: #666;
}
</style>
