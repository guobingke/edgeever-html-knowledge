import { describe, it, expect, vi } from 'vitest';
import { createDrafts } from '../src/drafts.js';

describe('本地恢复草稿', () => {
  it('按资源串行写入，并使清理排在旧写入之后', async () => {
    const data = new Map();
    const storage = {
      get: vi.fn(async key => data.get(key) ?? null),
      set: vi.fn(async (key, value) => { data.set(key, value); }),
      remove: vi.fn(async key => { data.delete(key); }),
    };
    const drafts = createDrafts(storage, vi.fn());
    const a = drafts.write('r1', { source: 'a', baseHash: 'h' });
    const b = drafts.write('r1', { source: 'b', baseHash: 'h' });
    expect((await drafts.read('r1')).source).toBe('b');
    await Promise.all([a, b, drafts.clear('r1')]);
    expect(await drafts.read('r1')).toBeNull();
    expect(storage.set).toHaveBeenCalledTimes(2);
  });
  it('存储失败会通知，内存仍能恢复，后续队列不被拒绝中断', async () => {
    const report = vi.fn();
    const storage = { get: vi.fn(async () => null), set: vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(null), remove: vi.fn() };
    const drafts = createDrafts(storage, report);
    await drafts.write('r1', { source: 'a', baseHash: 'h' });
    expect(report).toHaveBeenCalled();
    expect((await drafts.read('r1')).source).toBe('a');
    await drafts.write('r1', { source: 'b', baseHash: 'h' });
    expect((await drafts.read('r1')).source).toBe('b');
  });
  it('读取有效的持久化草稿，忽略坏数据', async () => {
    const storage = { get: vi.fn().mockResolvedValueOnce({ source: 'a', baseHash: 'h' }).mockResolvedValueOnce({ source: 1 }) };
    const drafts = createDrafts(storage, vi.fn());
    expect((await drafts.read('a')).source).toBe('a');
    expect(await drafts.read('b')).toBeNull();
  });
  it('读取失败时报告错误但允许正常加载附件', async () => {
    const report = vi.fn();
    const drafts = createDrafts({ get: vi.fn().mockRejectedValue(new Error('disk')) }, report);
    expect(await drafts.read('r')).toBeNull();
    expect(report).toHaveBeenCalled();
  });
});
