import { useState } from 'react';
import { get, downloadUrl } from '../api.js';
import { money, dateTime, METHOD_NAMES } from '../format.js';
import { Loading, useLoad } from './ui.jsx';
import { useSettings } from '../App.jsx';
import { usePrint } from './Receipt.jsx';

const REF_LINK = { invoice: (id) => `#/hoa-don/${id}` };

function LedgerTable({ l }) {
  return (
    <div className="table-scroll">
      <table className="table ledger">
        <thead>
          <tr><th>Ngày / Chứng từ</th><th className="r">Giá trị</th><th className="r">Đã trả</th><th className="r">Nợ +/-</th><th className="r">Còn nợ</th></tr>
        </thead>
        <tbody>
          <tr className="muted"><td colSpan={4}>Nợ đầu kỳ</td><td className="r"><b>{money(l.opening)}</b></td></tr>
          {l.rows.map((r, i) => (
            <tr key={i}>
              <td>
                {REF_LINK[r.ref] ? <a href={REF_LINK[r.ref](r.ref_id)}>{r.code}</a> : r.code} · {r.type}
                <small className="muted block">{dateTime(r.created_at)}{r.method ? ` · ${METHOD_NAMES[r.method]}` : ''}{r.discount ? ` · CK ${money(r.discount)}` : ''}{r.note ? ` · ${r.note}` : ''}</small>
              </td>
              <td className="r">{r.amount ? money(r.amount) : ''}</td>
              <td className="r">{r.paid ? money(r.paid) : ''}</td>
              <td className={`r ${r.change > 0 ? 'neg' : r.change < 0 ? 'pos' : ''}`}>{r.change ? `${r.change > 0 ? '+' : ''}${money(r.change)}` : ''}</td>
              <td className="r"><b>{money(r.balance)}</b></td>
            </tr>
          ))}
          <tr className="total-row">
            <td>Cộng</td>
            <td className="r">{money(l.totals.amount)}</td>
            <td className="r">{money(l.totals.paid)}</td>
            <td className="r">{money(l.totals.increase - l.totals.decrease)}</td>
            <td className="r"><b>{money(l.closing)}</b></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Bản in A4 của sổ công nợ (để đưa / gửi khách đối chiếu)
function LedgerPrint({ l, from, to, settings, kind }) {
  return (
    <div className="a4">
      <style>{'@page { size: A4; margin: 10mm; }'}</style>
      <div className="a4-head">
        <div><b>{settings.shop_name}</b><div>{settings.shop_address}</div><div>{settings.shop_phone}</div></div>
        <div className="r"><small>In lúc {new Date().toLocaleString('vi-VN')}</small></div>
      </div>
      <h2 className="center">BIÊN BẢN ĐỐI CHIẾU CÔNG NỢ</h2>
      <p className="center">{from || to ? `Từ ngày ${from || '...'} đến ngày ${to || '...'}` : 'Toàn bộ thời gian'}</p>
      <p>{kind === 'supplier' ? 'Nhà cung cấp' : 'Khách hàng'}: <b>{l.partner.name}</b> {l.partner.code && `(${l.partner.code})`}
        {l.partner.phone && ` · ĐT: ${l.partner.phone}`}{l.partner.address && ` · ${l.partner.address}`}</p>
      <LedgerTable l={l} />
      <p>Số nợ cuối kỳ: <b>{money(l.closing)} đ</b></p>
      <div className="a4-sign">
        <div><b>{kind === 'supplier' ? 'Nhà cung cấp' : 'Khách hàng'}</b><br /><small>(Ký, ghi rõ họ tên)</small></div>
        <div><b>Cửa hàng</b><br /><small>(Ký, ghi rõ họ tên)</small></div>
      </div>
    </div>
  );
}

// Sổ chi tiết công nợ: kind = 'customer' | 'supplier'
export default function Ledger({ kind, id }) {
  const settings = useSettings();
  const [range, setRange] = useState(['', '']);
  const base = kind === 'supplier' ? `/suppliers/${id}` : `/customers/${id}`;
  const q = `from=${range[0]}&to=${range[1]}`;
  const state = useLoad(() => get(`${base}/ledger?${q}`), [base, q]);
  const [print, portal] = usePrint();
  return (
    <div>
      <div className="row gap wrap">
        <input type="date" className="input grow" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} />
        <span>đến</span>
        <input type="date" className="input grow" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} />
      </div>
      <Loading state={state}>
        {(l) => (
          <>
            <LedgerTable l={l} />
            <div className="row gap">
              <a className="btn grow" href={downloadUrl(`/export/${kind === 'supplier' ? 'suppliers' : 'customers'}/${id}/ledger.xlsx?${q}`)} download>📥 Xuất Excel</a>
              <button className="btn grow" onClick={() => print(<LedgerPrint l={l} from={range[0]} to={range[1]} settings={settings} kind={kind} />)}>🖨️ In đối chiếu (A4)</button>
            </div>
          </>
        )}
      </Loading>
      {portal}
    </div>
  );
}
