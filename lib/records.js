import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BookError, freeze, revision } from './book.js';

// Session v4 cannot append an ignorable external event. Keep book governance
// outside its closed event vocabulary; native descriptors remain readable.
export function recordStore(directory) {
  const filename = id => {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new BookError('INVALID_INSTANCE', 'Invalid book instance id');
    return join(directory, `${id}.json`);
  };
  return {
    write(record) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const file = filename(record.instanceId);
      const temporary = `${file}.tmp`;
      const { integrity: _previous, ...snapshot } = record;
      const data = ['continuable', 'root'].includes(record.mode) ? { ...snapshot, integrity: revision(snapshot) } : record;
      try { writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, file); }
      finally { rmSync(temporary, { force: true }); }
    },
    read(id) {
      try {
        const record = JSON.parse(readFileSync(filename(id), 'utf8'));
        if (record.version !== 1 || record.instanceId !== id || !record.compiled) throw new BookError('INVALID_INSTANCE', 'Invalid persisted book record');
        if (['continuable', 'root'].includes(record.mode)) {
          const { integrity, ...data } = record;
          if (typeof integrity !== 'string' || revision(data) !== integrity) throw new BookError('INVALID_INSTANCE', 'Book snapshot integrity check failed');
        }
        return freeze(record);
      } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    },
    roots() {
      let files;
      try { files = readdirSync(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      return files.filter(file => /^[a-zA-Z0-9_-]+\.json$/.test(file)).flatMap(file => {
        // Bad sidecars never become catalog declarations. Direct restoration
        // still uses read(), which reports the original corruption explicitly.
        try { const record = this.read(file.slice(0, -5)); return record?.mode === 'root' ? [record] : []; }
        catch { return []; }
      });
    },
    remove(id) { rmSync(filename(id), { force: true }); },
  };
}
