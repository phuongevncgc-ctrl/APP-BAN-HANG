import crypto from 'node:crypto';
import { HttpError } from './util.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function checkPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

// Đặt lại mật khẩu mọi tài khoản chủ (dùng khi quên mật khẩu). Mỗi mật khẩu chỉ áp dụng một lần,
// để sau này chú đổi mật khẩu trong app rồi khởi động lại add-on thì không bị ghi đè.
export function resetOwnerPassword(db, password) {
  if (String(password).length < 12) throw new Error('Mật khẩu mới phải có ít nhất 12 ký tự');
  const mark = crypto.createHash('sha256').update(String(password)).digest('hex');
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'reset_applied' AND value = ?").get(mark)) return null;
  const owners = db.prepare("SELECT id, username FROM users WHERE role = 'owner'").all();
  for (const u of owners) {
    db.prepare('UPDATE users SET pass_hash = ?, active = 1 WHERE id = ?').run(hashPassword(password), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('reset_applied', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(mark);
  return owners.map((u) => u.username);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

// Gắn req.user nếu có token hợp lệ.
export function authenticate(db) {
  const find = db.prepare(`
    SELECT u.id, u.username, u.name, u.role FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND u.active = 1`);
  return (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    req.user = token ? find.get(String(token)) : undefined;
    req.token = token;
    next();
  };
}

export function requireUser(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Vui lòng đăng nhập');
  next();
}

export function requireOwner(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Vui lòng đăng nhập');
  if (req.user.role !== 'owner') throw new HttpError(403, 'Chỉ chủ cửa hàng được làm việc này');
  next();
}

export const isOwner = (req) => req.user?.role === 'owner';
