import axios from "axios";
import { type Location } from "./Template";

// 🟢 Domain Proxy Render Singapore chính thức
const proxyUrl = "https://lyo-inventory-proxy-sg.onrender.com/api";
const TARGET_LOCATION_ID_NEW = 789505; // ID Kho Site Mới

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

export function is_promotional_item(brand: string, name: string = "") {
    const br = (brand || "").trim().toLowerCase();
    const nm = (name || "").trim().toLowerCase();
    if (br === "tặng" || br === "sale" || br.includes("kđh") || br === "kđh" || br.includes("khuyến mãi")) return true;
    if (nm.includes("- sale") || nm.includes("-sale") || nm.includes("sale ") || nm.includes("(tặng)") || nm.includes("kđh")) return true;
    return false;
}

// 🟢 HÀM TÍNH TOÁN DOANH SỐ QUY ĐỔI CHO SITE MỚI (LÀM TRÒN CHUẨN TỪ .5)
export function calculate_restock_data(
    records: RecordItem[],
    variant_by_id: Map<number, ProductV2>,
    location_id: number,
) {
    const active_loc_id = location_id || TARGET_LOCATION_ID_NEW;
    records.sort((a, b) => b.t_unix - a.t_unix);

    let sales_by_sku = new Map<string, number>();

    // Mốc bắt đầu chạy Site mới: 01/09/2026
    const site_start_date = new Date("2026-09-01T00:00:00");
    const min_valid_ts = site_start_date.getTime();
    
    const now = new Date();
    const now_ts = now.getTime();

    // Tính số ngày bán thực tế ghi nhận được từ 01/09 đến nay
    const diff_time = Math.max(0, now_ts - min_valid_ts);
    const actual_days = Math.max(1, Math.ceil(diff_time / (1000 * 60 * 60 * 24)));

    // Hệ số nhân quy đổi về 31 ngày
    const multiplier_31_days = actual_days >= 31 ? 1 : (31 / actual_days);

    console.log(`[SITE MỚI] Số ngày chạy thực tế: ${actual_days} ngày. Hệ số quy đổi 31 ngày: x${multiplier_31_days.toFixed(2)}`);

    for (let [_, variant] of variant_by_id) {
        if (variant.sku && !variant.is_composite) {
            sales_by_sku.set(variant.sku.trim().toLowerCase(), 0);
        }
    }

    for (let record of records) {
        const clean_sku = (record.sku || "").trim().toLowerCase();

        if (clean_sku) {
            variant_by_id.forEach((v) => {
                if (v.sku && v.sku.trim().toLowerCase() === clean_sku) {
                    v.order_history_by_location.add(active_loc_id);
                }
            });
        }

        if (record.t_unix >= min_valid_ts && record.t_unix <= now_ts) {
            const current_sales = sales_by_sku.get(clean_sku) || 0;
            sales_by_sku.set(clean_sku, current_sales + (Number(record.quantity) || 0));
        }
    }

    let count_has_sales = 0;
    variant_by_id.forEach((variant) => {
        if (variant.is_composite || is_promotional_item(variant.brand, variant.name)) {
            variant.c_restock = 0;
            return;
        }

        const inventory = variant.inventory_level_by_location.get(active_loc_id) || variant.inventory_level_by_location.get(TARGET_LOCATION_ID_NEW);

        variant.c_available = inventory ? Math.max(0, Math.round(inventory.available ?? inventory.on_hand ?? 0)) : 0;
        variant.c_incoming = inventory ? Math.max(0, Math.round(inventory.incoming ?? 0)) : 0;
        variant.c_on_hand = variant.c_available;

        const clean_sku = (variant.sku || "").trim().toLowerCase();
        const actual_sales = sales_by_sku.get(clean_sku) ?? 0;

        // 🟢 QUY ĐỔI SANG 31 NGÀY VÀ LÀM TRÒN NGUYÊN (TRÊN .5 LÊN 1, DƯỚI .5 XUỐNG 0)
        const estimated_sales_31 = actual_sales * multiplier_31_days;
        variant.c_restock = Math.round(estimated_sales_31);

        if (variant.c_restock > 0) count_has_sales++;
    });

    console.log(`[LOG SỐ LIỆU] Số sản phẩm phát sinh doanh số quy đổi: ${count_has_sales}`);
    return get_items_need_restock(variant_by_id, active_loc_id);
}

