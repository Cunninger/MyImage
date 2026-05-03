/* IndexedDB 存储层 — 所有图片和元数据都存在本地 */

const DB_NAME = 'gpt-image-store';
const DB_VERSION = 3;
const STORE = 'images';

let dbPromise;
let dbError = null;

function checkIDB() {
  if (!window.indexedDB) {
    throw new Error('当前浏览器不支持 IndexedDB，图片无法持久保存。请通过 http://localhost:3000 访问，而非直接打开文件。');
  }
}

function openDB() {
  if (dbError) return Promise.reject(dbError);
  if (dbPromise) return dbPromise;
  checkIDB();
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
      if (oldV < 3) {
        store.openCursor().onsuccess = (ev) => {
          const c = ev.target.result;
          if (!c) return;
          if (!Array.isArray(c.value.tags)) {
            c.value.tags = [];
            c.update(c.value);
          }
          c.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbError = req.error || new Error('IndexedDB 打开失败');
      reject(dbError);
    };
    req.onblocked = () => {
      dbError = new Error('IndexedDB 被其他页面阻塞，请关闭其他标签页后刷新');
      reject(dbError);
    };
  });
  return dbPromise;
}

async function tx(mode = 'readonly') {
  try {
    const db = await openDB();
    return db.transaction(STORE, mode).objectStore(STORE);
  } catch (e) {
    throw new Error(`存储访问失败: ${e.message}`);
  }
}

const Storage = {
  async save(item) {
    try {
      const store = await tx('readwrite');
      return new Promise((resolve, reject) => {
        const r = store.put(item);
        r.onsuccess = () => resolve(item);
        r.onerror = () => reject(r.error);
      });
    } catch (e) {
      throw new Error(`保存图片失败: ${e.message}`);
    }
  },

  async list({ limit = 1000, offset = 0 } = {}) {
    try {
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
    } catch (e) {
      throw new Error(`读取图库失败: ${e.message}`);
    }
  },

  async count() {
    try {
      const store = await tx();
      return new Promise((resolve, reject) => {
        const r = store.count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } catch (e) {
      console.warn('Storage.count 失败:', e);
      return 0;
    }
  },

  async get(id) {
    try {
      const store = await tx();
      return new Promise((resolve, reject) => {
        const r = store.get(id);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } catch (e) {
      throw new Error(`读取记录失败: ${e.message}`);
    }
  },

  async remove(id) {
    try {
      const store = await tx('readwrite');
      return new Promise((resolve, reject) => {
        const r = store.delete(id);
        r.onsuccess = () => resolve(true);
        r.onerror = () => reject(r.error);
      });
    } catch (e) {
      throw new Error(`删除失败: ${e.message}`);
    }
  },

  async setStarred(id, starred) {
    try {
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
    } catch (e) {
      throw new Error(`收藏操作失败: ${e.message}`);
    }
  },

  async setTags(id, tags) {
    try {
      const store = await tx('readwrite');
      return new Promise((resolve, reject) => {
        const g = store.get(id);
        g.onsuccess = () => {
          const item = g.result;
          if (!item) return resolve(false);
          item.tags = Array.isArray(tags) ? tags : [];
          const p = store.put(item);
          p.onsuccess = () => resolve(true);
          p.onerror = () => reject(p.error);
        };
        g.onerror = () => reject(g.error);
      });
    } catch (e) {
      throw new Error(`标签保存失败: ${e.message}`);
    }
  },

  async clear() {
    try {
      const store = await tx('readwrite');
      return new Promise((resolve, reject) => {
        const r = store.clear();
        r.onsuccess = () => resolve(true);
        r.onerror = () => reject(r.error);
      });
    } catch (e) {
      throw new Error(`清空失败: ${e.message}`);
    }
  },

  // 检测当前环境是否支持持久化存储
  async isSupported() {
    try {
      checkIDB();
      await openDB();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
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
