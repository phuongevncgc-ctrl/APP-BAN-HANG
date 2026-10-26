import { useState } from 'react';
import { get, post, del } from '../api.js';
import { money, vnd, dateTime, isoDay, METHOD_NAMES } from '../format.js';
import { DateRange, Field, Loading, Modal, MoneyInput, useAction, useLoad, confirmAsk, useToast } from '../components/ui.jsx';
import { useUser, isOwner, useSettings } from '../App.jsx';
import { usePrint } from '../components/Receipt.jsx';
import { receiptPrinter, renderSummary, sendToPrinter } from '../printing.js';

const KIND_SHORT = {
  sale: 'Bán hàng', return: 'Hoàn tiền trả hàng', debt_in: 'Thu nợ', purchase: 'Trả tiền nhập hàng', debt_out: 'Trả nợ NCC',
  supplier_return: 'NCC hoàn tiền', entry_in: 'Phiếu thu', entry_out: 'Phiếu chi',
};

function EntryForm({ kind, onClose, onSaved }) {
  const cats = useLoad(() => get('/cash-categories'), []);
  const [f, setF] = useState({ kind, category: kind === 'in' ? 'other_in' : 'expense', amount: 0, method: 'cash', note: '' });
  const [run, busy] = useAction();
  const save = async () => (await run(() => post('/cash-entries', f), kind === 'in' ? 'Đã lập phiếu thu' : 'Đã lập phiếu chi')) && onSaved();
  return (
    <Modal title={kind === 'in' ? '➕ Phiếu thu' : '➖ Phiếu chi'} onClose={onClose}
      footer={<button className={`btn btn-lg btn-block ${kind === 'in' ? 'btn-success' : 'btn-danger'}`} disabled={busy || !f.amount} onClick={save}>Lưu phiếu {vnd(f.amount)}</button>}>
      <Field label="Loại">
        <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          {Object.entries(cats.data?.[kind] ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Số tiền"><MoneyInput autoFocus value={f.amount} onChange={(amount) => setF({ ...f, amount })} /></Field>
      <div className="seg">
        {['cash', 'transfer'].map((m) => <button key={m} className={f.method === m ? 'on' : ''} onClick={() => setF({ ...f, method: m })}>{METHOD_NAMES[m]}</button>)}
      </div>
      <Field label="Nội dung"><input className="input" placeholder={kind === 'in' ? 'vd: Bán ve chai' : 'vd: Tiền điện tháng 10'} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </Modal>
  );
}

// Chốt ca: tổng tiền thu trong ngày, in ra máy in hoá đơn
function Shift({ onClose }) {
  const owner = isOwner(useUser());
  const settings = useSettings();
  const [mine, setMine] = useState(!owner);
  const state = useLoad(() => get(`/reports/shift${mine ? '?user=me' : ''}`), [mine]);
  const [print, portal] = usePrint();
  const linesOf = (s) => {
    const m = (method, kind) => s.money[method]?.[kind] ?? 0;
    const lines = [
      [`Số hoá đơn`, String(s.sales.count)],
      ['Doanh số bán', money(s.sales.total), true],
      ...(s.returns.count ? [[`Trả hàng (${s.returns.count} phiếu)`, `-${money(s.returns.total)}`]] : []),
      ...(s.sales.debt ? [['Bán ghi nợ', money(s.sales.debt)]] : []),
      'hr',
    ];
    for (const method of Object.keys(s.money)) {
      lines.push(METHOD_NAMES[method].toUpperCase());
      for (const [kind, label] of Object.entries(KIND_SHORT)) if (m(method, kind)) lines.push([`  ${label}`, money(m(method, kind))]);
      lines.push([`Cộng ${METHOD_NAMES[method].toLowerCase()}`, money(s.totals[method]), true]);
    }
    if (s.cashOpening !== null) lines.push('hr', ['Tiền mặt đầu ngày', money(s.cashOpening)], ['Tiền mặt cuối ngày', money(s.cashOpening + (s.totals.cash ?? 0)), true]);
    if (s.drafts) lines.push('hr', [`Còn ${s.drafts} đơn tạm chưa thanh toán`, '']);
    return lines;
  };
  const doPrint = async (s) => {
    const lines = linesOf(s);
    const sub = `${s.day.split('-').reverse().join('/')} · ${s.user}`;
    const body = (
      <div className="receipt" style={{ width: settings.receipt_width === '58' ? '54mm' : '76mm' }}>
        <div className="r-center r-shop">{settings.shop_name}</div>
        <div className="r-center r-title">CHỐT CA</div>
        <div className="r-center">{sub}</div>
        {lines.map((l, i) => (l === 'hr' ? <div key={i} className="r-foot" /> : typeof l === 'string' ? <b key={i}>{l}</b>
          : <div key={i} className={`r-row ${l[2] ? 'r-big' : ''}`}><span>{l[0]}</span><span>{l[1]}</span></div>))}
      </div>
    );
    const printer = await receiptPrinter().catch(() => null);
    if (!printer) return print(body, { title: 'In phiếu chốt ca' });
    print(body, {
      title: 'In phiếu chốt ca',
      printer: printer.name,
      image: renderSummary(settings, 'CHỐT CA', sub, lines, printer.type, true),
      send: () => sendToPrinter(printer, [renderSummary(settings, 'CHỐT CA', sub, lines, printer.type)]),
    });
  };
  return (
    <Modal title="🧮 Chốt ca hôm nay" onClose={onClose}
      footer={state.data && <button className="btn btn-primary btn-lg btn-block" onClick={() => doPrint(state.data)}>🖨️ In phiếu chốt ca</button>}>
      {owner && (
        <div className="seg">
          <button className={!mine ? 'on' : ''} onClick={() => setMine(false)}>Cả cửa hàng</button>
          <button className={mine ? 'on' : ''} onClick={() => setMine(true)}>Của tôi</button>
        </div>
      )}
      <Loading state={state}>
        {(s) => (
          <div className="sumbox">
            {linesOf(s).map((l, i) => (l === 'hr' ? <hr key={i} /> : typeof l === 'string' ? <b key={i}>{l}</b>
              : <div key={i} className={`row-between ${l[2] ? 'big' : ''}`}><span>{l[0]}</span>{l[2] ? <b>{l[1]}</b> : <span>{l[1]}</span>}</div>))}
          </div>
        )}
      </Loading>
      {portal}
    </Modal>
  );
}

export default function Cash() {
  const owner = isOwner(useUser());
  const today = isoDay(new Date());
  const [range, setRange] = useState([today, today]);
  const [method, setMethod] = useState('cash');
  const [form, setForm] = useState(null);
  const [shift, setShift] = useState(false);
  const [run] = useAction();
  const book = useLoad(() => (owner ? get(`/cashbook?from=${range[0]}&to=${range[1]}&method=${method}`) : Promise.resolve(null)), [range[0], range[1], method]);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Thu chi</h1>
        <button className="btn" onClick={() => setShift(true)}>🧮 Chốt ca</button>
      </div>
      <div className="row gap">
        <button className="btn btn-success btn-lg grow" onClick={() => setForm('in')}>➕ Phiếu thu</button>
        <button className="btn btn-danger btn-lg grow" onClick={() => setForm('out')}>➖ Phiếu chi</button>
      </div>
      {!owner && <p className="muted">Lập phiếu chi khi lấy tiền trong két trả việc khác (tiền ship, mua nước…), để cuối ngày tiền mặt khớp.</p>}
      {owner && (
        <>
          <DateRange from={range[0]} to={range[1]} onChange={(f, t) => setRange([f, t])} />
          <div className="seg">
            {[['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản'], ['all', 'Tất cả']].map(([k, l]) => <button key={k} className={method === k ? 'on' : ''} onClick={() => setMethod(k)}>{l}</button>)}
          </div>
          <Loading state={book}>
            {(b) => b && (
              <>
                <div className="cards">
                  <div className="card stat"><small>Tồn đầu kỳ</small><b>{money(b.opening)}</b></div>
                  <div className="card stat"><small>Tổng thu</small><b className="pos">{money(b.totalIn)}</b></div>
                  <div className="card stat"><small>Tổng chi</small><b className="neg">{money(b.totalOut)}</b></div>
                  <div className="card stat"><small>Tồn cuối kỳ</small><b>{money(b.closing)}</b></div>
                </div>
                <div className="list">
                  {b.rows.length === 0 && <div className="empty">Không có thu chi trong kỳ</div>}
                  {b.rows.slice().reverse().map((r) => (
                    <div key={r.id} className="list-item">
                      <span className="grow">
                        <b>{r.type}</b> {r.ref_code && (r.kind === 'sale' ? <a href={`#/hoa-don/${r.ref_id}`}>{r.ref_code}</a> : <span className="muted">{r.ref_code}</span>)}
                        <small className="muted block">{dateTime(r.created_at)}{method === 'all' ? ` · ${METHOD_NAMES[r.method]}` : ''}{r.partner ? ` · ${r.partner}` : ''}{r.note ? ` · ${r.note}` : ''}{r.user_name ? ` · ${r.user_name}` : ''}</small>
                      </span>
                      <span className="r">
                        <b className={r.amount < 0 ? 'neg' : 'pos'}>{r.amount > 0 ? '+' : ''}{money(r.amount)}</b>
                        <small className="muted block">Tồn {money(r.balance)}</small>
                      </span>
                      {r.entry && <button className="btn btn-sm" title="Xoá phiếu" onClick={async () => confirmAsk('Xoá phiếu thu chi này?') && (await run(() => del(`/cash-entries/${r.id.slice(1)}`), 'Đã xoá')) && book.reload()}>✕</button>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Loading>
        </>
      )}
      {form && <EntryForm kind={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); book.reload(); }} />}
      {shift && <Shift onClose={() => setShift(false)} />}
    </div>
  );
}
