import { defineConfig } from 'vitest/config'

/**
 * vitest 测试配置：Node 环境，默认匹配 src 下的 *.test.ts。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
