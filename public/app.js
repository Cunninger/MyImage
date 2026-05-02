/* AI 画图工坊 — 前端逻辑（本地直跑，所有图片存本机 IndexedDB） */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

// =======================
// 工具
// =======================
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function base64ToBlob(b64, mime = 'image/png') {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// 生成完成提示音
function playDoneSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.4);
    });
  } catch (e) {}
}

const isNative = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
const FS = isNative ? Capacitor.Plugins.Filesystem : null;
const SharePlugin = isNative ? Capacitor.Plugins.Share : null;
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// 提示词历史记录
const PROMPT_HISTORY_KEY = 'prompt_history';
const PROMPT_HISTORY_MAX = 30;
function getPromptHistory() { try { return JSON.parse(localStorage.getItem(PROMPT_HISTORY_KEY) || '[]'); } catch { return []; } }
function savePromptHistory(text, model) {
  if (!text.trim()) return;
  const history = getPromptHistory().filter(h => h.text !== text);
  history.unshift({ text, model, time: Date.now() });
  localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(history.slice(0, PROMPT_HISTORY_MAX)));
}

// 主题管理：auto / light / dark，localStorage 持久化，跟随系统偏好
const THEME_KEY = 'theme_mode';
const MODEL_PREF_KEY = 'preferred_model';
const themeMq = window.matchMedia('(prefers-color-scheme: light)');
function getThemeMode() { return localStorage.getItem(THEME_KEY) || 'auto'; }
function applyTheme(mode) {
  const resolved = mode === 'auto' ? (themeMq.matches ? 'light' : 'dark') : mode;
  document.documentElement.setAttribute('data-theme', resolved);
  const themeColor = resolved === 'light' ? '#f5f7fa' : '#0b0d13';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
}
function setThemeMode(mode) {
  if (!['auto', 'light', 'dark'].includes(mode)) mode = 'auto';
  if (mode === 'auto') localStorage.removeItem(THEME_KEY);
  else localStorage.setItem(THEME_KEY, mode);
  applyTheme(mode);
  document.querySelectorAll('.theme-opt').forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.theme === mode));
  });
}
applyTheme(getThemeMode());
themeMq.addEventListener?.('change', () => { if (getThemeMode() === 'auto') applyTheme('auto'); });

// 自定义确认对话框
function confirmDialog(msg, { title = '确认', confirmText = '确定', danger = false } = {}) {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `
      <div class="modal-bg"></div>
      <div class="confirm-frame">
        <div class="confirm-title">${escapeHtml(title)}</div>
        <div class="confirm-msg">${escapeHtml(msg)}</div>
        <div class="confirm-actions">
          <button class="confirm-cancel">取消</button>
          <button class="confirm-ok${danger ? ' danger' : ''}">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    const close = (val) => { el.remove(); resolve(val); };
    el.querySelector('.modal-bg').addEventListener('click', () => close(false));
    el.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
    el.querySelector('.confirm-ok').addEventListener('click', () => close(true));
    document.body.appendChild(el);
  });
}

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// =======================
// API Client（本地直跑，浏览器/APP 直接调 pearapi.ai）
// =======================
const KEY_STORE = 'pearapi_key';
const PEARAPI_BASE = 'https://api.pearapi.ai';

const Client = {
  get hasUserKey() { return !!localStorage.getItem(KEY_STORE); },
  getKey() { return localStorage.getItem(KEY_STORE) || ''; },
  setKey(k) {
    if (k) localStorage.setItem(KEY_STORE, k);
    else localStorage.removeItem(KEY_STORE);
  },

  // ============ 生成 / 编辑 ============
  async generateOrEdit({ type, model, prompt, aspectRatio, n, refFiles, refUrls, signal }) {
    const refs = [];
    for (const f of refFiles || []) {
      if (f instanceof File && f.size > 0) {
        refs.push(await fileToDataUrl(f));
      }
    }
    refs.push(...(refUrls || []));

    const body = { model, prompt, response_format: 'b64_json' };
    if (aspectRatio) body.aspect_ratio = aspectRatio;
    if (n) body.n = Math.min(4, Math.max(1, n));
    if (refs.length === 1) body.image = refs[0];
    else if (refs.length > 1) body['images[]'] = refs;

    const url = type === 'edit' ? `${PEARAPI_BASE}/v1/images/edits` : `${PEARAPI_BASE}/v1/images/generations`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getKey()}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    let data;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    const items = [];
    for (const item of (data.data || [])) {
      let blob = null;
      if (item.b64_json) {
        blob = base64ToBlob(item.b64_json, 'image/png');
      } else if (item.url) {
        try {
          const r = await fetch(item.url);
          blob = await r.blob();
        } catch (e) {
          items.push({
            id: genId(), createdAt: Date.now(), prompt, model, type, aspect_ratio: aspectRatio || '',
            remoteUrl: item.url,
          });
          continue;
        }
      }
      if (!blob) continue;
      const record = {
        id: genId(),
        blob,
        prompt, model, type,
        aspect_ratio: aspectRatio || '',
        createdAt: Date.now(),
        tags: [],
      };
      await Storage.save(record);
      items.push(record);
    }
    return items;
  },

  async listGallery() {
    return await Storage.list({ limit: 500 });
  },

  async deleteItem(item) {
    return await Storage.remove(item.id);
  },

  imgSrc(item) {
    if (item.blob) return URL.createObjectURL(item.blob);
    if (item.remoteUrl) return item.remoteUrl;
    return '';
  },
};

// =======================
// Tabs（统一桌面 .tab + 移动 .nav-item）
// =======================
function switchTab(tabName) {
  // 桌面顶栏 tab
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  // 移动底岛 nav-item
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  // 面板切换
  $$('.panel').forEach(p => p.classList.remove('active'));
  if (tabName === 'settings') {
    openSettings();
  } else {
    $(`#panel-${tabName}`)?.classList.add('active');
    if (tabName === 'gallery') loadGallery();
  }
}

$$('.tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// =======================
// 浮动输入条（移动端）
// =======================
$$('.float-send').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const input = btn.closest('.float-bar').querySelector('.float-input');
    const text = (input?.value || '').trim();
    if (!text) return;
    const form = $(`#${target}`);
    if (!form) return;
    const ta = form.querySelector('textarea[name="prompt"]');
    if (ta) {
      ta.value = text;
      ta.dispatchEvent(new Event('input'));
    }
    input.value = '';
    form.requestSubmit();
  });
});
$$('.float-input').forEach(input => {
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.closest('.float-bar').querySelector('.float-send')?.click();
    }
  });
});
// 点击 sheet 外部关闭
document.addEventListener('click', e => {
  const sheet = document.querySelector('.sidebar.sheet-open');
  if (sheet && !sheet.contains(e.target) && !e.target.closest('.float-bar')) {
    sheet.classList.remove('sheet-open');
  }
});

// =======================
// Toast
// =======================
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = {
    success: '<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    error: '<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    info: '<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  el.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  }, 3000);
}

