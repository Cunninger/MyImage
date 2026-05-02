/* IndexedDB 存储层 — 所有图片和元数据都存在手机本地 */

const DB_NAME = 'gpt-image-store';
const DB_VERSION = 1;
const STORE = 'images';

let dbPromise;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('type', 'type', { unique: false });
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
