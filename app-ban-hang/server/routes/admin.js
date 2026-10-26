// Báo cáo, cài đặt, sao lưu.
import express, { Router } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../db.js';
import fs from 'node:fs';
import path from 'node:path';
import { requireOwner } from '../auth.js';
import { str, day, bad } from '../util.js';
import { readNotify, saveNotify, notifyServices, sendDaily } from '../notify.js';

const SETTING_KEYS = ['shop_name', 'shop_address', 'shop_phone', 'receipt_footer', 'receipt_width', 'bank_bin', 'bank_account', 'bank_holder', 'allow_negative_stock', 'print_preview'];

export function getSettings(db) {
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
}

export function report(db, from, to) {
  const sales = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(discount),0) AS discount,
      COALESCE(SUM(debt),0) AS debt
    FROM invoices WHERE status = 'done' AND date(created_at) BETWEEN ? AND ?`).get(from, to);
  const salesCost = db.prepare(`SELECT COALESCE(SUM(ii.qty * ii.cost),0) AS s FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id WHERE i.status = 'done' AND date(i.created_at) BETWEEN ? AND ?`).get(from, to).s;
  const returns = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM returns
    WHERE date(created_at) BETWEEN ? AND ?`).get(from, to);
  const returnsCost = db.prepare(`SELECT COALESCE(SUM(ri.qty * ri.cost),0) AS s FROM return_items ri
    JOIN returns r ON r.id = ri.return_id WHERE date(r.created_at) BETWEEN ? AND ?`).get(from, to).s;

  const revenue = sales.total - returns.total;
  const cost = Math.round(salesCost - returnsCost);

  const byDayRows = db.prepare(`
    SELECT d, SUM(sales) AS sales, SUM(returns) AS returns, SUM(cost) AS cost FROM (
      SELECT date(i.created_at) AS d, i.total AS sales, 0 AS returns,
        (SELECT COALESCE(SUM(qty * cost),0) FROM invoice_items WHERE invoice_id = i.id) AS cost
      FROM invoices i WHERE i.status = 'done' AND date(i.created_at) BETWEEN ? AND ?
      UNION ALL
      SELECT date(r.created_at), 0, r.total,
        -(SELECT COALESCE(SUM(qty * cost),0) FROM return_items WHERE return_id = r.id)
      FROM returns r WHERE date(r.created_at) BETWEEN ? AND ?
    ) GROUP BY d ORDER BY d`).all(from, to, from, to);
  const byDay = byDayRows.map((r) => ({
    day: r.d, sales: r.sales, returns: r.returns, revenue: r.sales - r.returns, profit: Math.round(r.sales - r.returns - r.cost),
  }));

  const topProducts = db.prepare(`SELECT ii.product_id, ii.name, p.unit, SUM((ii.qty - ii.returned_qty) * ii.factor) AS qty,
      SUM(ROUND(ii.total * (CAST(i.total AS REAL) / MAX(i.subtotal,1)) * (ii.qty - ii.returned_qty) / ii.qty)) AS revenue,
      SUM(ROUND((ii.total * (CAST(i.total AS REAL) / MAX(i.subtotal,1)) - ii.qty * ii.cost) * (ii.qty - ii.returned_qty) / ii.qty)) AS profit
    FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id LEFT JOIN products p ON p.id = ii.product_id
    WHERE i.status = 'done' AND date(i.created_at) BETWEEN ? AND ?
    GROUP BY ii.product_id HAVING qty > 0 ORDER BY revenue DESC LIMIT 20`).all(from, to);

  const methods = db.prepare(`SELECT method, kind, SUM(amount) AS amount FROM payments
    WHERE date(created_at) BETWEEN ? AND ? GROUP BY method, kind`).all(from, to);
  const cashflow = { cash: 0, transfer: 0, card: 0 };
  for (const m of methods) cashflow[m.method] += m.amount;
  // Phiếu thu chi trong sổ quỹ
  const entries = db.prepare(`SELECT kind, category, method, SUM(amount) AS amount FROM cash_entries
    WHERE date(created_at) BETWEEN ? AND ? GROUP BY kind, category, method`).all(from, to);
  for (const e of entries) cashflow[e.method] += e.kind === 'in' ? e.amount : -e.amount;
  const expenses = entries.filter((e) => e.category === 'expense').reduce((s, e) => s + e.amount, 0);
  const otherIncome = entries.filter((e) => e.category === 'other_in').reduce((s, e) => s + e.amount, 0);

  const byUser = db.prepare(`SELECT u.name, COUNT(*) AS count, SUM(i.total) AS total FROM invoices i
    LEFT JOIN users u ON u.id = i.user_id WHERE i.status = 'done' AND date(i.created_at) BETWEEN ? AND ?
    GROUP BY i.user_id ORDER BY total DESC`).all(from, to);

  // Doanh thu theo giờ trong ngày (gộp cả kỳ) để biết giờ nào đông khách
  const byHour = db.prepare(`SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS count, SUM(total) AS total
    FROM invoices WHERE status = 'done' AND date(created_at) BETWEEN ? AND ? GROUP BY hour ORDER BY hour`).all(from, to);

  const topCustomers = db.prepare(`SELECT c.id, c.name, c.debt, COUNT(*) AS count, SUM(i.total) AS total FROM invoices i
    JOIN customers c ON c.id = i.customer_id WHERE i.status = 'done' AND date(i.created_at) BETWEEN ? AND ?
    GROUP BY c.id ORDER BY total DESC LIMIT 10`).all(from, to);

  const byCategory = db.prepare(`SELECT COALESCE(cat.name, 'Chưa phân nhóm') AS name,
      SUM(ROUND(ii.total * (CAST(i.total AS REAL) / MAX(i.subtotal,1)) * (ii.qty - ii.returned_qty) / ii.qty)) AS revenue,
      SUM(ROUND((ii.total * (CAST(i.total AS REAL) / MAX(i.subtotal,1)) - ii.qty * ii.cost) * (ii.qty - ii.returned_qty) / ii.qty)) AS profit
    FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id LEFT JOIN products p ON p.id = ii.product_id
    LEFT JOIN categories cat ON cat.id = p.category_id
    WHERE i.status = 'done' AND date(i.created_at) BETWEEN ? AND ? AND ii.qty > 0
    GROUP BY cat.id ORDER BY revenue DESC LIMIT 15`).all(from, to);

  return {
    from, to,
    sales, returns, revenue, cost, profit: revenue - cost,
    byHour, topCustomers, byCategory,
    expenses, otherIncome, netProfit: revenue - cost - expenses + otherIncome,
    byDay, topProducts, cashflow, methods, byUser,
    customerDebt: db.prepare('SELECT COALESCE(SUM(debt),0) AS s FROM customers WHERE active = 1').get().s,
    supplierDebt: db.prepare('SELECT COALESCE(SUM(debt),0) AS s FROM suppliers WHERE active = 1').get().s,
    stockValue: Math.round(db.prepare('SELECT COALESCE(SUM(MAX(stock,0) * cost),0) AS s FROM products WHERE active = 1 AND track_stock = 1').get().s),
    lowStock: db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND track_stock = 1 AND stock <= min_stock').get().n,
  };
}

