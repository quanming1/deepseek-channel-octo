import { defineConfig } from 'tsup'

/**
 * tsup 构建配置（esbuild 包装）。
 * - 产出 ESM 产物到 dist/，附带类型声明（dts）
 * - 插件最终作为 npm 包被 dsh 安装，入口为 src/index.ts
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  target: 'node22',
})
