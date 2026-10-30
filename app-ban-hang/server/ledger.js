// Sổ chi tiết công nợ khách hàng / nhà cung cấp.
// Mỗi dòng: giá trị chứng từ, số đã thanh toán, nợ tăng/giảm và nợ còn lại sau dòng đó.
// Nợ đầu kỳ được tính ngược từ nợ hiện tại nên khớp cả nợ cũ nhập từ app khác.
import { notFound } from './util.js';

// Hoá đơn nào còn nợ: nợ hiện tại của khách chia vào các hoá đơn ghi nợ gần nhất
// (khách trả nợ dần thì trừ vào hoá đơn cũ trước). Trả về theo thứ tự cũ -> mới.
export function debtInvoices(db, customerId, debt) {
  let left = Math.max(debt, 0);
  const owing = [];
  for (const inv of db.prepare(`SELECT id, code, created_at, debt FROM invoices
    WHERE customer_id = ? AND status = 'done' AND debt > 0 ORDER BY id DESC`).all(customerId)) {
    if (left <= 0) break;
    const amount = Math.min(inv.debt, left);
    left -= amount;
    owing.push({ ...inv, owing: amount });
  }
  return owing.reverse();
}

function finish(rows, currentDebt, from, to) {
  rows.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.order - b.order));
  let balance = currentDebt - rows.reduce((s, r) => s + r.change, 0);
  const opening0 = balance;
  const out = [];
  let opening = balance;
  for (const r of rows) {
    balance += r.change;
    if (from && r.created_at.slice(0, 10) < from) {
      opening = balance;
      continue;
    }
    if (to && r.created_at.slice(0, 10) > to) continue;
    const { order, ...row } = r;
    out.push({ ...row, balance });
  }
  if (!from) opening = opening0;
  const closing = out.length ? out[out.length - 1].balance : opening;
  return {
    opening,
    rows: out,
    closing,
    totals: {
      amount: out.reduce((s, r) => s + r.amount, 0),
      paid: out.reduce((s, r) => s + r.paid, 0),
      discount: out.reduce((s, r) => s + r.discount, 0),
      increase: out.reduce((s, r) => s + Math.max(r.change, 0), 0),
      decrease: out.reduce((s, r) => s - Math.min(r.change, 0), 0),
    },
  };
}

export function customerLedger(db, id, from, to) {
  const c = db.prepare('SELECT id, code, name, phone, address, tax_code, debt FROM customers WHERE id = ?').get(id);
  if (!c) throw notFound('Không tìm thấy khách hàng');
  const rows = [];
  for (const i of db.prepare(`SELECT id, code, created_at, total, debt, note FROM invoices
    WHERE customer_id = ? AND status = 'done'`).all(id)) {
    rows.push({ order: 1, created_at: i.created_at, code: i.code, ref: 'invoice', ref_id: i.id, type: 'Bán hàng',
      amount: i.total, paid: i.total - i.debt, discount: 0, change: i.debt, note: i.note });
  }
  for (const r of db.prepare(`SELECT r.id, r.code, r.created_at, r.total, r.note, i.code AS invoice_code,
      COALESCE((SELECT -SUM(amount) FROM payments WHERE kind = 'return' AND ref_id = r.id), 0) AS refunded
    FROM returns r LEFT JOIN invoices i ON i.id = r.invoice_id WHERE r.customer_id = ?`).all(id)) {
    rows.push({ order: 2, created_at: r.created_at, code: r.code, ref: 'return', ref_id: r.id,
      type: !r.refunded ? 'Trả hàng (trừ nợ)' : r.refunded < r.total ? 'Trả hàng (trừ nợ + hoàn tiền)' : 'Trả hàng (hoàn tiền)',
      amount: -r.total, paid: -r.refunded, discount: 0, change: -(r.total - r.refunded),
      note: [r.invoice_code && `HĐ ${r.invoice_code}`, r.note].filter(Boolean).join(' · ') });
  }
  for (const p of db.prepare(`SELECT id, created_at, method, amount, discount, note FROM payments
    WHERE customer_id = ? AND kind = 'debt_in'`).all(id)) {
    rows.push({ order: 3, created_at: p.created_at, code: `TT${String(p.id).padStart(6, '0')}`, ref: 'payment', ref_id: p.id,
      type: 'Thu nợ', method: p.method, amount: 0, paid: p.amount, discount: p.discount, change: -(p.amount + p.discount), note: p.note });
  }
  return { partner: c, ...finish(rows, c.debt, from, to) };
}

export function supplierLedger(db, id, from, to) {
  const s = db.prepare('SELECT id, name, phone, address, debt FROM suppliers WHERE id = ?').get(id);
  if (!s) throw notFound('Không tìm thấy nhà cung cấp');
  const rows = [];
  for (const p of db.prepare('SELECT id, code, created_at, total, paid, note FROM purchases WHERE supplier_id = ?').all(id)) {
    rows.push({ order: 1, created_at: p.created_at, code: p.code, ref: 'purchase', ref_id: p.id, type: 'Nhập hàng',
      amount: p.total, paid: p.paid, discount: 0, change: p.total - p.paid, note: p.note });
  }
  for (const r of db.prepare(`SELECT r.id, r.code, r.created_at, r.total, r.note,
      COALESCE((SELECT SUM(amount) FROM payments WHERE kind = 'supplier_return' AND ref_id = r.id), 0) AS refunded
    FROM supplier_returns r WHERE r.supplier_id = ?`).all(id)) {
    rows.push({ order: 2, created_at: r.created_at, code: r.code, ref: 'supplier_return', ref_id: r.id,
      type: r.refunded ? 'Trả hàng NCC (nhận tiền)' : 'Trả hàng NCC (trừ nợ)',
      amount: -r.total, paid: -r.refunded, discount: 0, change: -(r.total - r.refunded), note: r.note });
  }
  for (const p of db.prepare(`SELECT id, created_at, method, amount, note FROM payments
    WHERE supplier_id = ? AND kind = 'debt_out'`).all(id)) {
    rows.push({ order: 3, created_at: p.created_at, code: `TT${String(p.id).padStart(6, '0')}`, ref: 'payment', ref_id: p.id,
      type: 'Trả nợ NCC', method: p.method, amount: 0, paid: -p.amount, discount: 0, change: p.amount, note: p.note });
  }
  return { partner: s, ...finish(rows, s.debt, from, to) };
}
