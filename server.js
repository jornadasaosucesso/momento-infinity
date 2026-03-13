// server.js — MOMENTO∞
// FIREBASE: ganchos comentados prontos para ativar

import 'dotenv/config';
import express             from 'express';
import cors                from 'cors';
import path                from 'path';
import crypto              from 'crypto';
import fs                  from 'fs';
import { createServer }    from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath }   from 'url';
import multer              from 'multer';

// FIREBASE — descomente quando quiser ativar gravação
// import { db, storage } from './config/firebase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const isDev      = process.env.NODE_ENV !== 'production';

const TMP_DIR = path.join(__dirname, 'tmp_videos');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

setInterval(() => {
  const agora = Date.now();
  fs.readdirSync(TMP_DIR).forEach(f => {
    const fp  = path.join(TMP_DIR, f);
    const age = agora - fs.statSync(fp).mtimeMs;
    if (age > 2 * 60 * 60 * 1000) fs.unlinkSync(fp);
  });
}, 30 * 60 * 1000);

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB máx
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Apenas vídeos são aceitos.'));
  }
});

const app    = express();
const server = createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const csp = isDev
    ? "default-src * 'unsafe-inline' 'unsafe-eval'; img-src * data: blob:; media-src * blob: data:; font-src * data:;"
    : [
        "default-src 'self';",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net;",
        "font-src 'self' https://fonts.gstatic.com data:;",
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;",
        "img-src 'self' data: blob:;",
        "media-src 'self' blob: data:;",
        "connect-src 'self' ws: wss:;",
      ].join(' ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/tmp_videos', express.static(TMP_DIR, {
  setHeaders: (res, filePath) => {

    if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    }

    if (filePath.endsWith('.webm')) {
      res.setHeader('Content-Type', 'video/webm');
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

  }
}));

const sessoes = new Map();

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.tipo === 'celular_conectado') {
      const sessao = sessoes.get(msg.sessaoId);
      if (!sessao) { ws.send(JSON.stringify({ tipo: 'erro', mensagem: 'Sessão não encontrada.' })); return; }
      ws.sessaoId = msg.sessaoId;
      ws.papel    = 'celular';
      sessao.celulares.add(ws);
      ws.send(JSON.stringify({ tipo: 'ok', mensagem: 'Conectado à sessão.' }));
      console.log(`📱 Celular conectado → sessão ${msg.sessaoId}`);
      return;
    }

    if (msg.tipo === 'tv_conectada') {
      const sessao = sessoes.get(msg.sessaoId);
      if (!sessao) { ws.send(JSON.stringify({ tipo: 'erro', mensagem: 'Sessão não encontrada.' })); return; }
      ws.sessaoId  = msg.sessaoId;
      ws.papel     = 'tv';
      sessao.tvSocket = ws;
      ws.send(JSON.stringify({ tipo: 'ok', nomeEvento: sessao.nomeEvento }));
      console.log(`📺 TV conectada → sessão ${msg.sessaoId}`);
      return;
    }

    if (msg.tipo === 'foto') {
      const sessao = sessoes.get(ws.sessaoId);
      if (!sessao) return;
      const tv = sessao.tvSocket;
      if (tv && tv.readyState === tv.OPEN) {
        tv.send(JSON.stringify({ tipo: 'foto', dataUrl: msg.dataUrl, fotoId: msg.fotoId, timestamp: Date.now() }));
        console.log(`📸 Foto ${msg.fotoId} → TV (sessão ${ws.sessaoId})`);
      }
      ws.send(JSON.stringify({ tipo: 'foto_ok', fotoId: msg.fotoId }));

      // const ref    = storage.bucket().file(`Eventos/${ws.sessaoId}/${msg.fotoId}.webp`);
      // const buffer = Buffer.from(msg.dataUrl.split(',')[1], 'base64');
      // await ref.save(buffer, { contentType: 'image/webp' });
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.sessaoId) return;
    const sessao = sessoes.get(ws.sessaoId);
    if (!sessao) return;
    if (ws.papel === 'celular') sessao.celulares.delete(ws);
    if (ws.papel === 'tv')     sessao.tvSocket = null;
  });
});

