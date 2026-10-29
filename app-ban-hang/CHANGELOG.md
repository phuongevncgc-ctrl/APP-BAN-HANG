# Nhật ký thay đổi

## 1.0.0-rc.4.4

Rà tiếp công nợ (ngày 2):

- **"Khách đang nợ" ở Báo cáo nay đúng bằng tổng nợ ở trang Khách hàng.** Trước đây báo cáo cộng cả tiền cửa hàng đang giữ của khách (nợ âm, vd khách trả hàng trừ vào nợ còn dư) nên số nợ phải thu bị nhỏ đi. Nay tách riêng ô "Tiền giữ của khách". Nợ nhà cung cấp cũng tách tương tự. Tin nhắn báo cáo cuối ngày dùng số mới.
- **Không xoá được khách / nhà cung cấp còn nợ.** Trước đây xoá khách đang nợ thì số nợ biến mất khỏi mọi báo cáo. Nay app báo "còn nợ … , thu hết nợ rồi mới xoá được".

## 1.0.0-rc.4.3

Rà lại công nợ và trả hàng của khách:

- **Trả hàng hoá đơn còn nợ không còn hoàn nhầm tiền:** trước đây khách mua 1.000.000, trả 400.000, nợ 600.000, rồi trả lại hàng mà chọn "Tiền mặt" thì app hoàn đủ 1.000.000 tiền mặt và vẫn giữ nợ 600.000. Nay tiền hàng trả trừ vào phần nợ còn lại của chính hoá đơn đó trước, chỉ đưa lại phần khách đã trả (400.000). Hoá đơn đã trả đủ, hoặc khách đã thu nợ xong, thì vẫn hoàn đủ tiền như cũ. Nợ của hoá đơn khác không bị đụng tới.
- **Số tiền trên màn trả hàng khớp đúng từng đồng** với phiếu lưu (máy chủ tính sẵn): trước đây trả hết một dòng có giảm giá hoá đơn có thể hiện lệch 1đ so với số thật. Màn hình ghi rõ: tiền hàng trả, trừ vào nợ bao nhiêu, đưa lại bao nhiêu.
- Trả lẻ nhiều lần không bao giờ hoàn quá tiền của dòng hàng.
- Sổ công nợ ghi rõ phiếu "Trả hàng (trừ nợ + hoàn tiền)".
- Thêm bài kiểm tra: hoá đơn nợ một phần, trả nhiều lần, thu nợ xong mới trả, nợ hoá đơn khác, trừ hết vào nợ (nợ âm), giảm giá hoá đơn + đơn vị quy đổi, huỷ hoá đơn đã thu nợ một phần.

## 1.0.0-rc.4.2

- **Hạn mức nợ cho từng khách:** chủ cửa hàng đặt số nợ tối đa trong trang sửa khách (để 0 là không giới hạn). Khi bán ghi nợ mà tổng nợ sẽ vượt hạn mức, màn thanh toán báo ngay. Nhân viên không ghi nợ vượt được (phải thu thêm tiền), chủ cửa hàng bấm đồng ý thì vẫn ghi được. Khách trả đủ tiền thì vẫn bán bình thường.

## 1.0.0-rc.4.1

- **Lập phiếu nhập từ gợi ý:** trong phiếu nhập bấm "📋 Thêm hàng cần nhập (theo gợi ý)", tick các món cần nhập, sửa số lượng rồi thêm cả loạt vào phiếu. Không phải gõ tìm từng món.
- **Gợi ý nhập hàng tính đúng hàng bán qua combo:** trước đây món bán trong combo (vd bán "Bộ kẹp" trừ 10 cái kẹp) không được tính vào tốc độ bán, nên không hiện trong "Cần nhập thêm" và có thể bị xếp nhầm vào "Bán chậm". Nay tính theo thẻ kho, đã trừ hàng khách trả và hoá đơn huỷ.

## 1.0.0-rc.4

Gộp bản "RC2 Xem trước + Logo" của chú vào bản mới nhất, kiểm thử lại.

- **Chống trùng hoá đơn:** bấm "Hoàn tất" 2 lần hoặc mạng chập chờn rồi gửi lại thì chỉ có 1 hoá đơn, không trừ kho và ghi tiền 2 lần. Đơn đã thanh toán rồi mà sửa giỏ và thanh toán lại thì app báo số hoá đơn đã có (từ bản của chú).
- **Xem trước hoá đơn trước khi thanh toán** (nút "👁 Xem trước hóa đơn" trong màn Thanh toán), chưa ghi sổ, chưa trừ kho. Bản xem trước tự thu nhỏ vừa màn hình điện thoại (từ bản của chú).
- **Logo PSell mới** ở trang đăng nhập, biểu tượng app và hoá đơn in (từ bản của chú). Sửa đường dẫn logo để hiện được khi mở qua Home Assistant.
- Phiếu trả hàng không cho một dòng hàng lặp 2 lần (từ bản của chú).
- **Sửa lỗi bấm "Thanh toán" không ăn:** vừa chọn hàng xong (bàn phím còn mở) mà bấm Thanh toán ngay thì thanh dưới bị dời chỗ, phải bấm lại. Giờ bấm một lần là được.
- Đang dùng **ứng dụng Home Assistant trên điện thoại** thì trang in hiện hướng dẫn: ứng dụng này không in bằng trình duyệt được, dùng máy in IP hoặc mở PSell bằng Chrome.

