/**
 * deepseek-channel-octo 包入口。
 *
 * A1 阶段：仅提供冒烟导出，验证工具链全链路（构建 / 类型检查 / 测试 / lint）。
 * A2 阶段：重写为 Cordis 插件（name + inject + apply）。
 */

/** 包名常量——被冒烟测试断言，保证入口可被 ESM 正确解析。 */
export const PKG_NAME = 'deepseek-channel-octo'
