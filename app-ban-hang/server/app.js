import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { authenticate, requireUser, hashPassword, checkPassword, createSession } from './auth.js';
import { HttpError, bad, str } from './util.js';
import catalogRoutes from './routes/catalog.js';
import peopleRoutes from './routes/people.js';
import salesRoutes from './routes/sales.js';
import adminRoutes, { getSettings } from './routes/admin.js';

export function createApp(db, { dataDir, webDir }) {
  const imagesDir = path.join(dataDir, 'images');
  const backupDir = path.join(dataDir, 'backups');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));
  app.use(authenticate(db));

  const api = express.Router();

  // ---------- Đăng nhập ----------
  const needSetup = () => !db.prepare('SELECT 1 FROM users LIMIT 1').get();

  api.get('/status', (req, res) => {
    const s = getSettings(db);
    res.json({ needSetup: needSetup(), user: req.user ?? null, shop_name: s.shop_name });
  });

  // Lần đầu chạy: tạo tài khoản chủ cửa hàng.
  api.post('/setup', (req, res) => {
    if (!needSetup()) throw bad('Đã cài đặt rồi');
    const username = str(req.body.username, 50).toLowerCase();
    if (!/^[a-z0-9_.]{2,}$/.test(username)) throw bad('Tên đăng nhập chỉ gồm chữ không dấu và số, ít nhất 2 ký tự');
    if (String(req.body.password ?? '').length < 4) throw bad('Mật khẩu ít nhất 4 ký tự');
    const { lastInsertRowid } = db.prepare("INSERT INTO users (username, name, pass_hash, role) VALUES (?, ?, ?, 'owner')")
      .run(username, str(req.body.name, 100) || 'Chủ cửa hàng', hashPassword(req.body.password));
    if (str(req.body.shop_name)) db.prepare("UPDATE settings SET value = ? WHERE key = 'shop_name'").run(str(req.body.shop_name, 200));
    res.json({ token: createSession(db, Number(lastInsertRowid)) });
  });

  api.post('/login', (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(str(req.body.username, 50).toLowerCase());
    if (!u || !checkPassword(req.body.password ?? '', u.pass_hash)) throw bad('Sai tên đăng nhập hoặc mật khẩu');
    res.json({ token: createSession(db, u.id) });
  });

  api.post('/logout', (req, res) => {
    if (req.token) db.prepare('DELETE FROM sessions WHERE token = ?').run(String(req.token));
    res.json({ ok: true });
  });

  api.use(requireUser);

  api.put('/me/password', (req, res) => {
    const u = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(req.user.id);
    if (!checkPassword(req.body.old_password ?? '', u.pass_hash)) throw bad('Mật khẩu cũ không đúng');
    if (String(req.body.password ?? '').length < 4) throw bad('Mật khẩu mới ít nhất 4 ký tự');
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(req.body.password), req.user.id);
    res.json({ ok: true });
  });

  api.use(catalogRoutes(db, { imagesDir }));
  api.use(peopleRoutes(db));
  api.use(salesRoutes(db));
  api.use(adminRoutes(db, { backupDir }));

  api.use((_req, _res, next) => next(new HttpError(404, 'Không có chức năng này')));

  app.use('/api', api);
  app.use('/images', express.static(imagesDir, { maxAge: '30d', immutable: true }));

  if (webDir && fs.existsSync(webDir)) {
    app.use(express.static(webDir, { index: false, maxAge: '1h' }));
    // Ứng dụng một trang: mọi đường dẫn khác trả về index.html
    app.get(/.*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn' });
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ: ' + err.message });
  });

  return app;
}
