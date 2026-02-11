<script setup lang="ts">
import { ref, onMounted, h, watch } from "vue";
import {
  NCard,
  NTabs,
  NTabPane,
  NForm,
  NFormItem,
  NInput,
  NButton,
  NSpace,
  NDataTable,
  NSwitch,
  NModal,
  NTag,
  NRadioGroup,
  NRadio,
  useMessage,
  useDialog,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { useDarenStore, type DarenInfo } from "../stores/daren";
import { useApiConfigStore } from "../stores/apiConfig";
import { useAuthStore } from "../stores/auth";

const message = useMessage();
const dialog = useDialog();
const darenStore = useDarenStore();
const apiConfigStore = useApiConfigStore();
const authStore = useAuthStore();

// 当前标签页
const activeTab = ref("daren");

// 达人表单
const showDarenModal = ref(false);
const editingDaren = ref<DarenInfo | null>(null);
const darenForm = ref<DarenInfo>({
  id: "",
  label: "",
  password: "",
  feishuDramaStatusTableId: "",
  enableUpload: true,
  enableDownload: true,
  enableJuliang: false, // 默认不启用巨量上传
  changduConfigType: "sanrou", // 默认使用散柔配置
});

// API 配置表单（包含默认值）
const defaultApiConfig = {
  // 散柔-常读配置（默认配置）
  sanrouChangdu: {
    changduAppId: "40012555",
    distributorId: "1842236883646506",
    changduAdUserId: "380892546610362",
    changduRootAdUserId: "380892546610362",
    cookie: "",
  },
  // 每日-常读配置
  meiriChangdu: {
    changduAppId: "",
    distributorId: "",
    changduAdUserId: "",
    changduRootAdUserId: "",
    cookie: "",
  },
  // 飞书配置
  feishuAppId: "cli_a870f7611b7b1013",
  feishuAppSecret: "NTwHbZG8rpOQyMEnXGPV6cNQ84KEqE8z",
  feishuAppToken: "WdWvbGUXXaokk8sAS94c00IZnsf",
  // TOS 存储配置
  tosBucket: "ylc-material-beijing",
  tosRegion: "cn-beijing",
};

const apiForm = ref({
  // 散柔-常读配置
  sanrouChangdu: {
    cookie: "",
    distributorId: defaultApiConfig.sanrouChangdu.distributorId,
    changduAppId: defaultApiConfig.sanrouChangdu.changduAppId,
    changduAdUserId: defaultApiConfig.sanrouChangdu.changduAdUserId,
    changduRootAdUserId: defaultApiConfig.sanrouChangdu.changduRootAdUserId,
  },
  // 每日-常读配置
  meiriChangdu: {
    cookie: "",
    distributorId: defaultApiConfig.meiriChangdu.distributorId,
    changduAppId: defaultApiConfig.meiriChangdu.changduAppId,
    changduAdUserId: defaultApiConfig.meiriChangdu.changduAdUserId,
    changduRootAdUserId: defaultApiConfig.meiriChangdu.changduRootAdUserId,
  },
  // 飞书配置
  feishuAppId: defaultApiConfig.feishuAppId,
  feishuAppSecret: defaultApiConfig.feishuAppSecret,
  feishuAppToken: defaultApiConfig.feishuAppToken,
  feishuDramaStatusTableId: "",
  // TOS 存储配置（AccessKeyId/Secret 通过 API 动态获取，无需配置）
  tosAccessKeyId: "",
  tosAccessKeySecret: "",
  tosBucket: defaultApiConfig.tosBucket,
  tosRegion: defaultApiConfig.tosRegion,
  // 素材库配置
  xtToken: "",
});

// 加载数据
onMounted(async () => {
  await darenStore.loadFromServer(true);
  await apiConfigStore.loadConfig();
  // 合并配置，后端空值时使用默认值
  const loadedConfig = apiConfigStore.config;
  apiForm.value = {
    ...apiForm.value,
    ...loadedConfig,
    // 散柔配置：如果后端值为空，使用默认值
    sanrouChangdu: {
      cookie: loadedConfig.sanrouChangdu?.cookie || "",
      changduAppId:
        loadedConfig.sanrouChangdu?.changduAppId ||
        defaultApiConfig.sanrouChangdu.changduAppId,
      distributorId:
        loadedConfig.sanrouChangdu?.distributorId ||
        defaultApiConfig.sanrouChangdu.distributorId,
      changduAdUserId:
        loadedConfig.sanrouChangdu?.changduAdUserId ||
        defaultApiConfig.sanrouChangdu.changduAdUserId,
      changduRootAdUserId:
        loadedConfig.sanrouChangdu?.changduRootAdUserId ||
        defaultApiConfig.sanrouChangdu.changduRootAdUserId,
    },
    // 每日配置：如果后端值为空，使用默认值
    meiriChangdu: {
      cookie: loadedConfig.meiriChangdu?.cookie || "",
      changduAppId: loadedConfig.meiriChangdu?.changduAppId || "",
      distributorId: loadedConfig.meiriChangdu?.distributorId || "",
      changduAdUserId: loadedConfig.meiriChangdu?.changduAdUserId || "",
      changduRootAdUserId: loadedConfig.meiriChangdu?.changduRootAdUserId || "",
    },
    // 飞书配置
    feishuAppId: loadedConfig.feishuAppId || defaultApiConfig.feishuAppId,
    feishuAppSecret:
      loadedConfig.feishuAppSecret || defaultApiConfig.feishuAppSecret,
    feishuAppToken:
      loadedConfig.feishuAppToken || defaultApiConfig.feishuAppToken,
    // TOS配置
    tosBucket: loadedConfig.tosBucket || defaultApiConfig.tosBucket,
    tosRegion: loadedConfig.tosRegion || defaultApiConfig.tosRegion,
  };

  // 标记配置已加载完成，启用自动保存
  configLoaded.value = true;
});

// 打开达人编辑弹窗
function openDarenModal(daren?: DarenInfo) {
  if (daren) {
    editingDaren.value = daren;
    darenForm.value = {
      ...daren,
      changduConfigType: daren.changduConfigType || "sanrou", // 确保有默认值
    };
  } else {
    editingDaren.value = null;
    darenForm.value = {
      id: "",
      label: "",
      password: "",
      feishuDramaStatusTableId: "",
      enableUpload: true,
      enableDownload: true,
      enableJuliang: false,
      changduConfigType: "sanrou", // 默认使用散柔配置
    };
  }
  showDarenModal.value = true;
}

// 保存达人
async function saveDaren() {
  if (!darenForm.value.id || !darenForm.value.label) {
    message.warning("请填写必填项");
    return;
  }

  try {
    if (editingDaren.value) {
      await darenStore.updateDaren(editingDaren.value.id, darenForm.value);
    } else {
      await darenStore.addDaren(darenForm.value);
    }
    showDarenModal.value = false;

    // 推送到远程服务器
    console.log("[Settings] 达人配置变更，推送到远程服务器...");
    const pushResult = await window.api.pushRemoteConfig();
    if (pushResult.success) {
      console.log("[Settings] ✓ 配置推送成功");
      message.success(
        editingDaren.value ? "更新成功并同步到服务器" : "添加成功并同步到服务器"
      );
    } else {
      console.warn("[Settings] 配置推送失败:", pushResult.error);
      message.warning(
        editingDaren.value
          ? "更新成功，但同步到服务器失败"
          : "添加成功，但同步到服务器失败"
      );
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : "操作失败");
  }
}

// 删除达人
function confirmDeleteDaren(daren: DarenInfo) {
  dialog.warning({
    title: "确认删除",
    content: `确定要删除达人 "${daren.label}" 吗？`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        await darenStore.deleteDaren(daren.id);

        // 推送到远程服务器
        console.log("[Settings] 达人删除，推送到远程服务器...");
        const pushResult = await window.api.pushRemoteConfig();
        if (pushResult.success) {
          console.log("[Settings] ✓ 配置推送成功");
          message.success("删除成功并同步到服务器");
        } else {
          console.warn("[Settings] 配置推送失败:", pushResult.error);
          message.warning("删除成功，但同步到服务器失败");
        }
      } catch (error) {
        message.error("删除失败");
      }
    },
  });
}

