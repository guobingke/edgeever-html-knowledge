export function downloadHtml(source, filename) {
  const blob = source instanceof Blob ? source : new Blob([source], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = (filename || 'document.html').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  document.body.append(link);
  link.click();
  link.remove();
  // Keep the URL alive long enough for Chromium/WebKit to start a download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
