import { Axios } from "axios";
import { type Location } from "./Template";

let proxyUrl: string;
let baseUrl: string;

export interface OrderRecordV2 {
    sku: string;
    t_unix: number;
    quantity: number;
    location_id: number;
    is_composite: boolean;
    new_record: boolean;
    order_id: number;
    fulfillment_id?: number;
}

export interface TransferRecord {
    sku: string;
    t_unix: number;
    quantity: number;
    location_id: number;
    new_record: boolean;
    transfer_id: number;
}

interface InventoryLevel {
    on_hand: number;
    incoming: number;
    available: number;
    sold: number;
    lot_no?: string;
    lot_mfg?: Date;
    lot_exp?: Date;
    serial?: string;
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
    lot_no?: string;
    lot_mfg?: Date;
    lot_exp?: Date;
    serial?: string;
    tags?: string[];
    import_price: number;
    retail_price: number;
    retail_price_ecomm: number;
    inventory_level_by_location: Map<number, InventoryLevel>;
    category?: string;
    unit?: string;
    suppliers_last_year?: string[];
    composite_item_quantity_by_variant_id?: Map<number, number>;
    has_mac?: boolean; // 🟢 Cờ đánh dấu có giá vốn bình quân > 0 (đã từng nhập kho)
    has_order_history?: boolean; // 🟢 Cờ đánh dấu đã từng có đơn bán trong quá khứ
}

if (import.meta.env.MODE === "development") {
    proxyUrl = "http://localhost:8080/api";
    baseUrl = "http://localhost:8080";
} else {
    proxyUrl = "https://lyo-inventory-proxy-x79b.onrender.com/api";
    baseUrl = "https://lyo-inventory-proxy-x79b.onrender.com";
}

export function obtain_access_token() {
    const token = import.meta.env.VITE_SAPO_ACCESS_TOKEN || import.meta.env.SAPO_ACCESS_TOKEN || sessionStorage.getItem("token") || "";
    return "Bearer " + token.replace("Bearer ", "");
}

type Record = OrderRecordV2 | TransferRecord;

export function calculate_restock_data(
    records: Record[],
    variant_by_id: Map<number, ProductV2>,
    location_id: number,
) {
    records.sort((a, b) => b.t_unix - a.t_unix);

    let sales_by_sku = new Map<string, number>();

    const now = new Date();
    const min_date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 31, 0, 0, 0);
    const min_valid_ts = min_date.getTime();
    const now_ts = now.getTime();
    const target_location_id = Number(location_id || 0);

    for (let [_, variant] of variant_by_id) {
        if (variant.sku && !variant.is_composite) {
            sales_by_sku.set(variant.sku.trim(), 0);
        }
    }

    for (let record of records) {
        const rec_loc = Number(record.location_id || 0);
        const clean_sku = (record.sku || "").trim();

        // 🟢 ĐÁNH DẤU SẢN PHẨM ĐÃ TỪNG CÓ LỊCH SỬ ĐƠN BÁN
        for (let [_, variant] of variant_by_id) {
            if (variant.sku && variant.sku.trim() === clean_sku) {
                variant.has_order_history = true;
            }
        }

        if (target_location_id === 0 || rec_loc === target_location_id || rec_loc === 0) {
            if (record.t_unix >= min_valid_ts && record.t_unix <= now_ts) {
                const current_sales = sales_by_sku.get(clean_sku) || 0;
                sales_by_sku.set(clean_sku, current_sales + (Number(record.quantity) || 0));
            }
        }
    }

    variant_by_id.forEach((variant) => {
        if (variant.is_composite) {
            variant.c_restock = 0;
            return;
        }

        const inventory = variant.inventory_level_by_location.get(target_location_id);

        variant.c_available = inventory ? Math.max(0, inventory.available ?? inventory.on_hand ?? 0) : 0;
        variant.c_incoming = inventory ? Math.max(0, inventory.incoming ?? 0) : 0;
        variant.c_on_hand = variant.c_available;

        const clean_sku = (variant.sku || "").trim();
        const sales = sales_by_sku.get(clean_sku) ?? 0;

        variant.c_restock = Math.round(sales);
    });

    return get_items_need_restock(variant_by_id, target_location_id);
}

// 🟢 TAB 1: 🚨 Cần đặt ngay (Cảnh báo đứt hàng)
export function get_items_need_restock(variant_by_id: Map<number, ProductV2>, target_location_id: number): ProductV2[] {
    let result: ProductV2[] = [];
    variant_by_id.forEach((variant) => {
        if (variant.is_composite) return;

        const sales = variant.c_restock || 0;
        const current_has = variant.c_available + variant.c_incoming;

        if (current_has <= 0.5 * sales && sales > 0) {
            variant.c_restock_half = Math.max(0, Math.round(0.5 * sales) - current_has);
            variant.c_restock_third = Math.max(0, Math.round((1 / 3) * sales) - current_has);
            result.push(variant);
        }
    });
    return result;
}

