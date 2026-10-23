// Bán hàng, trả hàng, nhập hàng.
import { Router } from 'express';
import { tx, nextCode } from '../db.js';
import { requireOwner, isOwner } from '../auth.js';
import { bad, notFound, money, qty as toQty, str, idOrNull, payments, day, METHODS } from '../util.js';

// Thay đổi tồn kho và ghi lịch sử. Hàng không theo dõi tồn kho (dịch vụ) thì bỏ qua.
export function moveStock(db, productId, delta, kind, refId) {
  const p = db.prepare('SELECT stock, track_stock FROM products WHERE id = ?').get(productId);
  if (!p || !p.track_stock) return;
  const after = Math.round((p.stock + delta) * 1000) / 1000;
  db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(after, productId);
  db.prepare('INSERT INTO stock_moves (product_id, qty, kind, ref_id, stock_after) VALUES (?, ?, ?, ?, ?)').run(
    productId, delta, kind, refId, after,
  );
}

// Thành phần của combo (qty theo đơn vị gốc của từng món). Hàng thường trả về null.
export function comboParts(db, productId) {
  const p = db.prepare('SELECT is_combo FROM products WHERE id = ?').get(productId);
  if (!p?.is_combo) return null;
  return db.prepare(`SELECT ci.item_id AS product_id, ci.qty, p.cost, p.name FROM combo_items ci
    JOIN products p ON p.id = ci.item_id WHERE ci.combo_id = ?`).all(productId);
}

// Trừ / cộng kho cho một dòng hàng: combo thì đi vào từng món bên trong.
function moveLineStock(db, productId, components, baseQty, kind, refId) {
  const parts = typeof components === 'string' ? JSON.parse(components) : components;
  if (parts?.length) for (const c of parts) moveStock(db, c.product_id, baseQty * c.qty, kind, refId);
  else if (productId) moveStock(db, productId, baseQty, kind, refId);
}

// Tìm đơn vị bán: unitId rỗng = đơn vị gốc (hệ số 1).
export function resolveUnit(db, product, unitId) {
  const id = idOrNull(unitId);
  if (!id) return { unit_id: null, unit: product.unit, factor: 1 };
  const u = db.prepare('SELECT id, name, factor FROM product_units WHERE id = ? AND product_id = ?').get(id, product.id);
  if (!u) throw bad(`Đơn vị tính của "${product.name}" không hợp lệ`);
  return { unit_id: u.id, unit: u.name, factor: u.factor };
}

// Kiểm tra đủ hàng khi cài đặt không cho bán âm kho.
function checkStock(db, lines) {
  const allow = db.prepare("SELECT value FROM settings WHERE key = 'allow_negative_stock'").get()?.value !== '0';
  if (allow) return;
  const need = new Map();
  for (const l of lines) {
    for (const c of l.parts ?? [{ product_id: l.p.id, qty: 1 }]) {
      need.set(c.product_id, (need.get(c.product_id) ?? 0) + l.qty * l.u.factor * c.qty);
    }
  }
  for (const [pid, q] of need) {
    const p = db.prepare('SELECT name, stock, track_stock, unit FROM products WHERE id = ?').get(pid);
    if (p.track_stock && p.stock < q - 1e-9) throw bad(`Không đủ hàng: "${p.name}" chỉ còn ${p.stock} ${p.unit}`);
  }
}

