import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['node_modules', 'dist', 'out', 'build', 'resources', 'docs', 'dramas_processor']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // 主进程、preload、渲染层与脚本共用一份配置，同时开放 Node 与浏览器全局变量
      globals: { ...globals.browser, ...globals.node }
    }
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] }
    }
  },
  {
    rules: {
      'vue/require-default-prop': 'off',
      'vue/multi-word-component-names': 'off',
      // 允许 while (true) 这类显式循环
      'no-constant-condition': ['error', { checkLoops: false }],
      // 允许 best-effort 清理时的空 catch
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 允许带说明的 @ts-ignore（electron-vite 模板 preload 中的用法）
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ]
    }
  },
  {
    // TS 自身会检查未定义标识符，no-undef 无法识别 d.ts 中的全局类型（typescript-eslint 官方建议关闭）
    files: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.vue'],
    rules: { 'no-undef': 'off' }
  },
  {
    // CommonJS 脚本
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    // Vite 模板生成的类型声明文件
    files: ['**/*.d.ts'],
    rules: { '@typescript-eslint/triple-slash-reference': 'off' }
  },
  // 仓库存在混合代码风格，只关闭与 Prettier 冲突的规则，不强制格式化，避免 --fix 重排整个文件
  skipFormatting
)
