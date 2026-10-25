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

let ong, cay;

test('đơn vị quy đổi: tạo, tìm theo mã đơn vị, giá theo bảng giá', async () => {
  ong = (await post('/products', {
    code: 'bmo2719', name: 'Ống Hoa Sen 60', unit: 'Mét', cost: 10000, price: 15000, stock: 100,
    units: [{ name: 'Cây', factor: 4, price: 56000, code: 'BMO2719C', barcode: '893111' }],
    prices: { '1:0': 14000, '1:new0': 52000 },
  })).id;
  const p = await get(`/products/${ong}`);
  assert.equal(p.code, 'BMO2719');
  assert.equal(p.units.length, 1);
  cay = p.units[0].id;
  assert.deepEqual(p.prices, { '1:0': 14000, [`1:${cay}`]: 52000 });
  assert.equal((await get('/products?q=ong%2060'))[0].id, ong);
  assert.equal((await get('/products?q=BMO2719C'))[0].id, ong);
  const hit = await get('/products/lookup?code=893111&price_list=1');
  assert.equal(hit.unit_id, cay);
  assert.equal(hit.units[0].sell_price, 52000);
  assert.equal(hit.sell_price, 14000);
  await assert.rejects(post('/products', { name: 'X', code: 'BMO2719C', price: 1 }), /đã dùng/);
  await assert.rejects(put(`/products/${ong}`, { ...p, units: [{ name: 'mét', factor: 2, price: 1 }] }), /trùng/);
});

test('bán theo đơn vị quy đổi: trừ kho theo đơn vị gốc, giá vốn nhân hệ số', async () => {
  const inv = await post('/invoices', {
    items: [{ product_id: ong, unit_id: cay, qty: 2, price: 56000 }, { product_id: ong, qty: 3, price: 15000 }],
    payments: [{ method: 'cash', amount: 157000 }],
  });
  assert.equal(inv.items[0].unit, 'Cây');
  assert.equal(inv.items[0].cost, 40000);
  assert.equal((await get(`/products/${ong}`)).stock, 100 - 8 - 3);
  await post('/returns', { invoice_id: inv.id, items: [{ invoice_item_id: inv.items[0].id, qty: 1 }] });
  assert.equal((await get(`/products/${ong}`)).stock, 93);
  const r = await get(`/reports/summary`);
  assert.equal(r.topProducts[0].qty, 7); // 2 cây (8m) + 3m - 1 cây (4m) trả
  assert.equal(r.cost, 80000 + 30000 - 40000);
});

test('nhập hàng theo cây, giá vốn bình quân theo mét; trả NCC', async () => {
  const sup = await post('/suppliers', { name: 'Hoa Sen' });
  // tồn 93m giá 10.000; nhập 10 cây (40m) giá 48.000/cây = 12.000/m
  const pur = await post('/purchases', { supplier_id: sup.id, items: [{ product_id: ong, unit_id: cay, qty: 10, cost: 48000 }], paid: 0 });
  assert.equal(pur.total, 480000);
  let p = await get(`/products/${ong}`);
  assert.equal(p.stock, 133);
  assert.equal(p.cost, Math.round((93 * 10000 + 480000) / 133));
  assert.equal(p.last_cost, 12000);
  await post('/supplier-returns', { supplier_id: sup.id, items: [{ product_id: ong, unit_id: cay, qty: 1, cost: 48000 }] });
  p = await get(`/products/${ong}`);
  assert.equal(p.stock, 129);
  assert.equal((await get('/suppliers'))[0].debt, 432000);
});

test('không cho bán âm kho khi tắt cài đặt', async () => {
  await put('/settings', { allow_negative_stock: '0' });
  await assert.rejects(post('/invoices', { items: [{ product_id: ong, unit_id: cay, qty: 40, price: 1 }], payments: [{ method: 'cash', amount: 40 }] }), /Không đủ hàng/);
  await put('/settings', { allow_negative_stock: '1' });
});

test('đơn tạm: lưu, sửa, xoá khi thanh toán', async () => {
  const { id } = await post('/drafts', { name: 'Anh Ba', data: { lines: [1, 2] } });
  await post('/drafts', { id, name: 'Anh Ba 2', data: { lines: [1] } });
  const list = await get('/drafts');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Anh Ba 2');
  await post('/invoices', { draft_id: id, items: [{ product_id: ong, qty: 1, price: 15000 }], payments: [{ method: 'cash', amount: 15000 }] });
  assert.equal((await get('/drafts')).length, 0);
});

