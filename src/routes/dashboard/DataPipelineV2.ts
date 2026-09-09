import { Axios } from "axios";
import { type Location } from "./Template";

let proxyUrl: string;
let baseUrl: string;

if (import.meta.env.MODE === "development") {
    proxyUrl = "http://localhost:8080/api";
    baseUrl = "http://localhost:8080";
} else {
    // 🎯 Proxy Singapore siêu tốc
    proxyUrl = "https://lyo-inventory-proxy-sg.onrender.com/api";
    baseUrl = "https://lyo-inventory-proxy-sg.onrender.com";
}

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
    mac?: number;
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
    composite_item_quantity_by_variant_id?: Map<number, number>;
    order_history_by_location: Set<number>;
}

// 🎯 KHAI BÁO CHÍNH XÁC ID KHO SITE MỚI VÀ SITE CŨ
const TARGET_LOCATION_ID_NEW = 789505; // ID Kho Site Mới
const TARGET_LOCATION_ID_OLD = 781327; // ID Kho Site Cũ (Chuẩn theo JSON)

// Mốc bàn giao dữ liệu sang Site Mới: 01/09/2026
const CUTOFF_TIMESTAMP = new Date("2026-09-01T00:00:00+07:00").getTime();

export function obtain_access_token() {
    const token = import.meta.env.VITE_SAPO_ACCESS_TOKEN || import.meta.env.SAPO_ACCESS_TOKEN || sessionStorage.getItem("token") || "";
    return "Bearer " + token.replace("Bearer ", "");
}

export type RecordItem = OrderRecordV2 | TransferRecord;

export function parseSapoDate(dateStr: string): number {
    if (!dateStr) return 0;
    const isoStr = dateStr.trim().replace(" ", "T");
    const parsed = Date.parse(isoStr);
    if (!isNaN(parsed) && parsed > 0) return parsed;
    return new Date(dateStr).getTime() || 0;
}

export function is_promotional_item(brand: string) {
    if (!brand) return false;
    const br = brand.trim().toLowerCase();
    return br === "tặng" || br === "sale" || br.includes("kđh") || br === "kđh";
}

export function calculate_restock_data(
    records: RecordItem[],
    variant_by_id: Map<number, ProductV2>,
    location_id: number,
) {
    records.sort((a, b) => b.t_unix - a.t_unix);

    let sales_by_sku = new Map<string, number>();

    const now = new Date();
    const min_date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 31, 0, 0, 0);
    const min_valid_ts = min_date.getTime();
    const now_ts = now.getTime();

    for (let [_, variant] of variant_by_id) {
        if (variant.sku && !variant.is_composite) {
            sales_by_sku.set(variant.sku.trim(), 0);
        }
    }

    for (let record of records) {
        const clean_sku = (record.sku || "").trim();

        if (clean_sku) {
            variant_by_id.forEach((v) => {
                if (v.sku && v.sku.trim() === clean_sku) {
                    v.order_history_by_location.add(TARGET_LOCATION_ID_NEW);
                }
            });
        }

        // Tính doanh số từ cả đơn Kho Cũ lẫn Kho Mới trong 31 ngày
        if (record.t_unix >= min_valid_ts && record.t_unix <= now_ts) {
            const current_sales = sales_by_sku.get(clean_sku) || 0;
            sales_by_sku.set(clean_sku, current_sales + (Number(record.quantity) || 0));
        }
    }

    variant_by_id.forEach((variant) => {
        if (variant.is_composite || is_promotional_item(variant.brand)) {
            variant.c_restock = 0;
            return;
        }

        // Lấy tồn kho thực tế từ Site Mới
        const inventory = variant.inventory_level_by_location.get(TARGET_LOCATION_ID_NEW);

        variant.c_available = inventory ? Math.max(0, inventory.available ?? inventory.on_hand ?? 0) : 0;
        variant.c_incoming = inventory ? Math.max(0, inventory.incoming ?? 0) : 0;
        variant.c_on_hand = variant.c_available;

        const clean_sku = (variant.sku || "").trim();
        const sales = sales_by_sku.get(clean_sku) ?? 0;

        variant.c_restock = Math.round(sales);
    });

    return get_items_need_restock(variant_by_id, TARGET_LOCATION_ID_NEW);
}

