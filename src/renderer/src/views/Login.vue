<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NAlert,
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NRadio,
  NRadioGroup,
  type FormInst,
} from 'naive-ui';
import { useApiConfigStore } from '../stores/apiConfig';
import { useDarenStore } from '../stores/daren';
import { useSessionStore } from '../stores/session';

const router = useRouter();
const sessionStore = useSessionStore();
const apiConfigStore = useApiConfigStore();
const darenStore = useDarenStore();

const formRef = ref<FormInst | null>(null);
const loading = ref(false);
const bootstrapping = ref(true);
const errorMessage = ref('');
const showChannelSelector = ref(false);
const selectedChannelId = ref('');

const form = reactive({
  account: '',
  password: '',
});

const rules = {
  account: {
    required: true,
    message: '请输入账号',
    trigger: ['blur', 'input'],
  },
  password: {
    required: true,
    message: '请输入密码',
    trigger: ['blur', 'input'],
  },
};

function resolveDefaultRoute(session: SessionRuntimeData) {
  const menus = session.runtimeUser?.permissions?.desktopMenus;
  if (menus?.download) return '/download';
  if (menus?.materialClip) return '/material-clip';
  if (menus?.upload) return '/upload';
  if (menus?.juliangUpload) return '/juliang';
  if (menus?.uploadBuild) return '/upload-build';
  if (menus?.juliangBuild) return '/juliang-build';
  if (session.user.userType === 'admin') return '/settings';
  return '/login';
}

async function finishLogin(session: SessionRuntimeData) {
  apiConfigStore.applySessionData(session);
  await darenStore.loadFromServer(true);
  await router.push(resolveDefaultRoute(session));
}

async function bootstrapSession() {
  bootstrapping.value = true;
  try {
    const session = await sessionStore.loadSession();
    if (session) {
      apiConfigStore.applySessionData(session);
      await darenStore.loadFromServer(true);
      await router.replace(resolveDefaultRoute(session));
    }
  } catch (error) {
    console.error('[Login] 加载失败:', error);
    errorMessage.value = '初始化登录态失败，请稍后重试';
  } finally {
    bootstrapping.value = false;
  }
}

async function handleLogin() {
  errorMessage.value = '';

  try {
    await formRef.value?.validate();
  } catch {
    return;
  }

  const account = form.account.trim();
  const password = form.password.trim();
  if (!account) {
    errorMessage.value = '请输入账号';
    return;
  }

  loading.value = true;
  try {
    const session = await sessionStore.login(account, password);
    if (!session) {
      errorMessage.value = '登录失败，请稍后重试';
      return;
    }

    if (
      session.user.userType !== 'admin' &&
      Array.isArray(session.availableChannels) &&
      session.availableChannels.length > 1
    ) {
      selectedChannelId.value = session.channel?.id || session.availableChannels[0]?.id || '';
      showChannelSelector.value = true;
      apiConfigStore.applySessionData(session);
      return;
    }

    await finishLogin(session);
  } catch (error) {
    console.error('[Login] 登录失败:', error);
    errorMessage.value = error instanceof Error ? error.message : '登录失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

async function confirmChannelSelection() {
  if (!selectedChannelId.value) {
    errorMessage.value = '请选择要进入的渠道';
    return;
  }

  loading.value = true;
  try {
    const session = await sessionStore.switchChannel(selectedChannelId.value);
    showChannelSelector.value = false;
    await finishLogin(session);
  } catch (error) {
    console.error('[Login] 切换渠道失败:', error);
    errorMessage.value = error instanceof Error ? error.message : '切换渠道失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}

function cancelChannelSelection() {
  showChannelSelector.value = false;
  selectedChannelId.value = '';
  void sessionStore.logout();
  apiConfigStore.resetConfig();
  errorMessage.value = '已取消登录，请重新选择渠道';
}

onMounted(() => {
  void bootstrapSession();
});
</script>

<template>
  <div class="login-page">
    <div class="login-page__backdrop">
      <div class="login-page__orb login-page__orb--left"></div>
      <div class="login-page__orb login-page__orb--right"></div>
      <div class="login-page__orb login-page__orb--bottom"></div>
      <div class="login-page__mesh"></div>
      <div class="login-page__grid"></div>
    </div>

    <div class="login-layout">
      <section class="login-shell">
        <div class="login-shell__halo"></div>

        <NCard :bordered="false" class="login-card">
          <div class="login-brand">
            <div class="login-brand__badge">CHANGDU MATERIAL STUDIO</div>
            <div class="login-brand__mark">CM</div>
          </div>

          <div class="login-copy">
            <p class="login-copy__eyebrow">统一登录入口</p>
            <h1 class="login-copy__title">欢迎回来</h1>
            <p class="login-copy__desc">素材下载、剪辑、上传、搭建一站式全流程服务平台。</p>
          </div>

          <NForm
            ref="formRef"
            :model="form"
            :rules="rules"
            label-placement="top"
            class="login-form"
          >
            <NFormItem label="账号" path="account">
              <NInput v-model:value="form.account" placeholder="请输入账号或名称" size="large" />
            </NFormItem>

            <NFormItem label="密码" path="password">
              <NInput
                v-model:value="form.password"
                type="password"
                show-password-on="click"
                placeholder="请输入密码"
                size="large"
                @keyup.enter="handleLogin"
              />
            </NFormItem>
          </NForm>

          <NAlert v-if="errorMessage" type="error" :bordered="false" class="login-alert">
            {{ errorMessage }}
          </NAlert>

          <NButton
            type="primary"
            size="large"
            block
            :loading="loading || bootstrapping"
            :disabled="bootstrapping"
            class="login-submit"
            @click="handleLogin"
          >
            {{ bootstrapping ? '正在初始化...' : '登录' }}
          </NButton>

          <div class="login-footer">
            <span class="login-footer__line"></span>
            <p>常读素材管理统一登录入口</p>
            <span class="login-footer__line"></span>
          </div>
        </NCard>
      </section>
    </div>

    <NModal
      v-model:show="showChannelSelector"
      preset="card"
      title="选择进入渠道"
      :mask-closable="false"
      style="width: min(560px, calc(100vw - 32px))"
      class="channel-selector-modal"
    >
      <div class="channel-selector">
        <p class="channel-selector__desc">
          当前账号绑定了多个渠道，请先选择本次客户端要使用的渠道。
        </p>
        <NRadioGroup v-model:value="selectedChannelId" class="channel-selector__list">
          <NRadio
            v-for="channel in sessionStore.availableChannels"
            :key="channel.id"
            :value="channel.id"
            class="channel-selector__item"
          >
            {{ channel.name }}
          </NRadio>
        </NRadioGroup>
        <div class="channel-selector__actions">
          <NButton secondary @click="cancelChannelSelection">取消</NButton>
          <NButton type="primary" :loading="loading" @click="confirmChannelSelection">
            确认进入
          </NButton>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  padding: 32px 16px;
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.16), transparent 28%),
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.14), transparent 24%),
    linear-gradient(135deg, #f6f9ff 0%, #eef4ff 42%, #f8fbff 100%);
}

