import { describe, expect, it } from 'vitest'
import { PKG_NAME } from './index.js'

/** A1 冒烟测试：验证包入口可被 ESM 解析且导出正确。 */
describe('deepseek-channel-octo 包入口', () => {
  it('导出包名常量', () => {
    expect(PKG_NAME).toBe('deepseek-channel-octo')
  })
})