test('nhập Excel KiotViet: gom đơn vị, gỡ hàng tách sai', async () => {
  // Giả lập lần nhập sai trước: BMO3000C thành hàng riêng
  await post('/products', { code: 'BMO3000C', name: 'Dây điện (Cuộn)', price: 1 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hàng hóa');
  ws.addRow(['Loại hàng', 'Nhóm hàng(3 Cấp)', 'Mã hàng', 'Mã vạch', 'Tên hàng', 'Giá bán', 'Giá vốn', 'Tồn kho', 'Tồn nhỏ nhất', 'ĐVT', 'Mã ĐVT Cơ bản', 'Quy đổi', 'Đang kinh doanh', 'Được bán trực tiếp']);
  ws.addRow(['Hàng hóa', 'Điện>>Dây điện', 'BMO3000', '8930001', 'Dây điện Cadivi 2.5', 9000, 7000, 500, 100, 'Mét', '', 1, 1, 1]);
  ws.addRow(['Hàng hóa', 'Điện>>Dây điện', 'BMO3000C', '8930002', 'Dây điện Cadivi 2.5', 850000, 0, 5, 0, 'Cuộn', 'BMO3000', 100, 1, 1]);
  ws.addRow(['Hàng hóa', 'Điện', 'QUAT01', '', 'Quạt trần Panasonic', 1170000, 1000000, 2, 0, 'Cái', '', 1, 1, 1]);
  ws.addRow(['Hàng hóa', '', '', '', 'Dòng thiếu mã', 1, 1, 1, 0, 'Cái', '', 1, 1, 1]);
  ws.addRow(['Dịch vụ', '', 'LAPDAT', '', 'Công lắp đặt', 100000, 0, 0, 0, 'Lần', '', 1, 1, 1]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const r = await call('POST', '/products/import', null, buf);
  assert.equal(r.created, 3);
  assert.equal(r.units, 1);
  assert.equal(r.merged, 1);
  assert.equal(r.errors.length, 1);
  const [p] = await get('/products?q=BMO3000');
  assert.equal(p.name, 'Dây điện Cadivi 2.5');
  assert.equal(p.category_name, 'Dây điện');
  assert.equal(p.stock, 500);
  assert.deepEqual(p.units.map((u) => [u.name, u.factor, u.price, u.code]), [['Cuộn', 100, 850000, 'BMO3000C']]);
  assert.equal((await get('/products?q=lap%20dat'))[0].track_stock, 0);
  // Nhập lại lần 2: cập nhật, không nhân đôi
  const r2 = await call('POST', '/products/import', null, buf);
  assert.equal(r2.created, 0);
  assert.equal(r2.updated, 0);
  assert.equal(r2.unchanged, 3);
  assert.equal((await get('/products/stats')).total, 4);
});

const xlsx = async (rows, title) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  if (title) ws.addRow([title]);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
};

test('cập nhật từ KiotViet: xem trước, chỉ đổi cột có trong file, bảng giá, giá theo mã ĐVT', async () => {
  const before = (await get('/products?q=BMO3000'))[0];
  // File chỉ có mã + giá bán (vd xuất bảng giá): không được xoá giá vốn, tồn kho
  const buf = await xlsx([
    ['Mã hàng', 'Tên hàng', 'Giá bán', 'Giá sỉ'],
    ['BMO3000', 'Dây điện Cadivi 2.5', 9500, 9000],
    ['BMO3000C', 'Dây điện Cadivi 2.5', 900000, 880000],
    ['MOI01', 'Hàng mới', 5000, ''],
  ], 'Danh sách hàng hoá');
  const dry = await call('POST', '/products/import?dry=1', null, buf);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.created, 1);
  assert.equal(dry.updated, 1);
  assert.deepEqual(dry.changes.map((c) => [c.code, c.from, c.to]), [['BMO3000', 9000, 9500], ['BMO3000C', 850000, 900000]]);
  assert.equal((await get('/products?q=BMO3000'))[0].price, 9000, 'xem trước không được đổi dữ liệu');
  assert.equal((await get('/products?q=MOI01')).length, 0);

  await call('POST', '/products/import', null, buf);
  const p = (await get(`/products/${before.id}`));
  assert.equal(p.price, 9500);
  assert.equal(p.cost, before.cost);
  assert.equal(p.stock, before.stock);
  assert.equal(p.unit, 'Mét');
  assert.equal(p.units[0].price, 900000);
  assert.deepEqual(p.prices, { '1:0': 9000, [`1:${p.units[0].id}`]: 880000 });
  assert.equal((await get('/products?q=BMO3000C'))[0].id, before.id, 'mã ĐVT không thành hàng mới');
});

test('nhập khách hàng và nhà cung cấp từ KiotViet', async () => {
  const buf = await xlsx([
    ['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Địa chỉ', 'Nợ cần thu hiện tại'],
    ['KH000050', 'Chú Bảy', '0901 222 333', 'Chợ Lớn', 1500000],
    ['KH000051', 'Cô Tám', '', '', 0],
  ]);
  const r = await call('POST', '/products/import', null, buf);
  assert.equal(r.kind, 'customers');
  assert.equal(r.created, 2);
  const [c] = await get('/customers?q=chu%20bay');
  assert.equal(c.code, 'KH000050');
  assert.equal(c.phone, '0901222333');
  assert.equal(c.debt, 1500000);
  const again = await call('POST', '/products/import?update_stock=0', null, await xlsx([
    ['Mã khách hàng', 'Tên khách hàng', 'Nợ cần thu hiện tại'], ['KH000050', 'Chú Bảy', 999],
  ]));
  assert.equal(again.created, 0);
  assert.equal((await get('/customers?q=chu%20bay'))[0].debt, 1500000, 'không tick cập nhật nợ thì giữ nguyên');
  const s = await call('POST', '/products/import', null, await xlsx([
    ['Mã nhà cung cấp', 'Tên nhà cung cấp', 'Điện thoại', 'Nợ cần trả hiện tại'], ['NCC01', 'Cadivi', '028', 2000000],
  ]));
  assert.equal(s.kind, 'suppliers');
  assert.equal(s.created, 1);
});

test('chuyển dữ liệu từ db.json app cũ', async () => {
  const old = {
    products: [{ code: 'BLM36', name: 'Bát led M36', group: 'Điện', unit: 'Bộ', cost: 7000, price: 10000, stock: 2,
      units: [{ name: 'Bộ', factor: 1, isBase: true, price: 10000 }, { name: 'Thùng', factor: 20, price: 190000, code: 'BLM36T' }] }],
    customers: [{ id: 'khach-than-thiet', name: 'KH thân thiết', debt: 0 }, { id: 'c1', name: 'Anh Tư', phone: '0905', debt: 250000 }],
    suppliers: [{ id: 's1', name: 'Nhà cung cấp tổng', debt: 1000 }],
  };
  const r = await call('POST', '/products/import', null, Buffer.from(JSON.stringify(old)));
  assert.equal(r.created, 1);
  assert.equal(r.customers, 1);
  assert.equal(r.suppliers, 1);
  const [p] = await get('/products?q=BLM36');
  assert.deepEqual(p.units.map((u) => [u.name, u.factor]), [['Thùng', 20]]);
  const [c] = await get('/customers?q=anh%20tu');
  assert.equal(c.debt, 250000);
});

test('tuổi nợ khách và thu nợ có chiết khấu', async () => {
  const c = await post('/customers', { name: 'Chú Năm' });
  await post('/invoices', { customer_id: c.id, items: [{ product_id: ong, qty: 10, price: 15000 }], payments: [] });
  await post('/invoices', { customer_id: c.id, items: [{ product_id: ong, qty: 2, price: 15000 }], payments: [] });
  let d = await get(`/customers/${c.id}`);
  assert.equal(d.debt, 180000);
  assert.equal(d.debt_invoices.length, 2);
  await post(`/customers/${c.id}/pay`, { amount: 145000, discount: 5000 });
  d = await get(`/customers/${c.id}`);
  assert.equal(d.debt, 30000);
  assert.deepEqual(d.debt_invoices.map((x) => x.owing), [30000]);
  assert.equal(d.max_debt_age, 0);
});

test('PSell 1.0: xem trước công nợ, mật khẩu 12 ký tự, hệ số quy đổi sai', async () => {
  const c = (await get('/customers?q=Chú Năm'))[0];
  const d = await get(`/customers/${c.id}/debt-preview?total=100000&paid=40000`);
  assert.deepEqual([d.old_debt, d.new_debt, d.projected_debt], [30000, 60000, 90000]);
  assert.equal((await get(`/customers/${c.id}`)).debt, 30000, 'xem trước không ghi sổ');
  await assert.rejects(get(`/customers/${c.id}/debt-preview?total=100&paid=200`), /vượt tổng/);

  await assert.rejects(post('/users', { username: 'nv9', password: '12345678901' }), /12 ký tự/);
  await post('/users', { username: 'nv9', password: '123456789012' });
  await assert.rejects(put('/me/password', { old_password: 'matkhau-1234', password: 'ngan' }), /12 ký tự/);

  const buf = await xlsx([
    ['Mã hàng', 'Tên hàng', 'ĐVT', 'Mã ĐVT Cơ bản', 'Quy đổi', 'Giá bán'],
    ['HSO1', 'Ống thử', 'Cây', '', 1, 10000],
    ['HSO1C', 'Ống thử', 'Thùng', 'HSO1', 0, 90000],
    ['HSO1T', 'Ống thử', 'Tá', 'HSO1', -3, 90000],
  ]);
  const r = await call('POST', '/products/import', null, buf);
  assert.deepEqual(r.errors.map((e) => e.code), ['HSO1C', 'HSO1T']);
  assert.match(r.errors[0].reason, /Hệ số quy đổi/);
  assert.equal((await get('/products?q=HSO1'))[0].units.length, 0);
});

test('file KiotViet thật: thẻ XML có tiền tố, có bảng; combo; giữ chữ thường của mã', async () => {
  const JSZip = (await import('jszip')).default;
  const raw = await xlsx([
    ['Loại hàng', 'Nhóm hàng(3 Cấp)', 'Mã hàng', 'Tên hàng', 'Giá bán', 'Giá vốn', 'Tồn kho', 'ĐVT', 'Mã ĐVT Cơ bản', 'Quy đổi', 'Hàng thành phần'],
    ['Combo - đóng gói', 'Hàng Hóa', 'bccg49', 'Bộ co cùm gai 49', 75000, 51313.17, 0, 'Bộ', '', 1, 'csnv:1|ctg50:2|rcsb:1'],
    ['Hàng hóa', 'Hàng Hóa', 'csnv', 'Cùm sắt nhỏ', 5000, 3000.5, 100, 'Cái', '', 1, ''],
    ['Hàng hóa', 'Hàng Hóa', 'ctg50', 'Co tê gai 50', 8000, 6000, -3, 'Cái', '', 1, ''],
    ['Hàng hóa', 'Hàng Hóa', 'rcs', 'Ron cao su', 1000, 400, 500, 'Cái', '', 1, ''],
    ['Hàng hóa', 'Hàng Hóa', 'rcsb', 'Ron cao su', 45000, '', 10, 'Bì', 'rcs', 50, ''],
    ['Combo - đóng gói', 'Hàng Hóa', 'cbloi', 'Combo lỗi', 1, 0, 0, 'Bộ', '', 1, 'khongco:1'],
  ]);
  // Làm giống file KiotViet: styles.xml dùng tiền tố x:, trang tính có <tableParts>
  const zip = await JSZip.loadAsync(raw);
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const styles = await zip.file('xl/styles.xml').async('string');
  zip.file('xl/styles.xml', styles.replace(/<(\/?)(?![?!])/g, '<$1x:').replace(`xmlns="${main}"`, `xmlns:x="${main}"`));
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  zip.file('xl/worksheets/sheet1.xml', sheet.replace('</worksheet>',
    '<tableParts count="1"><tablePart p3:id="Rabc" xmlns:p3="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></tableParts></worksheet>'));
  const buf = await zip.generateAsync({ type: 'nodebuffer' });

  const r = await call('POST', '/products/import', null, buf);
  assert.equal(r.combos, 1);
  assert.deepEqual(r.errors.map((e) => [e.code, e.reason]), [['cbloi', 'Không có hàng thành phần mã "khongco"']]);
  const combo = await get('/products/lookup?code=BCCG49');
  assert.equal(combo.code, 'bccg49', 'giữ nguyên chữ thường như KiotViet');
  assert.equal(combo.is_combo, 1);
  // 1 cùm + 2 co tê + 1 bì ron (= 50 cái)
  const parts = Object.fromEntries((await get(`/products/${combo.id}`)).combo_items.map((c) => [c.code, c.qty]));
  assert.deepEqual(parts, { csnv: 1, ctg50: 2, rcs: 50 });
  assert.equal((await get('/products/lookup?code=CTG50')).stock, -3);
  assert.equal((await get('/products/lookup?code=rcsb')).unit_id > 0, true);

  const again = await call('POST', '/products/import', null, buf);
  assert.equal(again.created, 0);
  assert.equal(again.updated, 0, 'nhập lại cùng file không đổi gì');
});
