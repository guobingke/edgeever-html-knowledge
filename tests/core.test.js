import { describe, expect, it, vi } from 'vitest';
import {
  MAX_HTML_BYTES,
  validateHtmlFile,
  decodeHtml,
  makeEmbed,
  loadDocument,
  saveDocument,
  importHtml,
} from '../src/core.js';

const source = '<!doctype html><html><body>中文</body></html>';

function resource(overrides = {}) {
  return {
    id: 'html-1',
    noteId: 'note-1',
    filename: 'article.html',
    mimeType: 'text/html',
    kind: 'attachment',
    contentHash: 'hash-1',
    byteSize: new Blob([source]).size,
    ...overrides,
  };
}

function context() {
  return {
    editor: {
      getDocument: vi.fn().mockResolvedValue({ noteId: 'note-1', contentMarkdown: 'existing', hasUnsavedChanges: false }),
      insertEmbed: vi.fn().mockResolvedValue({ id: 'embed-1' }),
    },
    notes: {
      get: vi.fn().mockResolvedValue({ id: 'note-1', kind: 'text' }),
      update: vi.fn(),
      editMarkdown: vi.fn(),
    },
    resources: {
      list: vi.fn().mockResolvedValue([resource()]),
      read: vi.fn().mockResolvedValue(new Blob([source], { type: 'text/html' })),
      upload: vi.fn()
        .mockResolvedValueOnce(resource({ id: 'original-1', filename: 'original-article.html' }))
        .mockResolvedValueOnce(resource()),
      update: vi.fn().mockResolvedValue(resource({ contentHash: 'hash-2' })),
      delete: vi.fn(),
    },
  };
}

describe('validateHtmlFile', () => {
  it('uses a bounded 10 MiB source-file limit', () => {
    expect(MAX_HTML_BYTES).toBe(10 * 1024 * 1024);
  });

  it.each(['article.html', 'article.htm', 'ARTICLE.HTML', 'ARTICLE.HTM'])(
    'accepts a nonempty %s file',
    (name) => expect(() => validateHtmlFile(new File([source], name))).not.toThrow(),
  );

  it.each(['article.js', 'article.html.exe', 'article', ''])('rejects %s', (name) => {
    expect(() => validateHtmlFile(new File([source], name))).toThrow();
  });

  it('rejects MIME-only HTML whose extension is not HTML', () => {
    expect(() => validateHtmlFile(new File([source], 'article.txt', { type: 'text/html' }))).toThrow();
  });

  it('rejects an empty file', () => {
    expect(() => validateHtmlFile(new File([], 'empty.html'))).toThrow();
  });

  it('accepts the exact size limit and rejects one byte more', () => {
    expect(() => validateHtmlFile(new File([new Uint8Array(MAX_HTML_BYTES)], 'limit.html'))).not.toThrow();
    expect(() => validateHtmlFile(new File([new Uint8Array(MAX_HTML_BYTES + 1)], 'large.html'))).toThrow();
  });
});

describe('decodeHtml', () => {
  it('preserves UTF-8 source without rewriting markup', async () => {
    expect(await decodeHtml(new Blob([source]))).toBe(source);
  });

  it('removes a UTF-8 BOM', async () => {
    expect(await decodeHtml(new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), source]))).toBe(source);
  });

  it.each(['gbk', 'gb2312'])('reads legacy Chinese meta charset=%s', async (charset) => {
    const prefix = `<meta charset="${charset}"><p>`;
    const blob = new Blob([prefix, new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]), '</p>']);
    expect(await decodeHtml(blob)).toBe(`${prefix}中文</p>`);
  });

  it('understands an http-equiv charset declaration', async () => {
    const prefix = '<meta http-equiv="Content-Type" content="text/html; charset=gb2312"><p>';
    expect(await decodeHtml(new Blob([prefix, new Uint8Array([0xd6, 0xd0]), '</p>'])))
      .toBe(`${prefix}中</p>`);
  });

  it.each([
    ['LE', [0xff, 0xfe, 0x3c, 0x00, 0x70, 0x00, 0x3e, 0x00, 0x2d, 0x4e]],
    ['BE', [0xfe, 0xff, 0x00, 0x3c, 0x00, 0x70, 0x00, 0x3e, 0x4e, 0x2d]],
  ])('reads UTF-16 %s BOM', async (_endian, bytes) => {
    expect(await decodeHtml(new Blob([new Uint8Array(bytes)]))).toBe('<p>中');
  });

  it('rejects invalid UTF-8 rather than silently replacing bytes', async () => {
    await expect(decodeHtml(new Blob([new Uint8Array([0xc3, 0x28])]))).rejects.toThrow();
  });

  it('rejects unknown declared encodings', async () => {
    await expect(decodeHtml(new Blob(['<meta charset="not-a-real-charset"><p>hello</p>'])))
      .rejects.toThrow();
  });
});

