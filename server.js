require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PEARAPI_KEY = process.env.PEARAPI_KEY || '';
const PEARAPI_BASE = process.env.PEARAPI_BASE || 'https://api.pearapi.ai';

const ROOT = __dirname;
const IMAGES_DIR = path.join(ROOT, 'images');
const DATA_DIR = path.join(ROOT, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

for (const d of [IMAGES_DIR, DATA_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '[]', 'utf8');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/images', express.static(IMAGES_DIR));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

async function readHistory() {
  try {
    const txt = await fsp.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(txt);
  } catch {
    return [];
  }
}

async function writeHistory(list) {
  await fsp.writeFile(HISTORY_FILE, JSON.stringify(list, null, 2), 'utf8');
}

async function appendHistory(record) {
  const list = await readHistory();
  list.unshift(record);
  await writeHistory(list.slice(0, 1000));
}

function extFromContentType(ct) {
  if (!ct) return '.png';
  if (ct.includes('png')) return '.png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  return '.png';
}

async function downloadAndSave(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载图片失败: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = extFromContentType(res.headers.get('content-type'));
  const filename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  await fsp.writeFile(path.join(IMAGES_DIR, filename), buf);
  return filename;
}

async function saveB64(b64) {
  const buf = Buffer.from(b64, 'base64');
  const filename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;
  await fsp.writeFile(path.join(IMAGES_DIR, filename), buf);
  return filename;
}

async function persistResults(apiData, meta) {
  const items = Array.isArray(apiData?.data) ? apiData.data : [];
  const saved = [];
  for (const item of items) {
    try {
      let filename;
      if (item.url) {
        filename = await downloadAndSave(item.url);
      } else if (item.b64_json) {
        filename = await saveB64(item.b64_json);
      } else {
        continue;
      }
      const record = {
        id: filename.replace(/\.[^.]+$/, ''),
        filename,
        path: `/images/${filename}`,
        createdAt: Date.now(),
        ...meta,
      };
      await appendHistory(record);
      saved.push(record);
    } catch (e) {
      console.error('保存失败:', e.message);
    }
  }
  return saved;
}

function pearHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${PEARAPI_KEY}`,
    ...extra,
  };
}

async function callPear(endpoint, body) {
  const res = await fetch(`${PEARAPI_BASE}${endpoint}`, {
    method: 'POST',
    headers: pearHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error?.message || data?.message || `API ${res.status}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

app.post('/api/generate', upload.array('files', 4), async (req, res) => {
  if (!PEARAPI_KEY) return res.status(500).json({ error: '服务器未配置 PEARAPI_KEY' });
  try {
    const { model, prompt, aspect_ratio, size, n } = req.body || {};
    if (!model || !prompt) return res.status(400).json({ error: 'model 与 prompt 必填' });

    const imageInputs = [];
    if (Array.isArray(req.files)) {
      for (const f of req.files) {
        const dataUrl = `data:${f.mimetype};base64,${f.buffer.toString('base64')}`;
        imageInputs.push(dataUrl);
      }
    }
    const remoteUrls = req.body['imageUrls'];
    if (remoteUrls) {
      const arr = Array.isArray(remoteUrls) ? remoteUrls : String(remoteUrls).split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
      imageInputs.push(...arr);
    }

    const body = { model, prompt, response_format: 'url' };
    if (aspect_ratio) body.aspect_ratio = aspect_ratio;
    if (size) body.size = size;
    if (n) body.n = Math.min(4, Math.max(1, parseInt(n, 10) || 1));
    if (imageInputs.length === 1) body.image = imageInputs[0];
    else if (imageInputs.length > 1) body['images[]'] = imageInputs;

    const apiData = await callPear('/v1/images/generations', body);
    const saved = await persistResults(apiData, { model, prompt, type: 'generate', aspect_ratio: aspect_ratio || size });
    res.json({ ok: true, items: saved, raw: apiData });
  } catch (e) {
    console.error('generate 错误:', e);
    res.status(e.status || 500).json({ error: e.message, payload: e.payload });
  }
});

app.post('/api/edit', upload.array('files', 4), async (req, res) => {
  if (!PEARAPI_KEY) return res.status(500).json({ error: '服务器未配置 PEARAPI_KEY' });
  try {
    const { model, prompt, aspect_ratio, size, n } = req.body || {};
    if (!model || !prompt) return res.status(400).json({ error: 'model 与 prompt 必填' });

    const imageInputs = [];
    if (Array.isArray(req.files)) {
      for (const f of req.files) {
        const dataUrl = `data:${f.mimetype};base64,${f.buffer.toString('base64')}`;
        imageInputs.push(dataUrl);
      }
    }
    const remoteUrls = req.body['imageUrls'];
    if (remoteUrls) {
      const arr = Array.isArray(remoteUrls) ? remoteUrls : String(remoteUrls).split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
      imageInputs.push(...arr);
    }
    if (imageInputs.length === 0) return res.status(400).json({ error: '编辑接口至少需要一张参考图' });

    const body = { model, prompt, response_format: 'url' };
    if (aspect_ratio) body.aspect_ratio = aspect_ratio;
    if (size) body.size = size;
    if (n) body.n = Math.min(4, Math.max(1, parseInt(n, 10) || 1));
    if (imageInputs.length === 1) body.image = imageInputs[0];
    else body['images[]'] = imageInputs;

    const apiData = await callPear('/v1/images/edits', body);
    const saved = await persistResults(apiData, { model, prompt, type: 'edit', aspect_ratio: aspect_ratio || size });
    res.json({ ok: true, items: saved, raw: apiData });
  } catch (e) {
    console.error('edit 错误:', e);
    res.status(e.status || 500).json({ error: e.message, payload: e.payload });
  }
});

app.get('/api/history', async (req, res) => {
  const list = await readHistory();
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  res.json({ items: list.slice(0, limit) });
});

app.delete('/api/history/:id', async (req, res) => {
  const id = req.params.id;
  const list = await readHistory();
  const idx = list.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: '未找到' });
  const record = list[idx];
  list.splice(idx, 1);
  await writeHistory(list);
  try { await fsp.unlink(path.join(IMAGES_DIR, record.filename)); } catch {}
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  res.json({ hasKey: !!PEARAPI_KEY });
});

app.listen(PORT, () => {
  console.log(`\n✨ 画图网站已启动: http://localhost:${PORT}`);
  if (!PEARAPI_KEY) console.log('⚠️  尚未配置 PEARAPI_KEY，请复制 .env.example 为 .env 并填入 API Key');
});