// 保存 API 配置
async function saveApiConfig(showMessage = true) {
  try {
    await apiConfigStore.saveConfig(apiForm.value);

    // 推送到远程服务器
    console.log("[Settings] 推送配置到远程服务器...");
    const pushResult = await window.api.pushRemoteConfig();
    if (pushResult.success) {
      console.log("[Settings] ✓ 配置推送成功");
      if (showMessage) {
        message.success("配置已保存并同步到服务器");
      }
    } else {
      console.warn("[Settings] 配置推送失败:", pushResult.error);
      if (showMessage) {
        message.warning("配置已保存，但同步到服务器失败");
      }
    }
  } catch (error) {
    console.error("[Settings] 保存失败:", error);
    if (showMessage) {
      message.error("保存失败");
    }
  }
}

// 自动保存：防抖定时器
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const configLoaded = ref(false); // 标记配置是否已加载完成

// 监听 API 配置变化，自动保存
watch(
  apiForm,
  () => {
    // 配置加载完成后才启用自动保存
    if (!configLoaded.value) return;

    // 清除之前的定时器
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }

    // 延迟 1 秒后自动保存（防抖）
    autoSaveTimer = setTimeout(() => {
      console.log("[Settings] 配置变化，自动保存...");
      saveApiConfig(false); // 静默保存，不显示消息
    }, 1000);
  },
  { deep: true }
);

