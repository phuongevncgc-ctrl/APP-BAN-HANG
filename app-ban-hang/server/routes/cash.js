// Sổ quỹ (thu chi), phiếu kiểm kho nhiều món, chốt ca cuối ngày.
import { Router } from 'express';
import { tx, nextCode } from '../db.js';
import { requireOwner, isOwner } from '../auth.js';
import { bad, notFound, money, str, idOrNull, day, METHODS } from '../util.js';
import { moveStock } from './sales.js';

export const CASH_CATEGORIES = {
  in: { other_in: 'Thu khác', deposit: 'Nộp tiền vào quỹ' },
  out: { expense: 'Chi phí (điện, nước, lương…)', withdraw: 'Rút tiền', other_out: 'Chi khác' },
};
const KIND_NAMES = {
  sale: 'Bán hàng', return: 'Hoàn tiền trả hàng', debt_in: 'Thu nợ khách', purchase: 'Trả tiền nhập hàng',
  debt_out: 'Trả nợ NCC', supplier_return: 'NCC hoàn tiền',
};

// Tất cả dòng tiền (thu +, chi −) gồm thanh toán và phiếu thu chi.
function cashRows(db, method, whereDate, args) {
  const m = method === 'all' ? '' : 'AND method = ?';
  const margs = method === 'all' ? [] : [method];
  return db.prepare(`
    SELECT 'p' || p.id AS id, p.created_at, p.kind, p.method, p.amount, p.note, u.name AS user_name,
      CASE p.kind
        WHEN 'sale' THEN (SELECT code FROM invoices WHERE id = p.ref_id)
        WHEN 'return' THEN (SELECT code FROM returns WHERE id = p.ref_id)
        WHEN 'purchase' THEN (SELECT code FROM purchases WHERE id = p.ref_id)
        WHEN 'supplier_return' THEN (SELECT code FROM supplier_returns WHERE id = p.ref_id)
      END AS ref_code, p.ref_id,
      COALESCE(c.name, s.name) AS partner, NULL AS category, 0 AS src, p.id AS n
    FROM payments p LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE ${whereDate('p.created_at')} ${m.replace('method', 'p.method')}
    UNION ALL
    SELECT 'e' || e.id, e.created_at, 'entry_' || e.kind, e.method, CASE e.kind WHEN 'in' THEN e.amount ELSE -e.amount END,
      e.note, u.name, NULL, NULL, NULL, e.category, 1, e.id
    FROM cash_entries e LEFT JOIN users u ON u.id = e.user_id
    WHERE ${whereDate('e.created_at')} ${m.replace('method', 'e.method')}
    ORDER BY 2, src, n`).all(...args, ...margs, ...args, ...margs);
}

function sumCash(db, method, before) {
  const m = method === 'all' ? '' : 'AND method = ?';
  const a = method === 'all' ? [before] : [before, method];
  return db.prepare(`SELECT
    (SELECT COALESCE(SUM(amount),0) FROM payments WHERE date(created_at) < ? ${m}) +
    (SELECT COALESCE(SUM(CASE kind WHEN 'in' THEN amount ELSE -amount END),0) FROM cash_entries WHERE date(created_at) < ? ${m}) AS s`)
    .get(...a, ...a).s;
}

export function cashbook(db, from, to, method = 'cash') {
  const opening = sumCash(db, method, from);
  let balance = opening;
  const rows = cashRows(db, method, (col) => `date(${col}) BETWEEN ? AND ?`, [from, to]).map((r) => {
    balance += r.amount;
    const kind = r.kind.startsWith('entry_') ? r.kind.slice(6) : null;
    const { src, n, ...row } = r;
    return {
      ...row,
      type: kind ? CASH_CATEGORIES[kind][r.category] ?? (kind === 'in' ? 'Thu khác' : 'Chi khác') : KIND_NAMES[r.kind] ?? r.kind,
      entry: !!kind,
      balance,
    };
  });
  return {
    from, to, method, opening, rows, closing: balance,
    totalIn: rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0),
    totalOut: rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0),
  };
}

