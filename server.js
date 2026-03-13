// ─────────────────────────────────────────────────────────────────────────────
// server.js — MOMENTO∞
// Transporte: WebSocket puro — sem Firebase por enquanto
// Quando quiser ativar gravação: descomente os blocos marcados com 🔥 FIREBASE
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import express             from 'express';
import cors                from 'cors';
import path                from 'path';
import crypto              from 'crypto';
import { createServer }    from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath }   from 'url';

// 🔥 FIREBASE — descomente quando quiser ativar gravação
// import { db, storage } from './config/firebase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const isDev      = process.env.NODE_ENV !== 'production';

// ─── APP ─────────────────────────────────────────────────────────────────────
const app    = express();
const server = createServer(app);

app.use(cors());
app.use(express.json({ limit: '150mb' }));           // ← suporta vídeos base64
app.use(express.urlencoded({ extended: true, limit: '150mb' }));

// ─── CSP ─────────────────────────────────────────────────────────────────────
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

// ─── ESTÁTICOS ───────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── MEMÓRIA DE SESSÕES ───────────────────────────────────────────────────────
const sessoes = new Map();

// ─── WEBSOCKET SERVER ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, maxPayload: 150 * 1024 * 1024 }); // 150MB

wss.on('connection', (ws) => {

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── CELULAR se registra na sessão ────────────────────────────────────────
    if (msg.tipo === 'celular_conectado') {
      const sessao = sessoes.get(msg.sessaoId);
      if (!sessao) {
        ws.send(JSON.stringify({ tipo: 'erro', mensagem: 'Sessão não encontrada.' }));
        return;
      }
      ws.sessaoId = msg.sessaoId;
      ws.papel    = 'celular';
      sessao.celulares.add(ws);
      ws.send(JSON.stringify({ tipo: 'ok', mensagem: 'Conectado à sessão.' }));
      console.log(`📱 Celular conectado → sessão ${msg.sessaoId}`);
      return;
    }

    // ── TV se registra como receptor ─────────────────────────────────────────
    if (msg.tipo === 'tv_conectada') {
      const sessao = sessoes.get(msg.sessaoId);
      if (!sessao) {
        ws.send(JSON.stringify({ tipo: 'erro', mensagem: 'Sessão não encontrada.' }));
        return;
      }
      ws.sessaoId  = msg.sessaoId;
      ws.papel     = 'tv';
      sessao.tvSocket = ws;
      ws.send(JSON.stringify({ tipo: 'ok', nomeEvento: sessao.nomeEvento }));
      console.log(`📺 TV conectada → sessão ${msg.sessaoId}`);
      return;
    }

    // ── CELULAR envia FOTO → servidor repassa para TV ─────────────────────────
    if (msg.tipo === 'foto') {
      const sessao = sessoes.get(ws.sessaoId);
      if (!sessao) return;

      const tv = sessao.tvSocket;
      if (tv && tv.readyState === tv.OPEN) {
        tv.send(JSON.stringify({
          tipo:      'foto',
          dataUrl:   msg.dataUrl,
          fotoId:    msg.fotoId,
          timestamp: Date.now(),
        }));
        console.log(`📸 Foto ${msg.fotoId} → TV (sessão ${ws.sessaoId})`);
      }

      ws.send(JSON.stringify({ tipo: 'foto_ok', fotoId: msg.fotoId }));

      // 🔥 FIREBASE — descomente para gravar a foto no Storage
      // const filePath = `Eventos/${ws.sessaoId}/${msg.fotoId}.webp`;
      // const ref      = storage.bucket().file(filePath);
      // const buffer   = Buffer.from(msg.dataUrl.split(',')[1], 'base64');
      // await ref.save(buffer, { contentType: 'image/webp' });
      // const [url]    = await ref.getSignedUrl({ action: 'read', expires: '2099-01-01' });
      // await db.ref(`Eventos/${ws.sessaoId}/fotos/${msg.fotoId}`).set(url);

      return;
    }

    // ── CELULAR envia VÍDEO → servidor repassa para TV ────────────────────────
    if (msg.tipo === 'video') {
      const sessao = sessoes.get(ws.sessaoId);
      if (!sessao) return;

      const tv = sessao.tvSocket;
      if (tv && tv.readyState === tv.OPEN) {
        tv.send(JSON.stringify({
          tipo:      'video',
          dataUrl:   msg.dataUrl,
          videoId:   msg.videoId,
          timestamp: Date.now(),
        }));
        console.log(`🎬 Vídeo ${msg.videoId} → TV (sessão ${ws.sessaoId})`);
      }

      ws.send(JSON.stringify({ tipo: 'video_ok', videoId: msg.videoId }));

      // 🔥 FIREBASE — descomente para gravar o vídeo no Storage
      // const filePath = `Eventos/${ws.sessaoId}/${msg.videoId}.webm`;
      // const ref      = storage.bucket().file(filePath);
      // const buffer   = Buffer.from(msg.dataUrl.split(',')[1], 'base64');
      // await ref.save(buffer, { contentType: 'video/webm' });
      // const [url]    = await ref.getSignedUrl({ action: 'read', expires: '2099-01-01' });
      // await db.ref(`Eventos/${ws.sessaoId}/videos/${msg.videoId}`).set(url);

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

// ─── ROTAS HTTP ───────────────────────────────────────────────────────────────

// POST /api/sessao/nova
app.post('/api/sessao/nova', async (req, res) => {
  try {
    const nomeEvento = (req.body.nomeEvento || 'Evento').trim().slice(0, 80);
    const sessaoId   = crypto.randomBytes(3).toString('hex').toUpperCase();
    const criadaEm   = new Date().toISOString();

    sessoes.set(sessaoId, {
      nomeEvento,
      criadaEm,
      ativa:     true,
      tvSocket:  null,
      celulares: new Set(),
    });

    // 🔥 FIREBASE — descomente para persistir sessão no DB
    // await db.ref(`Eventos/${sessaoId}/meta`).set({ nomeEvento, criadaEm, ativa: true });

    const baseUrl       = process.env.BASE_URL || `https://${req.headers.host}`;
    const urlCamera     = `${baseUrl}/camera_evento.html?sessao=${sessaoId}&evento=${encodeURIComponent(nomeEvento)}`;
    const urlTv         = `${baseUrl}/tv.html?sessao=${sessaoId}`;
    const urlCameraVideo= `${baseUrl}/camera_video.html?sessao=${sessaoId}`;
    const urlTvVideo    = `${baseUrl}/tv_video.html?sessao=${sessaoId}`;

    console.log(`🎉 [SESSÃO CRIADA] ${sessaoId} — "${nomeEvento}"`);
    res.json({
      success: true, sessaoId, nomeEvento, criadaEm,
      urls: {
        camera:       urlCamera,
        tv:           urlTv,
        camera_video: urlCameraVideo,
        tv_video:     urlTvVideo,
      }
    });

  } catch (err) {
    console.error('Erro ao criar sessão:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/sessao/:id
app.delete('/api/sessao/:id', async (req, res) => {
  const sessaoId = req.params.id.toUpperCase();

  if (!sessoes.has(sessaoId)) {
    return res.status(404).json({ success: false, error: 'Sessão não encontrada.' });
  }

  const sessao = sessoes.get(sessaoId);
  const msgFim = JSON.stringify({ tipo: 'sessao_encerrada' });

  if (sessao.tvSocket?.readyState === sessao.tvSocket?.OPEN) sessao.tvSocket.send(msgFim);
  sessao.celulares.forEach(ws => { if (ws.readyState === ws.OPEN) ws.send(msgFim); });
  sessoes.delete(sessaoId);

  // 🔥 FIREBASE — descomente para apagar do DB e Storage
  // await db.ref(`Eventos/${sessaoId}`).remove();
  // const [files] = await storage.bucket().getFiles({ prefix: `Eventos/${sessaoId}/` });
  // await Promise.all(files.map(f => f.delete()));

  console.log(`🔒 [SESSÃO ENCERRADA] ${sessaoId}`);
  res.json({ success: true, sessaoId, mensagem: 'Sessão encerrada.' });
});

// GET /api/sessao/:id
app.get('/api/sessao/:id', (req, res) => {
  const sessaoId = req.params.id.toUpperCase();
  const sessao   = sessoes.get(sessaoId);

  if (!sessao) {
    return res.status(404).json({ success: false, ativa: false, error: 'Sessão não encontrada.' });
  }

  res.json({
    success:    true,
    sessaoId,
    nomeEvento: sessao.nomeEvento,
    criadaEm:   sessao.criadaEm,
    ativa:      true,
    tvOnline:   sessao.tvSocket !== null,
    celulares:  sessao.celulares.size,
  });
});

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', servico: 'Momento∞', timestamp: new Date().toISOString(), sessoes_ativas: sessoes.size });
});

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n✨ ─────────────────────────────────────────');
  console.log(`   MOMENTO∞ — SERVIDOR ATIVO`);
  console.log(`   PORTA    : ${PORT}`);
  console.log(`   MODO     : ${isDev ? 'DESENVOLVIMENTO' : 'PRODUÇÃO'}`);
  console.log(`   FIREBASE : desativado (ganchos prontos 🔥)`);
  console.log('✨ ─────────────────────────────────────────\n');
});
