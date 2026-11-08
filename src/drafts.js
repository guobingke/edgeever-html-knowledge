export function createDrafts(storage, report) {
  const memory = new Map();
  const queues = new Map();
  const key = id => `html-draft:v1:${id}`;
  function enqueue(id, action) {
    const next = (queues.get(id) ?? Promise.resolve()).then(action).catch(error => {
      report(`本地草稿存储失败，请先导出 HTML，避免关闭后丢失：${error.message}`);
    });
    queues.set(id, next);
    return next;
  }
  return {
    async read(id) {
      await queues.get(id);
      if (memory.has(id)) return memory.get(id);
      try {
        const value = await storage.get(key(id));
        const draft = value && typeof value.source === 'string' && typeof value.baseHash === 'string' ? value : null;
        if (!memory.has(id)) memory.set(id, draft);
        return memory.get(id);
      } catch (error) {
        report(`无法读取本地草稿：${error.message}`);
        return null;
      }
    },
    write(id, value) {
      memory.set(id, { ...value });
      return enqueue(id, () => storage.set(key(id), value));
    },
    clear(id, expected) {
      const current = memory.get(id);
      if (expected && (current?.source !== expected.source || current?.baseHash !== expected.baseHash)) return Promise.resolve();
      memory.set(id, null);
      return enqueue(id, () => storage.remove(key(id)));
    },
  };
}
