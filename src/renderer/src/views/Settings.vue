<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from "vue";
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NModal,
  NSpace,
  NSwitch,
  NTag,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { useSessionStore } from "../stores/session";

interface EditableDesktopMenus {
  download: boolean;
  materialClip: boolean;
  upload: boolean;
  juliangUpload: boolean;
  uploadBuild: boolean;
  juliangBuild: boolean;
}

interface EditableChannelConfig {
  channelId: string;
  channelName: string;
  menus: EditableDesktopMenus;
}

interface SettingsUserProfile {
  id: string;
  nickname: string;
  account: string;
  userType: "admin" | "normal";
  channelIds: string[];
  defaultChannelId: string;
  channelNames?: string[];
  defaultChannelName?: string;
  channelConfigs?: Record<
    string,
    {
      permissions?: {
        syncAccount?: boolean;
        desktopMenus?: Partial<EditableDesktopMenus>;
      };
    }
  >;
}

const message = useMessage();
const sessionStore = useSessionStore();

const loading = ref(false);
const saving = ref(false);
const users = ref<SettingsUserProfile[]>([]);
const showEditor = ref(false);
const editingUser = ref<SettingsUserProfile | null>(null);
const editableChannels = reactive<EditableChannelConfig[]>([]);

const channelNameMap = computed(() => {
  return new Map(
    sessionStore.availableChannels.map((item) => [item.id, item.name]),
  );
});

const columns: DataTableColumns<SettingsUserProfile> = [
  {
    title: "昵称",
    key: "nickname",
    width: 140,
  },
  {
    title: "账号",
    key: "account",
    width: 180,
  },
  {
    title: "类型",
    key: "userType",
    width: 110,
    render: (row) =>
      h(
        NTag,
        { type: row.userType === "admin" ? "warning" : "success", size: "small" },
        { default: () => (row.userType === "admin" ? "管理员" : "普通用户") },
      ),
  },
  {
    title: "渠道",
    key: "channelNames",
    render: (row) => row.channelNames?.join("、") || "-",
  },
  {
    title: "默认渠道",
    key: "defaultChannelName",
    width: 140,
    render: (row) => row.defaultChannelName || "-",
  },
  {
    title: "操作",
    key: "actions",
    width: 120,
    render: (row) =>
      h(
        NButton,
        {
          size: "small",
          onClick: () => openEditor(row),
        },
        { default: () => "配置菜单" },
      ),
  },
];

function createEmptyMenus(): EditableDesktopMenus {
  return {
    download: false,
    materialClip: false,
    upload: false,
    juliangUpload: false,
    uploadBuild: false,
    juliangBuild: false,
  };
}

function openEditor(user: SettingsUserProfile) {
  editingUser.value = JSON.parse(JSON.stringify(user)) as SettingsUserProfile;
  editableChannels.splice(0, editableChannels.length);

  for (const channelId of user.channelIds || []) {
    const channelConfig = user.channelConfigs?.[channelId];
    const menus = channelConfig?.permissions?.desktopMenus || {};
    editableChannels.push({
      channelId,
      channelName: channelNameMap.value.get(channelId) || channelId,
      menus: {
        ...createEmptyMenus(),
        ...menus,
      },
    });
  }

  showEditor.value = true;
}

async function loadUsers() {
  loading.value = true;
  try {
    const result = (await window.api.adminListUsers()) as SettingsUserProfile[];
    users.value = Array.isArray(result) ? result : [];
  } catch (error) {
    console.error("[Settings] 加载用户列表失败:", error);
    message.error(error instanceof Error ? error.message : "加载用户列表失败");
  } finally {
    loading.value = false;
  }
}

