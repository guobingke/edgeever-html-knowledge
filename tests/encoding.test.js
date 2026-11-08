import { describe, expect, it } from 'vitest';
import { decodeHtml, utf8Html } from '../src/core.js';

describe('real HTML encoding declarations', () => {
  it.each([
    ['<meta charset="gbk">', '<meta charset="utf-8">'],
    ["<meta charset='gb2312'>", "<meta charset='utf-8'>"],
    ['<meta charset=gb18030>', '<meta charset=utf-8>'],
    ['<META CHARSET = "UTF-16LE" />', '<META CHARSET = "utf-8" />'],
    ['<meta http-equiv="Content-Type" content="text/html; charset=gb2312">',
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">'],
    ["<meta content='text/html; charset=gbk' http-equiv='content-type'>",
      "<meta content='text/html; charset=utf-8' http-equiv='content-type'>"],
  ])('normalizes %s without rewriting surrounding HTML', (input, expected) => {
    expect(utf8Html(`<head>${input}</head><body>中文</body>`))
      .toBe(`<head>${expected}</head><body>中文</body>`);
  });

  it.each(['script', 'style', 'textarea', 'title'])('preserves fake meta inside %s', (tag) => {
    const input = `<${tag}>const fake = '<meta charset="gbk">';</${tag}><meta charset="gb2312">`;
    expect(utf8Html(input))
      .toBe(`<${tag}>const fake = '<meta charset="gbk">';</${tag}><meta charset="utf-8">`);
  });

  it('preserves comments containing a fake meta declaration', () => {
    expect(utf8Html('<!-- <meta charset="gbk"> -->\n<meta charset="gb2312">'))
      .toBe('<!-- <meta charset="gbk"> -->\n<meta charset="utf-8">');
  });

  it.each([
    '<meta data-charset="gbk">',
    '<meta name="description" content="a charset=gbk example">',
    '<meta data-note="charset=gbk">',
  ])('does not mistake unrelated attributes for an encoding: %s', (input) => {
    expect(utf8Html(input)).toBe(input);
  });

  it('preserves literal markup when no encoding declaration exists', () => {
    const input = '<!DOCTYPE HTML>\n<HTML><body data-charset="gbk"><p>中文 &amp; café</p></body></HTML>';
    expect(utf8Html(input)).toBe(input);
  });
});

describe('encoding detection does not scan fake HTML', () => {
  it.each([
    '<!-- <meta charset="gbk"> -->',
    '<script>const example = \'<meta charset="gbk">\';</script>',
    '<style>/* <meta charset="gbk"> */</style>',
    '<textarea><meta charset="gbk"></textarea>',
    '<title><meta charset="gbk"></title>',
  ])('ignores fake charset in %s', async (prefix) => {
    const input = `${prefix}<p>中文 UTF-8</p>`;
    expect(await decodeHtml(new Blob([input]))).toBe(input);
  });

  it.each([
    '<meta data-charset="gbk">',
    '<meta name="description" content="a charset=gbk example">',
    '<meta data-note="charset=gbk">',
  ])('ignores charset text in unrelated meta attributes: %s', async (prefix) => {
    const input = `${prefix}<p>中文 UTF-8</p>`;
    expect(await decodeHtml(new Blob([input]))).toBe(input);
  });

  it('lets a UTF-8 BOM override an obsolete gbk declaration', async () => {
    const input = '<meta charset="gbk"><p>中文 UTF-8</p>';
    expect(await decodeHtml(new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), input]))).toBe(input);
  });

  it('finds the real legacy charset after comments and script examples', async () => {
    const prefix = '<!-- <meta charset="utf-8"> --><script>const x = \'<meta charset="utf-8">\';</script><meta charset="gbk"><p>';
    const blob = new Blob([prefix, new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]), '</p>']);
    expect(await decodeHtml(blob)).toBe(`${prefix}中文</p>`);
  });
});
