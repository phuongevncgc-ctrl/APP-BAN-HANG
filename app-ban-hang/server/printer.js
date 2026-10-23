// In thẳng ra máy in qua mạng LAN (cổng 9100, kiểu "raw").
// Giao diện vẽ sẵn hoá đơn / tem thành ảnh đen trắng, máy chủ chỉ đóng gói thành lệnh máy in:
//  - Máy in hoá đơn K80/K58: lệnh ESC/POS in ảnh (GS v 0) rồi cắt giấy.
//  - Máy in tem (TSC, Xprinter, HPRT...): lệnh TSPL (SIZE, GAP, BITMAP, PRINT).
import net from 'node:net';
import { bad } from './util.js';

// Gửi dữ liệu tới máy in, báo lỗi dễ hiểu nếu không kết nối được.
export function sendRaw(ip, port, data, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: ip, port });
    const fail = (msg) => {
      sock.destroy();
      reject(bad(msg));
    };
    sock.setTimeout(timeoutMs, () => fail(`Máy in ${ip} không trả lời. Kiểm tra máy in đã bật và đúng địa chỉ IP chưa.`));
    sock.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') fail(`Máy in ${ip} từ chối kết nối ở cổng ${port}.`);
      else if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') fail(`Không tìm thấy máy in ${ip} trong mạng.`);
      else fail(`Lỗi máy in ${ip}: ${err.message}`);
    });
    sock.on('connect', () => {
      if (!data) {
        sock.end();
        return resolve();
      }
      sock.end(data, () => resolve());
    });
  });
}

// Ảnh: { width (điểm, chia hết cho 8), height, data: base64 các bit 1 = đen, từng hàng từ trái sang phải }
export function readImage(img) {
  const width = Number(img?.width);
  const height = Number(img?.height);
  if (!Number.isInteger(width) || width <= 0 || width % 8 || width > 2400) throw bad('Ảnh in không hợp lệ (chiều ngang)');
  if (!Number.isInteger(height) || height <= 0 || height > 20000) throw bad('Ảnh in không hợp lệ (chiều dọc)');
  const data = Buffer.from(String(img.data ?? ''), 'base64');
  if (data.length !== (width / 8) * height) throw bad('Ảnh in không hợp lệ (dữ liệu)');
  return { width, height, data };
}

// ESC/POS: in ảnh theo từng dải để máy in đủ bộ nhớ, rồi đẩy giấy và cắt.
export function escposImage(images, { cut = true } = {}) {
  const parts = [Buffer.from([0x1b, 0x40])]; // ESC @ khởi động lại máy in
  for (const img of images) {
    const bytesPerRow = img.width / 8;
    const band = 256;
    for (let y = 0; y < img.height; y += band) {
      const h = Math.min(band, img.height - y);
      parts.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, h & 0xff, h >> 8]));
      parts.push(img.data.subarray(y * bytesPerRow, (y + h) * bytesPerRow));
    }
    parts.push(Buffer.from([0x1b, 0x64, 0x04])); // đẩy giấy 4 dòng
    if (cut) parts.push(Buffer.from([0x1d, 0x56, 0x42, 0x00])); // cắt giấy
  }
  return Buffer.concat(parts);
}

// TSPL: mỗi ảnh là một hàng tem (vd 2 tem nằm ngang). invert: TSPL quy ước bit 0 = in đen.
export function tsplImages(images, { widthMm, heightMm, gapMm = 2, invert = true, density = 8, speed = 4 }) {
  const head = [
    `SIZE ${widthMm} mm,${heightMm} mm`,
    `GAP ${gapMm} mm,0 mm`,
    `SPEED ${speed}`,
    `DENSITY ${density}`,
    'DIRECTION 1,0',
    'REFERENCE 0,0',
    'SET TEAR ON',
  ].join('\r\n');
  const parts = [Buffer.from(`${head}\r\n`, 'latin1')];
  for (const img of images) {
    const bytesPerRow = img.width / 8;
    const bits = invert ? Buffer.from(img.data.map((b) => ~b & 0xff)) : img.data;
    parts.push(Buffer.from(`CLS\r\nBITMAP 0,0,${bytesPerRow},${img.height},0,`, 'latin1'));
    parts.push(bits);
    parts.push(Buffer.from('\r\nPRINT 1,1\r\n', 'latin1'));
  }
  return Buffer.concat(parts);
}

// Đọc và kiểm tra danh sách máy in từ cài đặt.
export function readPrinters(list) {
  if (!Array.isArray(list)) throw bad('Danh sách máy in không hợp lệ');
  return list.map((p, i) => {
    const name = String(p.name ?? '').trim().slice(0, 60) || `Máy in ${i + 1}`;
    const ip = String(p.ip ?? '').trim();
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !/^[a-z0-9.-]+$/i.test(ip)) throw bad(`"${name}": địa chỉ IP không đúng`);
    const port = Number(p.port) || 9100;
    if (!['k80', 'k58', 'label'].includes(p.type)) throw bad(`"${name}": chưa chọn loại máy in`);
    const num = (v, def, min, max) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= min && n <= max ? n : def;
    };
    return {
      id: String(p.id || `p${Date.now().toString(36)}${i}`).slice(0, 30),
      name,
      ip,
      port,
      type: p.type,
      // Tem: kích thước 1 tem, số tem 1 hàng, khoảng cách giữa các tem
      label_w: num(p.label_w, 35, 10, 120),
      label_h: num(p.label_h, 22, 10, 150),
      columns: num(p.columns, 2, 1, 4),
      col_gap: num(p.col_gap, 2, 0, 20),
      gap: num(p.gap, 2, 0, 20),
      invert: p.invert !== false,
      density: num(p.density, 8, 1, 15),
      show_shop: p.show_shop !== false,
      show_price: p.show_price !== false,
    };
  });
}
