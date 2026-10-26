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

// Đang gõ chữ / số (bàn phím điện thoại mở) thì ẩn thanh menu dưới cho rộng chỗ
const typingField = (el) => (el?.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'button', 'submit'].includes(el.type)) || el?.tagName === 'TEXTAREA';
// Bỏ chế độ gõ thì đợi một chút: nếu đổi bố cục ngay lúc ngón tay vừa chạm nút (vd "Thanh toán"),
// nút bị dời chỗ trước khi nhấc tay nên bấm không ăn.
let typingTimer;
const updateTyping = () => {
  clearTimeout(typingTimer);
  if (typingField(document.activeElement)) document.body.classList.add('typing');
  else typingTimer = setTimeout(() => document.body.classList.toggle('typing', typingField(document.activeElement)), 400);
};
document.addEventListener('focusin', updateTyping);
document.addEventListener('focusout', () => setTimeout(updateTyping, 0));