// 🟢 TAB 1: CẦN ĐẶT NGAY (ĐÃ LÀM TRÒN NGUYÊN ĐẠT .5 LÊN 1)
export function get_items_need_restock(variant_by_id: Map<number, ProductV2>, target_location_id: number): ProductV2[] {
    let result: ProductV2[] = [];
    variant_by_id.forEach((variant) => {
        if (variant.is_composite || is_promotional_item(variant.brand, variant.name)) return;

        const sales = variant.c_restock || 0;
        const current_has = variant.c_available + variant.c_incoming;

        if (current_has <= 0.5 * sales && sales > 0) {
            // 🟢 LÀM TRÒN: ĐẠT TỪ 0.5 TẠO NÊN 1 NGUYÊN
            variant.c_restock_half = Math.max(0, Math.round(0.5 * sales - current_has));
            variant.c_restock_third = Math.max(0, Math.round((1 / 3) * sales - current_has));
            result.push(variant);
        }
    });
    console.log(`[TAB 1 - CẦN ĐẶT NGAY]: ${result.length} sản phẩm`);
    return result;
}

// 🟢 TAB 2: TỒN KHO AN TOÀN (LÀM TRÒN CHUẨN SỐ NGUYÊN)
export function get_items_has_sales(variant_by_id: Map<number, ProductV2>): ProductV2[] {
    let result: ProductV2[] = [];
    variant_by_id.forEach((variant) => {
        if (variant.is_composite || is_promotional_item(variant.brand, variant.name)) return;

        const sales = variant.c_restock || 0;
        const current_has = variant.c_available + variant.c_incoming;

        if (sales > 0 && current_has > 0.5 * sales) {
            result.push(variant);
        }
    });
    console.log(`[TAB 2 - TỒN KHO AN TOÀN]: ${result.length} sản phẩm`);
    return result;
}

// 🟢 TAB 3: HÀNG BỊ ĐỨT (LÀM TRÒN VỀ 0 CHUẨN SỐ NGUYÊN)
export function get_items_out_of_stock_history(variant_by_id: Map<number, ProductV2>, target_location_id: number): ProductV2[] {
    let result: ProductV2[] = [];

    variant_by_id.forEach((variant) => {
        if (variant.is_composite || is_promotional_item(variant.brand, variant.name)) return;

        const sales = variant.c_restock || 0;
        const current_has = variant.c_available + variant.c_incoming;

        const is_valid_product = (variant.retail_price > 0) && (variant.image_path && variant.image_path.trim().length > 0);

        if (sales === 0 && current_has === 0 && is_valid_product) {
            variant.c_restock_half = 0;
            variant.c_restock_third = 0;
            result.push(variant);
        }
    });
    console.log(`[TAB 3 - HÀNG BỊ ĐỨT]: ${result.length} sản phẩm`);
    return result;
}

export async function get_locations(): Promise<Location[]> {
    return [{ id: TARGET_LOCATION_ID_NEW, label: "CÔNG TY TNHH LYO GROUP", address: "Mặc định" }];
}

