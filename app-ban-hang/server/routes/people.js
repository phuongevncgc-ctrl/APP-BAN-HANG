// Khách hàng, nhà cung cấp, nhân viên.
import { Router } from 'express';
import { tx, nextCode, fold } from '../db.js';
import { requireOwner, hashPassword } from '../auth.js';
import { bad, notFound, money, str, idOrNull, METHODS, day } from '../util.js';
import { customerLedger, supplierLedger } from '../ledger.js';

export default function peopleRoutes(db) {
  const r = Router();

  // ---------- Khách hàng ----------
  r.get('/customers', (req, res) => {
    const q = fold(req.query.q);
    const raw = str(req.query.q, 50);
    const rows = db.prepare(`SELECT c.id, c.code, c.name, c.phone, c.address, c.debt, c.price_list_id, pl.name AS price_list_name
      FROM customers c LEFT JOIN price_lists pl ON pl.id = c.price_list_id
      WHERE c.active = 1 AND (? = '' OR c.search LIKE ? OR c.phone LIKE ? OR c.code LIKE ?)
        AND (? = '0' OR c.debt != 0)
      ORDER BY c.name COLLATE NOCASE LIMIT 300`)
      .all(q, `%${q}%`, `%${raw}%`, `%${raw}%`, req.query.debt === '1' ? '1' : '0');
    res.json(rows);
  });

  r.get('/customers/:id', (req, res) => {
    const c = db.prepare(`SELECT c.*, pl.name AS price_list_name FROM customers c
      LEFT JOIN price_lists pl ON pl.id = c.price_list_id WHERE c.id = ?`).get(Number(req.params.id));
    if (!c) throw notFound('Không tìm thấy khách hàng');
    c.invoices = db.prepare(`SELECT id, code, created_at, total, debt, status FROM invoices
      WHERE customer_id = ? ORDER BY id DESC LIMIT 50`).all(c.id);
    c.debt_payments = db.prepare(`SELECT created_at, method, amount, discount, note FROM payments
      WHERE customer_id = ? AND kind = 'debt_in' ORDER BY id DESC LIMIT 50`).all(c.id);
    c.total_bought = db.prepare("SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE customer_id = ? AND status = 'done'").get(c.id).s;
    c.total_returned = db.prepare('SELECT COALESCE(SUM(total),0) AS s FROM returns WHERE customer_id = ?').get(c.id).s;
    // Tuổi nợ: các hoá đơn còn nợ tính từ cũ nhất (nợ trả dần trừ vào hoá đơn cũ trước)
    let left = Math.max(c.debt, 0);
    const owing = [];
    for (const inv of db.prepare(`SELECT id, code, created_at, debt FROM invoices
      WHERE customer_id = ? AND status = 'done' AND debt > 0 ORDER BY id DESC`).all(c.id)) {
      if (left <= 0) break;
      const amount = Math.min(inv.debt, left);
      left -= amount;
      owing.push({ ...inv, owing: amount, age_days: Math.floor((Date.now() - new Date(inv.created_at.replace(' ', 'T')).getTime()) / 86400000) });
    }
    c.debt_invoices = owing.reverse();
    c.max_debt_age = owing.reduce((m, x) => Math.max(m, x.age_days), 0);
    res.json(c);
  });

  function readCustomer(body) {
    const name = str(body.name, 200);
    if (!name) throw bad('Chưa nhập tên khách');
    return {
      name,
      search: fold(name),
      phone: str(body.phone, 30),
      address: str(body.address, 300),
      tax_code: str(body.tax_code, 30),
      note: str(body.note, 500),
      price_list_id: idOrNull(body.price_list_id),
    };
  }

  r.post('/customers', (req, res) => {
    const f = readCustomer(req.body);
    if (f.phone && db.prepare('SELECT 1 FROM customers WHERE phone = ? AND active = 1').get(f.phone)) {
      throw bad('Số điện thoại này đã có khách khác');
    }
    const code = str(req.body.code, 50) || nextCode(db, 'customers', 'KH');
    const { lastInsertRowid } = db.prepare(`INSERT INTO customers (code, name, search, phone, address, tax_code, note, price_list_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(code, f.name, f.search, f.phone, f.address, f.tax_code, f.note, f.price_list_id);
    res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(lastInsertRowid));
  });

  r.put('/customers/:id', (req, res) => {
    const f = readCustomer(req.body);
    db.prepare(`UPDATE customers SET name=?, search=?, phone=?, address=?, tax_code=?, note=?, price_list_id=? WHERE id=?`)
      .run(f.name, f.search, f.phone, f.address, f.tax_code, f.note, f.price_list_id, Number(req.params.id));
    res.json({ ok: true });
  });

  r.delete('/customers/:id', requireOwner, (req, res) => {
    db.prepare('UPDATE customers SET active = 0 WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // PSell 1.0 Beta: xem trước công nợ ngay tại POS, không ghi dữ liệu.
  // Tiền thanh toán hóa đơn mới không được tự ý trừ nợ cũ.
  r.get('/customers/:id/debt-preview', (req, res) => {
    const customer = db.prepare('SELECT id, code, name, debt FROM customers WHERE id = ? AND active = 1')
      .get(Number(req.params.id));
    if (!customer) throw notFound('Không tìm thấy khách hàng');
    const invoiceTotal = money(req.query.total, 'Tổng tiền hóa đơn');
    const invoicePaid = money(req.query.paid, 'Tiền thanh toán hóa đơn');
    if (invoicePaid > invoiceTotal) throw bad('Tiền thanh toán vượt tổng hóa đơn; cần tách tiền thối');
    const newDebt = invoiceTotal - invoicePaid;
    res.json({ customer, old_debt: customer.debt, invoice_total: invoiceTotal,
      invoice_paid: invoicePaid, new_debt: newDebt, projected_debt: customer.debt + newDebt,
      note: 'Số liệu xem trước, sẽ đối chiếu lại sau khi lưu giao dịch.' });
  });

  // Thu nợ khách
  // Giá bán gần nhất cho khách này theo từng hàng + đơn vị: ?ids=1,2,3
  r.get('/customers/:id/last-prices', (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
    if (!ids.length) return res.json({});
    const rows = db.prepare(`SELECT it.product_id, COALESCE(it.unit_id, 0) AS unit_id, it.price, it.discount, i.created_at, i.code
      FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
      WHERE i.customer_id = ? AND i.status = 'done' AND it.product_id IN (${ids.map(() => '?').join(',')})
      ORDER BY i.id DESC`).all(Number(req.params.id), ...ids);
    const out = {};
    for (const x of rows) {
      const k = `${x.product_id}:${x.unit_id}`;
      if (!out[k]) out[k] = { price: x.price, discount: x.discount, date: x.created_at, code: x.code };
    }
    res.json(out);
  });

  r.get('/customers/:id/ledger', (req, res) => {
    res.json(customerLedger(db, Number(req.params.id), day(req.query.from, ''), day(req.query.to, '')));
  });

  r.post('/customers/:id/pay', (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT debt FROM customers WHERE id = ?').get(id);
    if (!c) throw notFound('Không tìm thấy khách hàng');
    const amount = money(req.body.amount);
    const discount = money(req.body.discount, 'Chiết khấu');
    if (!amount && !discount) throw bad('Chưa nhập số tiền');
    const method = METHODS.includes(req.body.method) ? req.body.method : 'cash';
    tx(db, () => {
      db.prepare('UPDATE customers SET debt = debt - ? WHERE id = ?').run(amount + discount, id);
      db.prepare(`INSERT INTO payments (kind, customer_id, method, amount, discount, user_id, note) VALUES ('debt_in', ?, ?, ?, ?, ?, ?)`)
        .run(id, method, amount, discount, req.user.id, str(req.body.note));
    });
    res.json({ debt: c.debt - amount - discount });
  });

  // ---------- Nhà cung cấp ----------
  r.get('/suppliers', (_req, res) => {
    res.json(db.prepare('SELECT * FROM suppliers WHERE active = 1 ORDER BY name COLLATE NOCASE').all());
  });
  r.post('/suppliers', (req, res) => {
    const name = str(req.body.name, 200);
    if (!name) throw bad('Chưa nhập tên nhà cung cấp');
    const { lastInsertRowid } = db.prepare('INSERT INTO suppliers (name, phone, address) VALUES (?, ?, ?)')
      .run(name, str(req.body.phone, 30), str(req.body.address, 300));
    res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(lastInsertRowid));
  });
  r.put('/suppliers/:id', requireOwner, (req, res) => {
    const name = str(req.body.name, 200);
    if (!name) throw bad('Chưa nhập tên nhà cung cấp');
    db.prepare('UPDATE suppliers SET name=?, phone=?, address=? WHERE id=?')
      .run(name, str(req.body.phone, 30), str(req.body.address, 300), Number(req.params.id));
    res.json({ ok: true });
  });
  r.delete('/suppliers/:id', requireOwner, (req, res) => {
    db.prepare('UPDATE suppliers SET active = 0 WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });
  // Trả nợ nhà cung cấp
  r.get('/suppliers/:id/ledger', requireOwner, (req, res) => {
    res.json(supplierLedger(db, Number(req.params.id), day(req.query.from, ''), day(req.query.to, '')));
  });

  r.post('/suppliers/:id/pay', requireOwner, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(id)) throw notFound();
    const amount = money(req.body.amount);
    if (!amount) throw bad('Chưa nhập số tiền');
    const method = METHODS.includes(req.body.method) ? req.body.method : 'cash';
    tx(db, () => {
      db.prepare('UPDATE suppliers SET debt = debt - ? WHERE id = ?').run(amount, id);
      db.prepare(`INSERT INTO payments (kind, supplier_id, method, amount, user_id) VALUES ('debt_out', ?, ?, ?, ?)`)
        .run(id, method, -amount, req.user.id);
    });
    res.json({ ok: true });
  });

  // ---------- Nhân viên ----------
  r.get('/users', requireOwner, (_req, res) => {
    res.json(db.prepare('SELECT id, username, name, role, active, created_at FROM users ORDER BY id').all());
  });
  r.post('/users', requireOwner, (req, res) => {
    const username = str(req.body.username, 50).toLowerCase();
    const name = str(req.body.name, 100) || username;
    if (!/^[a-z0-9_.]{2,}$/.test(username)) throw bad('Tên đăng nhập chỉ gồm chữ không dấu và số, ít nhất 2 ký tự');
    if (String(req.body.password ?? '').length < 12) throw bad('Mật khẩu ít nhất 12 ký tự');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad('Tên đăng nhập đã có');
    const role = req.body.role === 'owner' ? 'owner' : 'staff';
    const { lastInsertRowid } = db.prepare('INSERT INTO users (username, name, pass_hash, role) VALUES (?, ?, ?, ?)')
      .run(username, name, hashPassword(req.body.password), role);
    res.json({ id: Number(lastInsertRowid) });
  });
  r.put('/users/:id', requireOwner, (req, res) => {
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw notFound();
    const role = req.body.role === 'owner' ? 'owner' : 'staff';
    const active = req.body.active === false ? 0 : 1;
    if (u.role === 'owner' && (role !== 'owner' || !active)) {
      const owners = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1").get().n;
      if (owners <= 1) throw bad('Phải còn ít nhất một tài khoản chủ');
    }
    tx(db, () => {
      db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(str(req.body.name, 100) || u.name, role, active, id);
      if (req.body.password) {
        if (String(req.body.password).length < 12) throw bad('Mật khẩu ít nhất 12 ký tự');
        db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(req.body.password), id);
      }
      if (!active || req.body.password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    });
    res.json({ ok: true });
  });

  return r;
}