// =======================
// 比例 & 计数器
// =======================
$$('.ratio-grid').forEach(grid => {
  const hidden = grid.parentElement.querySelector('input[type="hidden"][name="aspect_ratio"]');
  grid.querySelectorAll('.ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (hidden) hidden.value = btn.dataset.value;
    });
  });
});

$$('.counter').forEach(counter => {
  const input = counter.querySelector('input[type="number"]');
  counter.querySelectorAll('.counter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = parseInt(btn.dataset.step, 10);
      const cur = parseInt(input.value, 10) || 1;
      input.value = Math.max(1, Math.min(4, cur + step));
    });
  });
});

// 提示词字符计数 + chips
const promptInput = $('#form-generate textarea[name="prompt"]');
const promptCount = $('#prompt-count');
if (promptInput && promptCount) {
  const update = () => promptCount.textContent = promptInput.value.length;
  promptInput.addEventListener('input', update);
  update();
}
$$('.chip[data-tag]').forEach(chip => {
  chip.addEventListener('click', () => {
    if (!promptInput) return;
    const tag = chip.dataset.tag;
    const v = promptInput.value;
    if (chip.classList.contains('active')) {
      // 移除标签
      promptInput.value = v.replace(new RegExp(',?\\s*' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ',?\\s*'), (m, p1) => {
        return m.startsWith(',') && m.endsWith(',') ? ', ' : '';
      }).replace(/^,\s*/, '').replace(/,\s*$/, '').trim();
      chip.classList.remove('active');
    } else {
      // 添加标签
      const trimmed = promptInput.value.trim();
      promptInput.value = trimmed ? `${trimmed}, ${tag}` : tag;
      chip.classList.add('active');
    }
    promptInput.dispatchEvent(new Event('input'));
    promptInput.focus();
  });
});

// =======================
// FileBucket（拖拽上传）
// =======================
class FileBucket {
  constructor(zoneEl, inputEl, listEl, max = 4) {
    this.zone = zoneEl;
    this.input = inputEl;
    this.list = listEl;
    this.max = max;
    this.files = [];
    this.bind();
  }

  bind() {
    this.zone.addEventListener('click', (e) => {
      if (e.target.closest('.file-thumb')) return;
      this.input.click();
    });
    this.input.addEventListener('change', () => {
      this.add(Array.from(this.input.files));
      this.input.value = '';
    });
    ['dragenter', 'dragover'].forEach(ev => {
      this.zone.addEventListener(ev, e => { e.preventDefault(); this.zone.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(ev => {
      this.zone.addEventListener(ev, e => {
        e.preventDefault();
        if (ev === 'dragleave' && e.relatedTarget && this.zone.contains(e.relatedTarget)) return;
        this.zone.classList.remove('drag-over');
      });
    });
    this.zone.addEventListener('drop', e => {
      const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
      if (files.length) this.add(files);
    });
    document.addEventListener('paste', e => {
      if (!this.zone.closest('.panel')?.classList.contains('active')) return;
      const items = Array.from(e.clipboardData?.files || []);
      const imgs = items.filter(f => f.type.startsWith('image/'));
      if (imgs.length) {
        this.add(imgs);
        toast(`从剪贴板添加了 ${imgs.length} 张图片`);
      }
    });
    this.zone.querySelector('.camera-link')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openCameraSheet();
    });
  }

  openCameraSheet() {
    const remaining = this.max - this.files.length;
    if (remaining <= 0) {
      toast(`最多 ${this.max} 张图片`, 'error');
      return;
    }
    showCameraSheet(async (action) => {
      try {
        if (action === 'camera') {
          const file = await takePhotoToFile();
          if (file) this.add([file]);
        } else if (action === 'gallery') {
          const files = await pickFromGalleryToFiles(remaining);
          if (files.length) this.add(files);
        }
      } catch (err) {
        if (isCameraCancel(err)) return;
        console.error('[camera]', err);
        toast(err?.message || '相机调用失败', 'error');
      }
    });
  }

  add(files) {
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) {
        toast(`${f.name} 超过 25MB 限制`, 'error');
        continue;
      }
      if (this.files.length >= this.max) {
        toast(`最多 ${this.max} 张图片`, 'error');
        break;
      }
      this.files.push(f);
    }
    this.render();
  }

  remove(idx) {
    this.files.splice(idx, 1);
    this.render();
  }

  clear() { this.files = []; this.render(); }

  render() {
    this.list.innerHTML = '';
    this.files.forEach((f, i) => {
      const url = URL.createObjectURL(f);
      const thumb = document.createElement('div');
      thumb.className = 'file-thumb';
      thumb.innerHTML = `
        <img src="${url}" alt="" />
        <button type="button" class="remove" aria-label="移除">×</button>
      `;
      thumb.querySelector('.remove').addEventListener('click', e => {
        e.stopPropagation();
        URL.revokeObjectURL(url);
        this.remove(i);
      });
      this.list.appendChild(thumb);
    });
  }
}

const generateFiles = new FileBucket($('#dropzone-generate'), $('#file-generate'), $('#files-generate'), 4);
const editFiles = new FileBucket($('#dropzone-edit'), $('#file-edit'), $('#files-edit'), 4);

// =======================
// 相机/相册（仅 Capacitor 原生平台）
// =======================
if (isNative) {
  document.querySelectorAll('.camera-link').forEach(el => el.removeAttribute('hidden'));
}

function isCameraCancel(err) {
  if (!err) return false;
  const code = err.code || '';
  if (code === 'OS-PLUG-CAMR-0006' || code === 'OS-PLUG-CAMR-0020') return true;
  const msg = (err.message || err.errorMessage || '').toLowerCase();
  return msg.includes('cancel') || msg.includes('user denied') || msg.includes('user cancelled');
}

