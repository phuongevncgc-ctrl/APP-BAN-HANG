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


test('sổ quỹ: tiền bán, thu nợ, phiếu chi; báo cáo lãi sau chi phí; chốt ca', async () => {
  const p = (await post('/products', { name: 'Gạo', unit: 'Kg', cost: 10000, price: 15000, stock: 100 })).id;
  const c = await post('/customers', { name: 'Cô Năm' });
  await post('/invoices', { items: [{ product_id: p, qty: 10, price: 15000 }], payments: [{ method: 'cash', amount: 200000 }] }); // thối 50k
  await post('/invoices', { customer_id: c.id, items: [{ product_id: p, qty: 4, price: 15000 }], payments: [{ method: 'transfer', amount: 20000 }] });
  await post(`/customers/${c.id}/pay`, { amount: 40000, method: 'cash' });
  await post('/cash-entries', { kind: 'out', category: 'expense', amount: 30000, note: 'Tiền điện' });
  await post('/cash-entries', { kind: 'out', category: 'withdraw', amount: 100000, note: 'Rút về nhà' });
  await assert.rejects(post('/cash-entries', { kind: 'out', amount: 1000 }), /nội dung/);

  const book = await get('/cashbook');
  assert.equal(book.opening, 0);
  assert.equal(book.totalIn, 150000 + 40000);
  assert.equal(book.totalOut, 130000);
  assert.equal(book.closing, 60000);
  assert.deepEqual(book.rows.map((r) => r.type), ['Bán hàng', 'Thu nợ khách', 'Chi phí (điện, nước, lương…)', 'Rút tiền']);

  const r = await get('/reports/summary');
  assert.equal(r.cashflow.cash, 60000);
  assert.equal(r.profit, 70000);
  assert.equal(r.netProfit, 40000);

  const shift = await get('/reports/shift');
  assert.equal(shift.sales.count, 2);
  assert.equal(shift.totals.cash, 60000);
  assert.equal(shift.totals.transfer, 20000);
  assert.equal(shift.sales.debt, 40000);
});

test('kiểm kho nhiều món: cân lại tồn, ghi lệch', async () => {
  const a = (await post('/products', { name: 'Bia', unit: 'Lon', cost: 10000, price: 12000, stock: 24 })).id;
  const b = (await post('/products', { name: 'Nước ngọt', unit: 'Chai', cost: 8000, price: 10000, stock: 10 })).id;
  const { id } = await post('/stock-counts', { items: [{ product_id: a, actual_qty: 20 }, { product_id: b, actual_qty: 10 }], note: 'Cuối tháng' });
  const sc = await get(`/stock-counts/${id}`);
  assert.equal(sc.code, 'KK000001');
  assert.equal(sc.items[0].system_qty, 24);
  assert.equal((await get(`/products/${a}`)).stock, 20);
  const list = await get('/stock-counts');
  assert.equal(list[0].diff_value, -40000);
  const moves = (await get(`/products/${a}`)).moves;
  assert.equal(moves[0].kind, 'count');
  assert.equal(moves[0].ref_code, 'KK000001');
  await assert.rejects(post('/stock-counts', { items: [{ product_id: a, actual_qty: 1 }, { product_id: a, actual_qty: 2 }] }), /trùng/);
});

test('báo cáo xuất nhập tồn theo kỳ', async () => {
  const p = (await post('/products', { name: 'Ốc vít', unit: 'Cái', cost: 100, price: 200, stock: 100 })).id;
  const sup = await post('/suppliers', { name: 'NCC vít' });
  await post('/purchases', { supplier_id: sup.id, items: [{ product_id: p, qty: 50, cost: 100 }], paid: 5000 });
  const inv = await post('/invoices', { items: [{ product_id: p, qty: 30, price: 200 }], payments: [{ method: 'cash', amount: 6000 }] });
  await post('/returns', { invoice_id: inv.id, items: [{ invoice_item_id: inv.items[0].id, qty: 5 }] });
  await post('/supplier-returns', { supplier_id: sup.id, items: [{ product_id: p, qty: 10, cost: 100 }] });
  await post('/stock-counts', { items: [{ product_id: p, actual_qty: 110 }] });
  const rep = await get('/reports/stock?q=oc%20vit');
  const r = rep.rows.find((x) => x.id === p);
  assert.deepEqual([r.opening, r.purchase, r.sold, r.returned, r.supplier_return, r.adjust, r.closing], [0, 50, 30, 5, 10, 95, 110]); // hàng tạo hôm nay: tồn ban đầu 100 nằm trong cột cân bằng (100 - 5)
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('sv');
  const later = (await get(`/reports/stock?from=${tomorrow}&to=${tomorrow}&q=oc%20vit`)).rows.find((x) => x.id === p);
  assert.equal(later.opening, 110);
  assert.equal(later.sold, 0);
});
