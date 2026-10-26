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
	c_restock: number;
	c_on_hand: number;
	c_incoming: number;
	c_available: number;
	name: string;
	name_normalized: string;
	import_price: number;
	retail_price: number;
	retail_price_ecomm: number;
	inventory_level_by_location: Map<number, InventoryLevel>;
	composite_item_quantity_by_variant_id?: Map<number, number>;
	order_history_by_location: Set<number>;
}

export function obtain_access_token(): string {
	return localStorage.getItem("token") || "";
}

export type RecordItem = OrderRecordV2 | TransferRecord;

export function parseSapoDate(dateStr: string): number {
	if (!dateStr) return 0;
	const isoStr = dateStr.trim().replace(" ", "T");
	const parsed = Date.parse(isoStr);
	if (!isNaN(parsed) && parsed > 0) return parsed;
	return new Date(dateStr).getTime() || 0;
}

// 🟢 BỘ LỌC TỰ ĐỘNG CHẶN HÀNG KHUYẾN MÃI, MÃ ẢO & CÁC MÃ SKU ĐẶC BIỆT
export function is_promotional_item(brand: string, name: string = "", sku: string = "") {
	const br = (brand || "").trim().toLowerCase();
	const nm = (name || "").trim().toLowerCase();
	const clean_sku = (sku || "").trim().toUpperCase();

	// 🚫 1. Danh sách 7 mã SKU cấm tuyệt đối
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

// 🟢 THUẬT TOÁN TÍNH SẢN LƯỢNG BÁN 30 NGÀY CHUẨN XÁC THEO TỪNG KHO CHI NHÁNH
export function calculate_restock_data(
	records: RecordItem[],
	variant_by_id: Map<number, ProductV2>,
	location_id: number,
) {
	const active_loc_id = Number(location_id) || TARGET_LOCATION_ID_GROUP;
	records.sort((a, b) => b.t_unix - a.t_unix);

	let sales_by_sku = new Map<string, number>();

	const now_ts = new Date().getTime();
	const thirty_days_ts = 30 * 24 * 60 * 60 * 1000;
	const min_valid_ts = now_ts - thirty_days_ts;

	for (let [_, variant] of variant_by_id) {
		if (variant.sku && !variant.is_composite) {
			sales_by_sku.set(variant.sku.trim().toUpperCase(), 0);
		}
	}

	for (let record of records) {
		const clean_sku = (record.sku || "").trim().toUpperCase();
		const rec_loc = Number(record.location_id);

		if (clean_sku && rec_loc === active_loc_id && record.t_unix >= min_valid_ts && record.t_unix <= now_ts) {
			const current_sales = sales_by_sku.get(clean_sku) || 0;
			sales_by_sku.set(clean_sku, current_sales + (Number(record.quantity) || 0));
		}
	}

	variant_by_id.forEach((variant) => {
		if (variant.is_composite || is_promotional_item(variant.brand, variant.name, variant.sku)) {
			variant.c_restock = 0;
			return;
		}

		const inventory = variant.inventory_level_by_location.get(active_loc_id) || variant.inventory_level_by_location.get(TARGET_LOCATION_ID_GROUP);

		variant.c_available = inventory ? Math.max(0, Math.round(inventory.available ?? inventory.on_hand ?? 0)) : 0;
		variant.c_incoming = inventory ? Math.max(0, Math.round(inventory.incoming ?? 0)) : 0;
		variant.c_on_hand = variant.c_available;

		const clean_sku = (variant.sku || "").trim().toUpperCase();
		const actual_sales = sales_by_sku.get(clean_sku) ?? 0;

		variant.c_restock = Math.round(actual_sales);
	});

	return get_items_need_restock(variant_by_id, active_loc_id);
}

export function get_items_need_restock(variant_by_id: Map<number, ProductV2>, target_location_id: number): ProductV2[] {
	let result: ProductV2[] = [];
	variant_by_id.forEach((variant) => {
		if (variant.is_composite || is_promotional_item(variant.brand, variant.name, variant.sku)) return;

		const sales = variant.c_restock || 0;
		const current_has = variant.c_available + variant.c_incoming;

		if (current_has <= 0.5 * sales && sales > 0) {
			variant.c_restock_half = Math.max(0, Math.round(0.5 * sales - current_has));
			variant.c_restock_third = Math.max(0, Math.round((1 / 3) * sales - current_has));
			result.push(variant);
		}
	});
	return result;
}

export function get_items_has_sales(variant_by_id: Map<number, ProductV2>): ProductV2[] {
	let result: ProductV2[] = [];
	variant_by_id.forEach((variant) => {
		if (variant.is_composite || is_promotional_item(variant.brand, variant.name, variant.sku)) return;

		const sales = variant.c_restock || 0;
		const current_has = variant.c_available + variant.c_incoming;

		if (sales > 0 && current_has > 0.5 * sales) {
			result.push(variant);
		}
	});
	return result;
}

export function get_items_out_of_stock_history(variant_by_id: Map<number, ProductV2>, target_location_id: number): ProductV2[] {
	let result: ProductV2[] = [];
	variant_by_id.forEach((variant) => {
		if (variant.is_composite || is_promotional_item(variant.brand, variant.name, variant.sku)) return;

		const sales = variant.c_restock || 0;
		const current_has = variant.c_available + variant.c_incoming;
		const is_valid_product = (variant.retail_price > 0) && (variant.image_path && variant.image_path.trim().length > 0);

		if (sales === 0 && current_has === 0 && is_valid_product) {
			variant.c_restock_half = 0;
			variant.c_restock_third = 0;
			result.push(variant);
		}
	});
	return result;
}

export async function get_locations(): Promise<Location[]> {
	return [
		{ id: TARGET_LOCATION_ID_GROUP, label: "CÔNG TY TNHH LYO GROUP", address: "Mặc định" },
		{ id: TARGET_LOCATION_ID_TRUNG_TAM, label: "Chi nhánh trung tâm", address: "Trung tâm" }
	];
}

export function isFirstTime() { return true; }
export function setLastDataUpdate() { localStorage.setItem("last_data_update_v50", new Date().getTime().toString()); }
export function getLastDataUpdateTUnix() { return Number(localStorage.getItem("last_data_update_v50")); }
export function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export function normalizeString(input: string): string {
	if (!input) return "";
	return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
}

// 🟢 KÉO SẢN PHẨM NGUYÊN BẢN GỐC
export async function get_active_products() {
	let p_variant_by_ids: Map<number, ProductV2> = new Map();
	let running = true;
	let page = 1;

	while (running) {
		try {
			const resp = await axios.get(`${proxyUrl}/admin/products.json`, {
				params: { limit: 250, page: page, status: "active" },
			});

			if (resp.status === 200) {
				const products = resp.data?.products || [];
				if (products.length === 0) { running = false; break; }

				products.forEach((product: any) => {
					if (product.status !== "active") return;

					const brand_name = (product.brand || "").trim();
					const prod_name = (product.name || "").trim();

					const is_prod_composite = product.product_type === "composite";

					product.variants.forEach((variant: any) => {
						if (variant.sellable === false || variant.status === "inactive" || variant.composite || is_prod_composite) return;

						const full_var_name = variant.name || prod_name;
						const var_sku = (variant.sku || "").trim().toUpperCase();

						if (is_promotional_item(brand_name, full_var_name, var_sku)) return;

						let p_variant: ProductV2 = {
							is_composite: false,
							brand: brand_name || "<Không xác định>",
							variant_id: variant.id,
							product_id: product.id,
							sku: var_sku,
							barcode: (variant.barcode || var_sku).trim().toUpperCase(),
							c_restock: 0, c_restock_half: 0, c_restock_third: 0, image_path: "",
							c_on_hand: 0, c_incoming: 0, c_available: 0,
							name: full_var_name, name_normalized: normalizeString(full_var_name),
							import_price: variant.variant_import_price || 0, retail_price: variant.variant_retail_price || 0, retail_price_ecomm: 0,
							inventory_level_by_location: new Map(),
							composite_item_quantity_by_variant_id: new Map(),
							order_history_by_location: new Set<number>()
						};

						if (variant.inventories && variant.inventories.length > 0) {
							variant.inventories.forEach((inventory: any) => {
								const loc_id = Number(inventory.location_id);
								p_variant.inventory_level_by_location.set(loc_id, {
									on_hand: Number(inventory.on_hand || 0),
									incoming: Number(inventory.incoming || 0),
									available: Number(inventory.available ?? inventory.on_hand ?? 0),
									sold: 0,
								});
							});
						}

						if (variant.images && variant.images[0]) { p_variant.image_path = variant.images[0].full_path; }
						p_variant_by_ids.set(p_variant.variant_id, p_variant);
					});
				});
				page++;
				await sleep(10);
			} else { running = false; }
		} catch (e: any) {
			console.error("[LỖI KÉO SẢN PHẨM]:", e);
			running = false;
		}
	}
	return p_variant_by_ids;
}

// 🟢 HÀM KHỞI TẠO ĐẮC THÙ CHỜ TẠO BẢNG XONG MỚI TRẢ VỀ DB (ĐỘC LẬP & AN TOÀN CHO TẤT CẢ TRÌNH DUYỆT MỚI)
function get_idb_connection(): Promise<IDBDatabase | null> {
	return new Promise((resolve) => {
		try {
			const request = indexedDB.open("LYOInventoryDB_V50", 1);

			request.onupgradeneeded = function (event) {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains("OrderRecordsV2")) {
					const store = db.createObjectStore("OrderRecordsV2", { autoIncrement: true });
					store.createIndex("type", "type");
					store.createIndex("site_id", "site_id");
				}
			};

			request.onsuccess = function () {
				const db = request.result;
				if (!db.objectStoreNames.contains("OrderRecordsV2")) {
					db.close();
					resolve(null);
					return;
				}
				resolve(db);
			};

			request.onerror = function () {
				resolve(null);
			};
		} catch (e) {
			resolve(null);
		}
	});
}

