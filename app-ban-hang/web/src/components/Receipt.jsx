import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { money, num, dateTime, METHOD_NAMES, moneyToWords } from '../format.js';
import { useSettings } from '../App.jsx';

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

export function ReceiptActions({ inv, onDone }) {
  const settings = useSettings();
  const [print, portal] = usePrint();
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
        <button className="btn btn-primary btn-lg grow" onClick={() => print(<ReceiptBody inv={inv} settings={settings} />)}>🖨️ In hoá đơn</button>
        <button className="btn btn-lg grow" onClick={share}>📤 Gửi Zalo</button>
        {onDone && <button className="btn btn-lg grow" onClick={onDone}>Đơn mới</button>}
      </div>
      {portal}
    </>
  );
}
