import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { openDb } from '../db.js';
import { createApp } from '../app.js';

let server, base, token, dataDir;

async function call(method, url, body, raw) {
  const res = await fetch(base + url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': raw ? 'application/octet-stream' : 'application/json' },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}
const get = (u) => call('GET', u);
const post = (u, b) => call('POST', u, b);
async function xlsx(url) {
  const res = await fetch(`${base}${url}${url.includes('?') ? '&' : '?'}token=${token}`);
  assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  return wb;
}
const values = (ws, n) => ws.getRow(n).values.slice(1);

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banhang-'));
  server = createApp(openDb(':memory:'), { dataDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  token = (await post('/setup', { username: 'chu', password: 'matkhau-1234' })).token;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('sổ công nợ khách: nợ đầu kỳ, mua, trả hàng, thu nợ có chiết khấu', async () => {
  const p = (await post('/products', { name: 'Sơn', unit: 'Lon', cost: 50000, price: 100000, stock: 50 })).id;
  const c = await post('/customers', { name: 'Chú Tư', phone: '0901' });
  await post(`/customers/${c.id}/pay`, { amount: 0, discount: 0 }).catch(() => {});
  const inv = await post('/invoices', { customer_id: c.id, items: [{ product_id: p, qty: 3, price: 100000 }], payments: [{ method: 'cash', amount: 100000 }] });
  await post('/returns', { invoice_id: inv.id, refund_method: 'debt', items: [{ invoice_item_id: inv.items[0].id, qty: 1 }] });
  await post(`/customers/${c.id}/pay`, { amount: 90000, discount: 10000, method: 'transfer' });
  const l = await get(`/customers/${c.id}/ledger`);
  assert.equal(l.opening, 0);
  assert.deepEqual(l.rows.map((r) => [r.type, r.change, r.balance]), [
    ['Bán hàng', 200000, 200000],
    ['Trả hàng (trừ nợ)', -100000, 100000],
    ['Thu nợ', -100000, 0],
  ]);
  assert.equal(l.closing, (await get(`/customers/${c.id}`)).debt);

  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('sv');
  const later = await get(`/customers/${c.id}/ledger?from=${tomorrow}`);
  assert.equal(later.rows.length, 0);
  assert.equal(later.opening, 0);

  const wb = await xlsx(`/export/customers/${c.id}/ledger.xlsx`);
  const ws = wb.worksheets[0];
  assert.match(String(ws.getCell(1, 1).value), /Chú Tư/);
  const all = await xlsx('/export/customers.xlsx');
  assert.equal(all.worksheets.length, 2);
  const inv2 = await xlsx('/export/invoices.xlsx');
  assert.equal(inv2.worksheets[1].rowCount, 2);
});

test('xuất hàng hoá rồi nhập lại không thay đổi gì', async () => {
  const ong = (await post('/products', { code: 'ONG', name: 'Ống', unit: 'Mét', cost: 10000, price: 15000, stock: 20,
    units: [{ name: 'Cây', factor: 4, price: 56000 }], prices: { '1:0': 14000 } })).id;
  await post('/products', { name: 'Bộ ống', is_combo: true, price: 1, combo_items: [{ item_id: ong, qty: 4 }] });
  const wb = await xlsx('/export/products.xlsx');
  const ws = wb.worksheets[0];
  const head = values(ws, 1);
  const rows = [];
  ws.eachRow((row, n) => n > 1 && rows.push(Object.fromEntries(head.map((h, i) => [h, row.values[i + 1]]))));
  const cay = rows.find((r) => r['ĐVT'] === 'Cây');
  assert.equal(cay['Mã ĐVT Cơ bản'], 'ONG');
  assert.equal(cay['Quy đổi'], 4);
  assert.equal(cay['Tồn kho'], 5);
  assert.equal(rows.find((r) => r['Mã hàng'] === 'ONG')['Giá sỉ'], 14000);
  const before = await get(`/products/${ong}`);
  const res = await call('POST', '/products/import?update_stock=1', null, Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(res.created, 0);
  const after = await get(`/products/${ong}`);
  assert.equal(after.stock, before.stock);
  assert.equal(after.units.length, 1);
  assert.equal(after.units[0].factor, 4);
  assert.equal((await get('/products?q=bo%20ong'))[0].is_combo, 1);
});