// 🟢 HÀM ĐỌC INDEXEDDB CHUẨN XÁC VỚI DB KẾT NỐI AN TOÀN
export async function getStoredOrderRecords(): Promise<OrderRecordV2[]> {
	const db = await get_idb_connection();
	if (!db) return [];

	return new Promise((resolve) => {
		try {
			const tx = db.transaction("OrderRecordsV2", "readonly");
			const store = tx.objectStore("OrderRecordsV2");
			const getAllReq = store.getAll();

			getAllReq.onsuccess = function () {
				db.close();
				resolve(getAllReq.result || []);
			};

			getAllReq.onerror = function () {
				db.close();
				resolve([]);
			};
		} catch (err) {
			db.close();
			resolve([]);
		}
	});
}

// 🟢 HÀM GHI INDEXEDDB CHUẨN XÁC VỚI DB KẾT NỐI AN TOÀN
export async function updateIndexedDB(records: RecordItem[]) {
	const db = await get_idb_connection();
	if (!db) return;

	return new Promise<void>((resolve) => {
		try {
			const tx = db.transaction("OrderRecordsV2", "readwrite");
			const store = tx.objectStore("OrderRecordsV2");

			records.forEach((r) => {
				store.put({
					t_unix: r.t_unix,
					quantity: r.quantity,
					sku: (r.sku || "").trim().toUpperCase(),
					location_id: Number(r.location_id),
					is_composite: (r as OrderRecordV2).is_composite || false,
					order_id: (r as OrderRecordV2).order_id || (r as TransferRecord).transfer_id,
					site_id: r.site_id || "site_new",
					type: (r as OrderRecordV2).order_id ? "order" : "transfer",
				});
			});

			tx.oncomplete = function () {
				db.close();
				resolve();
			};

			tx.onerror = function () {
				db.close();
				resolve();
			};
		} catch (err) {
			db.close();
			resolve();
		}
	});
}

