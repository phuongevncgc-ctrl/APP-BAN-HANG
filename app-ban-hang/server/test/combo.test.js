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

test('combo: tồn ráp được, bán trừ từng món, trả và huỷ cộng lại', async () => {
  const ong = (await post('/products', { name: 'Ống 21', unit: 'Mét', cost: 5000, price: 8000, stock: 40 })).id;
  const co = (await post('/products', { name: 'Co 21', unit: 'Cái', cost: 1000, price: 2000, stock: 9 })).id;
  const combo = (await post('/products', {
    name: 'Bộ ống 21', unit: 'Bộ', price: 50000, is_combo: true, stock: 99,
    combo_items: [{ item_id: ong, qty: 8 }, { item_id: co, qty: 2 }],
  })).id;
  let c = await get(`/products/${combo}`);
  assert.equal(c.is_combo, 1);
  assert.equal(c.stock, 4); // 40/8 = 5, 9/2 = 4
  assert.equal(c.cost, 42000);
  assert.equal(c.combo_items.length, 2);

  const inv = await post('/invoices', { items: [{ product_id: combo, qty: 2, price: 50000 }], payments: [{ method: 'cash', amount: 100000 }] });
  assert.equal(inv.items[0].cost, 42000);
  assert.equal((await get(`/products/${ong}`)).stock, 24);
  assert.equal((await get(`/products/${co}`)).stock, 5);

  // Đổi công thức combo sau khi bán: trả hàng vẫn cộng theo công thức lúc bán
  c = await get(`/products/${combo}`);
  await put(`/products/${combo}`, { ...c, combo_items: [{ item_id: ong, qty: 4 }] });
  await post('/returns', { invoice_id: inv.id, items: [{ invoice_item_id: inv.items[0].id, qty: 1 }] });
  assert.equal((await get(`/products/${ong}`)).stock, 32);
  assert.equal((await get(`/products/${co}`)).stock, 7);
  await post('/returns', { invoice_id: inv.id, items: [{ invoice_item_id: inv.items[0].id, qty: 1 }] });
  assert.equal((await get(`/products/${ong}`)).stock, 40);
  assert.equal((await get(`/products/${co}`)).stock, 9);

  const inv2 = await post('/invoices', { items: [{ product_id: combo, qty: 1, price: 50000 }], payments: [{ method: 'cash', amount: 50000 }] });
  assert.equal((await get(`/products/${ong}`)).stock, 36);
  await post(`/invoices/${inv2.id}/cancel`);
  assert.equal((await get(`/products/${ong}`)).stock, 40);

  await assert.rejects(post('/purchases', { items: [{ product_id: combo, qty: 1, cost: 1 }] }), /combo/);
  await assert.rejects(post('/products', { name: 'X', is_combo: true, combo_items: [{ item_id: combo, qty: 1 }] }), /combo/);
  await assert.rejects(post('/products', { name: 'Y', is_combo: true, combo_items: [] }), /ít nhất/);
  await assert.rejects(put(`/products/${ong}`, { ...(await get(`/products/${ong}`)), is_combo: true, combo_items: [{ item_id: co, qty: 1 }] }), /combo/);
});

test('combo: chặn bán khi không đủ món bên trong (tắt âm kho)', async () => {
  await put('/settings', { allow_negative_stock: '0' });
  const a = (await post('/products', { name: 'Món A', price: 1, stock: 3 })).id;
  const combo = (await post('/products', { name: 'Combo A', price: 10, is_combo: true, combo_items: [{ item_id: a, qty: 2 }] })).id;
  await post('/invoices', { items: [{ product_id: combo, qty: 1, price: 10 }], payments: [{ method: 'cash', amount: 10 }] });
  await assert.rejects(post('/invoices', { items: [{ product_id: combo, qty: 1, price: 10 }], payments: [{ method: 'cash', amount: 10 }] }), /Không đủ hàng: "Món A"/);
  await put('/settings', { allow_negative_stock: '1' });
});

test('giá bán lần trước cho khách theo hàng và đơn vị', async () => {
  const p = (await post('/products', { name: 'Sơn trắng', unit: 'Lon', price: 100000, stock: 50, units: [{ name: 'Thùng', factor: 4, price: 380000 }] }));
  const prod = await get(`/products/${p.id}`);
  const c = await post('/customers', { name: 'Thợ Hai' });
  await post('/invoices', { customer_id: c.id, items: [{ product_id: p.id, qty: 1, price: 100000, discount: 5000 }], payments: [{ method: 'cash', amount: 95000 }] });
  await post('/invoices', { customer_id: c.id, items: [{ product_id: p.id, qty: 1, price: 98000 }, { product_id: p.id, unit_id: prod.units[0].id, qty: 1, price: 370000 }], payments: [{ method: 'cash', amount: 468000 }] });
  const last = await get(`/customers/${c.id}/last-prices?ids=${p.id}`);
  assert.deepEqual(last[`${p.id}:0`].price, 98000);
  assert.equal(last[`${p.id}:${prod.units[0].id}`].price, 370000);
});
