import { defineConfig } from 'tsup'

/**
 * tsup 构建配置（esbuild 包装）。
 * - 产出 ESM 产物到 dist/，附带类型声明（dts）
 * - 插件最终作为 npm 包被 dsh 安装，入口为 src/index.ts
 * - octo-sdk-server 独立入口：打包成单文件供 sdk-profile 拷贝进 SDK profile
 *   （external 保留 @deepseek-ai/*，运行时由 profile 的 dsh-base 树提供）
 */
export default defineConfig({
  // 对象式 entry：指定输出文件名（octo-sdk-server 平铺到 dist/ 根，sdk-profile 按此拷贝）
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'octo-sdk-server': 'src/adapters/dsh/server/main.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  target: 'node22',
  outExtension: () => ({ js: '.js', dts: '.d.ts' }),
  splitting: false,
  // server 插件的依赖由 profile 内的 dsh-base 树提供，不打进 bundle
  external: [/@deepseek-ai\//, 'node:path', 'node:crypto'],
})
