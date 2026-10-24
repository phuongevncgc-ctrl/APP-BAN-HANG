import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { get, post, setToken, setUnauthorizedHandler } from './api.js';
import { Field, useAction } from './components/ui.jsx';
import Pos from './pages/Pos.jsx';
import Invoices from './pages/Invoices.jsx';
import Products from './pages/Products.jsx';
import Customers from './pages/Customers.jsx';
import Purchases from './pages/Purchases.jsx';
import Reports from './pages/Reports.jsx';
import Cash from './pages/Cash.jsx';
import Settings from './pages/Settings.jsx';

const SettingsCtx = createContext({});
const UserCtx = createContext(null);
export const useSettings = () => useContext(SettingsCtx);
export const useUser = () => useContext(UserCtx);
export const isOwner = (u) => u?.role === 'owner';

// Đường dẫn dạng #/hoa-don/12
export function useRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export const go = (path) => {
  window.location.hash = `#/${path}`;
};

const NAV = [
  { path: 'ban-hang', icon: '🛒', label: 'Bán hàng', page: Pos },
  { path: 'hoa-don', icon: '🧾', label: 'Hoá đơn', page: Invoices },
  { path: 'hang-hoa', icon: '📦', label: 'Hàng hoá', page: Products },
  { path: 'khach-hang', icon: '👥', label: 'Khách hàng', page: Customers },
  { path: 'nhap-hang', icon: '🚚', label: 'Nhập hàng', page: Purchases },
  { path: 'thu-chi', icon: '💵', label: 'Thu chi', page: Cash },
  { path: 'bao-cao', icon: '📊', label: 'Báo cáo', page: Reports },
  { path: 'cai-dat', icon: '⚙️', label: 'Cài đặt', page: Settings },
];
const MOBILE_MAIN = ['ban-hang', 'hoa-don', 'hang-hoa', 'khach-hang'];

function Setup({ onDone }) {
  const [f, setF] = useState({ shop_name: '', name: '', username: '', password: '' });
  const [run, busy] = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(() => post('/setup', f));
    if (r) {
      setToken(r.token);
      onDone();
    }
  };
  return (
    <form className="auth card" onSubmit={submit}>
      <h1>Chào mừng đến với PSell!</h1>
      <p className="muted">Lần đầu dùng, hãy tạo tài khoản chủ cửa hàng.</p>
      <Field label="Tên cửa hàng"><input className="input" value={f.shop_name} onChange={(e) => setF({ ...f, shop_name: e.target.value })} /></Field>
      <Field label="Tên của bạn"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Tên đăng nhập" hint="Chữ không dấu, viết liền, vd: chuphuong">
        <input className="input" autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
      </Field>
      <Field label="Mật khẩu"><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      <button className="btn btn-primary btn-lg btn-block" disabled={busy}>Bắt đầu</button>
    </form>
  );
}

function Login({ shopName, onDone }) {
  const [f, setF] = useState({ username: '', password: '' });
  const [run, busy] = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(() => post('/login', f));
    if (r) {
      setToken(r.token);
      onDone();
    }
  };
  return (
    <form className="auth card" onSubmit={submit}>
      <h1>{shopName || 'PSell'}</h1>
      <Field label="Tên đăng nhập">
        <input className="input" autoCapitalize="none" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
      </Field>
      <Field label="Mật khẩu">
        <input className="input" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </Field>
      <button className="btn btn-primary btn-lg btn-block" disabled={busy}>Đăng nhập</button>
    </form>
  );
}

function Layout({ user, reloadSettings }) {
  const route = useRoute();
  const [more, setMore] = useState(false);
  const nav = NAV.filter((n) => isOwner(user) || n.path !== 'bao-cao');
  const current = nav.find((n) => n.path === route[0]) ?? nav[0];
  const Page = current.page;
  useEffect(() => setMore(false), [route[0]]);
  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">{useSettings().shop_name}</div>
        {nav.map((n) => (
          <a key={n.path} href={`#/${n.path}`} className={n === current ? 'active' : ''}>
            <span className="nav-icon">{n.icon}</span> {n.label}
          </a>
        ))}
        <div className="sidebar-user">👤 {user.name}<small className="block muted">PSell</small></div>
      </nav>
      <main className="main">
        <Page route={route} reloadSettings={reloadSettings} />
      </main>
      <nav className="bottombar">
        {nav.filter((n) => MOBILE_MAIN.includes(n.path)).map((n) => (
          <a key={n.path} href={`#/${n.path}`} className={n === current ? 'active' : ''}>
            <span className="nav-icon">{n.icon}</span>
            <span>{n.label}</span>
          </a>
        ))}
        <button className={!MOBILE_MAIN.includes(current.path) ? 'active' : ''} onClick={() => setMore(!more)}>
          <span className="nav-icon">☰</span>
          <span>Thêm</span>
        </button>
      </nav>
      {more && (
        <div className="more-menu" onClick={() => setMore(false)}>
          <div className="more-sheet">
            {nav.filter((n) => !MOBILE_MAIN.includes(n.path)).map((n) => (
              <a key={n.path} href={`#/${n.path}`}>
                <span className="nav-icon">{n.icon}</span> {n.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const s = await get('/status');
      setStatus(s);
      setError('');
      if (s.user) setSettings(await get('/settings'));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setStatus((s) => (s ? { ...s, user: null } : s));
    });
    load();
  }, [load]);

  if (error) {
    return (
      <div className="auth card">
        <p className="error">{error}</p>
        <button className="btn btn-primary btn-block" onClick={load}>Thử lại</button>
      </div>
    );
  }
  if (!status) return <div className="empty">Đang mở…</div>;
  if (status.needSetup) return <Setup onDone={load} />;
  if (!status.user) return <Login shopName={status.shop_name} onDone={load} />;
  return (
    <UserCtx.Provider value={status.user}>
      <SettingsCtx.Provider value={settings}>
        <Layout user={status.user} reloadSettings={load} />
      </SettingsCtx.Provider>
    </UserCtx.Provider>
  );
}
