import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { openDb } from '../db.js';
import { createApp } from '../app.js';

let server, base, token, dataDir, fake, port;
const received = [];

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
const post = (u, b) => call('POST', u, b);
const put = (u, b) => call('PUT', u, b);

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banhang-'));
  server = createApp(openDb(':memory:'), { dataDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  token = (await post('/setup', { username: 'chu', password: '1234' })).token;
  // Máy in giả: nhận dữ liệu qua cổng TCP
  fake = net.createServer((sock) => {
    const chunks = [];
    sock.on('data', (d) => chunks.push(d));
    sock.on('end', () => received.push(Buffer.concat(chunks)));
  }).listen(0);
  await new Promise((r) => fake.once('listening', r));
  port = fake.address().port;
});
after(() => {
  server.close();
  fake.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const waitData = async (n) => {
  for (let i = 0; i < 50 && received.length < n; i++) await new Promise((r) => setTimeout(r, 20));
  return received[n - 1];
};

test('in hoá đơn K80 và tem 2 con qua IP', async () => {
  const list = await put('/printers', [
    { name: 'Hoá đơn', ip: '127.0.0.1', port, type: 'k80' },
    { name: 'Tem', ip: '127.0.0.1', port, type: 'label', label_w: 35, label_h: 22, columns: 2 },
  ]);
  assert.equal(list.length, 2);
  await post('/printers/check', { ip: '127.0.0.1', port });

  // Ảnh 16 x 2 điểm: hàng 1 đen hết, hàng 2 trắng
  const img = { width: 16, height: 2, data: Buffer.from([0xff, 0xff, 0, 0]).toString('base64') };
  await post('/print', { printer_id: list[0].id, images: [img] });
  const esc = await waitData(2);
  assert.deepEqual([...esc.subarray(0, 2)], [0x1b, 0x40]);
  assert.deepEqual([...esc.subarray(2, 10)], [0x1d, 0x76, 0x30, 0, 2, 0, 2, 0]);
  assert.deepEqual([...esc.subarray(10, 14)], [0xff, 0xff, 0, 0]);

  await post('/print', { printer_id: list[1].id, images: [img], copies: 2 });
  const tspl = (await waitData(3)).toString('latin1');
  assert.match(tspl, /SIZE 72 mm,22 mm/);
  assert.equal(tspl.match(/PRINT 1,1/g).length, 2);
  assert.match(tspl, /BITMAP 0,0,2,2,0,\x00\x00\xff\xff/); // đảo bit: 0 = đen

  await assert.rejects(post('/print', { printer_id: list[0].id, images: [{ width: 10, height: 1, data: '' }] }), /không hợp lệ/);
  await assert.rejects(put('/printers', [{ name: 'X', ip: 'a b', type: 'k80' }]), /IP/);
  await assert.rejects(post('/printers/check', { ip: '127.0.0.1', port: 1 }), /từ chối/);
});
