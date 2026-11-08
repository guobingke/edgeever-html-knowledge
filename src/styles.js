export const styles = `
.html-tools{--ht-bg:var(--color-surface,#fff);--ht-fg:var(--color-text,#1e293b);--ht-border:var(--color-border,#dfe5e9);color:var(--ht-fg);background:var(--ht-bg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;min-height:0;height:100%;box-sizing:border-box;border-radius:10px;overflow:hidden}
.html-tools *{box-sizing:border-box}.html-tools [hidden]{display:none!important}
.html-tools .ht-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;flex-wrap:wrap;border-bottom:1px solid var(--ht-border)}
.html-tools .ht-title{font-weight:600;flex:1;min-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.html-tools button,.html-tools .ht-import{font:inherit;cursor:pointer;border:1px solid var(--ht-border);border-radius:7px;padding:6px 12px;background:var(--ht-bg);color:inherit}
.html-tools button:hover{background:#e9f4f0;color:#145a42}.html-tools button:focus-visible,.html-tools input:focus-visible{outline:2px solid #16815e;outline-offset:2px}
.html-tools button:disabled{opacity:.45;cursor:wait}.html-tools button.ht-primary{background:#147d5b;color:#fff;border-color:#147d5b}
.html-tools .ht-status{font-size:12px;color:#64748b}.html-tools .ht-error{margin:0;padding:10px 14px;background:#fff1e7;color:#8b3d12;white-space:pre-wrap;overflow-wrap:anywhere}
.html-tools .ht-body{display:flex;flex:1;min-height:280px;overflow:hidden}.html-tools .ht-source{flex:1;min-width:0;overflow:hidden}.html-tools .ht-preview{flex:1;min-width:0;background:#fff}
.html-tools-frame{border:0;display:block;width:100%;height:100%;min-height:280px;background:white;color-scheme:light}
.html-tools.ht-embed{height:auto;border:1px solid var(--ht-border)}.html-tools.ht-embed .ht-preview{height:440px;resize:vertical;overflow:auto;min-height:220px;max-height:85vh}
.html-tools .ht-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 12px;border-top:1px solid var(--ht-border);font-size:12px;color:#64748b}
.html-tools .ht-network{display:inline-flex;gap:6px;align-items:center;cursor:pointer}.html-tools .ht-footer small{margin-left:auto}
.html-tools .ht-empty{padding:40px 22px;max-width:640px;margin:auto;text-align:center}.html-tools .ht-empty h3{font-size:19px;margin:0 0 12px}.html-tools .ht-empty p{color:#64748b}
.html-tools .ht-drop{border:1px dashed #83ab9d;border-radius:12px;padding:30px 20px}.html-tools .ht-drop:focus-within,.html-tools .ht-drop[data-drag=true]{outline:2px solid #16815e}
.html-tools input[type=file]{max-width:100%;margin:12px 0}.html-tools .ht-confirm{padding:14px;background:#fff6e3;border-bottom:1px solid #e8cf98;color:#713f12}.html-tools .ht-confirm button{margin:8px 8px 0 0}
.html-tools .cm-editor{height:100%;min-height:300px;font-size:13px}.html-tools .cm-scroller{overflow:auto;font-family:Consolas,"SFMono-Regular",monospace}.html-tools .ht-source:not([hidden])+.ht-preview:not([hidden]){border-left:1px solid var(--ht-border)}
@media(max-width:640px){.html-tools .ht-bar{gap:5px}.html-tools button{padding:5px 8px}.html-tools .ht-body{flex-direction:column}.html-tools .ht-source:not([hidden])+.ht-preview:not([hidden]){border-left:0;border-top:1px solid var(--ht-border)}.html-tools .ht-footer small{margin-left:0}}
`;

export function rootElement(container, embedded = false) {
  const root = document.createElement('section');
  root.className = `html-tools${embedded ? ' ht-embed' : ''}`;
  const style = document.createElement('style');
  style.textContent = styles;
  root.append(style);
  container.append(root);
  return root;
}

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label, handler, primary = false) {
  const node = element('button', primary ? 'ht-primary' : '', label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}