function addPayment(db, row) {
  db.prepare(`INSERT INTO payments (kind, ref_id, customer_id, supplier_id, method, amount, user_id, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    row.kind, row.ref_id ?? null, row.customer_id ?? null, row.supplier_id ?? null,
    row.method, row.amount, row.user_id ?? null, row.note ?? '',
  );
}

export function createInvoice(db, user, body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw bad('Chưa có hàng trong hoá đơn');
  const customerId = idOrNull(body.customer_id);
  if (customerId && !db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) throw bad('Khách hàng không tồn tại');
  const priceListId = idOrNull(body.price_list_id);
  const getProduct = db.prepare('SELECT id, name, unit, cost FROM products WHERE id = ?');

  const lines = items.map((it) => {
    const p = getProduct.get(idOrNull(it.product_id));
    if (!p) throw bad('Có mặt hàng không tồn tại');
    const u = resolveUnit(db, p, it.unit_id);
    const q = toQty(it.qty);
    const price = money(it.price, 'Giá bán');
    const discount = money(it.discount, 'Giảm giá');
    if (discount > price) throw bad(`Giảm giá của "${p.name}" lớn hơn giá bán`);
    const parts = comboParts(db, p.id);
    if (parts && !parts.length) throw bad(`Combo "${p.name}" chưa có món nào bên trong`);
    // Giá vốn 1 đơn vị gốc: combo = tổng giá vốn các món bên trong
    const baseCost = parts ? parts.reduce((s, c) => s + c.cost * c.qty, 0) : p.cost;
    return { p, u, parts, baseCost, qty: q, price, discount, total: Math.round(q * (price - discount)) };
  });
  checkStock(db, lines);

  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const discount = money(body.discount, 'Giảm giá hoá đơn');
  if (discount > subtotal) throw bad('Giảm giá hoá đơn lớn hơn tổng tiền hàng');
  const total = subtotal - discount;

  const pays = payments(body.payments);
  const paidSum = pays.reduce((s, p) => s + p.amount, 0);
  let change = 0;
  if (paidSum > total) {
    change = paidSum - total;
    const cash = pays.find((p) => p.method === 'cash');
    if (!cash || cash.amount < change) throw bad('Khách trả dư chỉ được thối lại bằng tiền mặt');
    cash.amount -= change;
  }
  const paid = Math.min(paidSum, total);
  const debt = total - paid;
  if (debt > 0 && !customerId) throw bad('Khách chưa trả đủ tiền. Hãy chọn khách hàng để ghi nợ.');

  return tx(db, () => {
    const code = nextCode(db, 'invoices', 'HD');
    const { lastInsertRowid: id } = db.prepare(`INSERT INTO invoices
      (code, user_id, customer_id, price_list_id, subtotal, discount, total, paid, change_amount, debt, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      code, user.id, customerId, priceListId, subtotal, discount, total, paid, change, debt, str(body.note),
    );
    const insItem = db.prepare(`INSERT INTO invoice_items
      (invoice_id, product_id, name, unit_id, unit, factor, qty, price, discount, cost, total, components)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const l of lines) {
      const components = l.parts ? JSON.stringify(l.parts.map((c) => ({ product_id: c.product_id, qty: c.qty }))) : null;
      insItem.run(id, l.p.id, l.p.name, l.u.unit_id, l.u.unit, l.u.factor, l.qty, l.price, l.discount,
        Math.round(l.baseCost * l.u.factor), l.total, components);
      moveLineStock(db, l.p.id, l.parts, -l.qty * l.u.factor, 'sale', id);
    }
    if (idOrNull(body.draft_id)) db.prepare('DELETE FROM drafts WHERE id = ?').run(idOrNull(body.draft_id));
    for (const p of pays) {
      if (p.amount > 0) addPayment(db, { kind: 'sale', ref_id: id, customer_id: customerId, method: p.method, amount: p.amount, user_id: user.id });
    }
    if (debt > 0) db.prepare('UPDATE customers SET debt = debt + ? WHERE id = ?').run(debt, customerId);
    return getInvoice(db, Number(id), true);
  });
}

export function getInvoice(db, id, withCost) {
  const inv = db.prepare(`SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, c.code AS customer_code,
      c.address AS customer_address, c.tax_code AS customer_tax_code, c.debt AS customer_debt, u.name AS user_name, pl.name AS price_list_name
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN users u ON u.id = i.user_id
    LEFT JOIN price_lists pl ON pl.id = i.price_list_id
    WHERE i.id = ?`).get(id);
  if (!inv) throw notFound('Không tìm thấy hoá đơn');
  inv.items = db.prepare(`SELECT it.*, p.code AS product_code, p.barcode AS product_barcode FROM invoice_items it
    LEFT JOIN products p ON p.id = it.product_id WHERE it.invoice_id = ? ORDER BY it.id`).all(id);
  if (!withCost) for (const it of inv.items) delete it.cost;
  inv.payments = db.prepare("SELECT method, amount, created_at, note FROM payments WHERE kind = 'sale' AND ref_id = ? ORDER BY id").all(id);
  inv.returns = db.prepare('SELECT id, code, created_at, total FROM returns WHERE invoice_id = ? ORDER BY id').all(id);
  return inv;
}

export function createReturn(db, user, body) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(idOrNull(body.invoice_id));
  if (!inv) throw notFound('Không tìm thấy hoá đơn');
  if (inv.status !== 'done') throw bad('Hoá đơn đã huỷ, không trả hàng được');
  const wanted = (Array.isArray(body.items) ? body.items : []).filter((it) => Number(it.qty) > 0);
  if (!wanted.length) throw bad('Chưa chọn hàng trả');
  const method = body.refund_method ?? 'cash';
  if (method === 'debt' && !inv.customer_id) throw bad('Hoá đơn không có khách hàng nên không trừ nợ được');
  if (method !== 'debt' && !METHODS.includes(method)) throw bad('Hình thức hoàn tiền không hợp lệ');

  // Phần giảm giá cả hoá đơn được chia đều theo tỷ lệ cho từng món.
  const ratio = inv.subtotal > 0 ? inv.total / inv.subtotal : 1;
  const getItem = db.prepare('SELECT * FROM invoice_items WHERE id = ? AND invoice_id = ?');
  const lines = wanted.map((w) => {
    const it = getItem.get(idOrNull(w.invoice_item_id), inv.id);
    if (!it) throw bad('Có món không thuộc hoá đơn này');
    const q = toQty(w.qty);
    const left = Math.round((it.qty - it.returned_qty) * 1000) / 1000;
    if (q > left) throw bad(`"${it.name}" chỉ còn trả được ${left}`);
    const unit = Math.round((it.price - it.discount) * ratio);
    // Trả hết phần còn lại thì hoàn đúng số tiền còn lại của dòng, tránh lệch do làm tròn.
    const total = q === left
      ? Math.round(it.total * ratio) - db.prepare('SELECT COALESCE(SUM(total),0) AS s FROM return_items WHERE invoice_item_id = ?').get(it.id).s
      : Math.round(q * unit);
    return { it, qty: q, price: unit, total: Math.max(0, total) };
  });
  const total = lines.reduce((s, l) => s + l.total, 0);

  return tx(db, () => {
    const code = nextCode(db, 'returns', 'TH');
    const { lastInsertRowid: id } = db.prepare(`INSERT INTO returns (code, invoice_id, customer_id, user_id, total, note)
      VALUES (?, ?, ?, ?, ?, ?)`).run(code, inv.id, inv.customer_id, user.id, total, str(body.note));
    for (const l of lines) {
      db.prepare(`INSERT INTO return_items (return_id, invoice_item_id, product_id, name, unit, factor, qty, price, cost, total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, l.it.id, l.it.product_id, l.it.name, l.it.unit, l.it.factor, l.qty, l.price, l.it.cost, l.total);
      db.prepare('UPDATE invoice_items SET returned_qty = returned_qty + ? WHERE id = ?').run(l.qty, l.it.id);
      moveLineStock(db, l.it.product_id, l.it.components, l.qty * l.it.factor, 'return', id);
    }
    if (method === 'debt') {
      db.prepare('UPDATE customers SET debt = debt - ? WHERE id = ?').run(total, inv.customer_id);
    } else if (total > 0) {
      addPayment(db, { kind: 'return', ref_id: id, customer_id: inv.customer_id, method, amount: -total, user_id: user.id });
    }
    return { id: Number(id), code, total, refund_method: method };
  });
}