.login-page__backdrop {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.login-page__orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(18px);
  opacity: 0.9;
}

.login-page__orb--left {
  top: 8%;
  left: -4rem;
  width: 18rem;
  height: 18rem;
  background: radial-gradient(circle, rgba(37, 99, 235, 0.2), rgba(37, 99, 235, 0));
}

.login-page__orb--right {
  top: 14%;
  right: -2rem;
  width: 22rem;
  height: 22rem;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.18), rgba(14, 165, 233, 0));
}

.login-page__orb--bottom {
  right: 10%;
  bottom: -5rem;
  width: 20rem;
  height: 20rem;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.14), rgba(99, 102, 241, 0));
}

.login-page__mesh {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.75), transparent 18%),
    radial-gradient(circle at 82% 16%, rgba(255, 255, 255, 0.68), transparent 16%),
    radial-gradient(circle at 50% 82%, rgba(255, 255, 255, 0.72), transparent 14%);
}

.login-page__grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.07) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: linear-gradient(180deg, rgba(15, 23, 42, 0.26), transparent 82%);
}

.login-layout {
  position: relative;
  display: flex;
  min-height: calc(100vh - 64px);
  align-items: center;
  justify-content: center;
}

.login-shell {
  position: relative;
  width: 100%;
  max-width: 520px;
}

.login-shell__halo {
  position: absolute;
  inset: -2.25rem;
  border-radius: 2.5rem;
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.95), transparent 54%),
    radial-gradient(circle at bottom right, rgba(96, 165, 250, 0.18), transparent 38%);
  filter: blur(10px);
}

.login-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.92);
  border-radius: 2rem;
  padding: 1.9rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.82)),
    rgba(255, 255, 255, 0.86);
  box-shadow:
    0 40px 80px -48px rgba(15, 23, 42, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(18px);
}

.login-card::before {
  content: '';
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
  height: 0.4rem;
  background: linear-gradient(90deg, #2563eb, #0ea5e9, #38bdf8);
}

.login-brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.login-brand__badge {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  padding: 0.4rem 0.85rem;
  background: rgba(37, 99, 235, 0.08);
  color: #1d4ed8;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.22em;
}

.login-brand__mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.15rem;
  height: 3.15rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, #0f172a, #2563eb);
  color: white;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  box-shadow: 0 22px 36px -24px rgba(37, 99, 235, 0.9);
}

.login-copy {
  margin-top: 28px;
}

.login-copy__eyebrow {
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: rgba(2, 132, 199, 0.9);
}

.login-copy__title {
  margin-top: 12px;
  font-size: 2.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #020617;
}

.login-copy__desc {
  margin-top: 12px;
  font-size: 0.95rem;
  line-height: 1.85;
  color: #64748b;
}

.login-form {
  margin-top: 30px;
}

.login-alert {
  margin-bottom: 16px;
}

.login-submit {
  box-shadow: 0 22px 36px -24px rgba(37, 99, 235, 0.7);
}

.login-footer {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  margin-top: 1.3rem;
  color: #64748b;
  font-size: 0.76rem;
}

.login-footer__line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.45), transparent);
}

:deep(.login-card .n-card__content) {
  padding: 0;
}

:deep(.login-card .n-form-item-label) {
  font-weight: 600;
  color: #334155;
}

:deep(.login-card .n-input) {
  --n-border-hover: rgba(37, 99, 235, 0.42) !important;
}

@media (max-width: 640px) {
  .login-page {
    padding: 20px 12px;
  }

  .login-layout {
    min-height: calc(100vh - 40px);
  }

  .login-card {
    padding: 1.5rem;
    border-radius: 1.6rem;
  }

  .login-shell__halo {
    inset: -1rem;
  }

  .login-brand {
    align-items: flex-start;
  }

  .login-copy__title {
    font-size: 2.2rem;
  }
}

.channel-selector {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.channel-selector__desc {
  margin: 0;
  color: #475569;
  line-height: 1.6;
}

.channel-selector__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.channel-selector__item {
  padding: 10px 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.9);
}

.channel-selector__actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
