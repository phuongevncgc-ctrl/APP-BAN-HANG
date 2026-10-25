// Mã QR chuyển khoản chuẩn VietQR (NAPAS), tạo ngay trong máy: mất Internet vẫn hiện được.
import qrcode from 'qrcode-generator';

const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

// CRC16-CCITT (0xFFFF), theo chuẩn EMVCo
function crc16(s) {
  let crc = 0xffff;
  for (const ch of new TextEncoder().encode(s)) {
    crc ^= ch << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Nội dung chuyển khoản chỉ nên có chữ không dấu, số, khoảng trắng
const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);

export function vietQrPayload({ bin, account, amount, info }) {
  const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', String(bin)) + tlv('01', String(account))) + tlv('02', 'QRIBFTTA');
  const amt = Math.round(Number(amount) || 0);
  let s = tlv('00', '01') + tlv('01', amt > 0 ? '12' : '11') + tlv('38', merchant) + tlv('53', '704');
  if (amt > 0) s += tlv('54', String(amt));
  s += tlv('58', 'VN');
  if (plain(info)) s += tlv('62', tlv('08', plain(info)));
  s += '6304';
  return s + crc16(s);
}

// Ảnh QR (data URL) để đặt vào <img>
export function vietQrImage(opts) {
  const qr = qrcode(0, 'M');
  qr.addData(vietQrPayload(opts));
  qr.make();
  return qr.createDataURL(6, 4);
}
