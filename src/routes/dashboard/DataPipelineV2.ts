import axios from "axios";
import { type Location } from "./Template";

// 🟢 Domain Proxy Render Singapore (Thay đúng URL Proxy SG của dì vào đây)
const proxyUrl = "https://<domain-proxy-singapore-cua-di>.onrender.com/api";

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

const TARGET_LOCATION_ID_NEW = 789505;

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

    if (br === "tặng" || br === "sale" || br.includes("kđh") || br === "kđh" || br.includes("khuyến mãi")) {
        return true;
    }

    if (nm.includes("- sale") || nm.includes("-sale") || nm.includes("sale ") || nm.includes("(tặng)") || nm.includes("kđh")) {
        return true;
    }

    return false;
}

export function calculate_restock_data(
    records: RecordItem[],
    variant_by_id: Map<number, ProductV2>,
    location_id: number,
) {
    const active_loc_id = location_id || TARGET_LOCATION_ID_NEW;
    records.sort((a, b) => b.t_unix - a.t_unix);

    let sales_by_sku = new Map<string, number>();

    const now = new Date();
    const min_date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 31, 0, 0, 0);
    const min_valid_ts = min_date.getTime();
    const now_ts = now.getTime();

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

        variant.c_available = inventory ? Math.max(0, inventory.available ?? inventory.on_hand ?? 0) : 0;
        variant.c_incoming = inventory ? Math.max(0, inventory.incoming ?? 0) : 0;
        variant.c_on_hand = variant.c_available;

        const clean_sku = (variant.sku || "").trim().toLowerCase();
        const sales = sales_by_sku.get(clean_sku) ?? 0;

        variant.c_restock = Math.round(sales);
        if (variant.c_restock > 0) count_has_sales++;
    });

    console.log(`[LOG SỐ LIỆU] Số sản phẩm c_restock > 0: ${count_has_sales}`);
    return get_items_need_restock(variant_by_id, active_loc_id);
}

// 🟢 TAB 1: CẦN ĐẶT NGAY
export function get_items_need_restock(variant_by_id: Map<number, ProductV2>, target_location_id: number): ProductV2[] {
    let result: ProductV2[] = [];
    variant_by_id.forEach((variant) => {
        if (variant.is_composite || is_promotional_item(variant.brand, variant.name)) return;

        const sales = variant.c_restock || 0;
        const current_has = variant.c_available + variant.c_incoming;

        if (current_has <= 0.5 * sales && sales > 0) {
            variant.c_restock_half = Math.max(0, Math.round(0.5 * sales) - current_has);
            variant.c_restock_third = Math.max(0, Math.round((1 / 3) * sales) - current_has);
            result.push(variant);
        }
    });
    console.log(`[TAB 1 - CẦN ĐẶT NGAY]: ${result.length} sản phẩm`);
    return result;
}

// 🟢 TAB 2: TỒN KHO AN TOÀN (LỌC TRỰC TIẾP TỒN KHO VÀ DOANH SỐ)
export function get_items_has_sales(variant_by_id: Map<number, ProductV2>): ProductV2[] {
    let result: ProductV2[] = [];
    variant_by_id.forEach((variant) => {
        if (variant.is_composite || is_promotional_item(variant.brand, variant.name)) return;

        const sales = variant.c_restock || 0;
        const inventory = variant.inventory_level_by_location.get(TARGET_LOCATION_ID_NEW);
        const current_has = inventory ? Math.max(0, (inventory.available ?? inventory.on_hand ?? 0) + (inventory.incoming ?? 0)) : (variant.c_available + variant.c_incoming);

        if (sales > 0 && current_has > 0.5 * sales) {
            result.push(variant);
        }
    });
    console.log(`[TAB 2 - TỒN KHO AN TOÀN]: ${result.length} sản phẩm`);
    return result;
}

