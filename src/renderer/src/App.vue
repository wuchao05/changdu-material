<script setup lang="ts">
import { NMessageProvider, NDialogProvider, NConfigProvider, NGlobalStyle } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'
import AppContent from './AppContent.vue'

const globalFontFamily =
  "'Maple Mono NF CN', 'Maple Mono', 'Maple Mono CN', 'SFMono-Regular', 'Cascadia Mono', 'JetBrains Mono', 'Fira Code', 'Consolas', 'Liberation Mono', 'PingFang SC', 'Microsoft YaHei UI', 'Noto Sans CJK SC', monospace"

const themeOverrides: GlobalThemeOverrides = {
  common: {
    fontFamily: globalFontFamily,
    fontFamilyMono: globalFontFamily
  }
}
</script>

<template>
  <NConfigProvider :theme-overrides="themeOverrides">
    <NGlobalStyle />
    <NMessageProvider>
      <NDialogProvider>
        <AppContent />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
