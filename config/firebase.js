// config/firebase.js
// ─────────────────────────────────────────────────────────────────────────────
// Inicialização do Firebase Admin para o Momento∞
// O arquivo de credenciais fica em config/firebase-key-momento.json
// ─────────────────────────────────────────────────────────────────────────────

import admin from 'firebase-admin';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Credenciais ficam SEMPRE dentro de /config — nunca na raiz
const KEY_PATH = path.join(__dirname, 'firebase-key-momento.json');

let serviceAccount;
try {
  serviceAccount = JSON.parse(await readFile(KEY_PATH, 'utf-8'));
} catch (err) {
  console.error('🚨 Não foi possível ler config/firebase-key-momento.json');
  console.error('   Verifique se o arquivo existe e tem permissão de leitura.');
  console.error('   Detalhe:', err.message);
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential:    admin.credential.cert(serviceAccount),
    databaseURL:   process.env.FIREBASE_DB_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
  console.log('🔥 Firebase Admin → Momento∞ conectado');
}

export const db      = admin.database();
export const storage = admin.storage();
export default admin;