import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db.js';
import { createApp } from '../app.js';

let server, base, token, staffToken, db, dataDir;

async function call(method, url, body, tok = token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error);
    err.status = res.status;
    throw err;
  }
  return data;
}
const get = (u, t) => call('GET', u, null, t);
const post = (u, b, t) => call('POST', u, b, t);

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banhang-'));
  db = openDb(':memory:');
  server = createApp(db, { dataDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const today = new Date().toLocaleDateString('sv');
let pA, pB, cust, wholesale;

test('cài đặt lần đầu và đăng nhập', async () => {
  assert.equal((await get('/status')).needSetup, true);
  token = (await post('/setup', { username: 'chu', password: 'matkhau-1234', shop_name: 'Tạp hoá Phương' })).token;
  assert.equal((await get('/status')).user.role, 'owner');
  await assert.rejects(post('/setup', { username: 'x', password: 'matkhau-1234' }), /Đã cài đặt/);
  await post('/users', { username: 'nv1', name: 'Lan', password: 'nhanvien-1111' });
  staffToken = (await post('/login', { username: 'NV1', password: 'nhanvien-1111' }, null)).token;
  await assert.rejects(post('/login', { username: 'nv1', password: 'sai' }, null), /Sai/);
});

test('tạo hàng hoá, tìm không dấu, nhân viên không thấy giá vốn', async () => {
  pA = (await post('/products', { name: 'Nước mắm Nam Ngư', barcode: '8934', unit: 'chai', cost: 30000, price: 40000, stock: 10 })).id;
  pB = (await post('/products', { name: 'Gạo ST25', unit: 'kg', cost: 20000, price: 30000, stock: 50 })).id;
  const found = await get('/products?q=nuoc%20mam');
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'SP000001');
  assert.equal(found[0].cost, 30000);
  assert.equal((await get('/products?q=nuoc', staffToken))[0].cost, undefined);
  assert.equal((await get('/products/lookup?code=8934')).id, pA);
  await assert.rejects(post('/products', { name: 'Trùng', barcode: '8934', price: 1 }), /đã dùng/);
  await assert.rejects(post('/products', { name: 'X', price: 1 }, staffToken), /Chỉ chủ/);
});

test('bảng giá: giá sỉ cho khách', async () => {
  wholesale = (await get('/price-lists'))[0].id;
  await call('PUT', `/price-lists/${wholesale}/items`, { items: [{ product_id: pA, price: 36000 }] });
  cust = await post('/customers', { name: 'Chị Hoa', phone: '0909', price_list_id: wholesale }, staffToken);
  const rows = await get(`/products?q=nuoc&price_list=${wholesale}`);
  assert.equal(rows[0].sell_price, 36000);
  assert.equal((await get(`/products?q=gao&price_list=${wholesale}`))[0].sell_price, 30000);
});

test('bán hàng: giảm giá từng dòng, tách thanh toán, thối tiền', async () => {
  const inv = await post('/invoices', {
    items: [
      { product_id: pA, qty: 2, price: 40000, discount: 5000 }, // 70.000
      { product_id: pB, qty: 1.5, price: 30000, discount: 0 }, // 45.000
    ],
    discount: 15000, // còn 100.000
    payments: [{ method: 'transfer', amount: 50000 }, { method: 'cash', amount: 60000 }],
  }, staffToken);
  assert.equal(inv.code, 'HD000001');
  assert.equal(inv.subtotal, 115000);
  assert.equal(inv.total, 100000);
  assert.equal(inv.change_amount, 10000);
  assert.equal(inv.debt, 0);
  assert.deepEqual(inv.payments.map((p) => [p.method, p.amount]), [['transfer', 50000], ['cash', 50000]]);
  assert.equal((await get(`/products/${pA}`)).stock, 8);
  assert.equal((await get(`/products/${pB}`)).stock, 48.5);
});

test('bán thiếu tiền: phải có khách, ghi nợ', async () => {
  const items = [{ product_id: pA, qty: 1, price: 36000 }];
  await assert.rejects(post('/invoices', { items, payments: [] }, staffToken), /ghi nợ/);
  await assert.rejects(post('/invoices', { items, payments: [{ method: 'transfer', amount: 50000 }] }, staffToken), /tiền mặt/);
  const inv = await post('/invoices', { items, customer_id: cust.id, price_list_id: wholesale, payments: [{ method: 'cash', amount: 6000 }] }, staffToken);
  assert.equal(inv.debt, 30000);
  assert.equal((await get(`/customers/${cust.id}`)).debt, 30000);
  await assert.rejects(post(`/customers/${cust.id}/pay`, { amount: 25000, discount: 6000 }, staffToken), /vượt công nợ/);
  await post(`/customers/${cust.id}/pay`, { amount: 10000, method: 'transfer' }, staffToken);
  assert.equal((await get(`/customers/${cust.id}`)).debt, 20000);
});

test('trả hàng: hoàn tiền chia theo giảm giá hoá đơn, cộng lại kho', async () => {
  const inv = await get('/invoices/1');
  const line = inv.items.find((i) => i.product_id === pA); // 2 x 35.000, hệ số 100/115
  await assert.rejects(post('/returns', { invoice_id: 1, items: [{ invoice_item_id: line.id, qty: 3 }] }), /chỉ còn trả được 2/);
  const r1 = await post('/returns', { invoice_id: 1, items: [{ invoice_item_id: line.id, qty: 1 }], refund_method: 'cash' }, staffToken);
  assert.equal(r1.total, Math.round(35000 * 100000 / 115000)); // 30.435
  const r2 = await post('/returns', { invoice_id: 1, items: [{ invoice_item_id: line.id, qty: 1 }] }, staffToken);
  assert.equal(r1.total + r2.total, Math.round(70000 * 100000 / 115000)); // không lệch do làm tròn
  assert.equal((await get(`/products/${pA}`)).stock, 9);
  await assert.rejects(post('/invoices/1/cancel', {}), /đã có trả hàng/);
});

test('trả hàng trừ vào công nợ', async () => {
  const inv = await get('/invoices/2');
  await post('/returns', { invoice_id: 2, items: [{ invoice_item_id: inv.items[0].id, qty: 1 }], refund_method: 'debt' });
  assert.equal((await get(`/customers/${cust.id}`)).debt, -16000); // 20.000 nợ - 36.000 trả = cửa hàng nợ lại khách
});

test('huỷ hoá đơn: chỉ chủ, hoàn kho và nợ', async () => {
  const inv = await post('/invoices', {
    items: [{ product_id: pB, qty: 2, price: 30000 }], customer_id: cust.id, payments: [{ method: 'cash', amount: 20000 }],
  });
  await assert.rejects(post(`/invoices/${inv.id}/cancel`, {}, staffToken), /Chỉ chủ/);
  const before = (await get(`/customers/${cust.id}`)).debt;
  const res = await post(`/invoices/${inv.id}/cancel`, {});
  assert.equal(res.status, 'cancelled');
  assert.equal((await get(`/customers/${cust.id}`)).debt, before - 40000);
  assert.equal((await get(`/products/${pB}`)).stock, 48.5);
});

test('nhập hàng: giá vốn bình quân, nợ nhà cung cấp', async () => {
  const sup = await post('/suppliers', { name: 'Đại lý Minh' });
  // tồn 10 chai giá 30.000, nhập 11 chai giá 32.000 -> (300.000 + 352.000) / 21 = 31.048
  const pur = await post('/purchases', { supplier_id: sup.id, items: [{ product_id: pA, qty: 11, cost: 32000 }], paid: 300000 });
  assert.equal(pur.total, 352000);
  const p = await get(`/products/${pA}`);
  assert.equal(p.stock, 21);
  assert.equal(p.cost, 31048);
  assert.equal((await get('/suppliers'))[0].debt, 52000);
  await assert.rejects(post(`/suppliers/${sup.id}/pay`, { amount: 52001 }), /vượt công nợ/);
});

test('báo cáo: doanh thu, lãi, dòng tiền', async () => {
  const r = await get(`/reports/summary?from=${today}&to=${today}`);
  // HD1 100.000 + HD2 36.000 (HD3 đã huỷ); trả 60.870 + 36.000
  assert.equal(r.sales.count, 2);
  assert.equal(r.sales.total, 136000);
  assert.equal(r.returns.total, 60870 + 36000);
  assert.equal(r.revenue, 136000 - 96870);
  // giá vốn: HD1 2*30.000 + 1.5*20.000 = 90.000; HD2 30.000; trả 2*30.000 + 30.000
  assert.equal(r.cost, 30000);
  assert.equal(r.profit, r.revenue - 30000);
  // tiền mặt: 50.000 + 6.000 - 30.435 - 30.435(lần 2 mặc định tiền mặt) + 20.000 - 20.000(huỷ) - 300.000(nhập)
  assert.equal(r.cashflow.cash, 50000 + 6000 - 60870 - 300000);
  assert.equal(r.cashflow.transfer, 50000 + 10000);
  assert.equal(r.byDay.length, 1);
  await assert.rejects(get('/reports/summary', staffToken), /Chỉ chủ/);
  assert.equal((await get('/reports/today', staffToken)).revenue, r.revenue);
});

test('sao lưu', async () => {
  const { name } = await post('/backups', {});
  assert.match(name, /^banhang-.*\.db$/);
  assert.equal((await get('/backups')).length, 1);
});

test('đăng nhập sai 5 lần thì phải đợi', async () => {
  await post('/users', { username: 'nv9', name: 'Thử', password: 'nhanvien-9999' });
  for (let i = 0; i < 5; i++) await assert.rejects(post('/login', { username: 'nv9', password: 'sai' }, null), /Sai/);
  await assert.rejects(post('/login', { username: 'nv9', password: 'nhanvien-9999' }, null), /đợi 5 phút/);
  // Tài khoản khác không bị ảnh hưởng
  assert.ok((await post('/login', { username: 'nv1', password: 'nhanvien-1111' }, null)).token);
});

test('chặn tải ảnh từ địa chỉ trong nhà', async () => {
  const { privateAddress } = await import('../routes/catalog.js');
  for (const ip of ['127.0.0.1', '192.168.1.5', '10.0.0.1', '172.20.0.2', '169.254.169.254', '100.64.0.1', '::1', '::ffff:192.168.1.1', 'fd00::1', 'fe80::1']) assert.ok(privateAddress(ip), ip);
  for (const ip of ['8.8.8.8', '113.161.1.1', '2001:4860::8888']) assert.ok(!privateAddress(ip), ip);
});

test('báo cáo: so với kỳ trước, theo giờ, gợi ý nhập hàng, hàng bán chậm', async () => {
  const r = await get(`/reports/summary?from=${today}&to=${today}`);
  assert.ok(r.previous && typeof r.previous.revenue === 'number');
  assert.ok(r.byHour.length >= 1 && r.byHour.every((h) => h.hour >= 0 && h.hour < 24));
  assert.ok(Array.isArray(r.topCustomers) && Array.isArray(r.byCategory));
  const fast = await post('/products', { name: 'Hàng bán nhanh', price: 1000, cost: 500, stock: 50, min_stock: 0 });
  const dead = await post('/products', { name: 'Hàng nằm kho', price: 1000, cost: 700, stock: 10 });
  await post('/invoices', { items: [{ product_id: fast.id, qty: 45, price: 1000 }], payments: [{ method: 'cash', amount: 45000 }] });
  const a = await get('/reports/products?days=30');
  const f = a.reorder.find((x) => x.id === fast.id);
  assert.ok(f, 'hàng bán nhanh phải nằm trong danh sách cần nhập');
  assert.equal(f.stock, 5);
  assert.equal(f.suggest, 40); // 1,5 cái/ngày x 30 ngày - 5 còn lại
  assert.ok(f.suggest >= 1);
  // Hàng vừa thêm hôm nay chưa đủ 30 ngày nên chưa tính là bán chậm
  assert.ok(!a.slow.some((x) => x.id === dead.id) && a.tooNew >= 1);
  db.prepare("UPDATE products SET created_at = datetime('now', '-40 days') WHERE id = ?").run(dead.id);
  const d = (await get('/reports/products?days=30')).slow.find((x) => x.id === dead.id);
  assert.equal(d.value, 7000);
  await assert.rejects(get('/reports/products', staffToken), /chủ/i);
  const owing = await get('/customers?debt=1&sort=debt');
  assert.ok(owing.every((c, i) => i === 0 || owing[i - 1].debt >= c.debt));
});