// 🟢 TAB 3: HÀNG BỊ ĐỨT
export function get_items_out_of_stock_history(variant_by_id: Map<number, ProductV2>, target_location_id: number): ProductV2[] {
    let result: ProductV2[] = [];

    variant_by_id.forEach((variant) => {
        if (variant.is_composite || is_promotional_item(variant.brand, variant.name)) return;

        const sales = variant.c_restock || 0;
        const current_has = variant.c_available + variant.c_incoming;

        if (sales === 0 && current_has === 0 && variant.retail_price > 0) {
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

// 🟢 KÉO DANH SÁCH SẢN PHẨM KHẢ DỤNG
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

// 🟢 ĐỌC ĐƠN ĐÃ LƯU TỪ INDEXEDDB
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
            getAllReq.onerror = function () {
                db.close();
                resolve([]);
            };
        };
        request.onerror = function () {
            resolve([]);
        };
    });
}

// 🟢 CẬP NHẬT INDEXEDDB
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

// 🟢 HÀM KÉO ĐƠN CHUẨN XÁC VỚI CHẶN MỐC CỨNG 31 NGÀY TỪ SAPO
export async function fetch_order_record(variant_by_id: Map<number, ProductV2>) {
    let newRecords: OrderRecordV2[] = [];
    let page = 1;
    let running = true;

    const now = new Date();
    const min_date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 31, 0, 0, 0);
    const min_valid_ts = min_date.getTime();

    // Chuỗi ngày YYYY-MM-DDTHH:mm:ss gửi sang Sapo
    const createdOnMinStr = min_date.toISOString().split('.')[0];

    while (running) {
        try {
            const resp = await axios.get(`${proxyUrl}/admin/orders.json`, {
                params: { 
                    limit: 250, 
                    page: page, 
                    order_by: "created_on desc",
                    created_on_min: createdOnMinStr
                }
            });

            if (resp.status === 200) {
                const j = resp.data || {};
                const orders = j.orders || [];

                if (orders.length === 0) { 
                    running = false; 
                    break; 
                }

                for (const order of orders) {
                    if (order.status !== "cancelled") {
                        const date_str = order.completed_on || order.finalized_on || order.created_on || order.created_at;
                        const order_ts = parseSapoDate(date_str);

                        const line_items = order.order_line_items || order.line_items || order.items || [];
                        line_items.forEach((line_item: any) => {
                            const qty = Number(line_item.quantity) || 0;
                            const raw_sku = (line_item.sku || line_item.barcode || "").trim();
                            if (qty > 0 && raw_sku) {
                                newRecords.push({
                                    sku: raw_sku,
                                    t_unix: order_ts,
                                    quantity: qty,
                                    location_id: TARGET_LOCATION_ID_NEW,
                                    is_composite: false,
                                    new_record: true,
                                    order_id: order.id,
                                    site_id: "site_new"
                                });
                            }
                        });
                    }
                }
                page++;
                await sleep(10);
            } else { running = false; }
        } catch (e: any) {
            console.error("[LỖI KÉO ĐƠN]:", e);
            running = false;
        }
    }

    const existingRecords = await getStoredOrderRecords();

    if (newRecords.length > 0) {
        await updateIndexedDB(newRecords);
    }
    setLastDataUpdate();

    const allRecordsMap = new Map<string, OrderRecordV2>();
    
    existingRecords.forEach(r => {
        if (r.t_unix >= min_valid_ts) {
            const key = `${r.order_id}_${r.sku}`;
            allRecordsMap.set(key, r);
        }
    });

    newRecords.forEach(r => {
        if (r.t_unix >= min_valid_ts) {
            const key = `${r.order_id}_${r.sku}`;
            allRecordsMap.set(key, r);
        }
    });

    const finalRecords = Array.from(allRecordsMap.values());
    console.log(`[TỔNG SỐ ĐƠN LỌC ĐƯỢC IN 31 DAYS]: ${finalRecords.length} bản ghi`);

    return finalRecords;
}

export async function fetch_inventory_transfer(p_variants: Map<number, ProductV2>) { return []; }