const shiftDay = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

// Kỳ trước cùng độ dài (hôm nay so với hôm qua, 7 ngày so với 7 ngày trước) để so sánh tăng giảm
export function previousPeriod(db, from, to) {
  const len = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const pFrom = shiftDay(from, -len);
  const pTo = shiftDay(from, -1);
  const s = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM invoices
    WHERE status = 'done' AND date(created_at) BETWEEN ? AND ?`).get(pFrom, pTo);
  const cost = db.prepare(`SELECT COALESCE(SUM(ii.qty * ii.cost),0) AS s FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id WHERE i.status = 'done' AND date(i.created_at) BETWEEN ? AND ?`).get(pFrom, pTo).s;
  const ret = db.prepare(`SELECT COALESCE(SUM(r.total),0) AS total,
      COALESCE((SELECT SUM(ri.qty * ri.cost) FROM return_items ri JOIN returns r2 ON r2.id = ri.return_id
        WHERE date(r2.created_at) BETWEEN ? AND ?),0) AS cost
    FROM returns r WHERE date(r.created_at) BETWEEN ? AND ?`).get(pFrom, pTo, pFrom, pTo);
  const revenue = s.total - ret.total;
  return { from: pFrom, to: pTo, count: s.count, revenue, profit: Math.round(revenue - cost + ret.cost) };
}

// Hàng cần nhập thêm (tồn thấp hoặc sắp bán hết theo tốc độ bán) và hàng tồn lâu không bán.
// Số lượng tính theo đơn vị gốc. Số bán lấy từ thẻ kho để tính cả món bán qua combo;
// hoá đơn huỷ và hàng khách trả đã cộng lại kho nên tự trừ ra.
export function productAdvice(db, days) {
  const since = shiftDay(new Date().toLocaleDateString('sv'), -days + 1);
  const rows = db.prepare(`SELECT p.id, p.code, p.name, p.unit, p.stock, p.min_stock, p.cost, date(p.created_at) AS added,
      MAX(ROUND(COALESCE(s.sold, 0), 3), 0) AS sold, last.d AS last_sale
    FROM products p
    LEFT JOIN (SELECT product_id, -SUM(qty) AS sold FROM stock_moves
      WHERE kind IN ('sale','cancel','return') AND date(created_at) >= ? GROUP BY product_id) s ON s.product_id = p.id
    LEFT JOIN (SELECT m.product_id, MAX(m.created_at) AS d FROM stock_moves m
      JOIN invoices i ON i.id = m.ref_id AND i.status = 'done' WHERE m.kind = 'sale' GROUP BY m.product_id) last ON last.product_id = p.id
    WHERE p.active = 1 AND p.track_stock = 1 AND p.is_combo = 0`).all(since);
  const reorder = [];
  const slow = [];
  let tooNew = 0;
  for (const r of rows) {
    const perDay = r.sold / days;
    const cover = perDay > 0 ? Math.max(r.stock, 0) / perDay : null; // còn bán được bao nhiêu ngày
    if ((r.min_stock > 0 && r.stock <= r.min_stock) || (cover !== null && cover < 7)) {
      // Đủ bán thêm 30 ngày và không thấp hơn tồn tối thiểu
      const need = Math.max(1, Math.ceil(perDay * 30 + r.min_stock - r.stock));
      reorder.push({ ...r, per_day: Math.round(perDay * 100) / 100, cover_days: cover === null ? null : Math.floor(cover), suggest: need });
    } else if (r.stock > 0 && r.sold <= 0) {
      // Hàng mới thêm (vd vừa nhập từ KiotViet) chưa đủ ngày để biết bán chậm hay không
      if (r.added > since) { tooNew++; continue; }
      slow.push({ ...r, value: Math.round(r.stock * r.cost) });
    }
  }
  reorder.sort((a, b) => (a.cover_days ?? 1e9) - (b.cover_days ?? 1e9) || b.per_day - a.per_day || a.stock - b.stock);
  slow.sort((a, b) => b.value - a.value);
  return {
    days,
    reorder: reorder.slice(0, 500), reorderCount: reorder.length,
    slow: slow.slice(0, 500), slowCount: slow.length, tooNew, slowValue: slow.reduce((s, x) => s + x.value, 0),
  };
}

// Sao lưu: chép CSDL ra file, giữ lại 30 bản gần nhất.
export function backup(db, backupDir, keep = 30) {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toLocaleString('sv').replace(/[: ]/g, '-');
  const file = path.join(backupDir, `banhang-${stamp}.db`);
  fs.rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = fs.readdirSync(backupDir).filter((f) => /^banhang-.*\.db$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) fs.rmSync(path.join(backupDir, f), { force: true });
  return file;
}

// Khôi phục dữ liệu từ một file sao lưu: kiểm tra file, sao lưu dữ liệu hiện tại, rồi chép toàn bộ bảng.
// Giữ phiên đăng nhập của người đang khôi phục nếu tài khoản đó vẫn có trong bản sao lưu.
export function restore(db, file, backupDir, keepSession) {
  const tmp = path.join(backupDir, 'khoi-phuc-tam.db');
  fs.copyFileSync(file, tmp);
  for (const ext of ['-wal', '-shm']) fs.rmSync(tmp + ext, { force: true });
  try {
    let src;
    try {
      src = new DatabaseSync(tmp);
      const ok = src.prepare('PRAGMA integrity_check').get();
      if (Object.values(ok)[0] !== 'ok') throw new Error();
      if (!src.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'products'").get()) throw new Error();
      if (src.prepare('PRAGMA user_version').get().user_version > db.prepare('PRAGMA user_version').get().user_version) {
        throw bad('File sao lưu của bản PSell mới hơn. Hãy cập nhật app trước khi khôi phục.');
      }
    } catch (err) {
      if (err.status) throw err;
      throw bad('File không phải bản sao lưu PSell hoặc đã bị hỏng');
    } finally {
      src?.close();
    }
    openDb(tmp).close(); // nâng cấu trúc bản cũ lên bản hiện tại
    const before = backup(db, backupDir);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'sessions'").all().map((t) => t.name);
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('ATTACH DATABASE ? AS src').run(tmp);
    try {
      db.exec('BEGIN');
      try {
        for (const t of tables) {
          const cols = db.prepare(`PRAGMA main.table_info("${t}")`).all().map((c) => c.name);
          const have = new Set(db.prepare(`PRAGMA src.table_info("${t}")`).all().map((c) => c.name));
          db.exec(`DELETE FROM main."${t}"`);
          if (!have.size) continue;
          const list = cols.filter((c) => have.has(c)).map((c) => `"${c}"`).join(', ');
          db.exec(`INSERT INTO main."${t}" (${list}) SELECT ${list} FROM src."${t}"`);
        }
        // Chỉ giữ phiên của người đang khôi phục, gắn lại vào tài khoản chủ cùng tên trong bản sao lưu
        const owner = db.prepare("SELECT id FROM users WHERE active = 1 AND role = 'owner' AND username = ?").get(keepSession.username);
        db.prepare('DELETE FROM sessions WHERE token != ? OR ? IS NULL').run(keepSession.token, owner?.id ?? null);
        if (owner) db.prepare('UPDATE sessions SET user_id = ? WHERE token = ?').run(owner.id, keepSession.token);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    } finally {
      db.exec('DETACH DATABASE src');
      db.exec('PRAGMA foreign_keys = ON');
    }
    return path.basename(before);
  } finally {
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(tmp + ext, { force: true });
  }
}

export default function adminRoutes(db, { backupDir }) {
  const r = Router();

  r.get('/settings', (_req, res) => res.json(getSettings(db)));

  r.put('/settings', requireOwner, (req, res) => {
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    for (const k of SETTING_KEYS) if (k in req.body) upsert.run(k, str(req.body[k], 500));
    res.json(getSettings(db));
  });

  r.get('/reports/summary', requireOwner, (req, res) => {
    const today = new Date().toLocaleDateString('sv');
    const from = day(req.query.from, today);
    const to = day(req.query.to, today);
    res.json({ ...report(db, from, to), previous: previousPeriod(db, from, to) });
  });

  // Gợi ý nhập hàng và hàng bán chậm
  r.get('/reports/products', requireOwner, (req, res) => {
    res.json(productAdvice(db, Math.min(Math.max(Number(req.query.days) || 30, 7), 365)));
  });

  // Báo cáo cuối ngày cho nhân viên: chỉ tiền thu, không có lãi.
  r.get('/reports/today', (req, res) => {
    const today = new Date().toLocaleDateString('sv');
    const full = report(db, today, today);
    res.json({
      sales: full.sales, returns: full.returns, revenue: full.revenue, cashflow: full.cashflow,
      drafts: db.prepare('SELECT COUNT(*) AS n FROM drafts').get().n,
      customerDebt: full.customerDebt,
    });
  });

  // Báo cáo cuối ngày gửi về điện thoại qua Home Assistant
  r.get('/notify', requireOwner, async (_req, res) => {
    let services = [];
    let error = null;
    try {
      services = await notifyServices();
    } catch (err) {
      error = err.message;
    }
    res.json({ ...readNotify(db), available: services, error });
  });

  r.put('/notify', requireOwner, (req, res) => {
    const time = String(req.body.time ?? '21:00');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw bad('Giờ gửi không hợp lệ');
    const services = (Array.isArray(req.body.services) ? req.body.services : []).map((s) => String(s)).filter((s) => /^[a-z0-9_]+$/.test(s));
    const cfg = { ...readNotify(db), enabled: !!req.body.enabled, services, time };
    saveNotify(db, cfg);
    res.json(cfg);
  });

  // Gửi thử ngay báo cáo hôm nay
  r.post('/notify/test', requireOwner, async (req, res) => {
    const services = Array.isArray(req.body.services) && req.body.services.length ? req.body.services : readNotify(db).services;
    try {
      res.json(await sendDaily(db, new Date().toLocaleDateString('sv'), services));
    } catch (err) {
      throw bad(err.message);
    }
  });

  r.get('/backups', requireOwner, (_req, res) => {
    fs.mkdirSync(backupDir, { recursive: true });
    res.json(fs.readdirSync(backupDir).filter((f) => f.endsWith('.db')).sort().reverse()
      .map((f) => ({ name: f, size: fs.statSync(path.join(backupDir, f)).size })));
  });

  r.post('/backups', requireOwner, (_req, res) => res.json({ name: path.basename(backup(db, backupDir)) }));

  r.get('/backups/:name', requireOwner, (req, res) => {
    const name = path.basename(req.params.name);
    if (!/^banhang-.*\.db$/.test(name)) return res.status(404).end();
    res.download(path.join(backupDir, name));
  });

  // Khôi phục từ bản sao lưu có sẵn trên máy
  r.post('/backups/:name/restore', requireOwner, (req, res) => {
    const name = path.basename(req.params.name);
    const file = path.join(backupDir, name);
    if (!/^banhang-.*\.db$/.test(name) || !fs.existsSync(file)) throw bad('Không có bản sao lưu này');
    res.json({ ok: true, before: restore(db, file, backupDir, keep(req)) });
  });

  // Khôi phục từ file .db tải lên (vd bản đã tải về USB)
  r.post('/backups/restore', requireOwner, express.raw({ type: () => true, limit: '500mb' }), (req, res) => {
    if (!req.body?.length) throw bad('Chưa chọn file');
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, 'tai-len-tam.db');
    fs.writeFileSync(file, req.body);
    try {
      res.json({ ok: true, before: restore(db, file, backupDir, keep(req)) });
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  return r;
}

const keep = (req) => ({ token: req.token, username: req.user.username });
