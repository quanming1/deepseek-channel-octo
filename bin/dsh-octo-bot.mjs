#!/usr/bin/env node
/**
 * dsh-octo-bot CLI 启动器。
 * 保持薄：只 import 构建后的 CLI 模块并执行（重逻辑都在 src/）。
 */
import { buildProgram } from '../dist/cli.js'

buildProgram().parse(process.argv)