export function get_low_sales_skus(p_variants: ProductV2[]) {
	let _r = new Set<string>();
	p_variants.forEach((v) => { if (v.c_restock < 20) _r.add(v.sku); });
	return _r;
}

// 🟢 HÀM KÉO ĐƠN HÀNG TỐI ƯU CÓ BỘ LỌC CỤ THỂ THEO KHO
export async function fetch_order_record(
	variant_by_id: Map<number, ProductV2>,
	target_location_ids: number[] = []
) {
	let existing_keys = new Set<string>();
	
	let stored_records = await getStoredOrderRecords();
	let max_stored_ts = 0;

	stored_records.forEach((r) => {
		const record_key = `ORD_${r.order_id}_${r.sku}_${r.location_id}`;
		existing_keys.add(record_key);
		if (r.t_unix > max_stored_ts) max_stored_ts = r.t_unix;
	});

	const now_ts = new Date().getTime();
	const thirty_days_ts = 30 * 24 * 60 * 60 * 1000;
	const min_valid_ts = now_ts - thirty_days_ts;

	const fetch_since_ts = max_stored_ts > min_valid_ts ? max_stored_ts : min_valid_ts;

	let new_records: RecordItem[] = [];
	let page = 1;
	let running = true;

	const allowed_loc_set = target_location_ids.length > 0 ? new Set(target_location_ids) : null;

	while (running) {
		try {
			const resp = await axios.get(`${proxyUrl}/admin/orders.json`, {
				params: { limit: 250, page: page, order_by: "created_on desc" }
			});

			if (resp.status === 200) {
				const j = resp.data || {};
				const orders = j.orders || [];

				if (orders.length === 0) { running = false; break; }

				let reached_existing_date = false;

				for (const order of orders) {
					if (order.status !== "cancelled") {
						const actual_loc_id = Number(order.location_id || order.assignee_location_id || TARGET_LOCATION_ID_GROUP);

						if (allowed_loc_set && !allowed_loc_set.has(actual_loc_id)) {
							continue;
						}

						const date_str = order.completed_on || order.finalized_on || order.created_on || order.created_at;
						const order_ts = parseSapoDate(date_str);

						if (order_ts > 0 && order_ts <= fetch_since_ts && stored_records.length > 0) {
							reached_existing_date = true;
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
											const clean_sub_sku = (sub_variant?.sku || part.sku || "").trim().toUpperCase();
											if (clean_sub_sku) {
												const total_sub_qty = qty * (Number(part.quantity) || 1);
												const record_key = `ORD_${order.id}_${line_id}_${clean_sub_sku}_${actual_loc_id}`;
												if (!existing_keys.has(record_key)) {
													new_records.push({ sku: clean_sub_sku, t_unix: order_ts, quantity: total_sub_qty, location_id: actual_loc_id, is_composite: false, new_record: true, order_id: order.id } as OrderRecordV2);
													existing_keys.add(record_key);
												}
											}
										});
									} else if (variant_obj?.is_composite && variant_obj?.composite_item_quantity_by_variant_id && variant_obj.composite_item_quantity_by_variant_id.size > 0) {
										variant_obj.composite_item_quantity_by_variant_id.forEach((comp_qty, comp_variant_id) => {
											const sub_variant = variant_by_id.get(comp_variant_id);
											if (sub_variant && sub_variant.sku) {
												const clean_sub_sku = sub_variant.sku.trim().toUpperCase();
												const total_sub_qty = qty * comp_qty;
												const record_key = `ORD_${order.id}_${line_id}_${clean_sub_sku}_${actual_loc_id}`;
												if (!existing_keys.has(record_key)) {
													new_records.push({ sku: clean_sub_sku, t_unix: order_ts, quantity: total_sub_qty, location_id: actual_loc_id, is_composite: false, new_record: true, order_id: order.id } as OrderRecordV2);
													existing_keys.add(record_key);
												}
											}
										});
									} else {
										const raw_sku = (variant_obj?.sku || line_item.sku || line_item.barcode || "").trim().toUpperCase();
										if (raw_sku) {
											const record_key = `ORD_${order.id}_${line_id}_${raw_sku}_${actual_loc_id}`;
											if (!existing_keys.has(record_key)) {
												new_records.push({ sku: raw_sku, t_unix: order_ts, quantity: qty, location_id: actual_loc_id, is_composite: false, new_record: true, order_id: order.id } as OrderRecordV2);
												existing_keys.add(record_key);
											}
										}
									}
								}
							});
						}
					}
				}

				if (reached_existing_date) {
					running = false;
					break;
				}

				page++;
				await sleep(10);
			} else { running = false; }
		} catch (e: any) {
			console.error("[LỖI KÉO ĐƠN]:", e);
			running = false;
		}
	}

	if (new_records.length > 0) {
		await updateIndexedDB(new_records);
	}

	setLastDataUpdate();
	return [...stored_records, ...new_records] as OrderRecordV2[];
}