export function cancelInvoice(db, user, id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) throw notFound('Không tìm thấy hoá đơn');
  if (inv.status === 'cancelled') throw bad('Hoá đơn đã huỷ rồi');
  if (db.prepare('SELECT 1 FROM returns WHERE invoice_id = ?').get(id)) throw bad('Hoá đơn đã có trả hàng, không huỷ được');
  return tx(db, () => {
    db.prepare("UPDATE invoices SET status = 'cancelled' WHERE id = ?").run(id);
    for (const it of db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(id)) {
      moveLineStock(db, it.product_id, it.components, it.qty * it.factor, 'cancel', id);
    }
    for (const p of db.prepare("SELECT method, SUM(amount) AS amount FROM payments WHERE kind = 'sale' AND ref_id = ? GROUP BY method").all(id)) {
      if (p.amount) addPayment(db, { kind: 'sale', ref_id: id, customer_id: inv.customer_id, method: p.method, amount: -p.amount, user_id: user.id, note: 'Huỷ hoá đơn' });
    }
    if (inv.debt > 0) db.prepare('UPDATE customers SET debt = debt - ? WHERE id = ?').run(inv.debt, inv.customer_id);
    return getInvoice(db, id, true);
  });
}

export function createPurchase(db, user, body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw bad('Chưa có hàng trong phiếu nhập');
  const supplierId = idOrNull(body.supplier_id);
  if (supplierId && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(supplierId)) throw bad('Nhà cung cấp không tồn tại');
  const lines = readStockLines(db, items);
  const total = lines.reduce((s, l) => s + l.total, 0);
  const paid = Math.min(money(body.paid, 'Tiền trả'), total);
  const method = METHODS.includes(body.method) ? body.method : 'cash';
  if (paid < total && !supplierId) throw bad('Chưa trả đủ tiền. Hãy chọn nhà cung cấp để ghi nợ.');

  return tx(db, () => {
    const code = nextCode(db, 'purchases', 'PN');
    const { lastInsertRowid: id } = db.prepare(`INSERT INTO purchases (code, supplier_id, user_id, total, paid, note)
      VALUES (?, ?, ?, ?, ?, ?)`).run(code, supplierId, user.id, total, paid, str(body.note));
    for (const l of lines) {
      db.prepare(`INSERT INTO purchase_items (purchase_id, product_id, name, unit_id, unit, factor, qty, cost, total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, l.p.id, l.p.name, l.u.unit_id, l.u.unit, l.u.factor, l.qty, l.cost, l.total);
      // Giá vốn bình quân (tính theo đơn vị gốc)
      const cur = db.prepare('SELECT cost, stock FROM products WHERE id = ?').get(l.p.id);
      const base = Math.max(cur.stock, 0);
      const inQty = l.qty * l.u.factor;
      const newCost = base > 0 ? Math.round((base * cur.cost + l.total) / (base + inQty)) : Math.round(l.cost / l.u.factor);
      db.prepare('UPDATE products SET cost = ?, last_cost = ? WHERE id = ?').run(newCost, Math.round(l.cost / l.u.factor), l.p.id);
      moveStock(db, l.p.id, inQty, 'purchase', id);
    }
    if (paid > 0) addPayment(db, { kind: 'purchase', ref_id: id, supplier_id: supplierId, method, amount: -paid, user_id: user.id });
    if (total > paid) db.prepare('UPDATE suppliers SET debt = debt + ? WHERE id = ?').run(total - paid, supplierId);
    const warnings = lines
      .filter((l) => db.prepare('SELECT price FROM products WHERE id = ?').get(l.p.id).price * l.u.factor < l.cost)
      .map((l) => `Giá bán "${l.p.name}" đang thấp hơn giá nhập`);
    return { id: Number(id), code, total, paid, warnings };
  });
}

function readStockLines(db, items) {
  const getProduct = db.prepare('SELECT id, name, unit, cost, stock, is_combo FROM products WHERE id = ?');
  return items.map((it) => {
    const p = getProduct.get(idOrNull(it.product_id));
    if (!p) throw bad('Có mặt hàng không tồn tại');
    if (p.is_combo) throw bad(`"${p.name}" là combo, hãy nhập / trả từng món bên trong`);
    const u = resolveUnit(db, p, it.unit_id);
    const q = toQty(it.qty);
    const cost = money(it.cost, 'Giá nhập');
    return { p, u, qty: q, cost, total: Math.round(q * cost) };
  });
}

// Trả hàng cho nhà cung cấp: trừ kho, giảm nợ NCC hoặc nhận lại tiền.
export function createSupplierReturn(db, user, body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw bad('Chưa có hàng trả');
  const supplierId = idOrNull(body.supplier_id);
  if (!supplierId || !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(supplierId)) throw bad('Chưa chọn nhà cung cấp');
  const method = body.refund_method ?? 'debt';
  if (method !== 'debt' && !METHODS.includes(method)) throw bad('Hình thức nhận tiền không hợp lệ');
  const lines = readStockLines(db, items);
  const total = lines.reduce((s, l) => s + l.total, 0);
  return tx(db, () => {
    const code = nextCode(db, 'supplier_returns', 'TN');
    const { lastInsertRowid: id } = db.prepare('INSERT INTO supplier_returns (code, supplier_id, user_id, total, note) VALUES (?, ?, ?, ?, ?)')
      .run(code, supplierId, user.id, total, str(body.note));
    for (const l of lines) {
      db.prepare(`INSERT INTO supplier_return_items (supplier_return_id, product_id, name, unit_id, unit, factor, qty, cost, total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, l.p.id, l.p.name, l.u.unit_id, l.u.unit, l.u.factor, l.qty, l.cost, l.total);
      moveStock(db, l.p.id, -l.qty * l.u.factor, 'supplier_return', id);
    }
    if (method === 'debt') db.prepare('UPDATE suppliers SET debt = debt - ? WHERE id = ?').run(total, supplierId);
    else addPayment(db, { kind: 'supplier_return', ref_id: id, supplier_id: supplierId, method, amount: total, user_id: user.id });
    return { id: Number(id), code, total };
  });
}

export default function salesRoutes(db) {
  const r = Router();

  r.post('/invoices', (req, res) => res.json(createInvoice(db, req.user, req.body)));

  r.get('/invoices', (req, res) => {
    const today = new Date().toLocaleDateString('sv');
    const from = day(req.query.from, today);
    const to = day(req.query.to, today);
    const q = str(req.query.q, 50);
    const rows = db.prepare(`SELECT i.id, i.code, i.created_at, i.total, i.paid, i.debt, i.status,
        c.name AS customer_name, u.name AS user_name,
        (SELECT COALESCE(SUM(total),0) FROM returns r WHERE r.invoice_id = i.id) AS returned
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN users u ON u.id = i.user_id
      WHERE date(i.created_at) BETWEEN ? AND ?
        AND (? = '' OR i.code LIKE '%' || ? || '%' OR c.name LIKE '%' || ? || '%' OR c.phone LIKE '%' || ? || '%')
      ORDER BY i.id DESC LIMIT 500`).all(from, to, q, q, q, q);
    res.json(rows);
  });

  r.get('/invoices/:id', (req, res) => res.json(getInvoice(db, Number(req.params.id), isOwner(req))));

  r.post('/invoices/:id/cancel', requireOwner, (req, res) => res.json(cancelInvoice(db, req.user, Number(req.params.id))));

  r.post('/returns', (req, res) => res.json(createReturn(db, req.user, req.body)));

  r.get('/returns', (req, res) => {
    const today = new Date().toLocaleDateString('sv');
    const rows = db.prepare(`SELECT r.id, r.code, r.created_at, r.total, r.invoice_id, i.code AS invoice_code,
        c.name AS customer_name, u.name AS user_name
      FROM returns r
      LEFT JOIN invoices i ON i.id = r.invoice_id
      LEFT JOIN customers c ON c.id = r.customer_id
      LEFT JOIN users u ON u.id = r.user_id
      WHERE date(r.created_at) BETWEEN ? AND ? ORDER BY r.id DESC LIMIT 500`)
      .all(day(req.query.from, today), day(req.query.to, today));
    res.json(rows);
  });

  r.get('/returns/:id', (req, res) => {
    const ret = db.prepare(`SELECT r.*, i.code AS invoice_code, c.name AS customer_name FROM returns r
      LEFT JOIN invoices i ON i.id = r.invoice_id LEFT JOIN customers c ON c.id = r.customer_id WHERE r.id = ?`).get(Number(req.params.id));
    if (!ret) throw notFound();
    ret.items = db.prepare('SELECT id, name, qty, price, total FROM return_items WHERE return_id = ?').all(ret.id);
    res.json(ret);
  });

  r.post('/purchases', (req, res) => res.json(createPurchase(db, req.user, req.body)));

  r.post('/supplier-returns', (req, res) => res.json(createSupplierReturn(db, req.user, req.body)));

  r.get('/supplier-returns', (req, res) => {
    const today = new Date().toLocaleDateString('sv');
    res.json(db.prepare(`SELECT r.id, r.code, r.created_at, r.total, s.name AS supplier_name FROM supplier_returns r
      LEFT JOIN suppliers s ON s.id = r.supplier_id WHERE date(r.created_at) BETWEEN ? AND ? ORDER BY r.id DESC LIMIT 500`)
      .all(day(req.query.from, today), day(req.query.to, today)));
  });

  // ---------- Đơn lưu tạm ----------
  r.get('/drafts', (_req, res) => {
    res.json(db.prepare(`SELECT d.id, d.name, d.data, d.updated_at, u.name AS user_name FROM drafts d
      LEFT JOIN users u ON u.id = d.user_id ORDER BY d.updated_at DESC LIMIT 100`).all()
      .map((d) => ({ ...d, data: JSON.parse(d.data) })));
  });
  r.post('/drafts', (req, res) => {
    const data = JSON.stringify(req.body.data ?? {});
    if (data.length > 200000) throw bad('Đơn tạm quá lớn');
    const id = idOrNull(req.body.id);
    if (id && db.prepare('SELECT 1 FROM drafts WHERE id = ?').get(id)) {
      db.prepare("UPDATE drafts SET name = ?, data = ?, user_id = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(str(req.body.name, 100), data, req.user.id, id);
      return res.json({ id });
    }
    res.json({ id: Number(db.prepare('INSERT INTO drafts (name, data, user_id) VALUES (?, ?, ?)').run(str(req.body.name, 100), data, req.user.id).lastInsertRowid) });
  });
  r.delete('/drafts/:id', (req, res) => {
    db.prepare('DELETE FROM drafts WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  r.get('/purchases', (req, res) => {
    const today = new Date().toLocaleDateString('sv');
    res.json(db.prepare(`SELECT p.id, p.code, p.created_at, p.total, p.paid, s.name AS supplier_name, u.name AS user_name
      FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.user_id
      WHERE date(p.created_at) BETWEEN ? AND ? ORDER BY p.id DESC LIMIT 500`)
      .all(day(req.query.from, today), day(req.query.to, today)));
  });

  r.get('/purchases/:id', (req, res) => {
    const p = db.prepare(`SELECT p.*, s.name AS supplier_name FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`).get(Number(req.params.id));
    if (!p) throw notFound();
    // Kèm mã, mã vạch, giá bán theo đúng đơn vị để in tem
    p.items = db.prepare(`SELECT it.*, pr.name AS product_name,
        COALESCE(NULLIF(u.code, ''), pr.code) AS code, COALESCE(NULLIF(u.barcode, ''), CASE WHEN u.id IS NULL THEN pr.barcode END) AS barcode,
        COALESCE(u.price, pr.price) AS sell_price
      FROM purchase_items it JOIN products pr ON pr.id = it.product_id
      LEFT JOIN product_units u ON u.id = it.unit_id WHERE it.purchase_id = ?`).all(p.id);
    res.json(p);
  });

  return r;
}