async function takePhotoToFile() {
  const Camera = window.Capacitor?.Plugins?.Camera;
  if (!Camera) throw new Error('Camera 插件不可用');
  const photo = await Camera.takePhoto({ quality: 90, includeMetadata: false });
  const path = photo.webPath || photo.path;
  if (!path) throw new Error('未能获取照片路径');
  const blob = await (await fetch(path)).blob();
  return new File([blob], `photo-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
}

async function pickFromGalleryToFiles(maxCount) {
  const Camera = window.Capacitor?.Plugins?.Camera;
  if (!Camera) throw new Error('Camera 插件不可用');
  const { results = [] } = await Camera.chooseFromGallery({ quality: 90, limit: maxCount });
  const files = [];
  for (const r of results) {
    const path = r.webPath || r.path;
    if (!path) continue;
    const blob = await (await fetch(path)).blob();
    files.push(new File([blob], `gallery-${Date.now()}-${files.length}.jpg`, { type: blob.type || 'image/jpeg' }));
  }
  return files;
}

function showCameraSheet(onChoose) {
  const sheet = document.getElementById('camera-sheet');
  if (!sheet) { onChoose('cancel'); return; }
  sheet.hidden = false;
  // 触发入场动画
  requestAnimationFrame(() => sheet.classList.add('open'));
  const close = () => {
    sheet.classList.remove('open');
    setTimeout(() => { sheet.hidden = true; }, 200);
    sheet.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  };
  const onClick = (e) => {
    const action = e.target.closest('[data-action]')?.dataset?.action;
    if (!action) return;
    close();
    onChoose(action);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); onChoose('cancel'); }
  };
  sheet.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
}

// =======================
// 卡片渲染
// =======================
function buildCard(item, container, prepend = true) {
  const card = document.createElement('div');
  card.className = 'card';
  const src = Client.imgSrc(item);
  const starred = !!item.starred;
  card.innerHTML = `
    <img src="${src}" alt="" loading="lazy" />
    <button class="star-corner${starred ? ' starred' : ''}" type="button" aria-label="${starred ? '取消收藏' : '收藏'}">
      <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" stroke-linejoin="round"/></svg>
    </button>
    <div class="card-overlay">
      <div class="card-overlay-content">
        <div class="card-prompt">${escapeHtml(item.prompt || '')}</div>
        <div class="card-meta">
          <span class="card-meta-tag">${item.model || ''}</span>
          ${item.aspect_ratio ? `<span class="card-meta-tag">${item.aspect_ratio}</span>` : ''}
          <span>${formatTime(item.createdAt)}</span>
        </div>
        ${(item.tags || []).length ? `<div class="card-tags">${item.tags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="card-actions">
          <button class="action-regen" title="重新生成"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="action-toedit" title="以此图编辑"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="action-download" title="下载"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="action-prompt" title="复制提示词"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" stroke="currentColor" stroke-width="2"/></svg></button>
          <button class="action-delete danger" title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>
      </div>
    </div>
  `;
  // 双击查看大图（触摸和桌面统一逻辑）
  let lastTapTime = 0;
  card.addEventListener('click', e => {
    if (e.target.closest('.card-actions button')) return;
    if (e.target.closest('.star-corner')) return;
    const now = Date.now();
    if (now - lastTapTime < 300) {
      lastTapTime = 0;
      if (isTouch) card.classList.remove('overlay-active');
      openModal(item);
    } else if (isTouch) {
      const wasActive = card.classList.contains('overlay-active');
      card.classList.toggle('overlay-active');
      if (wasActive && !card.classList.contains('overlay-active')) {
        // 点击关闭 overlay，不更新 lastTapTime，让快速双击仍可触发
      }
    }
    lastTapTime = now;
  });
  // 收藏切换
  const starBtn = card.querySelector('.star-corner');
  starBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const next = !starBtn.classList.contains('starred');
    starBtn.classList.toggle('starred', next);
    starBtn.classList.add('pop');
    starBtn.setAttribute('aria-label', next ? '取消收藏' : '收藏');
    setTimeout(() => starBtn.classList.remove('pop'), 400);
    item.starred = next ? 1 : 0;
    try {
      await Storage.setStarred(item.id, next);
      const idx = galleryData.findIndex(x => x.id === item.id);
      if (idx >= 0) galleryData[idx].starred = item.starred;
      // 若当前在 starred 筛选下且取消收藏，重新渲染让其消失
      if (!next && $('#gallery-filter')?.value === 'starred') renderGallery();
    } catch (err) {
      starBtn.classList.toggle('starred', !next);
      item.starred = !next ? 1 : 0;
      toast('收藏失败', 'error');
    }
  });
  card.querySelector('.action-download').addEventListener('click', e => { e.stopPropagation(); downloadImage(item); });
  card.querySelector('.action-regen').addEventListener('click', e => {
    e.stopPropagation();
    runTask({
      type: item.type || 'generate',
      opts: { prompt: item.prompt || '', model: item.model || 'gpt-image-2-4k', aspectRatio: item.aspect_ratio || '', n: 1, refFiles: [], refUrls: [] },
      container: $('#results-generate'),
    });
    toast('已重新生成', 'info');
  });
  card.querySelector('.action-toedit').addEventListener('click', async e => {
    e.stopPropagation();
    let blob = item.blob;
    if (!blob && item.remoteUrl) { try { const r = await fetch(item.remoteUrl); blob = await r.blob(); } catch {} }
    if (!blob) return toast('无法获取图片', 'error');
    const file = new File([blob], 'reference.png', { type: blob.type || 'image/png' });
    editFiles.add([file]);
    $$('.tab')[1]?.click();
    const editPrompt = $('#form-edit textarea[name="prompt"]');
    if (editPrompt && item.prompt) editPrompt.value = item.prompt;
    toast('已切换到图生图');
  });
  card.querySelector('.action-prompt').addEventListener('click', e => {
    e.stopPropagation();
    if (!item.prompt) return toast('没有提示词', 'error');
    navigator.clipboard.writeText(item.prompt);
    toast('提示词已复制');
  });
  card.querySelector('.action-delete').addEventListener('click', async e => {
    e.stopPropagation();
    if (!await confirmDialog('确定删除这张图片吗？', { danger: true })) return;
    const ok = await Client.deleteItem(item);
    if (ok || ok === undefined) {
      card.style.transition = 'all 0.25s';
      card.style.transform = 'scale(0.85)';
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 250);
      toast('已删除');
      updateGalleryBadge();
    } else toast('删除失败', 'error');
  });
  if (prepend) container.prepend(card);
  else container.appendChild(card);
  return card;
}

// 点击空白区域关闭所有 overlay（触摸设备）
if (isTouch) {
  document.addEventListener('click', e => {
    if (!e.target.closest('.card')) {
      $$('.card.overlay-active').forEach(c => c.classList.remove('overlay-active'));
    }
  });
}

