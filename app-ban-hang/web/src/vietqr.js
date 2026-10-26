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

// Ngân hàng hay dùng: [mã BIN, tên]
export const BANKS = [
  ['970436', 'Vietcombank'], ['970415', 'VietinBank'], ['970418', 'BIDV'], ['970405', 'Agribank'], ['970407', 'Techcombank'],
  ['970422', 'MB Bank'], ['970416', 'ACB'], ['970432', 'VPBank'], ['970403', 'Sacombank'], ['970423', 'TPBank'],
  ['970441', 'VIB'], ['970443', 'SHB'], ['970437', 'HDBank'], ['970426', 'MSB'], ['970448', 'OCB'], ['970440', 'SeABank'],
  ['970449', 'LPBank'], ['970431', 'Eximbank'], ['970428', 'Nam A Bank'], ['970409', 'Bac A Bank'],
];

export const bankName = (bin) => BANKS.find(([b]) => b === bin)?.[1] ?? '';

// Gửi nội dung qua Zalo / tin nhắn: điện thoại thì mở bảng chia sẻ (kèm ảnh QR nếu được), máy tính thì chép vào bộ nhớ
export async function shareText(text, qrDataUrl) {
  if (navigator.share) {
    try {
      if (qrDataUrl && navigator.canShare) {
        const blob = await (await fetch(qrDataUrl)).blob();
        const file = new File([blob], 'ma-qr-chuyen-khoan.gif', { type: blob.type });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ text, files: [file] });
          return;
        }
      }
      await navigator.share({ text });
    } catch {
      /* người dùng huỷ */
    }
  } else {
    await navigator.clipboard?.writeText(text);
    alert('Đã chép nội dung. Mở Zalo và dán để gửi cho khách.');
  }
}
