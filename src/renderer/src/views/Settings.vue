<script setup lang="ts">
import { ref, onMounted, h } from "vue";
import {
  NCard,
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
import { useAuthStore } from "../stores/auth";

const message = useMessage();
const dialog = useDialog();
const darenStore = useDarenStore();
const authStore = useAuthStore();

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
  enableJuliangBuild: false, // 默认不启用巨量搭建
  enableUploadBuild: false, // 默认不启用上传搭建
  enableMaterialClip: false,
  changduConfigType: "sanrou", // 默认使用散柔配置
  customChangduConfig: undefined, // 定制配置
});

// 加载数据
onMounted(async () => {
  await darenStore.loadFromServer(true);
});

// 打开达人编辑弹窗
function openDarenModal(daren?: DarenInfo) {
  if (daren) {
    editingDaren.value = daren;
    darenForm.value = {
      ...daren,
      enableJuliangBuild: daren.enableJuliangBuild ?? false,
      enableMaterialClip: daren.enableMaterialClip ?? false,
      changduConfigType: daren.changduConfigType || "sanrou", // 确保有默认值
      customChangduConfig: daren.customChangduConfig || {
        cookie: "",
        distributorId: "",
        changduAppId: "",
        changduAdUserId: "",
        changduRootAdUserId: "",
      },
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
      enableJuliangBuild: false,
      enableUploadBuild: false,
      enableMaterialClip: false,
      changduConfigType: "sanrou", // 默认使用散柔配置
      customChangduConfig: {
        cookie: "",
        distributorId: "",
        changduAppId: "",
        changduAdUserId: "",
        changduRootAdUserId: "",
      },
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
        editingDaren.value
          ? "更新成功并同步到服务器"
          : "添加成功并同步到服务器",
      );
    } else {
      console.warn("[Settings] 配置推送失败:", pushResult.error);
      message.warning(
        editingDaren.value
          ? "更新成功，但同步到服务器失败"
          : "添加成功，但同步到服务器失败",
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
        custom: "定制",
      };
      const type = row.changduConfigType || "sanrou";
      const tagType =
        type === "sanrou" ? "info" : type === "meiri" ? "success" : "warning";
      return h(
        NTag,
        { type: tagType, size: "small" },
        { default: () => typeMap[type] },
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
      if (row.enableJuliangBuild)
        tags.push({ type: "success", text: "巨量搭建" });
      if (row.enableUploadBuild) tags.push({ type: "success", text: "搭建" });
      if (row.enableMaterialClip) tags.push({ type: "success", text: "剪辑" });

      if (tags.length === 0)
        return h(
          NTag,
          { type: "default", size: "small" },
          { default: () => "无" },
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
                { default: () => tag.text },
              ),
            ),
        },
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
              { default: () => "编辑" },
            ),
            h(
              NButton,
              {
                size: "small",
                type: "error",
                onClick: () => confirmDeleteDaren(row),
              },
              { default: () => "删除" },
            ),
          ],
        },
      );
    },
  },
];
</script>

<template>
  <div class="settings-page">
    <h2 class="page-title">达人配置</h2>

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
              <NRadio value="custom">定制配置</NRadio>
            </NSpace>
          </NRadioGroup>
        </NFormItem>

        <!-- 定制配置表单 -->
        <template v-if="darenForm.changduConfigType === 'custom'">
          <div
            style="
              border: 1px solid #e0e0e0;
              border-radius: 4px;
              padding: 16px;
              margin-bottom: 16px;
              background: #fafafa;
            "
          >
            <h4 style="margin-bottom: 12px; color: #666">定制常读配置</h4>
            <NFormItem label="Cookie" required>
              <NInput
                v-model:value="darenForm.customChangduConfig!.cookie"
                type="textarea"
                :rows="3"
                placeholder="常读平台 Cookie"
              />
            </NFormItem>
            <NFormItem label="Distributor ID" required>
              <NInput
                v-model:value="darenForm.customChangduConfig!.distributorId"
                placeholder="分销商 ID"
              />
            </NFormItem>
            <NFormItem label="App ID" required>
              <NInput
                v-model:value="darenForm.customChangduConfig!.changduAppId"
                placeholder="常读应用 ID"
              />
            </NFormItem>
            <NFormItem label="Ad User ID" required>
              <NInput
                v-model:value="darenForm.customChangduConfig!.changduAdUserId"
                placeholder="广告用户 ID"
              />
            </NFormItem>
            <NFormItem label="Root Ad User ID" required>
              <NInput
                v-model:value="
                  darenForm.customChangduConfig!.changduRootAdUserId
                "
                placeholder="根广告用户 ID"
              />
            </NFormItem>
          </div>
        </template>

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
        <NFormItem label="启用巨量搭建">
          <NSwitch v-model:value="darenForm.enableJuliangBuild" />
        </NFormItem>
        <NFormItem label="启用上传搭建">
          <NSwitch v-model:value="darenForm.enableUploadBuild" />
        </NFormItem>
        <NFormItem label="启用素材剪辑">
          <NSwitch v-model:value="darenForm.enableMaterialClip" />
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