async function downloadImage(item) {
  let blob = null;
  let name = `gpt-image-${item.id || Date.now()}.png`;

  // 拿到 Blob
  if (item.blob instanceof Blob) {
    blob = item.blob;
  } else if (item.remoteUrl) {
    try {
      const r = await fetch(item.remoteUrl);
      blob = await r.blob();
    } catch (e) { /* 跨域 fallback */ }
  }

  // ===== 原生路径：Capacitor Android/iOS =====
  if (isNative && blob) {
    try {
      toast('正在保存...');
      const b64 = await blobToBase64(blob);
      const result = await FS.writeFile({
        path: name,
        data: b64,
        directory: 'DOCUMENTS',
        recursive: true,
      });
      toast('已保存到 Downloads', 'success');
      try {
        await SharePlugin.share({
          title: 'AI 画图工坊',
          text: item.prompt || '',
          url: result.uri,
        });
      } catch (e) {
        if (e?.message?.includes('cancel') || e?.message?.includes('Abort')) return;
      }
      return;
    } catch (e) {
      console.error('原生下载失败:', e);
      toast('保存失败: ' + (e.message || e), 'error');
      return;
    }
  }

  // ===== Web 路径：Web Share API =====
  if (blob) {
    try {
      const file = new File([blob], name, { type: blob.type || 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'AI 画图工坊' });
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }

  // ===== Web Fallback：<a download> =====
  const url = blob ? URL.createObjectURL(blob) : item.remoteUrl;
  if (!url) { toast('无法获取图片', 'error'); return; }
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (blob) setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function clearEmptyState(container) {
  container.querySelector('.empty-state')?.remove();
}

// =======================
// Modal
// =======================
let currentModalItem = null;
function openModal(item) {
  currentModalItem = item;
  $('#modal-img').src = Client.imgSrc(item);
  $('#modal-info').innerHTML = `
    <strong>${escapeHtml(item.prompt || '(无提示词)')}</strong>
    <span>模型: ${item.model || '-'} · 比例: ${item.aspect_ratio || '默认'} · ${new Date(item.createdAt).toLocaleString('zh-CN')}</span>
  `;
  renderModalTags(item);
  $('#modal').classList.remove('hidden');
}

function renderModalTags(item) {
  const container = $('#modal-tags');
  if (!container) return;
  const tags = item.tags || [];
  const allTags = getAllTags();
  const suggestions = allTags.filter(t => !tags.includes(t));
  container.innerHTML = `
    <div class="modal-tags-list">${tags.map(t => `<span class="tag-pill editable" data-tag="${escapeHtml(t)}">${escapeHtml(t)} <button class="tag-remove">×</button></span>`).join('') || '<span class="muted small">暂无标签</span>'}</div>
    <div class="modal-tags-input-row">
      <input type="text" class="tag-input" id="tag-input" placeholder="输入标签回车添加" maxlength="20" />
      ${suggestions.length ? `<select class="tag-suggest" id="tag-suggest"><option value="">快速选择...</option>${suggestions.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}</select>` : ''}
    </div>
  `;
  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => removeTagFromItem(item, btn.parentElement.dataset.tag));
  });
  const input = container.querySelector('#tag-input');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const v = input.value.trim();
        if (v) addTagToItem(item, v);
      }
    });
  }
  const suggest = container.querySelector('#tag-suggest');
  if (suggest) {
    suggest.addEventListener('change', () => {
      if (suggest.value) addTagToItem(item, suggest.value);
    });
  }
}

async function addTagToItem(item, tag) {
  const tags = new Set(item.tags || []);
  if (tags.has(tag)) return;
  tags.add(tag);
  item.tags = Array.from(tags);
  try {
    await Storage.setTags(item.id, item.tags);
    const idx = galleryData.findIndex(x => x.id === item.id);
    if (idx >= 0) galleryData[idx].tags = item.tags;
    renderModalTags(item);
    renderTagFilter();
    renderGallery();
  } catch (err) { toast('添加标签失败', 'error'); }
}

async function removeTagFromItem(item, tag) {
  item.tags = (item.tags || []).filter(t => t !== tag);
  try {
    await Storage.setTags(item.id, item.tags);
    const idx = galleryData.findIndex(x => x.id === item.id);
    if (idx >= 0) galleryData[idx].tags = item.tags;
    renderModalTags(item);
    renderTagFilter();
    renderGallery();
  } catch (err) { toast('移除标签失败', 'error'); }
}
$('#modal-close').addEventListener('click', closeModal);
$('.modal-bg').addEventListener('click', closeModal);
$('#modal-download').addEventListener('click', () => {
  if (currentModalItem) downloadImage(currentModalItem);
});
function closeModal() { $('#modal').classList.add('hidden'); }

// =======================
// 任务管理（含队列调度）
// =======================
const MAX_CONCURRENT = 2;
let activeTaskCount = 0;
let taskSeq = 0;
let taskQueue = [];      // { id, type, opts, container, cards, progressors, abortCtrl, status, taskId }
let runningTasks = 0;

function updateTaskCounter() {
  const el = $('#task-counter');
  const c = $('#task-count');
  const pending = taskQueue.filter(t => t.status === 'pending').length;
  if (activeTaskCount > 0 || pending > 0) {
    el.classList.remove('hidden');
    c.textContent = `${activeTaskCount}运行${pending ? ' / ' + pending + '排队' : ''}`;
  } else el.classList.add('hidden');
}

function createTaskCard(prompt, statusText = '生成中...') {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.innerHTML = `
    <button type="button" class="task-cancel" title="取消">×</button>
    <div class="task-progress-ring">
      <svg viewBox="0 0 64 64">
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#a78bfa"/>
            <stop offset="100%" stop-color="#ec4899"/>
          </linearGradient>
        </defs>
        <circle class="ring-track" cx="32" cy="32" r="28"/>
        <circle class="ring-fill" cx="32" cy="32" r="28"/>
      </svg>
      <span class="ring-pct">0%</span>
    </div>
    <div class="task-status-text">${escapeHtml(statusText)}</div>
    <div class="task-elapsed">0s</div>
    <div class="task-prompt">${escapeHtml((prompt || '(无提示词)').slice(0, 200))}</div>
  `;
  return card;
}

// 任务卡片伪进度动画
const RING_CIRCUMFERENCE = 175.93;
function startTaskProgress(card) {
  const fill = card.querySelector('.ring-fill');
  const pctEl = card.querySelector('.ring-pct');
  const elapsedEl = card.querySelector('.task-elapsed');
  const startedAt = Date.now();
  let raf;
  const tick = () => {
    const elapsed = (Date.now() - startedAt) / 1000;
    let pct;
    // 前 5 秒快速到 60%，5-25s 缓慢到 85%，之后逼近但不超过 92%
    if (elapsed < 5) pct = (elapsed / 5) * 60;
    else if (elapsed < 25) pct = 60 + ((elapsed - 5) / 20) * 25;
    else pct = 85 + Math.min(7, (elapsed - 25) * 0.2);
    pct = Math.min(92, pct);
    fill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - pct / 100));
    pctEl.textContent = `${Math.round(pct)}%`;
    elapsedEl.textContent = `已等待 ${Math.floor(elapsed)}s`;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    finish() {
      cancelAnimationFrame(raf);
      fill.style.strokeDashoffset = '0';
      pctEl.textContent = '100%';
      elapsedEl.textContent = '完成';
    },
    cancel() {
      cancelAnimationFrame(raf);
    },
  };
}

function setTaskCardError(card, msg) {
  card.classList.add('error');
  card.querySelector('.task-status-text').textContent = '失败';
  card.querySelector('.task-prompt').textContent = msg;
}

function enqueueTask({ type, opts, container }) {
  const taskId = ++taskSeq;
  const cards = [];
  const progressors = [];
  const n = opts.n || 1;
  const isPending = runningTasks >= MAX_CONCURRENT;

  for (let i = 0; i < n; i++) {
    const c = createTaskCard(opts.prompt, isPending ? `排队中 #${taskId}` : '生成中...');
    if (isPending) c.classList.add('pending');
    container.prepend(c);
    cards.push(c);
    progressors.push(startTaskProgress(c));
  }

  const abortCtrl = new AbortController();
  const task = { id: taskId, type, opts, container, cards, progressors, abortCtrl, status: isPending ? 'pending' : 'running', taskId };

  // 绑定取消按钮
  cards.forEach(c => {
    c.querySelector('.task-cancel').addEventListener('click', () => {
      const idx = taskQueue.findIndex(t => t.id === task.id);
      if (idx >= 0) {
        const t = taskQueue[idx];
        if (t.status === 'pending') {
          taskQueue.splice(idx, 1);
          t.progressors.forEach(p => p.cancel());
          t.cards.forEach(x => x.remove());
          updateTaskCounter();
          toast(`#${t.taskId} 已取消`);
          return;
        }
      }
      abortCtrl.abort();
      progressors.forEach(p => p.cancel());
      cards.forEach(x => x.remove());
      activeTaskCount -= n;
      updateTaskCounter();
    });
  });

  activeTaskCount += n;
  updateTaskCounter();

  if (isPending) {
    taskQueue.push(task);
    toast(`#${taskId} 已加入队列，前面还有 ${taskQueue.filter(t => t.status === 'pending').length - 1} 个任务`);
  } else {
    taskQueue.push(task);
    toast(`已开始生成 ${n} 张，可继续操作 ✨`, 'info');
    processQueue();
  }

  // 后台保活
  if (isNative && window.Capacitor?.Plugins?.BackgroundGen) {
    try { window.Capacitor.Plugins.BackgroundGen.startForeground(); } catch(e) {}
  }
}

