import { describe, it, expect } from 'vitest';
import { previewDocument, createPreview } from '../src/preview.js';

describe('隔离预览', () => {
  it('策略位于任何用户代码之前，保留脚本和中文', () => {
    const source = '<!doctype html><html><head><title>中文</title></head><body><script>window.x=1</script></body></html>';
    const result = previewDocument(source, false);
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('<script>'));
    expect(result).toContain("connect-src 'none'");
    expect(result).toContain("script-src 'unsafe-inline' 'unsafe-eval' data: blob:");
    expect(result).toContain('<script>window.x=1</script>');
    expect(result).toContain('<title>中文</title>');
  });
  it('联网仅在明确开启后允许 HTTPS 资源', () => {
    expect(previewDocument('<p>x</p>', true)).toContain('connect-src https:');
    expect(previewDocument('<p>x</p>', true)).not.toContain('http: ');
  });
  it('不允许宿主同源、表单提交、弹窗、顶层跳转或嵌套iframe', () => {
    const fake = { createElement: () => ({ setAttribute(name, value) { this[name] = value; } }) };
    const frame = createPreview('<p>x</p>', { document: fake });
    expect(frame.sandbox).toBe('allow-scripts');
    expect(frame.referrerPolicy).toBe('no-referrer');
    expect(frame.srcdoc).toContain("frame-src 'none'");
    expect(frame.srcdoc).toContain("base-uri 'none'");
    expect(frame.srcdoc).toContain("form-action 'none'");
  });
});
