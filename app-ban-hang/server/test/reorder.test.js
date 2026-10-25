import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db.js';
import { createApp } from '../app.js';

let server, base, token, dataDir, db;

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

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banhang-'));
  db = openDb(':memory:');
  server = createApp(db, { dataDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  token = (await post('/setup', { username: 'chu', password: '1234' })).token;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('gợi ý nhập hàng: theo sức bán, tồn nhỏ nhất, trả hàng, huỷ, NCC', async () => {
  const supA = (await post('/suppliers', { name: 'NCC A' })).id;
  const supB = (await post('/suppliers', { name: 'NCC B' })).id;
  const ong = (await post('/products', {
    name: 'Ống 27', unit: 'Mét', cost: 6000, price: 9000, min_stock: 10,
    units: [{ name: 'Cây', factor: 4, price: 34000 }],
  })).id;
  const keo = (await post('/products', { name: 'Keo dán', unit: 'Tuýp', cost: 3000, price: 5000 })).id;
  const du = (await post('/products', { name: 'Hàng còn nhiều', unit: 'Cái', cost: 1000, price: 2000, min_stock: 2 })).id;
  const dv = (await post('/products', { name: 'Công lắp', unit: 'Lần', price: 50000, track_stock: false })).id;

  await post('/purchases', { supplier_id: supA, items: [{ product_id: ong, qty: 100, cost: 6000 }], paid: 0, method: 'cash' });
  await post('/purchases', { supplier_id: supB, items: [{ product_id: keo, qty: 20, cost: 3000 }, { product_id: du, qty: 50, cost: 1000 }], paid: 0, method: 'cash' });

  // Bán 15 Cây = 60 Mét ống, khách trả 5 Cây = 20 Mét -> bán thực 40 Mét trong 30 ngày
  const inv = await post('/invoices', { items: [{ product_id: ong, unit_id: (await get(`/products/${ong}`)).units[0].id, qty: 15, price: 34000 }], payments: [{ method: 'cash', amount: 510000 }] });
  await post('/returns', { invoice_id: inv.id, items: [{ invoice_item_id: inv.items[0].id, qty: 5 }] });
  // Bán 18 tuýp keo, một hoá đơn 3 tuýp bị huỷ -> bán thực 15
  await post('/invoices', { items: [{ product_id: keo, qty: 15, price: 5000 }], payments: [{ method: 'cash', amount: 75000 }] });
  const bad = await post('/invoices', { items: [{ product_id: keo, qty: 3, price: 5000 }], payments: [{ method: 'cash', amount: 15000 }] });
  await post(`/invoices/${bad.id}/cancel`, {});
  await post('/invoices', { items: [{ product_id: dv, qty: 1, price: 50000 }], payments: [{ method: 'cash', amount: 50000 }] });

  let list = await get('/products/reorder?days=30&cover=15');
  const by = Object.fromEntries(list.map((x) => [x.id, x]));
  // Ống: tồn 60, bán 40/30 ngày -> 15 ngày cần 20, + tồn nhỏ nhất 10 = 30 < 60 -> không cần nhập
  assert.equal(by[ong], undefined);
  // Keo: tồn 5, bán 15 -> 15 ngày cần 7.5 -> 8, + 0 - 5 = 3
  assert.equal(by[keo].sold, 15);
  assert.equal(by[keo].need, 3);
  assert.equal(by[keo].last_supplier_id, supB);
  assert.equal(by[du], undefined);
  assert.equal(by[dv], undefined);

  // Đủ bán 60 ngày: ống cần 80 + 10 - 60 = 30 Mét, có kèm ĐVT Cây để chọn
  list = await get('/products/reorder?days=30&cover=60');
  const o = list.find((x) => x.id === ong);
  assert.equal(o.need, 30);
  assert.equal(o.units[0].name, 'Cây');
  assert.equal(o.cost, 6000);
  assert.equal(list[0].id, ong); // cần nhập nhiều nhất đứng đầu

  // Lọc theo NCC lần nhập gần nhất
  assert.deepEqual((await get(`/products/reorder?days=30&cover=60&supplier=${supA}`)).map((x) => x.id), [ong]);
  assert.deepEqual((await get(`/products/reorder?days=30&cover=60&supplier=${supB}`)).map((x) => x.id), [keo]);

  // Hàng bán từ lâu (ngoài khoảng ngày) không tính vào sức bán
  db.exec("UPDATE stock_moves SET created_at = datetime('now','localtime','-40 days') WHERE product_id = " + keo + " AND kind IN ('sale','cancel')");
  assert.equal((await get('/products/reorder?days=30&cover=15')).find((x) => x.id === keo), undefined);

  // Tồn dưới mức tối thiểu, không bán gì: nhập đủ lên mức tối thiểu
  db.exec(`UPDATE products SET stock = -3 WHERE id = ${du}`);
  assert.equal((await get('/products/reorder')).find((x) => x.id === du).need, 5);
});
