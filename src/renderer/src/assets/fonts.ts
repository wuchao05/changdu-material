/*
 * 全局内置字体：
 * - Maple Mono：拉丁字符与常用符号
 * - Maple Mono CN：中文字符分包版本
 * 组合后可在大多数场景下实现接近 Maple Mono NF CN 的显示效果。
 *
 * 注意：不要在 CSS 文件里用 @import 引入这些包。
 * Windows 下 PostCSS 可能把 @fontsource 误解析为项目内相对路径。
 * 通过 TS 入口导入可以交给 Vite 的模块解析处理。
 */

import '@fontsource/maple-mono/400.css'
import '@fontsource/maple-mono/500.css'
import '@fontsource/maple-mono/600.css'
import '@fontsource/maple-mono/700.css'

import '@chinese-fonts/maple-mono-cn/dist/MapleMono-CN-Regular/result.css'
import '@chinese-fonts/maple-mono-cn/dist/MapleMono-CN-Medium/result.css'
import '@chinese-fonts/maple-mono-cn/dist/MapleMono-CN-SemiBold/result.css'
import '@chinese-fonts/maple-mono-cn/dist/MapleMono-CN-Bold/result.css'
