import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db.js';
import { createApp } from '../app.js';

let server, base, token, dataDir;

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}
const get = (u) => call('GET', u);
const post = (u, b) => call('POST', u, b);
const put = (u, b) => call('PUT', u, b);

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banhang-'));
  server = createApp(openDb(':memory:'), { dataDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  token = (await post('/setup', { username: 'chu', password: '1234' })).token;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Chạy 300 nghiệp vụ ngẫu nhiên (có hạt giống cố định) rồi đối chiếu sổ sách từ đầu.
test('đối chiếu sổ sách sau 300 nghiệp vụ ngẫu nhiên', async () => {
  let seed = 12345;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const sup = await post('/suppliers', { name: 'NCC' });
  const prods = [];
  for (let i = 0; i < 6; i++) {
    const p = await post('/products', {
      name: `Hàng ${i}`, unit: 'Cái', cost: 1000 + i * 700, price: 2000 + i * 1100, stock: 50,
      units: i % 2 ? [{ name: 'Hộp', factor: 6, price: (2000 + i * 1100) * 6 - 500 }] : [],
    });
    prods.push(await get(`/products/${p.id}`));
  }
  const combo = await post('/products', { name: 'Combo', price: 9000, is_combo: true, combo_items: [{ item_id: prods[0].id, qty: 2 }, { item_id: prods[1].id, qty: 1 }] });
  prods.push(await get(`/products/${combo.id}`));
  const custs = [];
  for (let i = 0; i < 4; i++) custs.push(await post('/customers', { name: `Khách ${i}` }));
  const invoices = [];
  for (let n = 0; n < 300; n++) {
    const op = rnd(10);
    if (op < 5) {
      const items = [];
      for (let k = 0, m = 1 + rnd(3); k < m; k++) {
        const p = prods[rnd(prods.length)];
        const unit = p.units[0] && rnd(2) ? p.units[0] : null;
        const price = unit ? unit.price : p.price;
        items.push({ product_id: p.id, unit_id: unit?.id ?? null, qty: 1 + rnd(3), price, discount: rnd(3) ? 0 : Math.min(price, 300) });
      }
      const sub = items.reduce((s, x) => s + x.qty * (x.price - x.discount), 0);
      const discount = rnd(4) ? 0 : Math.min(sub, 1000);
      const cust = rnd(3) ? custs[rnd(custs.length)] : null;
      const total = sub - discount;
      const pay = cust ? rnd(total + 1) : total + rnd(5000);
      const payments = rnd(2) ? [{ method: 'cash', amount: pay }] : [{ method: 'transfer', amount: Math.floor(pay / 2) }, { method: 'cash', amount: pay - Math.floor(pay / 2) }];
      try {
        invoices.push(await post('/invoices', { customer_id: cust?.id, items, discount, payments }));
      } catch (e) {
        assert.match(e.message, /thối lại bằng tiền mặt/);
      }
    } else if (op < 7 && invoices.length) {
      const inv = await get(`/invoices/${invoices[rnd(invoices.length)].id}`);
      const it = inv.items.find((x) => x.qty > x.returned_qty);
      if (inv.status !== 'done' || !it) continue;
      const q = rnd(2) ? it.qty - it.returned_qty : 1;
      await post('/returns', { invoice_id: inv.id, refund_method: inv.customer_id && rnd(2) ? 'debt' : 'cash', items: [{ invoice_item_id: it.id, qty: q }] });
    } else if (op === 7) {
      const c = await get(`/customers/${custs[rnd(custs.length)].id}`);
      if (c.debt > 0) await post(`/customers/${c.id}/pay`, { amount: rnd(c.debt + 1), discount: rnd(2) ? 0 : 100, method: rnd(2) ? 'cash' : 'transfer' });
    } else if (op === 8) {
      const p = prods[rnd(6)];
      await post('/purchases', { supplier_id: sup.id, items: [{ product_id: p.id, qty: 1 + rnd(20), cost: p.cost + rnd(500) }], paid: rnd(2) ? 0 : 5000 });
    } else if (invoices.length) {
      const inv = invoices[rnd(invoices.length)];
      await post(`/invoices/${inv.id}/cancel`).catch(() => {});
    }
  }

  // 1. Tồn kho = tồn đầu + tổng các lần nhập xuất trong thẻ kho
  for (const p of prods.slice(0, 6)) {
    const d = await get(`/products/${p.id}`);
    const all = d.moves; // 100 dòng gần nhất
    assert.equal(all[0].stock_after, d.stock, `tồn ${d.name}`);
    for (let i = 0; i + 1 < all.length; i++) assert.ok(Math.abs(all[i + 1].stock_after + all[i].qty - all[i].stock_after) < 1e-6, 'thẻ kho liền mạch');
  }
  // 2. Nợ khách = sổ công nợ tính lại từ đầu (nợ đầu kỳ phải = 0 vì khách tạo mới)
  for (const c of custs) {
    const l = await get(`/customers/${c.id}/ledger`);
    assert.equal(l.opening, 0, `nợ đầu kỳ ${c.name}`);
    assert.equal(l.closing, (await get(`/customers/${c.id}`)).debt);
  }
  // 3. Nợ NCC
  const sl = await get(`/suppliers/${sup.id}/ledger`);
  assert.equal(sl.opening, 0);
  // 4. Báo cáo: doanh thu = tổng hoá đơn còn hiệu lực - trả hàng; tiền = sổ quỹ
  const r = await get('/reports/summary');
  const book = await get('/cashbook?method=all');
  assert.equal(r.cashflow.cash + r.cashflow.transfer + r.cashflow.card, book.closing - book.opening);
  let sales = 0;
  let debt = 0;
  for (const inv of invoices) {
    const d = await get(`/invoices/${inv.id}`);
    if (d.status === 'done') {
      sales += d.total;
      debt += d.debt;
      assert.equal(d.subtotal, d.items.reduce((s, x) => s + x.total, 0));
      assert.equal(d.paid + d.debt, d.total);
      assert.equal(d.payments.reduce((s, x) => s + x.amount, 0), d.paid);
    }
  }
  assert.ok(invoices.length > 100 && r.returns.count > 20, `đủ nghiệp vụ: ${invoices.length} HĐ, ${r.returns.count} trả`);
  assert.equal(r.sales.total, sales);
  assert.equal(r.sales.debt, debt);
  // Tiền vào sổ quỹ khớp: bán + thu nợ - hoàn trả - trả NCC
  const sumKind = (k) => book.rows.filter((x) => x.kind === k).reduce((s, x) => s + x.amount, 0);
  assert.equal(sumKind('sale'), sales - debt);
});
