import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import { notifyTick, readNotify } from '../notify.js';

let server, base, token, dataDir, db, ha;
const haCalls = [];

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
const put = (u, b) => call('PUT', u, b);

before(async () => {
  // Home Assistant giả: liệt kê dịch vụ notify và ghi lại tin nhắn
  ha = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      haCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body && JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/services') return res.end(JSON.stringify([{ domain: 'light', services: { turn_on: {} } }, { domain: 'notify', services: { mobile_app_dien_thoai_chu: {}, send_message: {}, notify: {} } }]));
      res.end('[]');
    });
  }).listen(0);
  await new Promise((r) => ha.once('listening', r));
  process.env.HA_URL = `http://127.0.0.1:${ha.address().port}/`;
  process.env.HA_TOKEN = 'token-thu';

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banhang-'));
  db = openDb(path.join(dataDir, 'banhang.db'));
  server = createApp(db, { dataDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  token = (await post('/setup', { username: 'chu', password: 'matkhau-1234' })).token;
});
after(() => {
  server.close();
  ha.close();
  delete process.env.HA_URL;
  delete process.env.HA_TOKEN;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('khôi phục dữ liệu từ bản sao lưu', async () => {
  const p = (await post('/products', { name: 'Ống nhựa', unit: 'Mét', cost: 5000, price: 8000, stock: 100 })).id;
  const c = await post('/customers', { name: 'Anh Ba' });
  await post('/invoices', { customer_id: c.id, items: [{ product_id: p, qty: 10, price: 8000 }], payments: [] });
  const { name } = await post('/backups');

  // Sau khi sao lưu: bán thêm, thêm hàng mới
  await post('/invoices', { customer_id: c.id, items: [{ product_id: p, qty: 5, price: 8000 }], payments: [] });
  await post('/products', { name: 'Hàng sau sao lưu', price: 1 });
  assert.equal((await get(`/customers/${c.id}`)).debt, 120000);

  const r = await post(`/backups/${name}/restore`);
  assert.ok(r.before.startsWith('banhang-'), 'sao lưu dữ liệu hiện tại trước khi khôi phục');
  assert.equal((await get(`/customers/${c.id}`)).debt, 80000);
  assert.equal((await get(`/products/${p}`)).stock, 90);
  assert.equal((await get('/products?q=sau sao luu')).length, 0);
  assert.equal((await get('/status')).user.username, 'chu', 'người khôi phục vẫn đăng nhập');

  // Khôi phục ngược lại từ file tải lên (bản vừa tự sao lưu trước khi khôi phục)
  const buf = fs.readFileSync(path.join(dataDir, 'backups', r.before));
  await call('POST', '/backups/restore', null, buf);
  assert.equal((await get(`/customers/${c.id}`)).debt, 120000);
  assert.equal((await get('/products?q=sau sao luu')).length, 1);

  // File hỏng: báo lỗi, dữ liệu không đổi
  await assert.rejects(call('POST', '/backups/restore', null, Buffer.from('khong phai file sqlite '.repeat(100))), /không phải bản sao lưu/);
  assert.equal((await get(`/customers/${c.id}`)).debt, 120000);
});

test('báo cáo cuối ngày gửi về điện thoại qua Home Assistant', async () => {
  const n = await get('/notify');
  assert.deepEqual(n.available, ['mobile_app_dien_thoai_chu', 'notify']);
  assert.equal(n.enabled, false);
  await assert.rejects(put('/notify', { enabled: true, services: ['mobile_app_dien_thoai_chu'], time: '25:00' }), /Giờ/);
  await put('/notify', { enabled: true, services: ['mobile_app_dien_thoai_chu', '../x'], time: '21:00' });
  assert.deepEqual(readNotify(db).services, ['mobile_app_dien_thoai_chu']);

  await post('/cash-entries', { kind: 'out', category: 'expense', amount: 30000, note: 'Tiền điện' });
  const msg = await post('/notify/test', {});
  assert.match(msg.message, /Doanh thu: 120\.000đ \(2 hoá đơn\)/);
  assert.match(msg.message, /Lợi nhuận gộp: 45\.000đ/);
  assert.match(msg.message, /Chi phí: 30\.000đ/);
  assert.match(msg.message, /Lãi ròng: 15\.000đ/);
  const sent = haCalls.at(-1);
  assert.equal(sent.url, '/api/services/notify/mobile_app_dien_thoai_chu');
  assert.equal(sent.auth, 'Bearer token-thu');
  assert.equal(sent.body.title, msg.title);

  // Hẹn giờ: trước 21:00 chưa gửi, sau 21:00 gửi đúng một lần mỗi ngày
  const count = haCalls.length;
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
  assert.equal(await notifyTick(db, at(20, 59)), false);
  assert.equal(await notifyTick(db, at(21, 0)), true);
  assert.equal(await notifyTick(db, at(21, 5)), false);
  assert.equal(haCalls.length, count + 1);
});

test('quên mật khẩu: đặt lại mật khẩu chủ qua cấu hình add-on, chỉ áp dụng một lần', async () => {
  const { resetOwnerPassword } = await import('../auth.js');
  assert.throws(() => resetOwnerPassword(db, 'ngan'), /12 ký tự/);
  assert.deepEqual(resetOwnerPassword(db, 'matkhau-moi-2026'), ['chu']);
  const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'CHU', password: 'matkhau-moi-2026' }) });
  assert.equal(login.status, 200);
  token = (await login.json()).token;
  await put('/me/password', { old_password: 'matkhau-moi-2026', password: 'mat-khau-tu-doi-1' });
  assert.equal(resetOwnerPassword(db, 'matkhau-moi-2026'), null, 'khởi động lại không ghi đè mật khẩu chú tự đổi');
});