async function processQueue() {
  while (runningTasks < MAX_CONCURRENT) {
    const next = taskQueue.find(t => t.status === 'pending');
    if (!next) break;
    next.status = 'running';
    next.cards.forEach(c => {
      c.classList.remove('pending');
      c.querySelector('.task-status-text').textContent = '生成中...';
    });
    runningTasks++;
    updateTaskCounter();
    executeTask(next).then(() => {
      runningTasks--;
      processQueue();
    });
  }
}

async function executeTask(task) {
  const { type, opts, container, cards, progressors, abortCtrl, taskId } = task;
  const n = opts.n || 1;

  try {
    const items = await Client.generateOrEdit({ type, ...opts, signal: abortCtrl.signal });
    if (abortCtrl.signal.aborted) return;
    if (!items?.length) throw new Error('未返回图片');
    progressors.forEach(p => p.finish());
    await new Promise(r => setTimeout(r, 250));
    cards.forEach(c => c.remove());
    items.forEach(it => buildCard(it, container));
    toast(`#${taskId} 完成：${(opts.prompt || '').slice(0, 24) || '已生成'} (${items.length} 张)`);
    playDoneSound();
    updateGalleryBadge();
  } catch (err) {
    if (abortCtrl.signal.aborted) {
      cards.forEach(c => c.remove());
      return;
    }
    progressors.forEach(p => p.cancel());
    cards.forEach(c => {
      setTaskCardError(c, err.message);
      c.querySelector('.task-cancel').onclick = () => c.remove();
    });
    let msg = err.message;
    if (err.name === 'TypeError') {
      msg = '网络错误：请检查网络/API Key 是否正确';
    }
    toast(`#${taskId} 失败：${msg}`, 'error');
  } finally {
    activeTaskCount -= n;
    updateTaskCounter();
    const idx = taskQueue.findIndex(t => t.id === task.id);
    if (idx >= 0) taskQueue.splice(idx, 1);
    if (activeTaskCount <= 0 && isNative && window.Capacitor?.Plugins?.BackgroundGen) {
      try { await window.Capacitor.Plugins.BackgroundGen.stopForeground(); } catch(e) {}
    }
  }
}

async function runTask({ type, opts, container }) {
  if (!Client.hasUserKey) {
    toast('请先在右上角设置 → 填入 API Key', 'error');
    openSettings();
    return;
  }
  clearEmptyState(container);
  savePromptHistory(opts.prompt || '', opts.model || '');
  if (opts.model) localStorage.setItem(MODEL_PREF_KEY, opts.model);
  enqueueTask({ type, opts, container });
}

// =======================
// 表单提交
// =======================
function readForm(form, bucket) {
  const fd = new FormData(form);
  return {
    model: fd.get('model'),
    prompt: (fd.get('prompt') || '').toString(),
    aspectRatio: (fd.get('aspect_ratio') || '').toString(),
    n: parseInt(fd.get('n'), 10) || 1,
    refFiles: bucket.files,
    refUrls: (fd.get('imageUrls') || '').toString().split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
  };
}