export default function cashRoutes(db) {
  const r = Router();
  const today = () => new Date().toLocaleDateString('sv');

  // ---------- Sổ quỹ ----------
  r.get('/cashbook', requireOwner, (req, res) => {
    const method = ['cash', 'transfer', 'card', 'all'].includes(req.query.method) ? req.query.method : 'cash';
    res.json(cashbook(db, day(req.query.from, today()), day(req.query.to, today()), method));
  });

  r.get('/cash-categories', (_req, res) => res.json(CASH_CATEGORIES));

  // Phiếu thu / chi: nhân viên cũng lập được (vd chi tiền ship), chỉ chủ được xoá.
  r.post('/cash-entries', (req, res) => {
    const kind = req.body.kind === 'in' ? 'in' : req.body.kind === 'out' ? 'out' : null;
    if (!kind) throw bad('Chọn phiếu thu hay phiếu chi');
    const category = CASH_CATEGORIES[kind][req.body.category] ? req.body.category : kind === 'in' ? 'other_in' : 'other_out';
    const amount = money(req.body.amount);
    if (!amount) throw bad('Chưa nhập số tiền');
    const method = METHODS.includes(req.body.method) ? req.body.method : 'cash';
    const note = str(req.body.note, 300);
    if (!note) throw bad('Ghi rõ nội dung thu / chi (vd: Tiền điện tháng 10)');
    const { lastInsertRowid } = db.prepare('INSERT INTO cash_entries (kind, category, method, amount, note, user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kind, category, method, amount, note, req.user.id);
    res.json({ id: Number(lastInsertRowid) });
  });

  r.delete('/cash-entries/:id', requireOwner, (req, res) => {
    const { changes } = db.prepare('DELETE FROM cash_entries WHERE id = ?').run(Number(req.params.id));
    if (!changes) throw notFound();
    res.json({ ok: true });
  });

  // ---------- Kiểm kho nhiều món ----------
  r.get('/stock-counts', requireOwner, (_req, res) => {
    res.json(db.prepare(`SELECT sc.*, u.name AS user_name, COUNT(i.id) AS items,
        SUM(i.actual_qty - i.system_qty) AS diff_qty, SUM(ROUND((i.actual_qty - i.system_qty) * i.cost)) AS diff_value
      FROM stock_counts sc LEFT JOIN users u ON u.id = sc.user_id LEFT JOIN stock_count_items i ON i.count_id = sc.id
      GROUP BY sc.id ORDER BY sc.id DESC LIMIT 100`).all());
  });

  r.get('/stock-counts/:id', requireOwner, (req, res) => {
    const sc = db.prepare('SELECT sc.*, u.name AS user_name FROM stock_counts sc LEFT JOIN users u ON u.id = sc.user_id WHERE sc.id = ?')
      .get(Number(req.params.id));
    if (!sc) throw notFound();
    sc.items = db.prepare(`SELECT i.*, p.code, p.unit FROM stock_count_items i JOIN products p ON p.id = i.product_id
      WHERE i.count_id = ? ORDER BY i.id`).all(sc.id);
    res.json(sc);
  });

  // { items: [{product_id, actual_qty}], note } — số thực tế theo ĐVT gốc
  r.post('/stock-counts', requireOwner, (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) throw bad('Chưa có hàng nào để kiểm');
    const getP = db.prepare('SELECT id, name, stock, cost, track_stock, is_combo FROM products WHERE id = ?');
    const lines = items.map((it) => {
      const p = getP.get(idOrNull(it.product_id));
      if (!p) throw bad('Có mặt hàng không tồn tại');
      if (!p.track_stock || p.is_combo) throw bad(`"${p.name}" không theo dõi tồn kho`);
      const actual = Number(it.actual_qty);
      if (!Number.isFinite(actual) || actual < 0) throw bad(`Số thực tế của "${p.name}" không hợp lệ`);
      return { p, actual: Math.round(actual * 1000) / 1000 };
    });
    if (new Set(lines.map((l) => l.p.id)).size !== lines.length) throw bad('Có hàng bị nhập trùng trong phiếu');
    const id = tx(db, () => {
      const code = nextCode(db, 'stock_counts', 'KK');
      const cid = Number(db.prepare('INSERT INTO stock_counts (code, user_id, note) VALUES (?, ?, ?)')
        .run(code, req.user.id, str(req.body.note)).lastInsertRowid);
      const ins = db.prepare(`INSERT INTO stock_count_items (count_id, product_id, name, system_qty, actual_qty, cost)
        VALUES (?, ?, ?, ?, ?, ?)`);
      for (const l of lines) {
        ins.run(cid, l.p.id, l.p.name, l.p.stock, l.actual, Math.round(l.p.cost));
        if (l.actual !== l.p.stock) moveStock(db, l.p.id, l.actual - l.p.stock, 'count', cid);
      }
      return cid;
    });
    res.json({ id });
  });

  // ---------- Chốt ca: tiền thu trong ngày (của mình, chủ xem được tất cả) ----------
  r.get('/reports/shift', (req, res) => {
    const d = day(req.query.day, today());
    const all = isOwner(req) && req.query.user !== 'me';
    const uid = all ? null : req.user.id;
    const userFilter = uid ? 'AND user_id = ?' : '';
    const ua = uid ? [uid] : [];
    const sales = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(debt),0) AS debt
      FROM invoices WHERE status = 'done' AND date(created_at) = ? ${userFilter}`).get(d, ...ua);
    const returns = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM returns
      WHERE date(created_at) = ? ${userFilter}`).get(d, ...ua);
    const money = {};
    for (const x of db.prepare(`SELECT kind, method, SUM(amount) AS amount FROM payments
      WHERE date(created_at) = ? ${userFilter} GROUP BY kind, method`).all(d, ...ua)) {
      money[x.method] ??= {};
      money[x.method][x.kind] = x.amount;
    }
    for (const x of db.prepare(`SELECT kind, method, SUM(amount) AS amount FROM cash_entries
      WHERE date(created_at) = ? ${userFilter} GROUP BY kind, method`).all(d, ...ua)) {
      money[x.method] ??= {};
      money[x.method][`entry_${x.kind}`] = x.kind === 'in' ? x.amount : -x.amount;
    }
    const totals = Object.fromEntries(Object.entries(money).map(([m, v]) => [m, Object.values(v).reduce((a, b) => a + b, 0)]));
    const user = uid ? db.prepare('SELECT name FROM users WHERE id = ?').get(uid).name : 'Tất cả nhân viên';
    res.json({
      day: d, user, sales, returns, money, totals,
      cashOpening: all ? sumCash(db, 'cash', d) : null,
      drafts: db.prepare('SELECT COUNT(*) AS n FROM drafts').get().n,
    });
  });

  return r;
}
