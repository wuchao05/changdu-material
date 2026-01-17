<script setup lang="ts">
import { NMessageProvider, NDialogProvider, NConfigProvider } from 'naive-ui'
import AppContent from './AppContent.vue'
</script>

<template>
  <NConfigProvider>
    <NMessageProvider>
      <NDialogProvider>
        <AppContent />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
