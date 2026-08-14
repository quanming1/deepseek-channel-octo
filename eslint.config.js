import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * ESLint flat config（ESLint 9+）。
 * - 基础：@eslint/js 推荐规则
 * - TS：typescript-eslint 推荐规则（类型感知关闭，A1 阶段保持轻量）
 */
export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 代码注释写「为什么」；空 catch 必须说明吞掉了什么
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
