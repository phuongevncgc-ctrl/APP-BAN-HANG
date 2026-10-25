import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { money, PRESETS, rangePreset } from '../format.js';

// ---------- Thông báo nhanh ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const show = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setItems((xs) => [...xs, { id, text, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Hộp thoại ----------
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && <button className="btn-icon" onClick={onClose} aria-label="Đóng">✕</button>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Hỏi xác nhận bằng hộp thoại của trình duyệt (đơn giản, to rõ trên điện thoại)
export const confirmAsk = (text) => window.confirm(text);

// ---------- Ô nhập tiền: tự thêm dấu chấm ----------
export function MoneyInput({ value, onChange, autoFocus, placeholder = '0', ...rest }) {
  const [text, setText] = useState(value ? money(value) : '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value ? money(value) : '');
  }, [value]);
  return (
    <input
      {...rest}
      className={`input money ${rest.className ?? ''}`}
      inputMode="numeric"
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(value ? money(value) : '');
      }}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 12);
        const n = digits ? Number(digits) : 0;
        setText(digits ? money(n) : '');
        onChange(n);
      }}
    />
  );
}

// Ô nhập số lượng (cho phép số lẻ, dùng dấu phẩy hoặc chấm)
export function QtyInput({ value, onChange, ...rest }) {
  const [text, setText] = useState(String(value ?? '').replace('.', ','));
  useEffect(() => {
    if (Number(text.replace(',', '.')) !== Number(value)) setText(String(value ?? '').replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      {...rest}
      className={`input ${rest.className ?? ''}`}
      style={{ '--len': Math.max(2, text.length), ...rest.style }}
      inputMode="decimal"
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,]/g, '');
        setText(t);
        const n = Number(t.replace(',', '.'));
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

// ---------- Chọn khoảng ngày ----------
export function DateRange({ from, to, onChange }) {
  return (
    <div className="date-range">
      <div className="chips">
        {PRESETS.map(([k, label]) => {
          const [f, t] = rangePreset(k);
          return (
            <button key={k} className={`chip ${f === from && t === to ? 'chip-on' : ''}`} onClick={() => onChange(f, t)}>
              {label}
            </button>
          );
        })}
      </div>
      <div className="row gap">
        <input type="date" className="input" value={from} onChange={(e) => onChange(e.target.value, to)} />
        <span>đến</span>
        <input type="date" className="input" value={to} onChange={(e) => onChange(from, e.target.value)} />
      </div>
    </div>
  );
}

// ---------- Tải dữ liệu ----------
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function Loading({ state, children }) {
  if (state.error) return <div className="empty error">{state.error.message}</div>;
  if (state.loading && !state.data) return <div className="empty">Đang tải…</div>;
  return children(state.data);
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Chạy một thao tác gửi lên máy chủ, báo lỗi bằng thông báo.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn, okText) => {
      if (busy) return undefined;
      setBusy(true);
      try {
        const r = await fn();
        if (okText) toast(okText);
        return r;
      } catch (err) {
        toast(err.message, 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [busy, toast],
  );
  return [run, busy];
}

// Thu nhỏ ảnh trước khi gửi lên (tối đa 600px)
export function resizeImage(file, max = 600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('Không đọc được ảnh'));
    img.src = URL.createObjectURL(file);
  });
}