## 1.0.0-rc.3

- **Xem trước rồi mới in:** bấm In hoá đơn, In A4, báo giá, sổ công nợ, phiếu chốt ca... đều hiện trang xem trước trên màn hình. Xem đúng rồi bấm **🖨️ In**, không thì bấm Đóng. Có máy in hoá đơn qua IP thì trang xem trước chính là bản máy in sẽ in ra, có thêm nút "In bằng trình duyệt".
- Muốn in luôn không cần xem trước: vào Cài đặt → bỏ chọn "Xem trước trang in rồi mới in".

## 1.0.0-rc.2

- **Báo cáo so sánh:** doanh thu, lợi nhuận hôm nay so với hôm trước (7 ngày so với 7 ngày trước...), có mũi tên ▲ tăng / ▼ giảm.
- **Bán theo giờ:** biểu đồ giờ nào bán được nhiều nhất trong ngày.
- **Khách mua nhiều** (top 10, kèm số đang nợ) và **doanh thu, lãi theo nhóm hàng**.
- **Gợi ý nhập hàng** (Báo cáo → Gợi ý nhập hàng): hàng dưới tồn tối thiểu hoặc chỉ còn đủ bán dưới 7 ngày theo tốc độ bán, kèm số **nên nhập** cho đủ bán 30 ngày.
- **Hàng bán chậm:** còn tồn mà 30 / 60 / 90 ngày qua không bán được, kèm số vốn đang nằm kho. Hàng mới thêm chưa đủ ngày thì chưa xét.
- **Nhắc nợ qua Zalo:** trong trang khách hàng, bấm "📤 Nhắc nợ" để gửi tin nhắn báo số nợ, các hoá đơn còn nợ, số tài khoản và **mã QR chuyển khoản đúng số nợ**.
- Danh sách "Đang nợ" xếp **khách nợ nhiều nhất lên đầu**, có ngày mua lần cuối.

## 1.0.0-rc.1.1

- Đồng bộ version Add-on với bản RC1.1.
- Chỉ chủ cửa hàng được kiểm tra máy in; giới hạn cổng máy in hợp lệ.
- Chặn URL ảnh import không an toàn, địa chỉ nội bộ và redirect tuỳ ý.
- Thêm giới hạn thử đăng nhập trong 5 phút.
- Không cho thu nợ khách hoặc trả nợ nhà cung cấp vượt số dư hiện tại.
- Màn Thu nợ / Trả nợ NCC báo ngay khi gõ số lớn hơn số đang nợ và khoá nút, không phải đợi máy báo lỗi.
- Chặn thêm địa chỉ nội bộ khi tải ảnh (dạng ::ffff:, 100.64.x.x, fe80–febf). Bộ đếm đăng nhập sai tự dọn, không phình bộ nhớ.

## 1.0.0-beta.10

- **Ô số lượng tự rộng ra** khi gõ số 3–4 chữ số (100, 1000, 12,5) — không còn bị mất số.
- **Màn hình "Đã bán xong":** 4 nút In hoá đơn / In A4 / Gửi Zalo / Đơn mới xếp gọn 2 hàng, chữ nằm trong nút.

## 1.0.0-beta.9

- **Chữ nhỏ lại** cho cả app (vừa mắt hơn, thấy được nhiều hơn).
- **Giỏ hàng gọn:** mỗi món 2 dòng — tên + ĐVT; giá · số lượng · thành tiền trên cùng một dòng. Nút +/− nhỏ lại.
- **Đang gõ trên điện thoại thì ẩn thanh menu dưới** (Bán hàng, Hoá đơn, Hàng hoá...) cho rộng chỗ; gõ xong tự hiện lại.

## 1.0.0-beta.8

- **Danh sách tìm hàng gọn như KiotViet:** mỗi hàng 2 dòng (tên + ĐVT, mã + tồn, giá bên phải), đơn vị quy đổi là nút nhỏ ngay dưới, bỏ ô ảnh trống. Màn hình điện thoại thấy được khoảng gấp 3 số hàng so với trước, danh sách không còn bị thanh "Thanh toán" che.
- Trang Hàng hoá cũng gọn hơn, nút Nhập / Excel / Thêm nhỏ lại.
- Sửa lỗi máy quét mã vạch + Enter không chọn đúng hàng khi mã hàng là chữ thường (mã từ KiotViet).

