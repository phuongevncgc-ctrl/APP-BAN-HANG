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
  token = (await post('/setup', { username: 'chu', password: 'matkhau-1234' })).token;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const debtOf = async (id) => (await get(`/customers/${id}`)).debt;
const ledgerClosing = async (id) => (await get(`/customers/${id}/ledger`)).closing;
const cashOut = async (returnId) => (await get('/cashbook?method=all')).rows
  .filter((x) => x.kind === 'return' && x.ref_id === returnId).reduce((s, x) => s + x.amount, 0);

let son, ong, cayId;
test('chuẩn bị hàng', async () => {
  son = (await post('/products', { name: 'Sơn', unit: 'Thùng', cost: 600000, price: 1000000, stock: 100 })).id;
  ong = (await post('/products', { name: 'Ống', unit: 'Mét', cost: 5000, price: 9000, stock: 400, units: [{ name: 'Cây', factor: 4, price: 34000 }] })).id;
  cayId = (await get(`/products/${ong}`)).units[0].id;
});

test('trả hàng hoá đơn còn nợ, chọn tiền mặt: trừ nợ hoá đơn trước, chỉ hoàn phần khách đã trả', async () => {
  const c = (await post('/customers', { name: 'Thợ A' })).id;
  const inv = await post('/invoices', { customer_id: c, items: [{ product_id: son, qty: 1, price: 1000000 }], payments: [{ method: 'cash', amount: 400000 }] });
  assert.equal(await debtOf(c), 600000);
  const pv = await post('/returns/preview', { invoice_id: inv.id, items: [{ invoice_item_id: inv.items[0].id, qty: 1 }], refund_method: 'cash' });
  assert.deepEqual([pv.total, pv.debt_reduced, pv.refund], [1000000, 600000, 400000]);
  const r = await post('/returns', { invoice_id: inv.id, items: [{ invoice_item_id: inv.items[0].id, qty: 1 }], refund_method: 'cash' });
  assert.deepEqual([r.total, r.debt_reduced, r.refund], [1000000, 600000, 400000]);
  assert.equal(await debtOf(c), 0);
  assert.equal(await cashOut(r.id), -400000);
  assert.equal(await ledgerClosing(c), 0);
});

test('trả một phần hoá đơn còn nợ: toàn bộ tiền hàng trả trừ vào nợ, không hoàn tiền', async () => {
  const c = (await post('/customers', { name: 'Thợ B' })).id;
  const inv = await post('/invoices', { customer_id: c, items: [{ product_id: son, qty: 3, price: 1000000 }], payments: [{ method: 'transfer', amount: 1000000 }] });
  const r = await post('/returns', { invoice_id: inv.id, items: [{ invoice_item_id: inv.items[0].id, qty: 1 }], refund_method: 'transfer' });
  assert.deepEqual([r.debt_reduced, r.refund], [1000000, 0]);
  assert.equal(await debtOf(c), 1000000);
  assert.equal(await cashOut(r.id), 0);
  // Trả tiếp 2 thùng: còn nợ 1 triệu thì trừ 1 triệu, hoàn 1 triệu đã chuyển khoản
  const r2 = await post('/returns', { invoice_id: inv.id, items: [{ invoice_item_id: inv.items[0].id, qty: 2 }], refund_method: 'transfer' });
  assert.deepEqual([r2.debt_reduced, r2.refund], [1000000, 1000000]);
  assert.equal(await debtOf(c), 0);
  assert.equal(await ledgerClosing(c), 0);
});

test('khách đã thu nợ xong thì trả hàng hoàn đủ tiền; nợ của hoá đơn khác không bị trừ', async () => {
  const c = (await post('/customers', { name: 'Thợ C' })).id;
  const cu = await post('/invoices', { customer_id: c, items: [{ product_id: son, qty: 1, price: 1000000 }], payments: [] });
  const moi = await post('/invoices', { customer_id: c, items: [{ product_id: son, qty: 1, price: 1000000 }], payments: [{ method: 'cash', amount: 1000000 }] });
  // Hoá đơn mới đã trả đủ: trả hàng hoá đơn này hoàn đủ tiền, nợ hoá đơn cũ giữ nguyên
  const r = await post('/returns', { invoice_id: moi.id, items: [{ invoice_item_id: moi.items[0].id, qty: 1 }], refund_method: 'cash' });
  assert.deepEqual([r.debt_reduced, r.refund], [0, 1000000]);
  assert.equal(await debtOf(c), 1000000);
  // Thu hết nợ rồi khách mới trả hàng hoá đơn cũ: hoàn đủ tiền mặt
  await post(`/customers/${c}/pay`, { amount: 1000000, method: 'cash' });
  const r2 = await post('/returns', { invoice_id: cu.id, items: [{ invoice_item_id: cu.items[0].id, qty: 1 }], refund_method: 'cash' });
  assert.deepEqual([r2.debt_reduced, r2.refund], [0, 1000000]);
  assert.equal(await debtOf(c), 0);
  assert.equal(await ledgerClosing(c), 0);
});

