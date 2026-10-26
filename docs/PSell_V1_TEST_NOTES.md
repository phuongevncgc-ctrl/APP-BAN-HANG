# PSell V1.0 — bản kiểm thử tăng cường giao dịch

**Không phải bản Stable đã chứng nhận.** Chưa chạy đầy đủ kiểm thử tích hợp và build do môi trường thiếu các gói npm.

## Thay đổi thực hiện
- Thêm bảng `invoice_requests` qua migration v5, liên kết mã yêu cầu duy nhất với hóa đơn.
- POS gửi `request_key` ổn định theo tab giỏ hàng; gửi lại cùng yêu cầu và cùng nội dung trả về hóa đơn cũ, không trừ kho hoặc ghi thu tiền lần hai.
- Cùng mã yêu cầu nhưng nội dung khác sẽ bị từ chối.
- Chặn một dòng hàng lặp nhiều lần trong cùng phiếu trả.
- Giữ mã nguồn và các chức năng in hiện có; **chưa triển khai màn hình xem trước in mới**.

## Cần kiểm thử trước khi sử dụng thật
1. Bấm thanh toán hai lần; giả lập mất phản hồi mạng rồi gửi lại.
2. Đổi giỏ hàng sau khi gửi cùng mã yêu cầu.
3. Combo, mét/cây, trả hàng một phần, công nợ, phiếu thu, thối tiền.
4. Xem trước hóa đơn và in nhiệt LAN/A5 với máy in thật.
5. Kiểm tra số liệu doanh thu, tồn kho và công nợ bằng dữ liệu mẫu.

Lưu ý: API bên ngoài không gửi `request_key` vẫn dùng luồng cũ; cần bổ sung mã yêu cầu cho mọi kênh bán để chống trùng toàn diện.