export async function fetch_inventory_transfer(p_variants: Map<number, ProductV2>) { return []; }

// 🟢 HÀM ĐẨY TRỰC TIẾP PHIẾU CHUYỂN HÀNG LÊN SAPO
export async function create_sapo_stock_transfer(
	items: ProductV2[], 
	target_location_id: number
) {
	try {
		const line_items = items.map((item: any) => ({
			variant_id: item.variant_id,
			sku: item.sku,
			name: item.name,
			qty: item.c_transfer_suggest || 0
		})).filter(x => x.qty > 0);

		if (line_items.length === 0) {
			alert("Không có sản phẩm nào có số lượng chuyển > 0!");
			return false;
		}

		const payload = {
			stock_transfer: {
				from_location_id: TARGET_LOCATION_ID_GROUP,
				to_location_id: Number(target_location_id),
				note: "Đơn chuyển hàng tự động từ LYO Dự Báo",
				stock_transfer_line_items: line_items.map(i => ({
					variant_id: i.variant_id,
					quantity: i.qty
				}))
			}
		};

		const resp = await axios.post(`${proxyUrl}/admin/stock_transfers.json`, payload);
		
		if (resp.status === 200 || resp.status === 201) {
			alert(`✅ Đã tạo thành công Phiếu chuyển hàng trên Sapo với ${line_items.length} sản phẩm!`);
			return true;
		} else {
			alert("Lỗi khi tạo phiếu chuyển hàng trên Sapo!");
			return false;
		}
	} catch (e: any) {
		console.error("Lỗi POST stock_transfers:", e);
		alert("Không thể kết nối API Sapo để tạo đơn chuyển hàng. Vui lòng dùng nút Xuất Excel!");
		return false;
	}
}

