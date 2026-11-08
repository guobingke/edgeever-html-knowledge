export const MAX_HTML_BYTES = 10 * 1024 * 1024;

export function validateHtmlFile(file) {
  if (!file || !/\.html?$/i.test(file.name)) throw new Error('请选择 .html 或 .htm 文件。');
  if (!file.size) throw new Error('HTML 文件为空。');
  if (file.size > MAX_HTML_BYTES) throw new Error('单个 HTML 文件不能超过 10 MiB。');
}

// Skip comments and raw-text elements: strings such as "<meta charset=gbk>" in JS
// must not be mistaken for a real encoding declaration or rewritten on save.
const HTML_TOKEN = /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\1\s*>|$)|<\/?[a-z][a-z0-9:-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>|<![^>]*>/gi;

function mapMeta(source, transform) {
  return source.replace(HTML_TOKEN, token => /^<meta\b/i.test(token) ? transform(token) : token);
}

function metaEncoding(token) {
  const pattern = /\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gy;
  pattern.lastIndex = 5; // '<meta'
  const attributes = new Map();
  let match;
  while ((match = pattern.exec(token))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    const assignment = /=\s*["']?/.exec(match[0]);
    const start = match.index + (assignment ? assignment.index + assignment[0].length : match[0].length);
    if (!attributes.has(name)) attributes.set(name, { value, start });
  }
  const direct = attributes.get('charset');
  if (direct?.value) return { encoding: direct.value, start: direct.start, end: direct.start + direct.value.length };
  const content = attributes.get('content');
  if (attributes.get('http-equiv')?.value.trim().toLowerCase() !== 'content-type' || !content) return null;
  const charset = /(?:^|;)\s*charset\s*=\s*["']?([a-zA-Z0-9._-]+)/i.exec(content.value);
  if (!charset) return null;
  const start = content.start + charset.index + charset[0].length - charset[1].length;
  return { encoding: charset[1], start, end: start + charset[1].length };
}

export function utf8Html(source) {
  return mapMeta(source, token => {
    const declaration = metaEncoding(token);
    return declaration ? `${token.slice(0, declaration.start)}utf-8${token.slice(declaration.end)}` : token;
  });
}

export async function decodeHtml(blob) {
  if (!blob.size || blob.size > MAX_HTML_BYTES) throw new Error('HTML 文件为空或超过 10 MiB。');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  else if (!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
    let declared = null;
    mapMeta(new TextDecoder('windows-1252').decode(bytes.slice(0, 4096)), token => {
      declared ??= metaEncoding(token)?.encoding.toLowerCase();
      return token;
    });
    encoding = /^(gbk|gb2312|gb18030)$/i.test(declared ?? '') ? 'gb18030' : (declared || encoding);
  }
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error(`无法按 ${encoding} 解码 HTML，请先将文件转换成 UTF-8。`, { cause });
  }
}

export function makeEmbed(resource, originalResource) {
  return {
    type: 'html-document', resourceId: resource.id, title: resource.filename,
    data: { version: 1, noteId: resource.noteId, originalResourceId: originalResource.id },
  };
}

function requireResource(resources, noteId, resourceId) {
  const resource = resources.find(item => item.id === resourceId && item.noteId === noteId);
  if (!resource || !/\.html?$/i.test(resource.filename ?? '')) throw new Error('找不到当前笔记的 HTML 附件。');
  if (!resource.contentHash?.trim()) throw new Error('附件缺少内容哈希，请先完成同步并重新载入，不能安全覆盖。');
  if (resource.byteSize > MAX_HTML_BYTES) throw new Error('HTML 附件超过 10 MiB。');
  return resource;
}

export async function loadDocument(context, noteId, resourceId) {
  const note = await context.notes.get(noteId);
  const canonicalId = note.id || noteId;
  const before = requireResource(await context.resources.list(canonicalId), canonicalId, resourceId);
  const blob = await context.resources.read(resourceId);
  const source = await decodeHtml(blob);
  const after = requireResource(await context.resources.list(canonicalId), canonicalId, resourceId);
  if (before.contentHash !== after.contentHash) throw new Error('读取期间附件发生变化，请重新载入。');
  return { resource: after, source };
}

export async function saveDocument(context, snapshot, source) {
  const current = snapshot.resource;
  if (!current.contentHash?.trim()) throw new Error('缺少内容哈希，不能安全保存，请完成同步并重新载入。');
  const normalized = utf8Html(source);
  const file = new File([normalized], current.filename, { type: 'text/html;charset=utf-8' });
  validateHtmlFile(file);
  const resource = await context.resources.update(current.id, { file, expectedContentHash: current.contentHash });
  return { resource, source: normalized };
}

async function requireEditor(context, noteId) {
  const doc = await context.editor.getDocument();
  if (!doc || doc.noteId !== noteId) throw new Error('请先打开并编辑目标普通笔记，导入时不要切换笔记。');
}

function requireSyncedUpload(resource, noteId) {
  if (resource.noteId !== noteId || resource.id.startsWith('local_resource_') || !resource.contentHash?.trim()) {
    throw new Error('HTML 附件尚未完成同步，暂不插入预览块。请先联网并完成笔记同步，再重新导入。');
  }
}

export async function importHtml(context, noteId, file) {
  validateHtmlFile(file);
  const source = await decodeHtml(file);
  await requireEditor(context, noteId);
  const note = await context.notes.get(noteId);
  if (note.kind !== 'text') throw new Error('只能向普通文本笔记插入 HTML。');
  if (note.id && note.id !== noteId) throw new Error('笔记同步后的 ID 已变化，请重新打开该笔记，再导入 HTML。');
  let uploaded = [];
  try {
    const original = await context.resources.upload(noteId, new File([file], `original-${file.name}`, { type: 'text/html' }));
    uploaded = [...uploaded, original.id];
    requireSyncedUpload(original, noteId);
    const editable = new File([utf8Html(source)], file.name, { type: 'text/html;charset=utf-8' });
    validateHtmlFile(editable);
    const resource = await context.resources.upload(noteId, editable);
    uploaded = [...uploaded, resource.id];
    requireSyncedUpload(resource, noteId);
    await requireEditor(context, noteId);
    const embed = makeEmbed(resource, original);
    await context.editor.insertEmbed(embed);
    return embed;
  } catch (cause) {
    const retained = uploaded.length ? `\n已上传附件仍保留在目标笔记，可从附件恢复：${uploaded.join('、')}` : '';
    throw new Error(`${cause.message}${retained}`, { cause });
  }
}

export function errorMessage(error) {
  if (error?.code === 'RESOURCE_CONFLICT') return '附件已被其他窗口或设备修改。草稿已保留，请先导出草稿，再重新载入，避免覆盖他人的修改。';
  return `${error instanceof Error ? error.message : String(error)}\n若附件尚未同步或当前离线，请先联网同步；也可导出当前 HTML。`;
}