test('chọn "Trừ vào nợ": trừ hết vào nợ, dư thì thành tiền cửa hàng giữ của khách', async () => {
  const c = (await post('/customers', { name: 'Thợ D' })).id;
  const inv = await post('/invoices', { customer_id: c, items: [{ product_id: son, qty: 1, price: 1000000 }], payments: [{ method: 'cash', amount: 700000 }] });
  const r = await post('/returns', { invoice_id: inv.id, items: [{ invoice_item_id: inv.items[0].id, qty: 1 }], refund_method: 'debt' });
  assert.deepEqual([r.debt_reduced, r.refund], [1000000, 0]);
  assert.equal(await debtOf(c), -700000);
  assert.equal(await ledgerClosing(c), -700000);
});

test('giảm giá hoá đơn + đơn vị quy đổi: xem trước khớp máy chủ, trả nhiều lần không lệch, kho cộng đúng', async () => {
  // 3 Cây x 1.000 = 3.000, giảm hoá đơn 2.000 -> còn 1.000 (mỗi cây 333,33đ)
  const inv = await post('/invoices', { items: [{ product_id: ong, unit_id: cayId, qty: 3, price: 1000 }], discount: 2000, payments: [{ method: 'cash', amount: 1000 }] });
  const line = inv.items[0].id;
  const all = await post('/returns/preview', { invoice_id: inv.id, items: [{ invoice_item_id: line, qty: 3 }] });
  assert.equal(all.total, 1000); // không phải 3 x 333 = 999
  const stock0 = (await get(`/products/${ong}`)).stock;
  const totals = [];
  for (const q of [1, 1, 1]) {
    const pv = await post('/returns/preview', { invoice_id: inv.id, items: [{ invoice_item_id: line, qty: q }] });
    const r = await post('/returns', { invoice_id: inv.id, items: [{ invoice_item_id: line, qty: q }] });
    assert.equal(r.total, pv.total);
    totals.push(r.total);
  }
  assert.deepEqual(totals, [333, 333, 334]);
  assert.equal((await get(`/products/${ong}`)).stock, stock0 + 12);
  // Trả lẻ 0,001 cây nhiều lần cũng không hoàn quá tiền dòng hàng
  const inv2 = await post('/invoices', { items: [{ product_id: ong, unit_id: cayId, qty: 1, price: 1000 }], discount: 1, payments: [{ method: 'cash', amount: 999 }] });
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += (await post('/returns', { invoice_id: inv2.id, items: [{ invoice_item_id: inv2.items[0].id, qty: 0.001 }] })).total;
  sum += (await post('/returns', { invoice_id: inv2.id, items: [{ invoice_item_id: inv2.items[0].id, qty: 0.997 }] })).total;
  assert.equal(sum, 999);
});

test('huỷ hoá đơn đã thu nợ một phần: nợ, sổ quỹ và sổ công nợ vẫn khớp', async () => {
  const c = (await post('/customers', { name: 'Thợ E' })).id;
  const inv = await post('/invoices', { customer_id: c, items: [{ product_id: son, qty: 1, price: 1000000 }], payments: [{ method: 'cash', amount: 400000 }] });
  await post(`/customers/${c}/pay`, { amount: 200000, method: 'transfer' });
  await post(`/invoices/${inv.id}/cancel`, {});
  // Khách đã đưa 400.000 + 200.000 cho hoá đơn bị huỷ: tiền bán hoàn lại trong sổ quỹ, 200.000 thu nợ thành tiền giữ của khách
  assert.equal(await debtOf(c), -200000);
  assert.equal(await ledgerClosing(c), -200000);
  const l = await get(`/customers/${c}/ledger`);
  assert.equal(l.opening, 0);
});