// 🟢 HÀM SỬA GIÁ TỰ ĐỘNG - PHÂN TÁCH 2 BƯỚC ĐỘC LẬP CHUẨN PAYLOAD SAPO
export async function adjust_order_prices_auto(order_code_or_id: string) {
	try {
		const clean_query = order_code_or_id.trim().toUpperCase();
		if (!clean_query) return { success: false, message: "Vui lòng nhập Mã đơn hàng!" };

		const token = obtain_access_token();
		const authHeaders = { headers: { Authorization: token } };

		// 1. Kéo thông tin đơn hàng
		const resp = await axios.get(`${proxyUrl}/admin/orders.json`, {
			params: { query: clean_query, limit: 10 },
			timeout: 15000,
			...authHeaders
		});

		const orders_list = resp.data?.orders || [];
		const target_summary = orders_list.find((o: any) => 
			(o.code || "").toUpperCase().trim() === clean_query || (o.name || "").toUpperCase().trim() === clean_query
		);

		if (!target_summary) return { success: false, message: `Không tìm thấy đơn hàng "${clean_query}"!` };

		// 2. Kéo chi tiết sản phẩm của đơn
		const detail_resp = await axios.get(`${proxyUrl}/admin/orders/${target_summary.id}.json`, {
			timeout: 15000,
			...authHeaders
		});

		const order = detail_resp.data?.order;
		const raw_line_items = order?.order_line_items || order?.line_items || [];
		if (raw_line_items.length === 0) return { success: false, message: "Đơn hàng không có sản phẩm nào!" };

		// =========================================================================
		// 🟢 BƯỚC 1: KIỂM TRA ĐIỀU KIỆN BẢNG GIÁ NỀN CỦA ĐƠN HÀNG
		// =========================================================================
		const price_list_name = String(order.price_list_name || order.price_list?.name || "").toUpperCase();
		const total_price = Number(order.total_price || order.total || 0);

		// Điều kiện Bán buôn: Tổng tiền >= 2 triệu
		if (price_list_name.includes("BAN BUON") || price_list_name.includes("BÁN BUÔN") || price_list_name.includes("BANSI")) {
			if (total_price < 2000000) {
				return {
					success: false,
					message: `❌ Bảng giá đơn không hợp lệ: Đơn đang chọn "Bán buôn" nhưng tổng tiền (${total_price.toLocaleString("vi-VN")}đ) chưa đạt tối thiểu 2.000.000đ!`
				};
			}
		}

		// Điều kiện SL20: Mọi sản phẩm trong đơn phải có SL >= 20
		if (price_list_name.includes("SL20") || price_list_name.includes("SL 20")) {
			for (const item of raw_line_items) {
				const q = Number(item.quantity) || 0;
				if (q < 20) {
					return {
						success: false,
						message: `❌ Bảng giá đơn không hợp lệ: Đơn đang chọn "SL20" nhưng sản phẩm "${item.product_name || item.name}" chỉ có số lượng ${q} (< 20)!`
					};
				}
			}
		}

		// Điều kiện VVIP: Mọi sản phẩm trong đơn phải có SL >= 50
		if (price_list_name.includes("VVIP") || price_list_name.includes("SL50")) {
			for (const item of raw_line_items) {
				const q = Number(item.quantity) || 0;
				if (q < 50) {
					return {
						success: false,
						message: `❌ Bảng giá đơn không hợp lệ: Đơn đang chọn "VVIP" nhưng sản phẩm "${item.product_name || item.name}" chỉ có số lượng ${q} (< 50)!`
					};
				}
			}
		}

		// =========================================================================
		// 🟢 BƯỚC 2: CHỈ QUÉT DÒNG CÓ NOTE ĐỂ KIỂM TRA VÀ SỬA GIÁ
		// =========================================================================
		let updated_items_count = 0;
		let details: any[] = [];
		let cleaned_payload_line_items: any[] = [];

		for (let index = 0; index < raw_line_items.length; index++) {
			const item = raw_line_items[index];
			const current_stt = index + 1;
			const item_note = String(item.note || "").trim().toUpperCase();
			const current_price = Number(item.price) || 0;
			const qty = Number(item.quantity) || 0;
			const item_name = item.product_name || item.name || "Sản phẩm";

			let target_price = current_price;
			let applied_rule = "";

			// Chỉ xử lý khi dòng có ghi chú
			if (item_note && item.variant_id) {
				let effective_qty = qty;

				// Bóc tách danh sách số dòng sau tiền tố (ví dụ: "ĐL: 1,2" hoặc "ĐL: 1, 2")
				const after_prefix = item_note.replace(/^(?:ĐL|DL|VVIP|SL20|SL50|SL100)\s*[:\s-]*/i, "").trim();
				const line_numbers = after_prefix
					.split(",")
					.map(part => parseInt(part.trim(), 10))
					.filter(num => !isNaN(num) && num > 0);

				if (line_numbers.length > 0) {
					let sum_qty = 0;
					let is_same_product = true;

					for (const ln of line_numbers) {
						const target_item = raw_line_items[ln - 1];
						if (target_item) {
							if (target_item.product_id !== item.product_id) {
								is_same_product = false;
							}
							sum_qty += Number(target_item.quantity) || 0;
						} else {
							is_same_product = false;
						}
					}

					if (is_same_product) {
						effective_qty = sum_qty;
					} else {
						console.warn(`Dòng ${current_stt}: Các dòng khai báo gộp không cùng loại sản phẩm hoặc vượt quá STT thực tế!`);
					}
				}

				// Kéo thông tin mốc giá của Variant
				try {
					const var_resp = await axios.get(`${proxyUrl}/admin/variants/${item.variant_id}.json`, {
						timeout: 6000,
						...authHeaders
					});

					if (var_resp.status === 200 && var_resp.data?.variant) {
						const prices = var_resp.data.variant.variant_prices || [];
						const extractPrice = (keys: string[]) => {
							for (const p of prices) {
								const strData = JSON.stringify(p).toUpperCase();
								if (keys.some(k => strData.includes(k))) {
									const val = Number(p.price || p.value || 0);
									if (val > 0) return val;
								}
							}
							return null;
						};

						const price_daily = extractPrice(["DAI LY", "DAILY", "ĐẠI LÝ", "SL100"]);
						const price_vvip  = extractPrice(["BANBUON", "VVIP", "SL50"]);
						const price_sl20  = extractPrice(["1SP SL20", "SL20", "1SP_SL20"]);

						// Kiểm tra mốc ĐL (SL >= 100)
						if (item_note.startsWith("ĐL") || item_note.startsWith("DL")) {
							if (effective_qty >= 100 && price_daily) {
								target_price = price_daily;
								applied_rule = `Giá Đại lý (Gộp dòng: ${effective_qty} SP)`;
							} else {
								applied_rule = `Ghi chú ĐL nhưng tổng số lượng (${effective_qty}) chưa đủ 100`;
							}
						}
						// Kiểm tra mốc VVIP (SL >= 50)
						else if (item_note.startsWith("VVIP") || item_note.startsWith("SL50")) {
							if (effective_qty >= 50 && price_vvip) {
								target_price = price_vvip;
								applied_rule = `Giá VVIP (Gộp dòng: ${effective_qty} SP)`;
							} else {
								applied_rule = `Ghi chú VVIP nhưng tổng số lượng (${effective_qty}) chưa đủ 50`;
							}
						}
						// Kiểm tra mốc SL20 (SL >= 20)
						else if (item_note.startsWith("SL20")) {
							if (effective_qty >= 20 && price_sl20) {
								target_price = price_sl20;
								applied_rule = `Giá SL20 (Gộp dòng: ${effective_qty} SP)`;
							} else {
								applied_rule = `Ghi chú SL20 nhưng tổng số lượng (${effective_qty}) chưa đủ 20`;
							}
						}
					}
				} catch (e) {
					console.warn(`Lỗi tra giá variant dòng ${current_stt}:`, e);
				}
			}

			const is_changed = Math.abs(target_price - current_price) > 1;
			if (is_changed) {
				updated_items_count++;
				details.push({
					stt: current_stt,
					sku: item.sku || "N/A",
					name: item_name,
					quantity: qty,
					old_price: current_price,
					new_price: target_price,
					rule: applied_rule,
					note: item_note,
					changed: true
				});
			}

			cleaned_payload_line_items.push({
				id: item.id,
				product_id: item.product_id,
				variant_id: item.variant_id,
				price: target_price,
				quantity: item.quantity
			});
		}

		// =========================================================================
		// 🟢 BƯỚC 3: CẬP NHẬT LÊN SAPO NẾU CÓ DÒNG THAY ĐỔI
		// =========================================================================
		if (updated_items_count > 0) {
			const update_payload = {
				order: {
					id: order.id,
					order_line_items: cleaned_payload_line_items
				}
			};

			const put_resp = await axios.put(`${proxyUrl}/admin/orders/${order.id}.json`, update_payload, {
				timeout: 15000,
				...authHeaders
			});

			if (put_resp.status === 200 || put_resp.status === 201) {
				return {
					success: true,
					order_code: order.code || clean_query,
					message: `✅ Bảng giá đơn hợp lệ. Đã cập nhật giá mới thành công cho ${updated_items_count} sản phẩm!`,
					details: details
				};
			} else {
				return { success: false, message: "Lỗi kết nối khi cập nhật đơn hàng lên Sapo!" };
			}
		} else {
			return {
				success: true,
				order_code: order.code || clean_query,
				message: "Bảng giá đơn hợp lệ. Không có sản phẩm ghi chú nào cần sửa hoặc chưa đủ điều kiện số lượng!",
				details: []
			};
		}

	} catch (e: any) {
		console.error("Lỗi điều chỉnh giá:", e);
		return { success: false, message: "Không thể xử lý đơn hàng: " + (e.message || "") };
	}
}
// 🟢 HÀM GOM HÀNG SAPO CHẠY SIÊU TỐC - BỎ REQUEST DƯ THỪA
export async function aggregate_sapo_orders_from_pdf(order_ids: string[]) {
	try {
		if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
			return { success: false, message: "Danh sách Mã đơn hàng rỗng!" };
		}

		const token = obtain_access_token();
		const authHeaders = { headers: { Authorization: token } };

		const item_map: Record<string, { sku: string; name: string; qty: number }> = {};
		let total_qty = 0;
		const successful_orders = new Set<string>();
		const failed_orders: string[] = [];

		// ⚡ Tra cứu 1 đơn hàng (Chỉ gọi 1 request duy nhất)
		async function fetchSingleOrder(orderId: string) {
			const clean_query = String(orderId).trim().toUpperCase();
			if (!clean_query) return;

			try {
				// 1. Kéo đơn từ Sapo Proxy (Timeout 25s)
				const resp = await axios.get(`${proxyUrl}/admin/orders.json`, {
					params: { query: clean_query, limit: 5 },
					timeout: 25000,
					...authHeaders
				});

				if (resp.status !== 200 || !resp.data?.orders || resp.data.orders.length === 0) {
					failed_orders.push(clean_query);
					return;
				}

				// Tìm chính xác đơn hàng khớp mã
				const order = resp.data.orders.find((o: any) => {
					const c_code = (o.code || "").toUpperCase().trim();
					const c_name = (o.name || "").toUpperCase().trim();
					const c_ref = (o.reference_number || o.source_name || "").toUpperCase().trim();
					return c_code.includes(clean_query) || c_name.includes(clean_query) || c_ref.includes(clean_query) || String(o.id) === clean_query;
				}) || resp.data.orders[0];

				// Lấy trực tiếp chi tiết sản phẩm ngay trong object order (Không gọi thêm API thứ 2)
				const raw_line_items = order.order_line_items || order.line_items || [];

				if (raw_line_items.length > 0) {
					successful_orders.add(clean_query);
				} else {
					failed_orders.push(clean_query);
					return;
				}

				// Gom sản phẩm
				for (const item of raw_line_items) {
					const sku = (
						item.variant_sku || 
						item.sku || 
						item.barcode || 
						"KHONG_MA_SKU"
					).trim().toUpperCase();

					let full_name = item.variant_name || item.product_name || item.name || "Sản phẩm";
					if (item.variant_title && !full_name.includes(item.variant_title)) {
						full_name = `${full_name} - ${item.variant_title}`;
					}

					const qty = Number(item.quantity) || 1;

					if (!item_map[sku]) {
						item_map[sku] = { sku: sku, name: full_name, qty: 0 };
					}

					item_map[sku].qty += qty;
					total_qty += qty;
				}
			} catch (err: any) {
				console.warn(`[Gom Hàng Sapo] Timeout/Lỗi đơn ${clean_query}:`, err.message);
				failed_orders.push(clean_query);
			}
		}

		// ⚡ TĂNG BATCH_SIZE LÊN 8 ĐƠN/LẦN ĐỂ CHẠY SONG SONG
		const BATCH_SIZE = 8;
		for (let i = 0; i < order_ids.length; i += BATCH_SIZE) {
			const batch = order_ids.slice(i, i + BATCH_SIZE);
			await Promise.all(batch.map(id => fetchSingleOrder(id)));
		}

		const sorted_items = Object.values(item_map).sort((a, b) => b.qty - a.qty);

		return {
			success: true,
			found_orders_count: successful_orders.size,
			failed_orders: failed_orders,
			items: sorted_items,
			total_qty: total_qty
		};

	} catch (e: any) {
		console.error("Lỗi Gom Hàng Sapo:", e);
		return { success: false, message: "Không thể kết nối API Sapo để gom hàng!" };
	}
}
// 🛑 HÀM HỦY ĐƠN HÀNG QUA APPS SCRIPT WEB APP (DÙNG GET CHỐNG LỖI REDIRECT)
export async function cancel_sapo_order(order_code_or_id: string, reason_note: string = "Hủy tự động qua hệ thống") {
	try {
		const clean_query = order_code_or_id.trim().toUpperCase();
		if (!clean_query) return { success: false, message: "Vui lòng nhập Mã đơn hàng!" };

		// Gọi trực tiếp vào backend Go trên Render vừa lấy được
		const PROXY_URL = "https://lyo-inventory-proxy-sg.onrender.com/sapo-action/cancel-order";

		const response = await fetch(PROXY_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				orderCode: clean_query,
				note: reason_note
			})
		});

		return await response.json();
	} catch (e: any) {
		return { success: false, message: "Lỗi kết nối proxy: " + (e.message || "") };
	}
}