$('#form-generate').addEventListener('submit', e => {
  e.preventDefault();
  const btn = e.target.querySelector('.submit-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, 2000);
  const opts = readForm(e.target, generateFiles);
  runTask({
    type: 'generate',
    opts,
    container: $('#results-generate'),
  });
});

$('#form-edit').addEventListener('submit', e => {
  e.preventDefault();
  const btn = e.target.querySelector('.submit-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, 2000);
  const opts = readForm(e.target, editFiles);
  if (opts.refFiles.length === 0 && opts.refUrls.length === 0) {
    toast('请上传或填入至少一张参考图', 'error');
    return;
  }
  runTask({
    type: 'edit',
    opts,
    container: $('#results-edit'),
  });
});

// 清空结果
$('#clear-generate').addEventListener('click', async () => {
  if (!await confirmDialog('清空结果区？（不会删除已保存图片）')) return;
  $('#results-generate').innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="64" height="64" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="9" r="2" stroke="currentColor" stroke-width="1.5"/><path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div><p>等待你的第一个创意 ✨</p><p class="muted">在左侧输入提示词，点击生成</p></div>`;
});
$('#clear-edit').addEventListener('click', async () => {
  if (!await confirmDialog('清空结果区？（不会删除已保存图片）')) return;
  $('#results-edit').innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="64" height="64" viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><p>上传图片，告诉 AI 你想怎么改</p></div>`;
});

// =======================
// 图库
// =======================
let galleryData = [];

async function loadGallery() {
  const container = $('#gallery');
  container.innerHTML = Array.from({ length: 8 }, () =>
    '<div class="skeleton" style="aspect-ratio:1"></div>'
  ).join('');
  galleryData = await Client.listGallery();
  renderGallery();
  renderTagFilter();
  $('#gallery-count').textContent = galleryData.length ? `共 ${galleryData.length} 张` : '';
  updateGalleryBadge();
}

function getAllTags() {
  const tags = new Set();
  galleryData.forEach(item => (item.tags || []).forEach(t => tags.add(t)));
  return Array.from(tags).sort();
}

function renderTagFilter() {
  const sel = $('#gallery-tag-filter');
  if (!sel) return;
  const current = sel.value;
  const allTags = getAllTags();
  sel.innerHTML = '<option value="">🏷 标签</option>' +
    allTags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  if (allTags.includes(current)) sel.value = current;
}

function renderGallery() {
  const search = ($('#gallery-search').value || '').toLowerCase();
  const filter = $('#gallery-filter').value;
  const tagFilter = $('#gallery-tag-filter')?.value;
  const container = $('#gallery');

  let list = galleryData;
  if (filter === 'starred') list = list.filter(x => x.starred);
  else if (filter) list = list.filter(x => x.type === filter);
  if (tagFilter) list = list.filter(x => (x.tags || []).includes(tagFilter));
  if (search) list = list.filter(x => (x.prompt || '').toLowerCase().includes(search));

  container.innerHTML = '';
  if (list.length === 0) {
    const noStarred = filter === 'starred' && galleryData.length > 0;
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">
          ${noStarred
            ? '<svg width="64" height="64" viewBox="0 0 24 24" fill="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
            : '<svg width="64" height="64" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="9" r="2" stroke="currentColor" stroke-width="1.5"/><path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'}
        </div>
        <p>${noStarred ? '还没有收藏的图片' : (galleryData.length === 0 ? '还没有保存的图片' : '没有匹配的图片')}</p>
        <p class="muted">${noStarred ? '点击图片右上角的星标即可收藏' : (galleryData.length === 0 ? '去文生图试试看吧' : '试试换个关键词')}</p>
      </div>
    `;
    return;
  }
  list.forEach(it => buildCard(it, container, false));
}

$('#refresh-gallery').addEventListener('click', loadGallery);
$('#gallery-search').addEventListener('input', renderGallery);
$('#gallery-filter').addEventListener('change', renderGallery);
$('#gallery-tag-filter')?.addEventListener('change', renderGallery);

// 收藏快捷按钮
const filterStarredBtn = $('#filter-starred-btn');
if (filterStarredBtn) {
  filterStarredBtn.addEventListener('click', () => {
    const filter = $('#gallery-filter');
    const isStarred = filter.value === 'starred';
    filter.value = isStarred ? '' : 'starred';
    filterStarredBtn.classList.toggle('active', !isStarred);
    renderGallery();
  });
}
// 同步收藏按钮状态与下拉框
function syncStarredBtnState() {
  if (filterStarredBtn) {
    filterStarredBtn.classList.toggle('active', $('#gallery-filter')?.value === 'starred');
  }
}
$('#gallery-filter')?.addEventListener('change', syncStarredBtnState);

// 图库视图切换
let galleryViewMode = 'grid';
const galleryEl = $('#gallery');
$('#view-grid').addEventListener('click', () => {
  galleryViewMode = 'grid';
  galleryEl.classList.remove('masonry');
  $('#view-grid').classList.add('active');
  $('#view-masonry').classList.remove('active');
});
$('#view-masonry').addEventListener('click', () => {
  galleryViewMode = 'masonry';
  galleryEl.classList.add('masonry');
  $('#view-masonry').classList.add('active');
  $('#view-grid').classList.remove('active');
});

async function updateGalleryBadge() {
  const count = await Storage.count();
  $('#gallery-badge').textContent = count;
  const mb = $('#gallery-badge-mobile');
  if (mb) mb.textContent = count;
}

// =======================
// 设置弹窗
// =======================
function openSettings() {
  const isMobile = window.innerWidth <= 980;
  if (isMobile) {
    // 移动端：确保 settings-body 在移动端 panel 中
    const body = $('#settings-modal .settings-body') || $('#settings-body-mobile .settings-body');
    const dst = $('#settings-body-mobile');
    if (body && dst && body.parentElement !== dst) dst.appendChild(body);
    $('#panel-settings').classList.add('active');
  } else {
    // 桌面端：确保 settings-body 在 modal 中，然后显示 modal
    const body = $('#settings-body-mobile .settings-body') || $('#settings-modal .settings-body');
    const frame = $('#settings-modal .settings-frame');
    if (body && frame && body.parentElement !== frame) frame.appendChild(body);
    $('#settings-modal').classList.remove('hidden');
  }
  $('#api-key-input').value = Client.getKey();
  const dk = $('#deepseek-key-input');
  if (dk) dk.value = getDeepSeekKey();
  const mode = getThemeMode();
  document.querySelectorAll('.theme-opt').forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.theme === mode));
  });
  refreshStorageInfo();
}
function closeSettings() {
  // 把 settings-body 移回 modal
  const body = $('#settings-body-mobile .settings-body') || $('#settings-modal .settings-body');
  const frame = $('#settings-modal .settings-frame');
  if (body && frame && body.parentElement !== frame) frame.appendChild(body);
  $('#settings-modal').classList.add('hidden');
}
$('#open-settings').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', closeSettings);
$('#settings-modal .modal-bg').addEventListener('click', closeSettings);

// 主题切换按钮
document.querySelectorAll('.theme-opt').forEach(btn => {
  btn.addEventListener('click', () => setThemeMode(btn.dataset.theme));
});

$('#save-key').addEventListener('click', async () => {
  const k = $('#api-key-input').value.trim();
  if (!k) return toast('请输入 API Key', 'error');
  Client.setKey(k);
  updateStatusUI();
  toast('已保存');
  closeSettings();
});

$('#clear-key').addEventListener('click', async () => {
  Client.setKey('');
  updateStatusUI();
  toast('已清除 Key');
  $('#api-key-input').value = '';
});

$('#clear-history').addEventListener('click', async () => {
  if (!await confirmDialog('删除手机本地存储的全部图片？此操作不可恢复。', { title: '清空图库', confirmText: '全部删除', danger: true })) return;
  await Storage.clear();
  toast('本地图库已清空');
  refreshStorageInfo();
  updateGalleryBadge();
});

$('#export-history').addEventListener('click', async () => {
  const items = await Storage.list({ limit: 1000 });
  const meta = items.map(({ blob, ...rest }) => rest);
  const json = JSON.stringify(meta, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gpt-image-history-${Date.now()}.json`;
  a.click();
  toast(`导出了 ${items.length} 条元数据（不含图片本体）`);
});

async function refreshStorageInfo() {
  const count = await Storage.count();
  const usage = await Storage.usage();
  const html = usage
    ? `<strong>${count}</strong> 张图片 · 占用 <strong>${usage.usedMB}</strong> MB / ${usage.quotaMB} MB
       <div class="storage-bar"><div style="width:${usage.percent}%"></div></div>`
    : `<strong>${count}</strong> 张图片`;
  $('#storage-info').innerHTML = html;
}

function updateStatusUI() {
  const status = $('#status');
  if (!status) return;
  const text = status.querySelector('.status-text');
  status.classList.remove('ok', 'error');
  if (Client.hasUserKey) {
    status.classList.add('ok');
    text.textContent = '本地直跑';
  } else {
    status.classList.add('error');
    text.textContent = '需要配置 Key';
  }
}

// =======================
// DeepSeek AI 扩写
// =======================
const DS_KEY_STORE = 'deepseek_key';
function getDeepSeekKey() { return localStorage.getItem(DS_KEY_STORE) || ''; }
function setDeepSeekKey(k) { k ? localStorage.setItem(DS_KEY_STORE, k) : localStorage.removeItem(DS_KEY_STORE); }

$('#save-deepseek-key').addEventListener('click', () => {
  const k = $('#deepseek-key-input').value.trim();
  if (!k) return toast('请输入 DeepSeek API Key', 'error');
  setDeepSeekKey(k);
  toast('DeepSeek Key 已保存');
});
$('#clear-deepseek-key').addEventListener('click', () => {
  setDeepSeekKey('');
  $('#deepseek-key-input').value = '';
  toast('DeepSeek Key 已清除');
});

// 配置导入导出
$('#export-config').addEventListener('click', () => {
  const config = {
    pearapi_key: Client.getKey(),
    deepseek_key: getDeepSeekKey(),
  };
  if (!config.pearapi_key && !config.deepseek_key) {
    return toast('没有可导出的配置', 'error');
  }
  $('#config-text').value = JSON.stringify(config, null, 2);
  toast('配置已导出到上方文本框，可复制分享');
});

$('#import-config').addEventListener('click', async () => {
  try {
    const text = ($('#config-text').value || '').trim();
    if (!text) return toast('请在上方文本框中粘贴配置 JSON', 'error');
    const config = JSON.parse(text);
    if (config.pearapi_key) {
      Client.setKey(config.pearapi_key);
      $('#api-key-input').value = config.pearapi_key;
    }
    if (config.deepseek_key) {
      setDeepSeekKey(config.deepseek_key);
      $('#deepseek-key-input').value = config.deepseek_key;
    }
    updateStatusUI();
    toast('配置导入成功');
  } catch (e) {
    toast('导入失败：请确保粘贴了有效的 JSON 配置', 'error');
  }
});

// 密码可见性切换
$$('.toggle-visibility').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const input = $(`#${targetId}`);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.setAttribute('aria-label', isHidden ? '隐藏密码' : '显示密码');
  });
});