// 达人表格列
const darenColumns: DataTableColumns<DarenInfo> = [
  {
    title: "用户ID",
    key: "id",
    width: 180,
    ellipsis: { tooltip: true },
  },
  {
    title: "名称",
    key: "label",
    width: 120,
  },
  {
    title: "常读配置",
    key: "changduConfigType",
    width: 120,
    render: (row) => {
      const typeMap = {
        sanrou: "散柔",
        meiri: "每日",
      };
      const type = row.changduConfigType || "sanrou";
      return h(
        NTag,
        { type: type === "sanrou" ? "info" : "success", size: "small" },
        { default: () => typeMap[type] }
      );
    },
  },
  {
    title: "状态表 ID",
    key: "feishuDramaStatusTableId",
    width: 200,
    ellipsis: { tooltip: true },
    render: (row) => row.feishuDramaStatusTableId || "-",
  },
  {
    title: "功能",
    key: "features",
    width: 140,
    render: (row) => {
      const tags: Array<{ type: "success" | "default"; text: string }> = [];
      if (row.enableUpload) tags.push({ type: "success", text: "上传" });
      if (row.enableDownload) tags.push({ type: "success", text: "下载" });
      if (row.enableJuliang) tags.push({ type: "success", text: "巨量" });

      if (tags.length === 0)
        return h(
          NTag,
          { type: "default", size: "small" },
          { default: () => "无" }
        );

      return h(
        NSpace,
        { size: "small" },
        {
          default: () =>
            tags.map((tag) =>
              h(
                NTag,
                { type: tag.type, size: "small" },
                { default: () => tag.text }
              )
            ),
        }
      );
    },
  },
  {
    title: "操作",
    key: "actions",
    width: 150,
    render: (row) => {
      return h(
        NSpace,
        { size: "small" },
        {
          default: () => [
            h(
              NButton,
              {
                size: "small",
                onClick: () => openDarenModal(row),
              },
              { default: () => "编辑" }
            ),
            h(
              NButton,
              {
                size: "small",
                type: "error",
                onClick: () => confirmDeleteDaren(row),
              },
              { default: () => "删除" }
            ),
          ],
        }
      );
    },
  },
];
</script>

