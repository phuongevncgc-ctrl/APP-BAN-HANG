import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { money, num, dateTime, METHOD_NAMES, moneyToWords } from '../format.js';
import { useSettings } from '../App.jsx';
import { useToast } from './ui.jsx';
import { printReceiptIp } from '../printing.js';

export function vietQrUrl(settings, amount, info) {
  if (!settings.bank_bin || !settings.bank_account) return null;
  const q = new URLSearchParams({ amount: String(amount), addInfo: info, accountName: settings.bank_holder ?? '' });
  return `https://img.vietqr.io/image/${settings.bank_bin}-${settings.bank_account}-compact2.png?${q}`;
}

export function ReceiptBody({ inv, settings }) {
  const remaining = inv.total - inv.paid;
  const cashPaid = inv.payments.filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0) + inv.change_amount;
  return (
    <div className="receipt" style={{ width: settings.receipt_width === '58' ? '54mm' : '76mm' }}>
      <div className="r-center r-shop">{settings.shop_name}</div>
      {settings.shop_address && <div className="r-center">{settings.shop_address}</div>}
      {settings.shop_phone && <div className="r-center">ĐT: {settings.shop_phone}</div>}
      <div className="r-center r-title">PHIẾU BÁN HÀNG</div>
      <div className="r-center">{inv.code} · {dateTime(inv.created_at)}</div>
      <div>Khách: {inv.customer_name || 'Khách lẻ'}{inv.customer_phone ? ` - ${inv.customer_phone}` : ''}</div>
      {inv.user_name && <div>Thu ngân: {inv.user_name}</div>}
      <table className="r-table">
        <thead>
          <tr><th>Hàng hoá</th><th>SL</th><th>Giảm</th><th>Tiền</th></tr>
        </thead>
        <tbody>
          {inv.items.map((it) => (
            <tr key={it.id}>
              <td>
                <div className="r-name">{it.name}{it.unit ? ` (${it.unit})` : ''}</div>
                <div>{money(it.price)}</div>
              </td>
              <td>{num(it.qty)}</td>
              <td>{it.discount > 0 ? money(it.discount * it.qty) : ''}</td>
              <td>{money(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="r-sum">
        <div className="r-row"><span>Tổng tiền hàng</span><span>{money(inv.subtotal)}</span></div>
        {inv.discount > 0 && <div className="r-row"><span>Giảm giá HĐ</span><span>-{money(inv.discount)}</span></div>}
        <div className="r-row r-big"><span>TỔNG CỘNG</span><span>{money(inv.total)}</span></div>
        {inv.payments.filter((p) => p.amount > 0).map((p, i) => (
          <div key={i} className="r-row"><span>{METHOD_NAMES[p.method]}</span><span>{money(p.amount + (p.method === 'cash' ? inv.change_amount : 0))}</span></div>
        ))}
        {cashPaid === 0 && <div className="r-row"><span>Khách trả</span><span>0</span></div>}
        {inv.change_amount > 0 && <div className="r-row"><span>Tiền thối</span><span>{money(inv.change_amount)}</span></div>}
        {remaining > 0 && <div className="r-row r-big"><span>Còn nợ</span><span>{money(remaining)}</span></div>}
      </div>
      <div className="r-words">({moneyToWords(inv.total)})</div>
      {inv.status === 'cancelled' && <div className="r-center r-title">ĐÃ HUỶ</div>}
      <div className="r-center r-foot">{settings.receipt_footer}</div>
    </div>
  );
}

// Hoá đơn khổ A4 (in bằng trình duyệt, chọn máy in A4 trong hộp thoại in)
export function InvoiceA4({ inv, settings }) {
  const remaining = inv.total - inv.paid;
  return (
    <div className="a4">
      <style>{'@page { size: A4; margin: 10mm; }'}</style>
      <div className="a4-head">
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{settings.shop_name}</div>
          {settings.shop_address && <div>{settings.shop_address}</div>}
          {settings.shop_phone && <div>ĐT: {settings.shop_phone}</div>}
          {settings.bank_account && <div>STK: {settings.bank_account} - {settings.bank_holder}</div>}
        </div>
        <div className="r"><b>Số: {inv.code}</b><div>Ngày: {dateTime(inv.created_at)}</div></div>
      </div>
      <h2 className="center">HOÁ ĐƠN BÁN HÀNG</h2>
      <div style={{ margin: '3mm 0' }}>
        <div>Khách hàng: <b>{inv.customer_name || 'Khách lẻ'}</b>{inv.customer_code ? ` (${inv.customer_code})` : ''}</div>
        {inv.customer_phone && <div>Điện thoại: {inv.customer_phone}</div>}
        {inv.customer_address && <div>Địa chỉ: {inv.customer_address}</div>}
        {inv.customer_tax_code && <div>Mã số thuế: {inv.customer_tax_code}</div>}
      </div>
      <table>
        <thead>
          <tr><th>STT</th><th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th><th className="r">SL</th><th className="r">Đơn giá</th><th className="r">Giảm giá</th><th className="r">Thành tiền</th></tr>
        </thead>
        <tbody>
          {inv.items.map((it, i) => (
            <tr key={it.id}>
              <td className="center">{i + 1}</td>
              <td>{it.product_code}</td>
              <td>{it.name}</td>
              <td>{it.unit}</td>
              <td className="r">{num(it.qty)}</td>
              <td className="r">{money(it.price)}</td>
              <td className="r">{it.discount > 0 ? money(it.discount * it.qty) : ''}</td>
              <td className="r">{money(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="a4-sum">
        <div><span>Tổng tiền hàng</span><span>{money(inv.subtotal)}</span></div>
        {inv.discount > 0 && <div><span>Giảm giá hoá đơn</span><span>-{money(inv.discount)}</span></div>}
        <div style={{ fontWeight: 800, fontSize: 15 }}><span>TỔNG CỘNG</span><span>{money(inv.total)}</span></div>
        <div><span>Khách đã trả</span><span>{money(inv.paid)}</span></div>
        {remaining > 0 && <div style={{ fontWeight: 700 }}><span>Còn nợ hoá đơn này</span><span>{money(remaining)}</span></div>}
        {inv.customer_id && inv.customer_debt > 0 && <div><span>Tổng nợ hiện tại của khách</span><span>{money(inv.customer_debt)}</span></div>}
      </div>
      <p><i>Số tiền bằng chữ: {moneyToWords(inv.total)}</i></p>
      {inv.status === 'cancelled' && <h2 className="center">ĐÃ HUỶ</h2>}
      <div className="a4-sign">
        <div><b>Người mua hàng</b><br /><small>(Ký, ghi rõ họ tên)</small></div>
        <div><b>Người bán hàng</b><br /><small>(Ký, ghi rõ họ tên)</small><br /><br /><br /><br />{inv.user_name}</div>
      </div>
      {settings.receipt_footer && <p className="center">{settings.receipt_footer}</p>}
    </div>
  );
}

// In hoá đơn: đặt nội dung vào vùng in rồi gọi lệnh in của trình duyệt.
export function usePrint() {
  const [content, setContent] = useState(null);
  useEffect(() => {
    if (!content) return undefined;
    const t = setTimeout(() => {
      window.print();
      setContent(null);
    }, 50);
    return () => clearTimeout(t);
  }, [content]);
  const portal = content ? createPortal(content, document.getElementById('print-area')) : null;
  return [setContent, portal];
}

export function shareText(inv, settings) {
  const lines = [
    settings.shop_name,
    `Hoá đơn ${inv.code} - ${dateTime(inv.created_at)}`,
    ...inv.items.map((it) => `• ${it.name}${it.unit ? ` (${it.unit})` : ''}: ${num(it.qty)} x ${money(it.price - it.discount)} = ${money(it.total)}`),
    inv.discount > 0 ? `Giảm giá: -${money(inv.discount)}đ` : null,
    `Tổng cộng: ${money(inv.total)}đ`,
    inv.total - inv.paid > 0 ? `Còn nợ: ${money(inv.total - inv.paid)}đ` : null,
    settings.bank_account ? `Chuyển khoản: ${settings.bank_account} - ${settings.bank_holder}` : null,
    settings.receipt_footer,
  ];
  return lines.filter(Boolean).join('\n');
}

// In hoá đơn nhỏ: ưu tiên máy in IP đã cài, không có hoặc lỗi thì in bằng trình duyệt.
export function useReceiptPrint() {
  const settings = useSettings();
  const toast = useToast();
  const [print, portal] = usePrint();
  const printReceipt = async (inv) => {
    try {
      const printer = await printReceiptIp(inv, settings);
      if (printer) {
        toast(`Đã gửi in tới ${printer.name}`);
        return;
      }
    } catch (err) {
      toast(`${err.message} Đang chuyển sang in bằng trình duyệt.`, 'error');
    }
    print(<ReceiptBody inv={inv} settings={settings} />);
  };
  return [printReceipt, portal, print];
}

export function ReceiptActions({ inv, onDone }) {
  const settings = useSettings();
  const [printReceipt, portal, print] = useReceiptPrint();
  const share = async () => {
    const text = shareText(inv, settings);
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        /* người dùng huỷ */
      }
    } else {
      await navigator.clipboard?.writeText(text);
      alert('Đã chép hoá đơn. Mở Zalo và dán để gửi cho khách.');
    }
  };
  return (
    <>
      <div className="row gap wrap">
        <button className="btn btn-primary btn-lg grow" onClick={() => printReceipt(inv)}>🖨️ In hoá đơn</button>
        <button className="btn btn-lg" onClick={() => print(<InvoiceA4 inv={inv} settings={settings} />)}>📄 In A4</button>
        <button className="btn btn-lg grow" onClick={share}>📤 Gửi Zalo</button>
        {onDone && <button className="btn btn-lg grow" onClick={onDone}>Đơn mới</button>}
      </div>
      {portal}
    </>
  );
}
