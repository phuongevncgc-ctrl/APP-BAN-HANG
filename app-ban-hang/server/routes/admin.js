// Báo cáo, cài đặt, sao lưu.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { requireOwner } from '../auth.js';
import { str, day } from '../util.js';

const SETTING_KEYS = ['shop_name', 'shop_address', 'shop_phone', 'receipt_footer', 'receipt_width', 'bank_bin', 'bank_account', 'bank_holder', 'allow_negative_stock'];

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

  const byUser = db.prepare(`SELECT u.name, COUNT(*) AS count, SUM(i.total) AS total FROM invoices i
    LEFT JOIN users u ON u.id = i.user_id WHERE i.status = 'done' AND date(i.created_at) BETWEEN ? AND ?
    GROUP BY i.user_id ORDER BY total DESC`).all(from, to);

  return {
    from, to,
    sales, returns, revenue, cost, profit: revenue - cost,
    byDay, topProducts, cashflow, methods, byUser,
    customerDebt: db.prepare('SELECT COALESCE(SUM(debt),0) AS s FROM customers WHERE active = 1').get().s,
    supplierDebt: db.prepare('SELECT COALESCE(SUM(debt),0) AS s FROM suppliers WHERE active = 1').get().s,
    stockValue: Math.round(db.prepare('SELECT COALESCE(SUM(MAX(stock,0) * cost),0) AS s FROM products WHERE active = 1 AND track_stock = 1').get().s),
    lowStock: db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND track_stock = 1 AND stock <= min_stock').get().n,
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
    res.json(report(db, day(req.query.from, today), day(req.query.to, today)));
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

  return r;
}