async function saveMenus() {
  if (!editingUser.value) {
    return;
  }

  saving.value = true;
  try {
    const nextChannelConfigs = {
      ...(editingUser.value.channelConfigs || {}),
    };

    for (const item of editableChannels) {
      nextChannelConfigs[item.channelId] = {
        ...(nextChannelConfigs[item.channelId] || {}),
        permissions: {
          ...(nextChannelConfigs[item.channelId]?.permissions || {}),
          desktopMenus: {
            ...item.menus,
          },
        },
      };
    }

    await window.api.adminUpdateUser(editingUser.value.id, {
      channelConfigs: nextChannelConfigs,
    });

    message.success("菜单权限已更新");
    showEditor.value = false;
    await loadUsers();
  } catch (error) {
    console.error("[Settings] 保存菜单权限失败:", error);
    message.error(error instanceof Error ? error.message : "保存菜单权限失败");
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadUsers();
});
</script>

<template>
  <div class="settings-page">
    <NCard :bordered="false" class="settings-card">
      <template #header>
        <div class="settings-header">
          <div>
            <p class="settings-header__eyebrow">管理员菜单配置</p>
            <h2 class="settings-header__title">按用户、按渠道控制客户端入口</h2>
          </div>
          <NButton :loading="loading" @click="loadUsers">刷新列表</NButton>
        </div>
      </template>

      <NDataTable
        v-if="users.length"
        :columns="columns"
        :data="users"
        :loading="loading"
        :bordered="false"
        :single-line="false"
      />
      <NEmpty v-else description="暂无用户数据" />
    </NCard>

    <NModal v-model:show="showEditor" preset="card" title="配置客户端菜单权限" class="settings-modal">
      <div v-if="editingUser" class="menu-editor">
        <div class="menu-editor__meta">
          <span>{{ editingUser.nickname }}（{{ editingUser.account }}）</span>
          <NTag size="small" :type="editingUser.userType === 'admin' ? 'warning' : 'success'">
            {{ editingUser.userType === "admin" ? "管理员" : "普通用户" }}
          </NTag>
        </div>

        <div v-if="editableChannels.length" class="menu-editor__channels">
          <div v-for="item in editableChannels" :key="item.channelId" class="menu-editor__channel">
            <div class="menu-editor__channel-header">
              <h3>{{ item.channelName }}</h3>
              <span class="menu-editor__channel-id">{{ item.channelId }}</span>
            </div>

            <div class="menu-editor__grid">
              <label class="menu-editor__switch">
                <span>剧目下载</span>
                <NSwitch v-model:value="item.menus.download" />
              </label>
              <label class="menu-editor__switch">
                <span>素材剪辑</span>
                <NSwitch v-model:value="item.menus.materialClip" />
              </label>
              <label class="menu-editor__switch">
                <span>形天上传</span>
                <NSwitch v-model:value="item.menus.upload" />
              </label>
              <label class="menu-editor__switch">
                <span>巨量上传</span>
                <NSwitch v-model:value="item.menus.juliangUpload" />
              </label>
              <label class="menu-editor__switch">
                <span>上传搭建</span>
                <NSwitch v-model:value="item.menus.uploadBuild" />
              </label>
              <label class="menu-editor__switch">
                <span>巨量搭建</span>
                <NSwitch v-model:value="item.menus.juliangBuild" />
              </label>
            </div>
          </div>
        </div>

        <NEmpty v-else description="该用户当前没有绑定渠道" />

        <NSpace justify="end">
          <NButton @click="showEditor = false">取消</NButton>
          <NButton type="primary" :loading="saving" @click="saveMenus">保存</NButton>
        </NSpace>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.settings-page {
  padding: 24px;
}

.settings-card {
  border-radius: 24px;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.settings-header__eyebrow {
  margin: 0 0 6px;
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.settings-header__title {
  margin: 0;
  font-size: 24px;
  color: #0f172a;
}

.settings-modal {
  width: min(920px, calc(100vw - 32px));
}

.menu-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.menu-editor__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #334155;
}

.menu-editor__channels {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.menu-editor__channel {
  padding: 16px;
  border-radius: 18px;
  background: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.menu-editor__channel-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.menu-editor__channel-header h3 {
  margin: 0;
  color: #0f172a;
}

.menu-editor__channel-id {
  color: #64748b;
  font-size: 12px;
}

.menu-editor__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.menu-editor__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid rgba(148, 163, 184, 0.16);
  color: #334155;
}
</style>