test('báo cáo: tổng khách nợ không bị tiền giữ của khách (nợ âm) bù trừ, khớp trang khách hàng', async () => {
  const before = await get('/reports/summary');
  const stats0 = await get('/customers/stats');
  assert.equal(before.customerDebt, stats0.debt_total);
  const no = (await post('/customers', { name: 'Khách nợ 300k' })).id;
  const giu = (await post('/customers', { name: 'Khách có tiền gửi' })).id;
  await post('/invoices', { customer_id: no, items: [{ product_id: son, qty: 1, price: 300000 }], payments: [] });
  const inv = await post('/invoices', { customer_id: giu, items: [{ product_id: son, qty: 1, price: 100000 }], payments: [{ method: 'cash', amount: 100000 }] });
  await post('/returns', { invoice_id: inv.id, items: [{ invoice_item_id: inv.items[0].id, qty: 1 }], refund_method: 'debt' }); // giữ 100k của khách
  const r = await get('/reports/summary');
  assert.equal(r.customerDebt - before.customerDebt, 300000);
  assert.equal(r.customerCredit - before.customerCredit, 100000);
  assert.equal(r.customerDebt, (await get('/customers/stats')).debt_total);
});

test('không xoá được khách / NCC còn nợ (nợ bị ẩn khỏi mọi báo cáo)', async () => {
  const c = (await post('/customers', { name: 'Khách sắp xoá' })).id;
  await post('/invoices', { customer_id: c, items: [{ product_id: son, qty: 1, price: 50000 }], payments: [] });
  await assert.rejects(call('DELETE', `/customers/${c}`), /còn nợ 50\.000đ/);
  await post(`/customers/${c}/pay`, { amount: 50000 });
  await call('DELETE', `/customers/${c}`);
  const s = (await post('/suppliers', { name: 'NCC sắp xoá' })).id;
  await post('/purchases', { supplier_id: s, items: [{ product_id: son, qty: 1, cost: 70000 }], paid: 0 });
  await assert.rejects(call('DELETE', `/suppliers/${s}`), /còn nợ 70\.000đ/);
});

test('chiết khấu khi thu nợ được trừ vào lãi sau chi phí (trước đây bị bỏ sót)', async () => {
  const before = await get('/reports/summary');
  const c = (await post('/customers', { name: 'Khách bớt nợ' })).id;
  await post('/invoices', { customer_id: c, items: [{ product_id: son, qty: 1, price: 1000000 }], payments: [] });
  await post(`/customers/${c}/pay`, { amount: 950000, discount: 50000, method: 'cash' });
  assert.equal(await debtOf(c), 0);
  const r = await get('/reports/summary');
  assert.equal(r.debtDiscount - (before.debtDiscount ?? 0), 50000);
  // Lãi gộp không đổi theo chiết khấu, lãi sau chi phí giảm đúng 50.000
  const gross = (r.profit - before.profit);
  assert.equal(r.netProfit - before.netProfit, gross - 50000);
  // Tiền thật thu vào chỉ 950.000
  assert.equal(r.cashflow.cash - before.cashflow.cash, 950000);
});

test('hoá đơn hiện "còn nợ" đúng sau khi thu nợ / trả hàng (không giữ số nợ lúc bán)', async () => {
  const c = (await post('/customers', { name: 'Khách xem nợ HĐ' })).id;
  const a = await post('/invoices', { customer_id: c, items: [{ product_id: son, qty: 1, price: 500000 }], payments: [] });
  const b = await post('/invoices', { customer_id: c, items: [{ product_id: son, qty: 1, price: 300000 }], payments: [{ method: 'cash', amount: 100000 }] });
  assert.equal((await get(`/invoices/${a.id}`)).debt_left, 500000);
  assert.equal((await get(`/invoices/${b.id}`)).debt_left, 200000);
  // Thu 600.000: trả dần vào hoá đơn cũ trước -> A hết nợ, B còn 100.000
  await post(`/customers/${c}/pay`, { amount: 600000 });
  assert.equal((await get(`/invoices/${a.id}`)).debt_left, 0);
  assert.equal((await get(`/invoices/${b.id}`)).debt_left, 100000);
  // Trả hàng B: trừ 100.000 nợ còn lại, hoàn 200.000 -> B hết nợ
  await post('/returns', { invoice_id: b.id, items: [{ invoice_item_id: b.items[0].id, qty: 1 }], refund_method: 'cash' });
  assert.equal((await get(`/invoices/${b.id}`)).debt_left, 0);
  // Danh sách hoá đơn cũng có cột còn nợ
  const list = await get(`/invoices?q=${encodeURIComponent('Khách xem nợ HĐ')}&from=2000-01-01&to=2100-01-01`);
  const byId = Object.fromEntries(list.map((x) => [x.id, x]));
  assert.equal(byId[a.id].debt, 500000); // số ghi nợ lúc bán giữ nguyên
  assert.equal(byId[a.id].debt_left, 0);
  assert.equal(byId[b.id].debt_left, 0);
  // Hoá đơn không ghi nợ: còn nợ 0
  assert.equal(byId[a.id].debt_left + byId[b.id].debt_left, 0);
});
