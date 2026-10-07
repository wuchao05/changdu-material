/* eslint-env node */
require('@rushstack/eslint-patch/modern-module-resolution')

module.exports = {
  root: true,
  extends: [
    'eslint:recommended',
    'plugin:vue/vue3-recommended',
    '@electron-toolkit',
    '@vue/eslint-config-typescript/recommended',
    // 仓库存在混合代码风格，只关闭与 Prettier 冲突的规则，不强制格式化，避免 --fix 重排整个文件
    '@vue/eslint-config-prettier/skip-formatting'
  ],
  rules: {
    'vue/require-default-prop': 'off',
    'vue/multi-word-component-names': 'off',
    // 允许 while (true) 这类显式循环
    'no-constant-condition': ['error', { checkLoops: false }],
    // 允许 best-effort 清理时的空 catch
    'no-empty': ['error', { allowEmptyCatch: true }],
    // 允许带说明的 @ts-ignore（electron-vite 模板 preload 中的用法）
    '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }],
    // 以下为存量问题，先降级为 warn 让 lint 可用，后续逐步清理后再改回 error
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
    ],
    'no-useless-escape': 'warn'
  },
  overrides: [
    {
      // Vite 模板生成的类型声明文件
      files: ['*.d.ts'],
      rules: {
        '@typescript-eslint/triple-slash-reference': 'off',
        '@typescript-eslint/ban-types': 'off'
      }
    }
  ]
}
