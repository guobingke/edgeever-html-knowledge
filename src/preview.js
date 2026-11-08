/** This is origin isolation, not an OS-level sandbox or a zero-network guarantee. */
export function previewDocument(source, network = false) {
  const remote = network ? ' https:' : '';
  const policy = [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' data: blob:${remote}`,
    `style-src 'unsafe-inline' data: blob:${remote}`,
    `img-src data: blob:${remote}`,
    `font-src data: blob:${remote}`,
    `media-src data: blob:${remote}`,
    `connect-src ${network ? 'https:' : "'none'"}`,
    "frame-src 'none'", "object-src 'none'", "worker-src 'none'",
    "base-uri 'none'", "form-action 'none'",
  ].join('; ');
  // Prepend the policy before all imported markup; never serialize/overwrite the original.
  const body = source.replace(/^\uFEFF?\s*<!doctype[^>]*>/i, '');
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">${body}`;
}

export function createPreview(source, { network = false, document: doc = document } = {}) {
  const frame = doc.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
  frame.referrerPolicy = 'no-referrer';
  frame.title = 'HTML 页面预览';
  frame.className = 'html-tools-frame';
  frame.srcdoc = previewDocument(source, network);
  return frame;
}