// AI 扩写语言配置
const EXPAND_LANG_KEY = 'ai_expand_lang';
function getExpandLang() { return localStorage.getItem(EXPAND_LANG_KEY) || 'en'; }
function setExpandLang(lang) { localStorage.setItem(EXPAND_LANG_KEY, lang); }
function buildExpandSystem(lang) {
  if (lang === 'zh') {
    return `你是一位顶级的AI绘画提示词专家。用户会给你一段简短的描述，你需要将其扩写为一段高质量、细节丰富的中文提示词（prompt），适合用于 GPT-Image、Midjourney、DALL-E 等 AI 绘画模型。\n\n规则：\n1. 输出纯中文提示词，不要任何解释、标题或额外文字\n2. 用逗号分隔各个描述元素\n3. 按以下结构组织：主体描述 → 场景/环境 → 光照/氛围 → 风格/艺术家参考 → 画质/技术参数\n4. 包含具体的视觉细节：材质、颜色、光线方向、镜头参数\n5. 添加画质提升词： masterpiece, best quality, highly detailed, 8K, professional 等（可保留英文品质词）\n6. 控制在 150-300 个汉字以内`;
  }
  return `你是一位顶级的AI绘画提示词专家。用户会给你一段简短的描述，你需要将其扩写为一段高质量、细节丰富的英文提示词（prompt），适合用于 GPT-Image、Midjourney、DALL-E 等 AI 绘画模型。\n\n规则：\n1. 输出纯英文提示词，不要任何解释、标题或额外文字\n2. 用逗号分隔各个描述元素\n3. 按以下结构组织：主体描述 → 场景/环境 → 光照/氛围 → 风格/艺术家参考 → 画质/技术参数\n4. 包含具体的视觉细节：材质、颜色、光线方向、镜头参数\n5. 添加画质提升词：masterpiece, best quality, highly detailed, 8K, professional 等\n6. 如果用户用中文描述，理解其含义并翻译成精准的英文提示词\n7. 控制在 100-200 个英文单词以内`;
}

// 语言切换按钮
$$('.lang-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const lang = btn.dataset.lang;
    setExpandLang(lang);
    $$('.lang-opt').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
    });
    toast(`扩写语言已切换为 ${lang === 'en' ? '英文' : '中文'}`);
  });
});
// 初始化语言按钮状态
(function initLangBtn() {
  const current = getExpandLang();
  $$('.lang-opt').forEach(btn => {
    const active = btn.dataset.lang === current;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
  });
})();

const PROMPT_EXPERT_SYSTEM = buildExpandSystem(getExpandLang());

const aiExpandBtn = $('#ai-expand-btn');
if (aiExpandBtn) {
  aiExpandBtn.addEventListener('click', async () => {
    const ta = $('.panel.active textarea[name="prompt"]');
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) return toast('请先输入一些提示词', 'error');
    const key = getDeepSeekKey();
    if (!key) return toast('请先在设置中配置 DeepSeek API Key', 'error');

    aiExpandBtn.classList.add('loading');
    const orig = aiExpandBtn.innerHTML;
    aiExpandBtn.innerHTML = `<svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 2a10 10 0 010 20 10 10 0 010-20" stroke="currentColor" stroke-width="2" stroke-dasharray="31 31" stroke-linecap="round"/></svg> 扩写中...`;

    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: buildExpandSystem(getExpandLang()) },
            { role: 'user', content: text }
          ],
          max_tokens: 500,
          temperature: 0.8
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const expanded = data.choices?.[0]?.message?.content?.trim();
      if (!expanded) throw new Error('AI 返回为空');
      ta.value = expanded;
      ta.dispatchEvent(new Event('input'));
      ta.focus();
      toast('提示词已扩写');
    } catch (e) {
      toast(`扩写失败: ${e.message}`, 'error');
    } finally {
      aiExpandBtn.classList.remove('loading');
      aiExpandBtn.innerHTML = orig;
    }
  });
}

// =======================
// 键盘快捷键
// =======================
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    const f = $('.panel.active form');
    if (f) { e.preventDefault(); f.requestSubmit(); }
  }
  if (e.key === 'Escape') {
    if (!$('#modal').classList.contains('hidden')) closeModal();
    if (!$('#settings-modal').classList.contains('hidden')) closeSettings();
  }
  if ((e.metaKey || e.ctrlKey) && /^[1-4]$/.test(e.key)) {
    e.preventDefault();
    const tabs = ['generate', 'edit', 'gallery', 'settings'];
    switchTab(tabs[parseInt(e.key, 10) - 1]);
  }
});

// =======================
// 初始化
// =======================
(async () => {
  updateStatusUI();
  const savedModel = localStorage.getItem(MODEL_PREF_KEY);
  if (savedModel) {
    $$('select[name="model"]').forEach(sel => {
      if ([...sel.options].some(o => o.value === savedModel)) sel.value = savedModel;
    });
  }
  if (!Client.hasUserKey) {
    setTimeout(() => openSettings(), 500);
  }
  updateGalleryBadge();
})();

// 提示词历史按钮
$('#prompt-history-btn')?.addEventListener('click', () => {
  const history = getPromptHistory();
  const popup = $('#prompt-history-popup');
  const list = $('#prompt-history-list');
  if (!popup || !list) return;
  if (popup.classList.contains('hidden')) {
    list.innerHTML = history.length === 0
      ? '<div class="prompt-empty">暂无历史记录</div>'
      : history.slice(0, 15).map(h => `
        <div class="prompt-card" data-text="${escapeHtml(h.text)}">
          <div class="prompt-card-body">
            <div class="prompt-card-text">${escapeHtml(h.text.slice(0, 100))}</div>
          </div>
        </div>
      `).join('');
    list.querySelectorAll('.prompt-card').forEach(card => {
      card.addEventListener('click', () => {
        const ta = $('.panel.active textarea[name="prompt"]');
        if (ta) { ta.value = card.dataset.text; ta.dispatchEvent(new Event('input')); ta.focus(); }
        popup.classList.add('hidden');
      });
    });
    popup.classList.remove('hidden');
  } else {
    popup.classList.add('hidden');
  }
});
document.addEventListener('click', e => {
  const popup = $('#prompt-history-popup');
  if (popup && !popup.contains(e.target) && !e.target.closest('#prompt-history-btn')) {
    popup.classList.add('hidden');
  }
});

