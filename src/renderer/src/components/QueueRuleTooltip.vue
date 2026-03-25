<script setup lang="ts">
import { ref } from "vue";
import { HelpCircleOutline } from "@vicons/ionicons5";
import { NIcon, NModal, NTooltip } from "naive-ui";

type QueueRuleTone =
  | "default"
  | "muted"
  | "blue"
  | "red"
  | "yellow"
  | "green";

interface QueueRuleTextPart {
  text: string;
  tone?: QueueRuleTone;
}

interface QueueRuleItem {
  index: number | string;
  title: string;
  desc?: string;
  parts?: QueueRuleTextPart[];
}

const props = withDefaults(
  defineProps<{
    title: string;
    description: string;
    items: QueueRuleItem[];
    width?: string;
  }>(),
  {
    width: "min(460px, 86vw)",
  },
);

const showModal = ref(false);

function getTextToneClass(tone: QueueRuleTone = "default") {
  return `tone-${tone}`;
}
</script>

<template>
  <NTooltip placement="bottom-start" trigger="hover">
    <template #trigger>
      <span class="queue-rule-trigger" @click.stop="showModal = true">
        <NIcon size="16">
          <HelpCircleOutline />
        </NIcon>
      </span>
    </template>

    点击展示优先级规则弹窗
  </NTooltip>

  <NModal v-model:show="showModal" :mask-closable="true">
    <div class="queue-rule-modal-shell" :style="{ '--queue-rule-width': props.width }">
      <div class="queue-rule-panel">
        <div class="queue-rule-header">
          <div>
            <div class="queue-rule-title">{{ title }}</div>
            <div class="queue-rule-desc">{{ description }}</div>
          </div>
          <button class="queue-rule-close" type="button" @click="showModal = false">
            关闭
          </button>
        </div>

        <div class="queue-rule-list">
          <div
            v-for="item in items"
            :key="item.index"
            class="queue-rule-item"
          >
            <span class="queue-rule-index">{{ item.index }}</span>
            <div class="queue-rule-content">
              <div class="queue-rule-name">{{ item.title }}</div>
              <div class="queue-rule-text">
                <template v-if="item.parts?.length">
                  <span
                    v-for="(part, partIndex) in item.parts"
                    :key="`${item.index}-${partIndex}`"
                    class="queue-rule-inline"
                    :class="getTextToneClass(part.tone)"
                  >
                    {{ part.text }}
                  </span>
                </template>
                <template v-else>
                  {{ item.desc }}
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.queue-rule-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid #dbe4f0;
  color: #64748b;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
  transition:
    color 0.2s ease,
    border-color 0.2s ease,
    background-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.queue-rule-trigger:hover {
  color: #1d4ed8;
  border-color: #93c5fd;
  background: linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%);
  box-shadow: 0 8px 18px rgba(37, 99, 235, 0.16);
  transform: translateY(-1px);
}

.queue-rule-modal-shell {
  width: min(var(--queue-rule-width), calc(100vw - 32px));
}

.queue-rule-panel {
  max-height: min(80vh, 720px);
  padding: 20px;
  box-sizing: border-box;
  border-radius: 24px;
  border: 1px solid #dbeafe;
  background:
    radial-gradient(circle at top left, rgba(219, 234, 254, 0.75), transparent 42%),
    linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
  box-shadow: 0 22px 44px rgba(15, 23, 42, 0.16);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.queue-rule-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.queue-rule-close {
  flex-shrink: 0;
  height: 34px;
  padding: 0 14px;
  border: 1px solid #dbe4f0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #475569;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    color 0.2s ease,
    background-color 0.2s ease;
}

.queue-rule-close:hover {
  border-color: #93c5fd;
  color: #1d4ed8;
  background: #eff6ff;
}

.queue-rule-title {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
  color: #0f172a;
}

.queue-rule-desc {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: #475569;
}

.queue-rule-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
}

.queue-rule-panel::-webkit-scrollbar {
  width: 8px;
}

.queue-rule-panel::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.6);
}

.queue-rule-panel::-webkit-scrollbar-track {
  background: transparent;
}

.queue-rule-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  background: rgba(255, 255, 255, 0.92);
}

.queue-rule-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  flex-shrink: 0;
  background: #e0ecff;
  color: #2563eb;
  font-size: 13px;
  font-weight: 700;
}

.queue-rule-content {
  min-width: 0;
}

.queue-rule-name {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.5;
  color: #0f172a;
}

.queue-rule-text {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.75;
  color: #334155;
}

.queue-rule-inline {
  white-space: pre-wrap;
}

.tone-default {
  color: #334155;
}

.tone-muted {
  color: #64748b;
}

.tone-blue {
  color: #2563eb;
  font-weight: 600;
}

.tone-red {
  color: #dc2626;
  font-weight: 700;
}

.tone-yellow {
  color: #d97706;
  font-weight: 700;
}

.tone-green {
  color: #16a34a;
  font-weight: 700;
}
</style>