## 1.0.0-beta.7

- Sửa lỗi **"Failed to fetch" khi bấm "Đồng ý nhập"** trên điện thoại Android: điện thoại không cho đọc file lần thứ hai (lần xem trước đã đọc rồi). Giờ app đọc file một lần ngay khi chọn và dùng lại cho cả xem trước lẫn nhập.
- Mất mạng giữa chừng thì báo rõ ràng; bấm nhập lại không bị trùng hàng.

## 1.0.0-beta.6

- **Quên mật khẩu chủ cửa hàng:** vào Home Assistant → add-on PSell → tab Cấu hình, điền "Đặt lại mật khẩu chủ cửa hàng", Lưu rồi Khởi động lại. Tên đăng nhập hiện ở tab Nhật ký. Dữ liệu giữ nguyên.

## 1.0.0-beta.5

Thử với file Khách hàng (1.356 khách) và Nhà cung cấp (78 NCC) thật của cửa hàng: nhập đủ, không lỗi, tổng nợ khớp file.

- **Sửa lỗi gộp nhầm nhà cung cấp trùng tên.** KiotViet có 2 NCC cùng tên "Bảo Bình" khác mã. Trước đây app so theo tên nên gộp làm một, mất một NCC. Giờ NCC có **mã** riêng như KiotViet, nhập lại so theo mã. NCC tạo trong app tự có mã NCC000001...
- Sửa lỗi có thể gộp nhầm 2 khách dùng chung số điện thoại: có mã khách thì chỉ so theo mã.
- Giữ nguyên chữ hoa / thường của mã khách, mã NCC như KiotViet.
- Nhập thêm mã số thuế (cột "MST (xuất HĐ)"), ghi chú, khu vực giao hàng.

## 1.0.0-beta.4

Thử với file hàng hoá KiotViet thật của cửa hàng (8.302 dòng): nhập đủ 7.422 hàng, 585 đơn vị quy đổi, 295 combo, không dòng nào lỗi, tổng tồn kho khớp file.

- **Sửa lỗi không đọc được file xuất từ KiotViet** (file KiotViet ghi Excel theo kiểu riêng). Trước đây nhập file thật sẽ báo lỗi.
- **Nhập combo từ KiotViet** ("Combo - đóng gói") kèm các món bên trong theo cột "Hàng thành phần". Món bên trong là mã đơn vị quy đổi (vd 1 Bì = 50 cái) thì tự quy về đơn vị gốc.
- Giữ nguyên **chữ hoa / thường của mã hàng** như trong KiotViet (trước đây đổi hết thành chữ hoa). Tìm và quét mã vẫn không phân biệt hoa thường.
- Hàng không có đơn vị tính trong KiotViet thì để trống, không tự ghi "Cái".

## 1.0.0-beta.3

- **Mã QR chuyển khoản tạo ngay trong máy** theo chuẩn VietQR (NAPAS), không cần Internet. Mất mạng VNPT / Viettel mà điện thoại vẫn bắt wifi nhà thì vẫn bán, vẫn hiện QR. Dưới mã QR có tên và số tài khoản để khách đối chiếu.

## 1.0.0-beta.2

Chạy tốt với kho 20.000 mặt hàng và 1.500 khách (đã thử: tìm hàng dưới 0,02 giây, nhập file 20.000 hàng khoảng 3 giây).

- **Báo cáo cuối ngày về điện thoại** qua ứng dụng Home Assistant: doanh thu, lợi nhuận gộp, chi phí, lãi ròng, tiền mặt / chuyển khoản, khách nợ thêm, thu nợ, hàng sắp hết. Chọn điện thoại và giờ gửi trong Cài đặt, có nút "Gửi thử ngay".
- **Khôi phục dữ liệu** ngay trong app: chọn bản sao lưu trong máy hoặc tải file .db lên. App tự sao lưu dữ liệu hiện tại trước khi khôi phục, file hỏng thì báo lỗi và không đổi gì.
- Sửa **tổng nợ khách** và **tổng tiền hoá đơn** bị tính thiếu khi danh sách dài (trước chỉ cộng 300 khách / 500 hoá đơn đầu). Giờ máy chủ cộng toàn bộ.
- Danh sách hàng hoá, khách hàng, hoá đơn, bảng giá có nút **Xem thêm**, xem được hết 20.000 hàng.
- **Mã vạch có chữ** quét / tìm không phân biệt hoa thường (mã hàng vốn đã không phân biệt).
- Xuất Excel nhanh hơn 4-5 lần (20.000 hàng: 12 giây xuống 2,4 giây).
- Thêm chỉ mục dữ liệu cho công nợ, trả hàng, nhập hàng, thẻ kho để chạy nhanh khi dữ liệu nhiều năm.

