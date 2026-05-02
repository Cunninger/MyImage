/* IndexedDB 存储层 — 所有图片和元数据都存在手机本地 */

const DB_NAME = 'gpt-image-store';
const DB_VERSION = 2;
const STORE = 'images';

let dbPromise;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const oldV = e.oldVersion;
      let store;
      if (!db.objectStoreNames.contains(STORE)) {
        store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      } else {
        store = req.transaction.objectStore(STORE);
      }
      if (oldV < 2) {
        if (!store.indexNames.contains('starred')) {
          store.createIndex('starred', 'starred', { unique: false });
        }
        // 现有记录补默认 starred=0（false 不参与索引，故用 0/1 整数）
        store.openCursor().onsuccess = (ev) => {
          const c = ev.target.result;
          if (!c) return;
          if (c.value.starred === undefined) {
            c.value.starred = 0;
            c.update(c.value);
          }
          c.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode = 'readonly') {
  const db = await openDB();
  return db.transaction(STORE, mode).objectStore(STORE);
}

const Storage = {
  async save(item) {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const r = store.put(item);
      r.onsuccess = () => resolve(item);
      r.onerror = () => reject(r.error);
    });
  },

  async list({ limit = 1000, offset = 0 } = {}) {
    const store = await tx();
    return new Promise((resolve, reject) => {
      const items = [];
      const idx = store.index('createdAt');
      const cursor = idx.openCursor(null, 'prev');
      let skipped = 0;
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || items.length >= limit) return resolve(items);
        if (skipped < offset) { skipped++; c.continue(); return; }
        items.push(c.value);
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  },

  async count() {
    const store = await tx();
    return new Promise((resolve, reject) => {
      const r = store.count();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },

  async get(id) {
    const store = await tx();
    return new Promise((resolve, reject) => {
      const r = store.get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },

  async remove(id) {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const r = store.delete(id);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  },

  async setStarred(id, starred) {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const g = store.get(id);
      g.onsuccess = () => {
        const item = g.result;
        if (!item) return resolve(false);
        item.starred = starred ? 1 : 0;
        const p = store.put(item);
        p.onsuccess = () => resolve(true);
        p.onerror = () => reject(p.error);
      };
      g.onerror = () => reject(g.error);
    });
  },

  async clear() {
    const store = await tx('readwrite');
    return new Promise((resolve, reject) => {
      const r = store.clear();
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  },

  // 用 blob 创建 ObjectURL，注意调用方使用完要 revoke
  blobUrl(blob) {
    return URL.createObjectURL(blob);
  },

  // 估算占用的存储空间
  async usage() {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return {
      usedMB: (est.usage / 1024 / 1024).toFixed(1),
      quotaMB: (est.quota / 1024 / 1024).toFixed(0),
      percent: Math.round((est.usage / est.quota) * 100),
    };
  },
};

window.Storage = Storage;