// 🟢 TAB 2: 📦 Tồn kho an toàn (Cân nhắc đặt thêm)
export function get_items_has_sales(variant_by_id: Map<number, ProductV2>): ProductV2[] {
    let result: ProductV2[] = [];
    variant_by_id.forEach((variant) => {
        if (variant.is_composite) return;

        const sales = variant.c_restock || 0;
        const current_has = variant.c_available + variant.c_incoming;

        if (sales > 0 && current_has > 0.5 * sales) {
            result.push(variant);
        }
    });
    return result;
}

// 🟢 TAB 3: ⚠️ Hàng bị đứt (Cần check để đặt lại) - CHỈ LẤY MÃ CŨ ĐÃ TỪNG NHẬP KHO HOẶC ĐÃ TỪNG BÁN
export function get_items_out_of_stock_history(variant_by_id: Map<number, ProductV2>): ProductV2[] {
    let result: ProductV2[] = [];
    variant_by_id.forEach((variant) => {
        if (variant.is_composite) return;

        const sales = variant.c_restock || 0;
        const current_has = variant.c_available + variant.c_incoming;

        // 🟢 ĐIỀU KIỆN CHUẨN ĐÉC: Sales = 0, Tồn kho = 0 VÀ (ĐÃ TỪNG CÓ MAC > 0 HOẶC ĐÃ TỪNG CÓ ĐƠN BÁN)
        const is_real_old_product = (variant.has_mac === true) || (variant.has_order_history === true);

        if (sales === 0 && current_has === 0 && is_real_old_product) {
            variant.c_restock_half = 0;
            variant.c_restock_third = 0;
            result.push(variant);
        }
    });
    return result;
}

export async function get_locations(): Promise<Location[]> {
    let a = new Axios({
        headers: {
            "Content-Type": "application/json",
            Authorization: obtain_access_token(),
        },
    });

    let location_by_id: Location[] = [];
    try {
        let resp = await a.get(`${proxyUrl}/admin/locations.json`);
        if (resp.status === 200) {
            let locs = typeof resp.data === "string" ? JSON.parse(resp.data).locations : resp.data.locations;
            (locs || []).forEach((loc: any) => {
                let addrs: string[] = [loc.address1, loc.address2, loc.district, loc.city, loc.country].filter((v) => v != "" && v != null);
                if (Number(loc.id) === 781327) {
                    location_by_id.unshift({ id: 781327, address: addrs.join(", "), label: loc.label || loc.name });
                } else {
                    location_by_id.push({ id: Number(loc.id), address: addrs.join(", "), label: loc.label || loc.name });
                }
            });
        }
    } catch (e) {}

    if (location_by_id.length === 0) {
        location_by_id = [
            { id: 781327, label: "CÔNG TY TNHH LYO GROUP", address: "Mặc định" },
            { id: 122671, label: "Chi nhánh Trung tâm", address: "Mặc định" }
        ];
    }
    return location_by_id;
}

export function isFirstTime() { return true; }
export function setLastDataUpdate() { localStorage.setItem("last_data_update_v50", new Date().getTime().toString()); }
export function getLastDataUpdateTUnix() { return Number(localStorage.getItem("last_data_update_v50")); }
export function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export function is_promotional_item(brand: string) {
    if (!brand) return false;
    const br = brand.toLowerCase();
    return br == "tặng" || br == "sale" || br.includes("kđh");
}

export function normalizeString(input: string): string {
    let str = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
    return str;
}