<template>
  <div class="settings-page">
    <h2 class="page-title">系统设置</h2>

    <NTabs v-model:value="activeTab" type="line">
      <!-- 达人配置 -->
      <NTabPane name="daren" tab="达人配置">
        <NCard>
          <template #header>
            <NSpace justify="space-between" align="center">
              <span>达人列表</span>
              <NButton
                v-if="authStore.isAdmin"
                type="primary"
                @click="openDarenModal()"
              >
                添加达人
              </NButton>
            </NSpace>
          </template>

          <NDataTable
            :columns="darenColumns"
            :data="darenStore.darenList"
            :bordered="false"
          />
        </NCard>
      </NTabPane>

      <!-- API 配置 -->
      <NTabPane v-if="authStore.isAdmin" name="api" tab="API 配置">
        <NCard title="飞书配置">
          <NForm :model="apiForm" label-placement="left" label-width="140px">
            <NFormItem label="App ID">
              <NInput
                v-model:value="apiForm.feishuAppId"
                placeholder="飞书应用 App ID"
              />
            </NFormItem>
            <NFormItem label="App Secret">
              <NInput
                v-model:value="apiForm.feishuAppSecret"
                type="password"
                show-password-on="click"
                placeholder="飞书应用 App Secret"
              />
            </NFormItem>
            <NFormItem label="App Token">
              <NInput
                v-model:value="apiForm.feishuAppToken"
                placeholder="飞书多维表格 App Token"
              />
            </NFormItem>
            <NFormItem label="状态表 ID">
              <NInput
                v-model:value="apiForm.feishuDramaStatusTableId"
                placeholder="飞书剧集状态表 ID（管理员用）"
              />
            </NFormItem>
          </NForm>
        </NCard>

        <NCard title="散柔-常读配置" style="margin-top: 16px">
          <NForm :model="apiForm" label-placement="left" label-width="140px">
            <NFormItem label="Cookie">
              <NInput
                v-model:value="apiForm.sanrouChangdu.cookie"
                type="textarea"
                :rows="3"
                placeholder="常读平台 Cookie"
              />
            </NFormItem>
            <NFormItem label="App ID">
              <NInput
                v-model:value="apiForm.sanrouChangdu.changduAppId"
                placeholder="常读应用 ID"
              />
            </NFormItem>
            <NFormItem label="Distributor ID">
              <NInput
                v-model:value="apiForm.sanrouChangdu.distributorId"
                placeholder="分销商 ID"
              />
            </NFormItem>
            <NFormItem label="Ad User ID">
              <NInput
                v-model:value="apiForm.sanrouChangdu.changduAdUserId"
                placeholder="广告用户 ID"
              />
            </NFormItem>
            <NFormItem label="Root Ad User ID">
              <NInput
                v-model:value="apiForm.sanrouChangdu.changduRootAdUserId"
                placeholder="根广告用户 ID"
              />
            </NFormItem>
          </NForm>
        </NCard>

        <NCard title="每日-常读配置" style="margin-top: 16px">
          <NForm :model="apiForm" label-placement="left" label-width="140px">
            <NFormItem label="Cookie">
              <NInput
                v-model:value="apiForm.meiriChangdu.cookie"
                type="textarea"
                :rows="3"
                placeholder="常读平台 Cookie"
              />
            </NFormItem>
            <NFormItem label="App ID">
              <NInput
                v-model:value="apiForm.meiriChangdu.changduAppId"
                placeholder="常读应用 ID"
              />
            </NFormItem>
            <NFormItem label="Distributor ID">
              <NInput
                v-model:value="apiForm.meiriChangdu.distributorId"
                placeholder="分销商 ID"
              />
            </NFormItem>
            <NFormItem label="Ad User ID">
              <NInput
                v-model:value="apiForm.meiriChangdu.changduAdUserId"
                placeholder="广告用户 ID"
              />
            </NFormItem>
            <NFormItem label="Root Ad User ID">
              <NInput
                v-model:value="apiForm.meiriChangdu.changduRootAdUserId"
                placeholder="根广告用户 ID"
              />
            </NFormItem>
          </NForm>
        </NCard>

        <NCard title="素材库配置" style="margin-top: 16px">
          <NForm :model="apiForm" label-placement="left" label-width="140px">
            <NFormItem label="XT Token">
              <NInput
                v-model:value="apiForm.xtToken"
                type="password"
                show-password-on="click"
                placeholder="素材库登录 Token (XT_SESSION_ID)"
              />
            </NFormItem>
          </NForm>
        </NCard>

        <NCard title="TOS 存储配置（可选）" style="margin-top: 16px">
          <NForm :model="apiForm" label-placement="left" label-width="140px">
            <NFormItem label="Access Key ID">
              <NInput
                v-model:value="apiForm.tosAccessKeyId"
                placeholder="TOS Access Key ID（通常不需要填写）"
              />
            </NFormItem>
            <NFormItem label="Access Key Secret">
              <NInput
                v-model:value="apiForm.tosAccessKeySecret"
                type="password"
                show-password-on="click"
                placeholder="TOS Access Key Secret（通常不需要填写）"
              />
            </NFormItem>
            <NFormItem label="Bucket">
              <NInput
                v-model:value="apiForm.tosBucket"
                placeholder="TOS Bucket 名称（通常不需要填写）"
              />
            </NFormItem>
            <NFormItem label="Region">
              <NInput
                v-model:value="apiForm.tosRegion"
                placeholder="TOS Region（通常不需要填写）"
              />
            </NFormItem>
          </NForm>
        </NCard>

        <div style="margin-top: 20px; text-align: right">
          <NButton type="primary" @click="saveApiConfig"> 保存配置 </NButton>
        </div>
      </NTabPane>
    </NTabs>

    <!-- 达人编辑弹窗 -->
    <NModal
      v-model:show="showDarenModal"
      preset="card"
      :title="editingDaren ? '编辑达人' : '添加达人'"
      style="width: 600px"
    >
      <NForm :model="darenForm" label-placement="left" label-width="120px">
        <NFormItem label="用户 ID" required>
          <NInput
            v-model:value="darenForm.id"
            placeholder="达人的用户 ID"
            :disabled="!!editingDaren"
          />
        </NFormItem>
        <NFormItem label="名称" required>
          <NInput v-model:value="darenForm.label" placeholder="达人名称" />
        </NFormItem>
        <NFormItem label="登录密码">
          <NInput
            v-model:value="darenForm.password"
            type="password"
            show-password-on="click"
            placeholder="达人登录密码（留空则无需密码）"
          />
        </NFormItem>
        <NFormItem label="常读配置" required>
          <NRadioGroup v-model:value="darenForm.changduConfigType">
            <NSpace>
              <NRadio value="sanrou">散柔-常读配置</NRadio>
              <NRadio value="meiri">每日-常读配置</NRadio>
            </NSpace>
          </NRadioGroup>
        </NFormItem>
        <NFormItem label="状态表 ID">
          <NInput
            v-model:value="darenForm.feishuDramaStatusTableId"
            placeholder="飞书剧集状态表 ID"
          />
        </NFormItem>

        <div
          style="border-top: 1px solid #eee; margin: 16px 0; padding-top: 16px"
        >
          <h4 style="margin-bottom: 12px; color: #666">功能权限</h4>
        </div>

        <NFormItem label="启用上传功能">
          <NSwitch v-model:value="darenForm.enableUpload" />
        </NFormItem>
        <NFormItem label="启用下载功能">
          <NSwitch v-model:value="darenForm.enableDownload" />
        </NFormItem>
        <NFormItem label="启用巨量上传">
          <NSwitch v-model:value="darenForm.enableJuliang" />
        </NFormItem>
      </NForm>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="showDarenModal = false">取消</NButton>
          <NButton type="primary" @click="saveDaren">保存</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 1200px;
  margin: 0 auto;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #333;
  margin-bottom: 20px;
}
</style>
