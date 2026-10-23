// Khởi động máy chủ.
// Cấu hình qua biến môi trường, hoặc /data/options.json khi chạy dạng add-on Home Assistant.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { backup } from './routes/admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function readOptions(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const dataDir = process.env.DATA_DIR ?? path.join(here, '..', 'data');
const options = readOptions(path.join(dataDir, 'options.json'));
const port = Number(process.env.PORT ?? 8099);
const ssl = options.ssl ?? process.env.SSL === '1';
const certfile = options.certfile ? path.join('/ssl', options.certfile) : process.env.SSL_CERT;
const keyfile = options.keyfile ? path.join('/ssl', options.keyfile) : process.env.SSL_KEY;

const db = openDb(path.join(dataDir, 'banhang.db'));
const app = createApp(db, { dataDir, webDir: path.join(here, '..', 'web', 'dist') });

const server = ssl
  ? https.createServer({ cert: fs.readFileSync(certfile), key: fs.readFileSync(keyfile) }, app)
  : http.createServer(app);

server.listen(port, () => {
  console.log(`App bán hàng đang chạy ở ${ssl ? 'https' : 'http'}://0.0.0.0:${port} (dữ liệu: ${dataDir})`);
});

// Sao lưu tự động: lúc khởi động (nếu hôm nay chưa có) và mỗi ngày lúc 23:30.
const backupDir = path.join(dataDir, 'backups');
const keep = Number(options.backup_keep_days ?? process.env.BACKUP_KEEP ?? 30);
function runBackup() {
  try {
    console.log('Đã sao lưu:', backup(db, backupDir, keep));
  } catch (err) {
    console.error('Sao lưu lỗi:', err);
  }
}
const today = () => new Date().toLocaleDateString('sv');
if (!(fs.existsSync(backupDir) && fs.readdirSync(backupDir).some((f) => f.startsWith(`banhang-${today()}`)))) runBackup();
let lastNightly = '';
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 23 && now.getMinutes() >= 30 && lastNightly !== today()) {
    lastNightly = today();
    runBackup();
  }
}, 5 * 60 * 1000);

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