// =======================
// 提示词灵感库
// =======================
(async function initPromptLibrary() {
  const drawer = $('#prompt-drawer');
  const listEl = $('#prompt-list');
  const catEl = $('#prompt-categories');
  const btns = $$('#prompt-lib-btn');
  let prompts = [], categories = [];
  let activeCategory = 'all';

  try {
    const res = await fetch('prompts.json');
    const data = await res.json();
    categories = [{ id: 'all', name: '全部', icon: '✨' }, ...data.categories];
    prompts = data.prompts;
    renderCategories();
    renderPrompts();
  } catch (e) { console.warn('提示词库加载失败', e); }

  function renderCategories() {
    catEl.innerHTML = categories.map(c =>
      `<button class="prompt-cat-pill${c.id === activeCategory ? ' active' : ''}" data-cat="${c.id}">${c.icon || ''} ${c.name}</button>`
    ).join('');
    catEl.querySelectorAll('.prompt-cat-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        activeCategory = btn.dataset.cat;
        catEl.querySelectorAll('.prompt-cat-pill').forEach(b => b.classList.toggle('active', b.dataset.cat === activeCategory));
        renderPrompts();
      });
    });
  }

  function renderPrompts() {
    const filtered = activeCategory === 'all' ? prompts : prompts.filter(p => p.category === activeCategory);
    if (!filtered.length) {
      listEl.innerHTML = '<div class="prompt-empty">暂无提示词</div>';
      return;
    }
    listEl.innerHTML = filtered.map(p =>
      `<div class="prompt-card" data-text="${p.text.replace(/"/g, '&quot;')}">
        <div class="prompt-card-body">
          <div class="prompt-card-title">${p.title}</div>
          <div class="prompt-card-text">${p.text}</div>
        </div>
        <button class="prompt-card-use">使用</button>
      </div>`
    ).join('');
    listEl.querySelectorAll('.prompt-card').forEach(card => {
      const useBtn = card.querySelector('.prompt-card-use');
      const handler = () => {
        const text = card.dataset.text;
        const ta = $('.panel.active textarea[name="prompt"]');
        if (!ta) return;
        const v = ta.value.trim();
        ta.value = v ? `${v}, ${text}` : text;
        ta.dispatchEvent(new Event('input'));
        drawer.classList.add('hidden');
        ta.focus();
      };
      useBtn.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
      card.addEventListener('click', handler);
    });
  }

  function openDrawer() { drawer.classList.remove('hidden'); }
  function closeDrawer() { drawer.classList.add('hidden'); }

  btns.forEach(b => b.addEventListener('click', openDrawer));
  $('#prompt-drawer-close').addEventListener('click', closeDrawer);
  $('#prompt-drawer .modal-bg').addEventListener('click', closeDrawer);
})();

// =======================
// 随机提示词
// =======================
(async function initRandomPrompt() {
  let promptData = null;
  try {
    const res = await fetch('prompts.json');
    promptData = await res.json();
  } catch (e) { console.warn('提示词库加载失败', e); }

  function generateRandomPrompt() {
    if (!promptData || !promptData.prompts.length) return '';
    const count = 1 + Math.floor(Math.random() * 2);
    const shuffled = [...promptData.prompts].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, count);
    const styleTags = ['电影感', '赛博朋克', '水彩', '日漫', '油画', '3D渲染', '像素风', '吉卜力', '水墨', '极简', '高清'];
    const tagCount = 1 + Math.floor(Math.random() * 2);
    const selectedTags = [...styleTags].sort(() => 0.5 - Math.random()).slice(0, tagCount);
    return selected.map(p => p.text).join('，') + '，' + selectedTags.join('，');
  }

  $('#random-prompt-btn')?.addEventListener('click', () => {
    const ta = $('.panel.active textarea[name="prompt"]');
    if (!ta) return;
    const text = generateRandomPrompt();
    if (!text) return toast('灵感库加载失败', 'error');
    ta.value = text;
    ta.dispatchEvent(new Event('input'));
    toast('已生成随机提示词');
  });
})();

// =======================
// 版本更新检查
// =======================
const APP_VERSION = '2.0.9';
const UPDATE_CHECK_KEY = 'last_update_check';
const UPDATE_DISMISS_KEY = 'dismissed_update_version';

function parseVersion(v) {
  const m = v.replace(/^v/, '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}
function isNewer(remote, local) {
  const r = parseVersion(remote), l = parseVersion(local);
  for (let i = 0; i < 3; i++) {
    if (r[i] > l[i]) return true;
    if (r[i] < l[i]) return false;
  }
  return false;
}

async function checkUpdate(force = false) {
  try {
    if (!force) {
      const lastCheck = parseInt(localStorage.getItem(UPDATE_CHECK_KEY) || '0', 10);
      const now = Date.now();
      if (now - lastCheck < 24 * 60 * 60 * 1000) return 'cached';
    }
    localStorage.setItem(UPDATE_CHECK_KEY, String(Date.now()));

    const res = await fetch('https://api.github.com/repos/Cunninger/MyImage/releases/latest', { cache: 'no-store' });
    if (!res.ok) return 'error';
    const data = await res.json();
    const latest = data.tag_name || '';
    const url = data.html_url || 'https://github.com/Cunninger/MyImage/releases';

    if (!latest || !isNewer(latest, APP_VERSION)) {
      updateAboutStatus(`✅ 当前已是最新版本 v${APP_VERSION}`);
      return 'latest';
    }

    const dismissed = localStorage.getItem(UPDATE_DISMISS_KEY);
    if (dismissed !== latest) {
      showUpdateBanner(latest, url);
    }
    updateAboutStatus(`🎉 发现新版本 ${latest}，<a href="${url}" target="_blank" rel="noopener">去下载</a>`);
    return 'new';
  } catch (e) {
    updateAboutStatus('检查失败，请稍后重试');
    return 'error';
  }
}

function updateAboutStatus(html) {
  const el = $('#update-status');
  if (el) el.innerHTML = html;
}

function showUpdateBanner(version, url) {
  if ($('#update-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.innerHTML = `
    <div class="update-banner-inner">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      <span>发现新版本 <strong>${version}</strong>，建议更新以获得最佳体验</span>
      <a href="${url}" target="_blank" rel="noopener" class="update-link">去更新</a>
      <button type="button" class="update-dismiss" aria-label="忽略此版本">✕</button>
    </div>
  `;
  document.body.appendChild(banner);
  banner.querySelector('.update-dismiss').addEventListener('click', () => {
    localStorage.setItem(UPDATE_DISMISS_KEY, version);
    banner.remove();
  });
}

$('#check-update-btn')?.addEventListener('click', async () => {
  updateAboutStatus('检查中...');
  await checkUpdate(true);
});

// 启动时检查更新（延迟 3 秒，避免阻塞首屏）
setTimeout(() => checkUpdate(false), 3000);
