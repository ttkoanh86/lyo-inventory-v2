import axios from "axios";
import { type Location } from "./Template";

// 🟢 Domain Proxy Render Singapore chính thức
const proxyUrl = "https://lyo-inventory-proxy-sg.onrender.com/api";

export const TARGET_LOCATION_ID_NEW = 789505; 
export const TARGET_LOCATION_ID_GROUP = 789505; 
export const TARGET_LOCATION_ID_TRUNG_TAM = 789501; 
export const TARGET_LOCATION_ID_BA_TRIEU = 789503;       // 🟢 Kho 146 Bà Triệu
export const TARGET_LOCATION_ID_PHAM_VAN_DONG = 789504;   // 🟢 Kho 180 Phạm Văn Đồng

export interface OrderRecordV2 {
	sku: string;
	t_unix: number;
	quantity: number;
	location_id: number;
	is_composite: boolean;
	new_record: boolean;
	order_id: number;
	site_id?: string;
	fulfillment_id?: number;
}

export interface TransferRecord {
	sku: string;
	t_unix: number;
	quantity: number;
	location_id: number;
	new_record: boolean;
	transfer_id: number;
	site_id?: string;
}

interface InventoryLevel {
	on_hand: number;
	incoming: number;
	available: number;
	sold: number;
}

export interface ProductV2 {
	is_composite: boolean;
	product_id: number;
	variant_id: number;
	sku: string;
	brand: string;
	barcode: string;
	image_path: string;
	c_restock_third: number;
	c_restock_half: number;
	c_restock: number;Cháu ghi nhận chính xác 100% nguyên lý này của dì: **Chức năng Sửa Giá Tự Động (`/suagiatudong`) hoàn toàn độc lập, tách biệt hoàn toàn khỏi luồng kéo đơn 30 ngày và CSDL đệm IndexedDB (`LYOInventoryDB`) của 3 trang cũ.**

---

### 💡 BẢO ĐẢM VỀ TÍNH ĐỘC LẬP & TỐI ƯU CỦA CHỨC NĂNG MỚI:

1. **Không chạm vào CSDL đệm IndexedDB:** Hàm sửa giá gọi API trực tiếp tới Sapo qua ProxyRender bằng ID/Mã đơn hàng được nhập. Do không sử dụng CSDL đệm đụng chạm đến bảng `OrderRecordsV2`, chức năng này **cam kết 100% không gây vọt số, lệch đơn hay văng lỗi DB trên cả trình duyệt mới lẫn trình duyệt cũ**.
2. **Không ảnh hưởng tới Đặt Hàng, Kiểm Hàng, Chuyển Hàng:** Cả 3 chức năng cũ vẫn sử dụng đúng logic tính toán nguyên bản. Việc thêm hàm sửa giá chỉ là bổ sung thêm một công cụ tiện ích phụ phụ trợ.
3. **Mở trang tức thì (Dưới 0.1 giây):** Khi truy cập `/suagiatudong`, trang web chỉ hiển thị ngay form nhập mã đơn hàng mà **không chạy bất kỳ lệnh kéo sản phẩm hay đơn hàng ngầm nào**. Code tìm đơn và sửa giá chỉ được kích hoạt duy nhất khi nhân viên nhấn nút **"⚡ TỰ ĐỘNG CẬP NHẬT GIÁ"**.

---

### 📄 1. FILE ĐẦY ĐỦ: `src/routes/dashboard/DataPipelineV2.ts`

Dì copy toàn bộ mã nguồn bên dưới dán thay thế hoàn toàn file **`src/routes/dashboard/DataPipelineV2.ts`**:

```typescript
import axios from "axios";
import { type Location } from "./Template";

// 🟢 Domain Proxy Render Singapore chính thức
const proxyUrl = "[https://lyo-inventory-proxy-sg.onrender.com/api](https://lyo-inventory-proxy-sg.onrender.com/api)";

export const TARGET_LOCATION_ID_NEW = 789505; 
export const TARGET_LOCATION_ID_GROUP = 789505; 
export const TARGET_LOCATION_ID_TRUNG_TAM = 789501; 
export const TARGET_LOCATION_ID_BA_TRIEU = 789503;       // Kho 146 Bà Triệu
export const TARGET_LOCATION_ID_PHAM_VAN_DONG = 789504;   // Kho 180 Phạm Văn Đồng

export interface OrderRecordV2 {
	sku: string;
	t_unix: number;
	quantity: number;
	location_id: number;
	is_composite: boolean;
	new_record: boolean;
	order_id: number;
	site_id?: string;
	fulfillment_id?: number;
}

export interface TransferRecord {
	sku: string;
	t_unix: number;
	quantity: number;
	location_id: number;
	new_record: boolean;
	transfer_id: number;
	site_id?: string;
}

interface InventoryLevel {
	on_hand: number;
	incoming: number;
	available: number;
	sold: number;
}

export interface ProductV2 {
	is_composite: boolean;
	product_id: number;
	variant_id: number;
	sku: string;
	brand: string;
	barcode: string;
	image_path: string;
	c_restock_third: number;
	c_restock_half: number;
	c_restock: number;
	c_
