/**
 * wrangler.jsonc 的 Text 规则把 HTML 模板作为字符串模块打进 Worker bundle：
 * `import templateHtml from './index.html'`。
 * 这里补上声明，让 tsc 知道它导出的是 string。
 */
declare module '*.html' {
  const content: string;
  export default content;
}