export function get_items_need_restock(variant_by_id: Map<number, ProductV2>, target_location_id: number): ProductV2[] {
    let result: ProductV2[] = [];
    variant_by_id.forEach((variant) => {
        if (variant.is_composite || is_promotional_item(variant.brand)) return;

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

export function get_items_has_sales(variant_by_id: Map<number, ProductV2>): ProductV2[] {
    let result: ProductV2[] = [];
    variant_by_id.forEach((variant) => {
        if (variant.is_composite || is_promotional_item(variant.brand)) return;

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
        if (variant.is_composite || is_promotional_item(variant.brand)) return;

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
        { id: TARGET_LOCATION_ID_NEW, label: "CÔNG TY TNHH LYO GROUP", address: "Mặc định" }
    ];
}

export function isFirstTime() { return true; }
export function setLastDataUpdate() { localStorage.setItem("last_data_update_v50", new Date().getTime().toString()); }
export function getLastDataUpdateTUnix() { return Number(localStorage.getItem("last_data_update_v50")); }
export function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export function normalizeString(input: string): string {
    let str = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
    return str;
}

// 🟢 TẢI TỒN KHO TỪ SITE MỚI
export async function get_active_products() {
    let p_variant_by_ids: Map<number, ProductV2> = new Map();
    let running = true;
    let page = 1;

    let a = new Axios({
        headers: { 
            "Content-Type": "application/json", 
            Authorization: obtain_access_token() 
        },
    });

    while (running) {
        try {
            const resp = await a.get(`${proxyUrl}/admin/products.json`, {
                params: { limit: 250, page: page, status: "active" },
            });

            if (resp.status === 200) {
                const raw_data_str = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
                const products = JSON.parse(raw_data_str).products || [];
                if (products.length === 0) { running = false; break; }

                products.forEach((product: any) => {
                    if (product.status !== "active") return;

                    const brand_name = (product.brand || "").trim();
                    if (is_promotional_item(brand_name)) return;

                    const is_prod_composite = product.product_type === "composite";

                    product.variants.forEach((variant: any) => {
                        if (variant.sellable === false || variant.status === "inactive" || variant.composite || is_prod_composite) return;

                        let p_variant: ProductV2 = {
                            is_composite: false,
                            brand: brand_name || "<Không xác định>",
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
                            order_history_by_location: new Set<number>()
                        };

                        variant.inventories.forEach((inventory: any) => {
                            const loc_id = Number(inventory.location_id);
                            // Nhận diện tồn kho của Site Mới
                            if (loc_id === TARGET_LOCATION_ID_NEW || loc_id === 0) {
                                p_variant.inventory_level_by_location.set(TARGET_LOCATION_ID_NEW, {
                                    on_hand: inventory.on_hand,
                                    incoming: inventory.incoming,
                                    available: inventory.available,
                                    sold: 0,
                                    mac: Number(inventory.mac || 0)
                                });
                            }
                        });

                        if (variant.images && variant.images[0]) { p_variant.image_path = variant.images[0].full_path; }
                        p_variant_by_ids.set(p_variant.variant_id, p_variant);
                    });
                });
                page++;
                await sleep(15);
            } else { running = false; }
        } catch (e) { running = false; }
    }
    return p_variant_by_ids;
}

export async function updateIndexedDB(records: RecordItem[]) {
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

// 🟢 TẢI ĐƠN TỪ PROXY VỚI ĐÚNG ID KHO CHO TỪNG SITE
async function fetchOrdersFromProxy(axiosClient: Axios, siteType: "new" | "old", minTs: number, maxTs?: number) {
    let records: RecordItem[] = [];
    let existing_keys = new Set<string>();
    let page = 1;
    let running = true;

    while (running) {
        try {
            let params: any = { 
                limit: 250, 
                page: page, 
                order_by: "created_on desc"
            };

            if (siteType === "new") {
                params.location_id = TARGET_LOCATION_ID_NEW;
            } else {
                params.site = "old";
                params.location_id = TARGET_LOCATION_ID_OLD; // Lọc đúng ID Kho Cũ 781327
            }

            const resp = await axiosClient.get(`${proxyUrl}/admin/orders.json`, { params });

            if (resp.status === 200) {
                const raw_data_str = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
                const j = JSON.parse(raw_data_str);
                const orders = j.orders || [];

                if (orders.length === 0) { running = false; break; }

                let reached_old_date = false;

                for (const order of orders) {
                    if (order.status !== "cancelled") {
                        const actual_loc_id = Number(order.location_id || 0);
                        const date_str = order.completed_on || order.finalized_on || order.created_on || order.created_at;
                        const order_ts = parseSapoDate(date_str);

                        if (order_ts > 0 && order_ts < minTs) {
                            reached_old_date = true;
                            break;
                        }

                        if (maxTs && order_ts > maxTs) continue;

                        if (order_ts >= minTs) {
                            const line_items = order.order_line_items || order.line_items || order.items || [];
                            line_items.forEach((line_item: any, index: number) => {
                                const qty = Number(line_item.quantity) || 0;
                                const raw_sku = (line_item.sku || line_item.barcode || "").trim();
                                if (qty > 0 && raw_sku) {
                                    const record_key = `ORD_${order.id}_${index}_${raw_sku}_${actual_loc_id}`;
                                    if (!existing_keys.has(record_key)) {
                                        records.push({
                                            sku: raw_sku,
                                            t_unix: order_ts,
                                            quantity: qty,
                                            location_id: TARGET_LOCATION_ID_NEW,
                                            is_composite: false,
                                            new_record: true,
                                            order_id: order.id
                                        } as OrderRecordV2);
                                        existing_keys.add(record_key);
                                    }
                                }
                            });
                        }
                    }
                }

                if (reached_old_date) { running = false; break; }
                page++;
                await sleep(10);
            } else { running = false; }
        } catch (e) { running = false; }
    }
    return records;
}

// 🟢 TỰ ĐỘNG GỘP ĐƠN TỪ 2 SITE
export async function fetch_order_record(variant_by_id: Map<number, ProductV2>) {
    let a = new Axios({
        headers: { 
            "Content-Type": "application/json", 
            Authorization: obtain_access_token() 
        },
    });

    let all_records: RecordItem[] = [];
    
    const now = new Date();
    const min_date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 31, 0, 0, 0);
    const min_valid_ts = min_date.getTime();

    // 1. Tải đơn Site Mới (Kho 789505)
    const newSiteMinTs = Math.max(min_valid_ts, CUTOFF_TIMESTAMP);
    const newSiteRecords = await fetchOrdersFromProxy(a, "new", newSiteMinTs);
    all_records = all_records.concat(newSiteRecords);

    // 2. Tải đơn Site Cũ (Kho 781327) cho các ngày còn thiếu
    if (min_valid_ts < CUTOFF_TIMESTAMP) {
        const oldSiteRecords = await fetchOrdersFromProxy(a, "old", min_valid_ts, CUTOFF_TIMESTAMP);
        all_records = all_records.concat(oldSiteRecords);
    }

    await updateIndexedDB(all_records);
    setLastDataUpdate();
    return all_records as OrderRecordV2[];
}

export async function fetch_inventory_transfer(p_variants: Map<number, ProductV2>) { return []; }
