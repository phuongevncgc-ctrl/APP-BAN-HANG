import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vietQrPayload } from '../../web/src/vietqr.js';

test('mã VietQR tạo trong máy: đúng cấu trúc NAPAS và mã kiểm tra CRC', () => {
  const p = vietQrPayload({ bin: '970436', account: '0011000414782', amount: 1250000, info: 'Thanh toán hoá đơn HD000123' });
  assert.equal(p, '00020101021238570010A00000072701270006970436011300110004147820208QRIBFTTA'
    + '5303704540712500005802VN62310827Thanh toan hoa don HD000123630458FD');
  // Không có số tiền: mã tĩnh (11), không có trường 54
  const s = vietQrPayload({ bin: '970415', account: '113366668888', amount: 0 });
  assert.match(s, /^000201010211/);
  assert.doesNotMatch(s, /530370454/);
});