describe('makeEmbed', () => {
  it('stores only resource references and metadata, not HTML source', () => {
    const original = resource({ id: 'original-1' });
    expect(makeEmbed(resource(), original)).toEqual({
      type: 'html-document',
      resourceId: 'html-1',
      title: 'article.html',
      data: { version: 1, noteId: 'note-1', originalResourceId: 'original-1' },
    });
  });
});

describe('loadDocument', () => {
  it('reads a resource between matching metadata snapshots', async () => {
    const ctx = context();
    const result = await loadDocument(ctx, 'note-1', 'html-1');
    expect(result).toEqual({ resource: resource(), source });
    expect(ctx.resources.read).toHaveBeenCalledWith('html-1');
    expect(ctx.resources.list).toHaveBeenCalledWith('note-1');
    expect(ctx.resources.list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not return stale content if the metadata changed during reading', async () => {
    const ctx = context();
    const newer = resource({ contentHash: 'hash-new' });
    ctx.resources.list.mockReset()
      .mockResolvedValueOnce([resource()])
      .mockResolvedValue([newer]);
    ctx.resources.read.mockReset()
      .mockResolvedValueOnce(new Blob(['old']))
      .mockResolvedValue(new Blob(['new']));
    try {
      const result = await loadDocument(ctx, 'note-1', 'html-1');
      expect(result.resource.contentHash).toBe('hash-new');
      expect(result.source).toBe('new');
    } catch (error) {
      // Rejecting the unstable read instead of retrying is also concurrency-safe.
      expect(error).toBeInstanceOf(Error);
    }
  });

  it.each([
    ['missing', []],
    ['another note', [resource({ noteId: 'note-other' })]],
    ['non-HTML', [resource({ filename: 'payload.js', mimeType: 'text/javascript' })]],
    ['missing hash', [resource({ contentHash: null })]],
  ])('rejects %s before trusting a snapshot', async (_name, resources) => {
    const ctx = context();
    ctx.resources.list.mockResolvedValue(resources);
    await expect(loadDocument(ctx, 'note-1', 'html-1')).rejects.toThrow();
  });

  it('propagates resource read failures', async () => {
    const ctx = context();
    ctx.resources.read.mockRejectedValue(new Error('read failed'));
    await expect(loadDocument(ctx, 'note-1', 'html-1')).rejects.toThrow('read failed');
  });

  it('rejects resources above the source-file limit', async () => {
    const ctx = context();
    ctx.resources.list.mockResolvedValue([resource({ byteSize: MAX_HTML_BYTES + 1 })]);
    await expect(loadDocument(ctx, 'note-1', 'html-1')).rejects.toThrow();
  });
});

describe('saveDocument', () => {
  it('saves UTF-8 HTML with the exact loaded concurrency token', async () => {
    const ctx = context();
    const snapshot = { resource: resource(), source };
    const next = '<!doctype html><p>保存中文</p>';
    await saveDocument(ctx, snapshot, next);
    expect(ctx.resources.update).toHaveBeenCalledTimes(1);
    const [id, input] = ctx.resources.update.mock.calls[0];
    expect(id).toBe('html-1');
    expect(input.expectedContentHash).toBe('hash-1');
    expect(input.file.name).toBe('article.html');
    expect(input.file.type).toMatch(/^text\/html/);
    expect(await input.file.text()).toBe(next);
    expect(snapshot).toEqual({ resource: resource(), source });
  });

  it('refuses saves without a concurrency token', async () => {
    const ctx = context();
    await expect(saveDocument(ctx, { resource: resource({ contentHash: null }), source }, source))
      .rejects.toThrow();
    expect(ctx.resources.update).not.toHaveBeenCalled();
  });

  it('rejects source above the byte-size limit before writing', async () => {
    const ctx = context();
    await expect(saveDocument(ctx, { resource: resource(), source }, '中'.repeat(MAX_HTML_BYTES / 3 + 1)))
      .rejects.toThrow();
    expect(ctx.resources.update).not.toHaveBeenCalled();
  });

  it('preserves conflicts instead of silently retrying with the latest hash', async () => {
    const ctx = context();
    const conflict = Object.assign(new Error('resource conflict'), { code: 'RESOURCE_CONFLICT' });
    ctx.resources.update.mockRejectedValue(conflict);
    await expect(saveDocument(ctx, { resource: resource(), source }, '<p>changed</p>')).rejects.toBe(conflict);
    expect(ctx.resources.update).toHaveBeenCalledTimes(1);
  });
});

describe('importHtml', () => {
  it('uploads an original and editable attachment and inserts a native embed', async () => {
    const ctx = context();
    const file = new File([source], 'article.html', { type: 'text/html' });
    const expected = makeEmbed(resource(), resource({ id: 'original-1' }));
    const result = await importHtml(ctx, 'note-1', file);
    expect(result).toEqual(expected);
    expect(ctx.resources.upload).toHaveBeenCalledTimes(2);
    const [[originalNote, originalFile], [editableNote, editableFile]] = ctx.resources.upload.mock.calls;
    expect(originalNote).toBe('note-1');
    expect(editableNote).toBe('note-1');
    expect(originalFile.name).toBe('original-article.html');
    expect(await originalFile.text()).toBe(source);
    expect(editableFile.name).toBe('article.html');
    expect(await editableFile.text()).toBe(source);
    expect(ctx.editor.insertEmbed).toHaveBeenCalledWith(expected);
    expect(ctx.notes.update).not.toHaveBeenCalled();
    expect(ctx.notes.editMarkdown).not.toHaveBeenCalled();
    expect(ctx.resources.delete).not.toHaveBeenCalled();
  });

  it('rejects invalid files without uploading', async () => {
    const ctx = context();
    await expect(importHtml(ctx, 'note-1', new File(['bad'], 'bad.exe'))).rejects.toThrow();
    expect(ctx.resources.upload).not.toHaveBeenCalled();
  });

  it.each([null, { noteId: 'note-other' }])('requires the target note to be the active editor', async (doc) => {
    const ctx = context();
    ctx.editor.getDocument.mockResolvedValue(doc);
    await expect(importHtml(ctx, 'note-1', new File([source], 'article.html'))).rejects.toThrow();
    expect(ctx.resources.upload).not.toHaveBeenCalled();
    expect(ctx.editor.insertEmbed).not.toHaveBeenCalled();
  });

  it('rejects structured notes without modifying them', async () => {
    const ctx = context();
    ctx.notes.get.mockResolvedValue({ id: 'note-1', kind: 'table' });
    await expect(importHtml(ctx, 'note-1', new File([source], 'article.html'))).rejects.toThrow();
    expect(ctx.resources.upload).not.toHaveBeenCalled();
  });

  it('rechecks the active note before insertion and leaves uploads recoverable', async () => {
    const ctx = context();
    ctx.editor.getDocument.mockResolvedValueOnce({ noteId: 'note-1' })
      .mockResolvedValue({ noteId: 'note-other' });
    await expect(importHtml(ctx, 'note-1', new File([source], 'article.html')))
      .rejects.toThrow(/html-1|original-1/);
    expect(ctx.editor.insertEmbed).not.toHaveBeenCalled();
    expect(ctx.resources.delete).not.toHaveBeenCalled();
  });

  it('reports already-uploaded resource ids if the second upload fails', async () => {
    const ctx = context();
    ctx.resources.upload.mockReset()
      .mockResolvedValueOnce(resource({ id: 'recover-original' }))
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(importHtml(ctx, 'note-1', new File([source], 'article.html')))
      .rejects.toThrow(/recover-original/);
    expect(ctx.editor.insertEmbed).not.toHaveBeenCalled();
    expect(ctx.resources.delete).not.toHaveBeenCalled();
  });

  it('reports both resource ids if embed insertion fails', async () => {
    const ctx = context();
    ctx.editor.insertEmbed.mockRejectedValue(new Error('editor closed'));
    let failure;
    try {
      await importHtml(ctx, 'note-1', new File([source], 'article.html'));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('original-1');
    expect(failure.message).toContain('html-1');
    expect(ctx.resources.delete).not.toHaveBeenCalled();
  });
});
