import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ToastProvider } from './components/ui.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);

// Cho phép "Thêm vào màn hình chính" như app thật (chỉ chạy khi mở bằng https hoặc localhost)
if ('serviceWorker' in navigator && window.isSecureContext && !import.meta.env.DEV) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
