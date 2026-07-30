export async function fetch_order_record(variant_by_id: Map<number, ProductV2>) {
    console.log("🚀 [DEBUG] BẮT ĐẦU CHẠY FETCH_ORDER_RECORD");
    
    let a = new Axios({
        headers: { "Content-Type": "application/json", Authorization: obtain_access_token() },
    });

    let all_records: Record[] = [];
    let existing_keys = new Set<string>();
    
    const now = new Date();
    const min_date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 31, 0, 0, 0);
    const min_valid_ts = min_date.getTime();

    console.log("📅 [DEBUG] MỐC THỜI GIAN LỌC (31 NGÀY TRƯỚC):", {
        min_date_str: min_date.toLocaleString(),
        min_valid_ts: min_valid_ts
    });

    let page = 1;
    let running = true;

    while (running) {
        try {
            console.log(`📡 [DEBUG] Bắt đầu gọi API Trang ${page}...`);
            const resp = await a.get(`${proxyUrl}/admin/orders.json`, {
                params: { 
                    limit: 250, 
                    page: page, 
                    order_by: "created_on desc"
                },
            });

            if (resp.status === 200) {
                const raw_data_str = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
                const j = JSON.parse(raw_data_str);
                const orders = j.orders || [];

                console.log(`📦 [DEBUG] Trang ${page} trả về ${orders.length} đơn hàng.`);

                if (orders.length === 0) {
                    console.log("🛑 [DEBUG] Hết đơn hàng từ API -> DỪNG.");
                    running = false;
                    break;
                }

                // In thử đơn hàng đầu tiên và đơn hàng cuối cùng của trang này để xem ngày
                const first_order = orders[0];
                const last_order = orders[orders.length - 1];
                
                const first_ts = parseSapoDate(first_order.completed_on || first_order.finalized_on || first_order.created_on);
                const last_ts = parseSapoDate(last_order.completed_on || last_order.finalized_on || last_order.created_on);

                console.log(`🔎 [DEBUG] Trang ${page} - Đơn đầu: ${first_order.created_on} (TS: ${first_ts}) | Đơn cuối: ${last_order.created_on} (TS: ${last_ts})`);

                let reached_old_date = false;

                for (const order of orders) {
                    if (order.status !== "cancelled") {
                        const actual_loc_id = Number(order.location_id || 0);
                        const date_str = order.completed_on || order.finalized_on || order.created_on || order.created_at;
                        const order_ts = parseSapoDate(date_str);

                        // KIỂM TRA ĐIỀU KIỆN NGẮT
                        if (order_ts > 0 && order_ts < min_valid_ts) {
                            console.log(`⛔ [DEBUG] ĐÃ PHÁT HIỆN ĐƠN CŨ HƠN 31 NGÀY VÀO LÚC: ${date_str} (TS: ${order_ts} < Min: ${min_valid_ts}). KÍCH HOẠT DỪNG!`);
                            reached_old_date = true;
                            break;
                        }

                        if (order_ts >= min_valid_ts) {
                            const line_items = order.order_line_items || order.line_items || order.items || [];
                            line_items.forEach((line_item: any, index: number) => {
                                const qty = Number(line_item.quantity) || 0;
                                if (qty > 0) {
                                    const variant_obj = variant_by_id.get(line_item.variant_id);
                                    const line_id = line_item.id || index;

                                    if (line_item.composite_item_parts && line_item.composite_item_parts.length > 0) {
                                        line_item.composite_item_parts.forEach((part: any) => {
                                            const sub_variant = variant_by_id.get(part.variant_id);
                                            const clean_sub_sku = (sub_variant?.sku || part.sku || "").trim();
                                            if (clean_sub_sku) {
                                                const total_sub_qty = qty * (Number(part.quantity) || 1);
                                                const record_key = `ORD_${order.id}_${line_id}_${clean_sub_sku}_${actual_loc_id}`;
                                                if (!existing_keys.has(record_key)) {
                                                    all_records.push({ sku: clean_sub_sku, t_unix: order_ts, quantity: total_sub_qty, location_id: actual_loc_id, is_composite: false, new_record: true, order_id: order.id } as OrderRecordV2);
                                                    existing_keys.add(record_key);
                                                }
                                            }
                                        });
                                    } 
                                    else if (variant_obj?.is_composite && variant_obj?.composite_item_quantity_by_variant_id && variant_obj.composite_item_quantity_by_variant_id.size > 0) {
                                        variant_obj.composite_item_quantity_by_variant_id.forEach((comp_qty, comp_variant_id) => {
                                            const sub_variant = variant_by_id.get(comp_variant_id);
                                            if (sub_variant && sub_variant.sku) {
                                                const clean_sub_sku = sub_variant.sku.trim();
                                                const total_sub_qty = qty * comp_qty;
                                                const record_key = `ORD_${order.id}_${line_id}_${clean_sub_sku}_${actual_loc_id}`;
                                                if (!existing_keys.has(record_key)) {
                                                    all_records.push({ sku: clean_sub_sku, t_unix: order_ts, quantity: total_sub_qty, location_id: actual_loc_id, is_composite: false, new_record: true, order_id: order.id } as OrderRecordV2);
                                                    existing_keys.add(record_key);
                                                }
                                            }
                                        });
                                    } 
                                    else {
                                        const raw_sku = (variant_obj?.sku || line_item.sku || line_item.barcode || "").trim();
                                        if (raw_sku) {
                                            const record_key = `ORD_${order.id}_${line_id}_${raw_sku}_${actual_loc_id}`;
                                            if (!existing_keys.has(record_key)) {
                                                all_records.push({ sku: raw_sku, t_unix: order_ts, quantity: qty, location_id: actual_loc_id, is_composite: false, new_record: true, order_id: order.id } as OrderRecordV2);
                                                existing_keys.add(record_key);
                                            }
                                        }
                                    }
                                }
                            });
                        }
                    }
                }

                if (reached_old_date) {
                    console.log(`✅ [DEBUG] Dừng cào thành công ở Trang ${page}. Tổng số record cào được: ${all_records.length}`);
                    running = false;
                    break;
                }

                page++;
                await sleep(10);
            } else { 
                console.log("❌ [DEBUG] Lỗi HTTP status:", resp.status);
                running = false; 
            }
        } catch (e) { 
            console.log("❌ [DEBUG] Lỗi Exception:", e);
            running = false; 
        }
    }

    await updateIndexedDB(all_records);
    setLastDataUpdate();
    return all_records as OrderRecordV2[];
}