export async function get_active_products() {
    let p_variant_by_ids: Map<number, ProductV2> = new Map();
    let running = true;
    let page = 1;

    let a = new Axios({
        headers: { "Content-Type": "application/json", Authorization: obtain_access_token() },
    });

    while (running) {
        try {
            const resp = await a.get(`${proxyUrl}/admin/products.json`, {
                params: { limit: 250, page: page, status: "active" },
            });

            if (resp.status == 200) {
                const raw_data_str = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
                const products = JSON.parse(raw_data_str).products || [];
                if (products.length === 0) { running = false; break; }

                products.forEach((product: any) => {
                    const is_prod_composite = product.product_type === "composite";

                    product.variants.forEach((variant: any) => {
                        let p_variant: ProductV2 = {
                            is_composite: variant.composite || is_prod_composite || false,
                            brand: product.brand ?? "<Không xác định>",
                            variant_id: variant.id,
                            product_id: product.id,
                            sku: (variant.sku || "").trim(),
                            barcode: (variant.barcode || variant.sku || "").trim(),
                            c_restock: 0, c_restock_half: 0, c_restock_third: 0, image_path: "",
                            c_on_hand: 0, c_incoming: 0, c_available: 0,
                            name: variant.name, name_normalized: normalizeString(variant.name),
                            import_price: variant.variant_import_price, retail_price: variant.variant_retail_price, retail_price_ecomm: 0,
                            inventory_level_by_location: new Map(),
                            composite_item_quantity_by_variant_id: new Map(),
                            has_mac: false,
                            has_order_history: false,
                        };

                        const comp_items = variant.composite_items || [];
                        if (p_variant.is_composite && comp_items.length > 0) {
                            comp_items.forEach((item: any) => {
                                const sub_variant_id = Number(item.sub_variant_id || item.variant_id);
                                const sub_qty = Number(item.quantity || 1);
                                if (sub_variant_id) {
                                    p_variant.composite_item_quantity_by_variant_id?.set(sub_variant_id, sub_qty);
                                }
                            });
                        }

                        let max_mac = 0;
                        variant.inventories.forEach((inventory: any) => {
                            p_variant.inventory_level_by_location.set(Number(inventory.location_id), {
                                on_hand: inventory.on_hand, incoming: inventory.incoming, available: inventory.available, sold: 0,
                            });
                            if (inventory.mac && Number(inventory.mac) > 0) max_mac = Math.max(max_mac, Number(inventory.mac));
                        });

                        // 🟢 NẾU GIÁ VỐN MAC > 0 -> XÁC NHẬN ĐÃ TỪNG NHẬP KHO THỰC TẾ
                        if (max_mac > 0) {
                            p_variant.has_mac = true;
                        }

                        if (variant.images && variant.images[0]) { p_variant.image_path = variant.images[0].full_path; }
                        p_variant_by_ids.set(p_variant.variant_id, p_variant);
                    });
                });
                page++;
                await sleep(20);
            } else { running = false; }
        } catch (e) { running = false; }
    }
    return p_variant_by_ids;
}

export async function updateIndexedDB(records: Record[]) {
    return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("LYOInventoryDB_V50", 1);
        request.onupgradeneeded = function (event) {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains("OrderRecordsV2")) {
                const store = db.createObjectStore("OrderRecordsV2", { autoIncrement: true });
                store.createIndex("type", "type");
            }
        };
        request.onsuccess = function () {
            const db = request.result;
            const tx = db.transaction("OrderRecordsV2", "readwrite");
            const store = tx.objectStore("OrderRecordsV2");
            records.forEach((r) => {
                store.put({
                    t_unix: r.t_unix, quantity: r.quantity, sku: r.sku, location_id: Number(r.location_id),
                    is_composite: (r as OrderRecordV2).is_composite || false, order_id: (r as OrderRecordV2).order_id || (r as TransferRecord).transfer_id,
                    type: (r as OrderRecordV2).order_id ? "order" : "transfer",
                });
            });
            tx.oncomplete = function () { db.close(); resolve(); };
        };
    });
}

export function get_low_sales_skus(p_variants: ProductV2[]) {
    let _r = new Set<string>();
    p_variants.forEach((v) => { if (!v.is_composite && v.c_restock < 20) _r.add(v.sku); });
    return _r;
}

// 🟢 CHUẨN HÓA CÀO ĐƠN SIÊU TỐC: BẮT CHUẨN NGÀY created_on VÀ NGẮT VÒNG LẶP DỨT ĐIỂM
export async function fetch_order_record(variant_by_id: Map<number, ProductV2>) {
    let a = new Axios({
        headers: { "Content-Type": "application/json", Authorization: obtain_access_token() },
    });

    let all_records: Record[] = [];
    let existing_keys = new Set<string>();
    
    const now = new Date();
    const min_date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 31, 0, 0, 0);
    const min_valid_ts = min_date.getTime();

    let page = 1;
    let running = true;

    while (running) {
        try {
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

                if (orders.length === 0) {
                    running = false;
                    break;
                }

                let reached_old_date = false;

                for (const order of orders) {
                    if (order.status !== "cancelled") {
                        const actual_loc_id = Number(order.location_id || 0);
                        
                        // 🟢 LẤY NGÀY TẠO ĐƠN CHUẨN DẠNG ISO VÀ ÉP KIỂU DATE AN TOÀN TUYỆT ĐỐI
                        const date_raw = order.created_on || order.created_at;
                        const date_str_clean = date_raw ? String(date_raw).trim().replace(" ", "T") : "";
                        const order_ts = date_str_clean ? new Date(date_str_clean).getTime() : 0;

                        // 🟢 NẾU GẶP ĐƠN CŨ HƠN 31 NGÀY -> NGẮT VÒNG LẶP DỪNG CÀO NGAY
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
                    running = false;
                    break;
                }

                page++;
                await sleep(10);
            } else { 
                running = false; 
            }
        } catch (e) { 
            running = false; 
        }
    }

    await updateIndexedDB(all_records);
    setLastDataUpdate();
    return all_records as OrderRecordV2[];
}

export async function fetch_inventory_transfer(p_variants: Map<number, ProductV2>) { return []; }
