// 🟢 HÀM SỬA GIÁ TỰ ĐỘNG ĐỘC LẬP CHO ĐƠN SỈ
export async function adjust_order_prices_auto(order_code_or_id: string) {
	try {
		const clean_query = order_code_or_id.trim();
		if (!clean_query) {
			return { success: false, message: "Vui lòng nhập Mã đơn hàng hoặc ID đơn!" };
		}

		// Kéo thông tin đơn hàng từ Sapo
		const resp = await axios.get(`${proxyUrl}/admin/orders.json`, {
			params: { name: clean_query, limit: 1 }
		});

		if (resp.status !== 200 || !resp.data?.orders || resp.data.orders.length === 0) {
			return { success: false, message: `Không tìm thấy đơn hàng "${clean_query}" trên Sapo!` };
		}

		const order = resp.data.orders[0];
		const line_items = order.order_line_items || order.line_items || [];

		if (line_items.length === 0) {
			return { success: false, message: "Đơn hàng không có sản phẩm nào!" };
		}

		let updated_items_count = 0;
		let details: any[] = [];

		const updated_line_items = await Promise.all(
			line_items.map(async (item: any) => {
				const qty = Number(item.quantity) || 0;
				const variant_id = item.variant_id;
				const current_price = Number(item.price) || 0;

				let target_price = current_price;
				let applied_rule = "Giá sỉ (BANSI)";

				try {
					const var_resp = await axios.get(`${proxyUrl}/admin/variants/${variant_id}.json`);
					if (var_resp.status === 200 && var_resp.data?.variant) {
						const variant = var_resp.data.variant;
						const prices = variant.variant_prices || [];

						const price_bansi = prices.find((p: any) => p.price_list_code === "BANSI")?.price || current_price;
						const price_sl20 = prices.find((p: any) => p.price_list_code === "1SP SL20")?.price;
						const price_vvip = prices.find((p: any) => p.price_list_code === "BANBUON")?.price;

						if (qty >= 50 && price_vvip) {
							target_price = Number(price_vvip);
							applied_rule = "Giá VVIP (SL ≥ 50)";
						} else if (qty >= 20 && qty < 50 && price_sl20) {
							target_price = Number(price_sl20);
							applied_rule = "Giá 1SP SL20 (20 ≤ SL < 50)";
						} else {
							if (price_bansi) {
								target_price = Number(price_bansi);
								applied_rule = "Giá Bán buôn (BANSI)";
							}
						}
					}
				} catch (e) {
					console.error(`Lỗi kéo giá Variant ${variant_id}:`, e);
				}

				if (Math.abs(target_price - current_price) > 1) {
					updated_items_count++;
				}

				details.push({
					sku: item.sku,
					name: item.name || item.title,
					quantity: qty,
					old_price: current_price,
					new_price: target_price,
					rule: applied_rule,
					changed: Math.abs(target_price - current_price) > 1
				});

				return {
					id: item.id,
					price: target_price
				};
			})
		);

		if (updated_items_count > 0) {
			const update_payload = {
				order: {
					id: order.id,
					order_line_items: updated_line_items
				}
			};

			const put_resp = await axios.put(`${proxyUrl}/admin/orders/${order.id}.json`, update_payload);

			if (put_resp.status === 200 || put_resp.status === 201) {
				return {
					success: true,
					order_code: order.name,
					message: `✅ Đã tự động cập nhật giá cho ${updated_items_count} sản phẩm!`,
					details: details
				};
			} else {
				return { success: false, message: "Lỗi kết nối khi cập nhật đơn giá lên Sapo!" };
			}
		} else {
			return {
				success: true,
				order_code: order.name,
				message: "Đơn hàng đã chuẩn giá sỉ, không có sản phẩm nào cần điều chỉnh!",
				details: details
			};
		}
	} catch (e: any) {
		console.error("Lỗi sửa giá tự động:", e);
		return { success: false, message: "Không thể tự động sửa giá. Vui lòng kiểm tra lại đường truyền Sapo!" };
	}
}
