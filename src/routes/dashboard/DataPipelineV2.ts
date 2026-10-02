// 🟢 BỘ LỌC TỰ ĐỘNG CHẶN HÀNG KHUYẾN MÃI, MÃ ẢO & CÁC MÃ SKU ĐẶC BIỆT
export function is_promotional_item(brand: string, name: string = "", sku: string = "") {
	const br = (brand || "").trim().toLowerCase();
	const nm = (name || "").trim().toLowerCase();
	const clean_sku = (sku || "").trim().toUpperCase();

	// 🚫 1. Danh sách 6 mã SKU cấm tuyệt đối không đưa vào Đặt hàng / Kiểm hàng / Chuyển hàng
	const blocked_skus = new Set([
		"LYO9566",
		"LYO9131",
		"LYO6928",
		"LYO9874",
		"LYO8946",
		"LYO9858",
		"LYO9873"
	]);

	if (blocked_skus.has(clean_sku)) {
		return true;
	}

	// 🚫 2. Chặn theo nhãn hiệu khuyến mãi
	if (br === "tặng" || br === "sale" || br.includes("kđh") || br === "kđh" || br.includes("khuyến mãi")) {
		return true;
	}

	// 🚫 3. Chặn theo tên combo, hàng tặng, mã ảo
	if (
		nm.includes("combo") || 
		nm.includes("- sale") || 
		nm.includes("-sale") || 
		nm.includes("sale ") || 
		nm.includes("(tặng)") || 
		nm.includes("kđh")
	) {
		return true;
	}

	return false;
}
