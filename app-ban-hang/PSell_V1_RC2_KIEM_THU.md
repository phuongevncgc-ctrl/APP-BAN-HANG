# PSell V1.0 RC2 – BẢN KIỂM THỬ

## Có trong bản này
- Kế thừa đầy đủ mã nguồn Beta 10 và bản chống trùng yêu cầu thanh toán trước đó.
- Xem trước hóa đơn **trước khi thanh toán** ngay trên POS. Xem trước không ghi sổ, không trừ kho; số hóa đơn thật chỉ có sau thanh toán.
- Xem lại hóa đơn sau bán trước khi in A4.
- Thêm logo PSell dạng SVG ở trang đăng nhập, biểu tượng web/PWA và phiếu in nhiệt trình duyệt.

## Chưa được chứng nhận chính xác tuyệt đối
- Chưa chạy toàn bộ kiểm thử tích hợp, chưa kiểm tra in LAN/A5 thực tế.
- Cần kiểm thử tình huống gửi lại hóa đơn sau timeout, nhiều người bán đồng thời, combo nhiều ĐVT, trả hàng một phần, thu nợ, phiếu thu và số dư.
- Chưa triển khai màn hình chỉnh sửa mẫu A5/58/80mm hoàn chỉnh.
- Không nên nhập dữ liệu thật hoặc cài đè bản đang hoạt động.

## Cài đặt
Dùng cách cài Home Assistant add-on hoặc Docker theo README gốc. Dùng vùng dữ liệu thử nghiệm độc lập.

## Danh sách kiểm thử quan trọng
1. Bán 1 cây/mét hàng có quy đổi, kiểm tra tồn kho đơn vị gốc.
2. Thanh toán bấm lặp, mất mạng sau khi gửi, gửi lại request_key: phải chỉ có một hóa đơn.
3. Bán nợ, thu nợ, trả hàng từng phần, kiểm tra sổ quỹ và công nợ.
4. Combo có thành phần nhiều đơn vị; trả một phần; kiểm tra tồn kho.
5. Xem trước trước thanh toán: không sinh hóa đơn và không thay đổi kho.
6. In nhiệt và A4; kiểm tra từng số tiền, chiết khấu, ĐVT, số dư.