## 1.0.0-beta.1

Bản thử nghiệm 1.0 (chú Phương viết, bác kiểm tra và bổ sung). Dữ liệu giữ nguyên.

- **Công nợ ngay lúc bán**: chọn khách khi thanh toán sẽ thấy nợ trước hoá đơn, nợ phát sinh và tổng nợ dự kiến sau bán. Số nợ cũ được lấy lại từ máy chủ mỗi lần mở, nên giỏ hàng để từ hôm trước vẫn đúng.
- **Mật khẩu mới ít nhất 12 ký tự** (cài đặt lần đầu, thêm nhân viên, đổi mật khẩu). Mật khẩu đang dùng vẫn đăng nhập bình thường.
- Nhập KiotViet: hệ số quy đổi bằng 0 hoặc âm thì báo lỗi đúng dòng, không tự đổi thành 1.
- Lỗi máy chủ không còn hiện chi tiết kỹ thuật lên màn hình (vẫn ghi trong nhật ký add-on).

## 0.3.0

- **Báo cáo xuất nhập tồn** theo kỳ: tồn đầu, nhập, bán, khách trả, trả NCC, kiểm kho, tồn cuối, giá trị tồn. Xuất Excel.
- **Giá bán lần trước**: chọn khách khi bán, mỗi món hiện giá đã bán cho khách đó lần gần nhất, bấm "Dùng giá này" là áp luôn.
- **Báo giá A4**: in bảng báo giá từ giỏ hàng cho khách / thợ, chưa bán, chưa trừ kho.

## 0.2.3

- Đổi tên app thành **PSell**. Dữ liệu giữ nguyên, cập nhật như bình thường.

## 0.2.2

- Nhập file KiotViet an toàn hơn: **xem trước** thêm / sửa gì (giá cũ → giá mới, tồn cũ → tồn mới) rồi mới đồng ý nhập.
- Cột nào không có hoặc để trống trong file thì **giữ nguyên** dữ liệu trong app (trước đây có thể bị ghi về 0).
- Nhập lại file giống hệt thì báo "giữ nguyên", không đổi gì.
- Cột trùng tên bảng giá (vd "Giá sỉ") thì cập nhật bảng giá. File chỉ có mã ĐVT quy đổi (vd file bảng giá) cập nhật đúng đơn vị, không tạo hàng mới.
- Nhập **khách hàng** và **nhà cung cấp** từ file KiotViet, kèm số nợ.
- Tự tải ảnh hàng hoá từ link ảnh KiotViet.

## 0.2.1

- Trả hàng: khách còn nợ thì mặc định "Trừ vào nợ", cảnh báo nếu chọn hoàn tiền mặt. Số tiền hoàn hiện trên nút tính giống hệt máy chủ.
- Thêm bài kiểm tra đối chiếu sổ sách sau 300 nghiệp vụ ngẫu nhiên (kho, công nợ, sổ quỹ, báo cáo).

## 0.2.0

- **Combo hàng hoá**: ghép nhiều món thành một combo. Bán combo thì kho trừ từng món bên trong, trả hàng / huỷ hoá đơn cộng lại đúng công thức lúc bán. Tồn combo tự tính theo số bộ ráp được.
- **Xuất Excel**: danh sách hàng hoá (có ĐVT quy đổi, bảng giá, nhập lại vào app được), công nợ khách hàng và nhà cung cấp (tổng hợp + sổ chi tiết: nợ đầu kỳ, tiền hàng, đã thanh toán, chiết khấu, trả hàng, còn nợ), danh sách hoá đơn và chi tiết hàng bán.
- **Sổ công nợ** trong từng khách / nhà cung cấp, in biên bản đối chiếu công nợ khổ A4.
- **Máy in qua IP** (cùng mạng với Home Assistant): hoá đơn K80 / K58, tem mã vạch 1–3 tem một hàng (cuộn 2 tem), in thử, kiểm tra kết nối. Không có máy in IP thì in bằng trình duyệt như cũ.
- **Hoá đơn A4** có mã hàng, khách hàng, tổng nợ, chỗ ký.
- **Thu chi (sổ quỹ)**: phiếu thu, phiếu chi, tồn quỹ tiền mặt / chuyển khoản theo ngày. Báo cáo có "Lãi sau chi phí".
- **Chốt ca**: tổng kết tiền trong ngày, in ra máy in hoá đơn.
- **Kiểm kho nhiều món**: quét từng món, nhập số đếm, lưu là cân lại tồn kho, giữ lịch sử lệch kho.

## 0.1.0

- Bản đầu tiên: bán hàng, đơn vị quy đổi, bảng giá, giảm giá từng món, tách thanh toán, trả hàng, công nợ, nhập hàng, báo cáo, sao lưu.
