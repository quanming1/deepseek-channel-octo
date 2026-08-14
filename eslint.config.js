import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * ESLint flat config（ESLint 9+）。
 * - 基础：@eslint/js 推荐规则
 * - TS：typescript-eslint 推荐规则（类型感知关闭，A1 阶段保持轻量）
 */
export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'demo/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // bin 启动器是 Node 脚本（process/console 全局），单独声明 globals
    files: ['bin/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    rules: {
      // 代码注释写「为什么」；空 catch 必须说明吞掉了什么
      'no-empty': ['error', { allowEmptyCatch: true }],
      // TS-STYLE-GUIDE：const 优先，禁止可被替代的重赋值 let（ESLint 核心规则）
      'prefer-const': 'error',
      // TS-STYLE-GUIDE：避免 else，提前 return
      'no-else-return': 'error',
      // TS-STYLE-GUIDE：禁止星号导入（import * as X）——别名导入靠 AGENTS.md 约束
      '@typescript-eslint/no-namespace': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportNamespaceSpecifier',
          message: '禁止星号导入（import * as X），使用具名导入',
        },
      ],
    },
  },
  {
    // 豁免：server 插件的 dsh-llm-deepseek 只有 named exports，cordis 插件
    // 传递必须整模块引用（ctx.plugin(LlmDeepSeek, ...)），官方 server 同款写法
    files: ['src/adapters/dsh/server/main.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportNamespaceSpecifier[source.value="@deepseek-ai/dsh-llm-deepseek"]',
          message: '允许 dsh-llm-deepseek 的整模块导入（cordis 插件传递惯例）',
        },
      ],
    },
  },
)