// ─── UPLOAD DE VÍDEO (HTTP POST) 
app.post('/api/video/upload', upload.single('video'), (req, res) => {
  try {
    const sessaoId = (req.body.sessaoId || '').toUpperCase();
    const videoId  = req.body.videoId || ('vid_' + Date.now());
    const sessao   = sessoes.get(sessaoId);

    if (!sessao) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, error: 'Sessão não encontrada.' });
    }

    if (!req.file) return res.status(400).json({ success: false, error: 'Nenhum arquivo recebido.' });

    const ext = path.extname(req.file.originalname) || '.mp4';
    const newName = `${sessaoId}_${videoId}.${ext}`;
    const newPath = path.join(TMP_DIR, newName);
    fs.renameSync(req.file.path, newPath);

    const baseUrl  = process.env.BASE_URL || `https://${req.headers.host}`;
    const videoUrl = `${baseUrl}/tmp_videos/${newName}`;

    console.log(`🎬 Vídeo ${videoId} salvo → notificando TV (sessão ${sessaoId})`);

    const tv = sessao.tvSocket;
    if (tv && tv.readyState === tv.OPEN) {
      tv.send(JSON.stringify({ tipo: 'video', videoUrl, videoId, timestamp: Date.now() }));
    }

    // const buffer = fs.readFileSync(newPath);
    // const ref    = storage.bucket().file(`Eventos/${sessaoId}/${videoId}.${ext}`);
    // await ref.save(buffer, { contentType: req.file.mimetype });
    // const [url]  = await ref.getSignedUrl({ action: 'read', expires: '2099-01-01' });
    // await db.ref(`Eventos/${sessaoId}/videos/${videoId}`).set(url);
    // fs.unlinkSync(newPath); // apaga temp se for pro firebase

    res.json({ success: true, videoId, videoUrl });

  } catch (err) {
    console.error('Erro no upload:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sessao/nova', async (req, res) => {
  try {
    const nomeEvento = (req.body.nomeEvento || 'Evento').trim().slice(0, 80);
    const sessaoId   = crypto.randomBytes(3).toString('hex').toUpperCase();
    const criadaEm   = new Date().toISOString();

    sessoes.set(sessaoId, { nomeEvento, criadaEm, ativa: true, tvSocket: null, celulares: new Set() });

    // await db.ref(`Eventos/${sessaoId}/meta`).set({ nomeEvento, criadaEm, ativa: true });

    const baseUrl        = process.env.BASE_URL || `https://${req.headers.host}`;
    const urlCamera      = `${baseUrl}/camera_evento.html?sessao=${sessaoId}&evento=${encodeURIComponent(nomeEvento)}`;
    const urlTv          = `${baseUrl}/tv.html?sessao=${sessaoId}`;
    const urlCameraVideo = `${baseUrl}/camera_video.html?sessao=${sessaoId}`;
    const urlTvVideo     = `${baseUrl}/tv_video.html?sessao=${sessaoId}`;

    console.log(`🎉 [SESSÃO CRIADA] ${sessaoId} — "${nomeEvento}"`);
    res.json({ success: true, sessaoId, nomeEvento, criadaEm,
      urls: { camera: urlCamera, tv: urlTv, camera_video: urlCameraVideo, tv_video: urlTvVideo }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/sessao/:id', async (req, res) => {
  const sessaoId = req.params.id.toUpperCase();
  if (!sessoes.has(sessaoId)) return res.status(404).json({ success: false, error: 'Sessão não encontrada.' });

  const sessao = sessoes.get(sessaoId);
  const msgFim = JSON.stringify({ tipo: 'sessao_encerrada' });
  if (sessao.tvSocket?.readyState === sessao.tvSocket?.OPEN) sessao.tvSocket.send(msgFim);
  sessao.celulares.forEach(ws => { if (ws.readyState === ws.OPEN) ws.send(msgFim); });
  sessoes.delete(sessaoId);

  console.log(`🔒 [SESSÃO ENCERRADA] ${sessaoId}`);
  res.json({ success: true, sessaoId, mensagem: 'Sessão encerrada.' });
});

app.get('/api/sessao/:id', (req, res) => {
  const sessaoId = req.params.id.toUpperCase();
  const sessao   = sessoes.get(sessaoId);
  if (!sessao) return res.status(404).json({ success: false, ativa: false, error: 'Sessão não encontrada.' });
  res.json({ success: true, sessaoId, nomeEvento: sessao.nomeEvento, criadaEm: sessao.criadaEm, ativa: true, tvOnline: sessao.tvSocket !== null, celulares: sessao.celulares.size });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servico: 'Momento∞', timestamp: new Date().toISOString(), sessoes_ativas: sessoes.size });
});

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n✨ ─────────────────────────────────────────');
  console.log(`   MOMENTO∞ — SERVIDOR ATIVO`);
  console.log(`   PORTA    : ${PORT}`);
  console.log(`   MODO     : ${isDev ? 'DESENVOLVIMENTO' : 'PRODUÇÃO'}`);
  console.log(`   FIREBASE : desativado (ganchos prontos 🔥)`);
  console.log('✨ ─────────────────────────────────────────\n');
});