export function isFirstTime() { return true; }
export function setLastDataUpdate() { localStorage.setItem("last_data_update_v50", new Date().getTime().toString()); }
export function getLastDataUpdateTUnix() { return Number(localStorage.getItem("last_data_update_v50")); }
export function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export function normalizeString(input: string): string {
    return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
}

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

                    if (is_promotional_item(brand_name, prod_name)) return;

                    const is_prod_composite = product.product_type === "composite";

                    product.variants.forEach((variant: any) => {
                        if (variant.sellable === false || variant.status === "inactive" || variant.composite || is_prod_composite) return;

                        const full_var_name = variant.name || prod_name;
                        if (is_promotional_item(brand_name, full_var_name)) return;

                        let p_variant: ProductV2 = {
                            is_composite: false,
                            brand: brand_name || "<Không xác định>",
                            variant_id: variant.id,
                            product_id: product.id,
                            sku: (variant.sku || "").trim(),
                            barcode: (variant.barcode || variant.sku || "").trim(),
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

export async function getStoredOrderRecords(): Promise<OrderRecordV2[]> {
    return new Promise((resolve) => {
        const request = indexedDB.open("LYOInventoryDB_V50", 1);
        request.onsuccess = function () {
            const db = request.result;
            if (!db.objectStoreNames.contains("OrderRecordsV2")) {
                db.close();
                resolve([]);
                return;
            }
            const tx = db.transaction("OrderRecordsV2", "readonly");
            const store = tx.objectStore("OrderRecordsV2");
            const getAllReq = store.getAll();
            getAllReq.onsuccess = function () {
                db.close();
                resolve(getAllReq.result || []);
            };
            getAllReq.onerror = function () { db.close(); resolve([]); };
        };
        request.onerror = function () { resolve([]); };
    });
}

export async function updateIndexedDB(records: RecordItem[]) {
    return new Promise<void>((resolve, reject) => {
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
            const tx = db.transaction("OrderRecordsV2", "readwrite");
            const store = tx.objectStore("OrderRecordsV2");
            records.forEach((r) => {
                store.put({
                    t_unix: r.t_unix,
                    quantity: r.quantity,
                    sku: r.sku,
                    location_id: Number(r.location_id),
                    is_composite: (r as OrderRecordV2).is_composite || false,
                    order_id: (r as OrderRecordV2).order_id || (r as TransferRecord).transfer_id,
                    site_id: r.site_id || "site_new",
                    type: (r as OrderRecordV2).order_id ? "order" : "transfer",
                });
            });
            tx.oncomplete = function () { db.close(); resolve(); };
        };
    });
}

export function get_low_sales_skus(p_variants: ProductV2[]) {
    let _r = new Set<string>();
    p_variants.forEach((v) => { if (v.c_restock < 20) _r.add(v.sku); });
    return _r;
}

// 🟢 HÀM KÉO ĐƠN CHÍNH THỨC DÀNH CHO SITE MỚI (CHẠY TỪ 01/09 ĐẾN NAY)
export async function fetch_order_record(variant_by_id: Map<number, ProductV2>) {
    let all_records: RecordItem[] = [];
    let existing_keys = new Set<string>();

    const site_start_date = new Date("2026-09-01T00:00:00");
    const min_valid_ts = site_start_date.getTime();

    let page = 1;
    let running = true;

    while (running) {
        try {
            const resp = await axios.get(`${proxyUrl}/admin/orders.json`, {
                params: { limit: 250, page: page, order_by: "created_on desc" }
            });

            if (resp.status === 200) {
                const j = resp.data || {};
                const orders = j.orders || [];

                if (orders.length === 0) { running = false; break; }

                let reached_old_date = false;

                for (const order of orders) {
                    if (order.status !== "cancelled") {
                        const actual_loc_id = Number(order.location_id || TARGET_LOCATION_ID_NEW);
                        const date_str = order.completed_on || order.finalized_on || order.created_on || order.created_at;
                        const order_ts = parseSapoDate(date_str);

                        // Ngắt vòng lặp khi chạm đơn trước ngày 01/09/2026
                        if (order_ts > 0 && order_ts < min_valid_ts) {
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
                                    } else if (variant_obj?.is_composite && variant_obj?.composite_item_quantity_by_variant_id && variant_obj.composite_item_quantity_by_variant_id.size > 0) {
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
                                    } else {
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
                    console.log(`[SITE MỚI] Ngắt API thành công khi chạm mốc 01/09 tại trang ${page}!`);
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

    await updateIndexedDB(all_records);
    setLastDataUpdate();
    console.log(`[SITE MỚI KÉO THÀNH CÔNG TỪ 01/09]: ${all_records.length} bản ghi`);
    return all_records as OrderRecordV2[];
}

export async function fetch_inventory_transfer(p_variants: Map<number, ProductV2>) { return []; }
