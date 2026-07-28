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

export function parseSapoDate(dateStr: string): number {
    if (!dateStr) return 0;
    const isoStr = dateStr.trim().replace(" ", "T");
    const parsed = Date.parse(isoStr);
    if (!isNaN(parsed)) return parsed;
    return new Date(dateStr).getTime() || 0;
}

export function calculate_restock_data(
    records: Record[],
    variant_by_id: Map<number, ProductV2>,
    location_id: number,
) {
    records.sort((a, b) => b.t_unix - a.t_unix);

    let sales_by_sku = new Map<string, number>();
    let items_need_restocking: ProductV2[] = [];

    const now_ts = new Date().getTime();
    const thirty_days_ms = 30 * 24 * 60 * 60 * 1000;
    const min_valid_ts = now_ts - thirty_days_ms;
    const target_location_id = Number(location_id || 781327);

    console.warn(`[TÍNH RESTOCK V46] Đang tính cho Kho ID: ${target_location_id}. Duyệt ${records.length} bản ghi.`);

    for (let [_, variant] of variant_by_id) {
        if (variant.sku) {
            sales_by_sku.set(variant.sku.trim(), 0);
        }
    }

    let matched_count = 0;
    for (let record of records) {
        const rec_loc = Number(record.location_id || 0);
        
        if (rec_loc === target_location_id || rec_loc === 0 || !target_location_id) {
            if (record.t_unix >= min_valid_ts && record.t_unix <= now_ts) {
                const clean_sku = (record.sku || "").trim();
                const current_sales = sales_by_sku.get(clean_sku) || 0;
                sales_by_sku.set(clean_sku, current_sales + (Number(record.quantity) || 0));
                matched_count++;
            }
        }
    }

    console.warn(`[TÍNH RESTOCK V46] Khớp ${matched_count} bản ghi đơn bán cho Kho ${target_location_id}`);

    variant_by_id.forEach((variant) => {
        const inventory = variant.inventory_level_by_location.get(target_location_id) || 
                          variant.inventory_level_by_location.get(location_id as any);

        variant.c_available = Math.max(0, inventory?.available ?? 0);
        variant.c_incoming = Math.max(0, inventory?.incoming ?? 0);
        variant.c_on_hand = variant.c_available;

        variant.lot_no = inventory?.lot_no || undefined;
        variant.lot_mfg = inventory?.lot_mfg || undefined;
        variant.lot_exp = inventory?.lot_exp || undefined;
        variant.serial = inventory?.serial || undefined;

        const clean_sku = (variant.sku || "").trim();
        const sales = sales_by_sku.get(clean_sku) ?? 0;

        if (
            variant.c_available + variant.c_incoming <= (1 / 2) * sales &&
            sales > 0
        ) {
            variant.c_restock = Math.round(sales);
            
            const current_has = variant.c_available + variant.c_incoming;
            
            variant.c_restock_half = Math.max(0, Math.round(0.5 * variant.c_restock) - current_has);
            variant.c_restock_third = Math.max(0, Math.round((1 / 3) * variant.c_restock) - current_has);

            items_need_restocking.push(variant);
        }
    });

    console.warn(`[TÍNH RESTOCK V46] Lọc ra ${items_need_restocking.length} mặt hàng cần đặt.`);
    return items_need_restocking;
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
                let addrs: string[] = [
                    loc.address1,
                    loc.address2,
                    loc.district,
                    loc.city,
                    loc.country,
                ];
                addrs = addrs.filter((v) => v != "" && v != null);
                
                if (Number(loc.id) === 781327) {
                    location_by_id.unshift({
                        id: 781327,
                        address: addrs.join(", "),
                        label: loc.label || loc.name,
                    });
                } else {
                    location_by_id.push({
                        id: Number(loc.id),
                        address: addrs.join(", "),
                        label: loc.label || loc.name,
                    });
                }
            });
        }
    } catch (e) {
        console.error("[GET LOCATIONS FAILED]", e);
    }

    if (location_by_id.length === 0) {
        location_by_id = [
            { id: 781327, label: "CÔNG TY TNHH LYO GROUP", address: "Mặc định" },
            { id: 122671, label: "Chi nhánh Trung tâm", address: "Mặc định" }
        ];
    }

    return location_by_id;
}

export function isFirstTime() {
    return true;
}

export function setLastDataUpdate() {
    localStorage.setItem(
        "last_data_update_v46",
        new Date().getTime().toString(),
    );
}

export function getLastDataUpdateTUnix() {
    return Number(localStorage.getItem("last_data_update_v46"));
}

export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function is_promotional_item(brand: string) {
    if (!brand) {
        return false;
    }
    const br = brand.toLowerCase();
    if (
        br == "tặng" ||
        br == "sale" ||
        br == "combo" ||
        br.includes("kđh")
    ) {
        return true;
    } else {
        return false;
    }
}

export function normalizeString(input: string): string {
    let str = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    str = str.toLowerCase();
    str = str.replace(/[^a-z0-9\s]/g, "");
    return str;
}

export async function get_active_products() {
    let p_variant_by_ids: Map<number, ProductV2> = new Map();
    let running = true;
    let page = 1;
    let retry_count = 0;

    let a = new Axios({
        headers: {
            "Content-Type": "application/json",
            Authorization: obtain_access_token(),
        },
    });

    while (running) {
        try {
            const resp = await a.get(`${proxyUrl}/admin/products.json`, {
                params: { limit: 250, page: page, status: "active" },
            });

            if (resp.status == 200) {
                retry_count = 0;
                const raw_data_str = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
                const products = JSON.parse(raw_data_str).products || [];
                if (products.length === 0) {
                    running = false;
                    break;
                }

                products.forEach((product: any) => {
                    product.variants.forEach((variant: any) => {
                        if (!is_promotional_item(product.brand)) {
                            let p_variant: ProductV2 = {
                                is_composite: variant.composite,
                                brand: product.brand ?? "<Không xác định>",
                                variant_id: variant.id,
                                product_id: product.id,
                                sku: variant.sku,
                                barcode: variant.barcode || variant.sku,
                                c_restock: 0,
                                c_restock_half: 0,
                                c_restock_third: 0,
                                image_path: "",
                                c_on_hand: 0,
                                c_incoming: 0,
                                c_available: 0,
                                name: variant.name,
                                name_normalized: normalizeString(variant.name),
                                import_price: variant.variant_import_price,
                                retail_price: variant.variant_retail_price,
                                retail_price_ecomm: 0,
                                inventory_level_by_location: new Map(),
                            };

                            variant.inventories.forEach(
                                (inventory: any) => {
                                    p_variant.inventory_level_by_location.set(
                                        Number(inventory.location_id),
                                        {
                                            on_hand: inventory.on_hand,
                                            incoming: inventory.incoming,
                                            available: inventory.available,
                                            sold: 0,
                                        },
                                    );
                                },
                            );

                            if (variant.images && variant.images[0]) {
                                p_variant.image_path = variant.images[0].full_path;
                            } else if (product.images && product.images[0]) {
                                p_variant.image_path = product.images[0].full_path;
                            }

                            p_variant_by_ids.set(
                                p_variant.variant_id,
                                p_variant,
                            );

                            for (let price of variant.variant_prices) {
                                if (price.price_list && price.price_list.code == "GIANHAP") {
                                    p_variant.retail_price_ecomm = price.included_tax_price;
                                    break;
                                }
                            }
                            p_variant.unit = variant.unit || "<Không xác định>";
                            p_variant.category = product.category;
                        }
                    });
                });

                page++;
                await sleep(100);
            } else {
                retry_count++;
                if (retry_count > 3) { running = false; break; }
                await sleep(500);
            }
        } catch (e) {
            retry_count++;
            if (retry_count > 3) { running = false; break; }
            await sleep(500);
        }
    }
    console.warn(`[V46 SAN PHAM] Đã nạp xong ${p_variant_by_ids.size} sản phẩm.`);
    return p_variant_by_ids;
}

export async function updateIndexedDB(records: OrderRecordV2[]) {
    return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("LYOInventoryDB_V46", 3);

        request.onupgradeneeded = function (event) {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains("OrderRecordsV2")) {
                const store = db.createObjectStore("OrderRecordsV2", {
                    autoIncrement: true,
                });
                store.createIndex("type", "type");
            }
        };

        request.onerror = function () {
            reject("IndexedDB connection failed");
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
                    is_composite: r.is_composite,
                    order_id: r.order_id,
                    fulfillment_id: r.fulfillment_id,
                    type: "order",
                });
            });

            tx.oncomplete = function () {
                db.close();
                resolve();
            };

            tx.onerror = function () {
                db.close();
                reject("Transaction failed");
            };
        };
    });
}

export function get_low_sales_skus(p_variants: ProductV2[]) {
    let _r = new Set<string>();
    p_variants.forEach((v) => {
        if (v.c_restock < 20) {
            _r.add(v.sku);
        }
    });
    return _r;
}

export async function saveInventoryTransferToIndexedDB(
    records: TransferRecord[],
    products: Map<number, ProductV2>,
) {
    return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("LYOInventoryDB_V46", 3);

        request.onupgradeneeded = function (event) {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains("OrderRecordsV2")) {
                const store = db.createObjectStore("OrderRecordsV2", {
                    autoIncrement: true,
                });
                store.createIndex("type", "type");
            }
        };

        request.onerror = function () {
            reject("IndexedDB connection failed");
        };

        request.onsuccess = function () {
            const db = request.result;
            const tx = db.transaction("OrderRecordsV2", "readwrite");
            const store = tx.objectStore("OrderRecordsV2");

            for (let r of records) {
                store.put({
                    t_unix: r.t_unix,
                    quantity: r.quantity,
                    sku: r.sku,
                    location_id: Number(r.location_id),
                    is_composite: false,
                    order_id: r.transfer_id,
                    type: "transfer",
                });
            }

            tx.oncomplete = function () {
                db.close();
                resolve();
            };

            tx.onerror = function () {
                db.close();
                reject("Transaction failed");
            };
        };
    });
}

// 🟢 V46 SOI CẤU TRÚC ĐƠN HÀNG THỰC TẾ SAPO VÀ SOI SẢN PHẨM THƯỜNG
export async function fetch_order_record(variant_by_id: Map<number, ProductV2>) {
    let a = new Axios({
        headers: {
            "Content-Type": "application/json",
            Authorization: obtain_access_token(),
        },
    });

    let order_records: OrderRecordV2[] = [];
    let existing_fulfillment_keys = new Set<string>();

    const now_ts = new Date().getTime();
    const min_valid_ts = now_ts - (45 * 24 * 60 * 60 * 1000);

    let page = 1;
    let running = true;
    let total_fetched = 0;
    let olay_found_count = 0;

    console.warn(`[V46 CHUẨN THỰC TẾ] Bắt đầu đồng bộ đơn hàng Sapo...`);

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

                total_fetched += orders.length;

                // 🟢 IN MẪU 1 ĐƠN HÀNG RA CONSOLE ĐỂ SOI TRỰC TIẾP DỮ LIỆU THÔ DƯỚI BẤT KỲ ĐỊNH DẠNG NÀO
                if (page === 1 && orders.length > 0) {
                    console.log("🔍 [V46 SOI ĐƠN GỐC SAPO]:", orders[0]);
                }

                orders.forEach((order: any) => {
                    const is_not_cancelled = order.status !== "cancelled";

                    if (is_not_cancelled) {
                        const actual_loc_id = Number(order.location_id || 0);
                        const date_str = order.created_on || order.created_at || order.modified_on;
                        const order_ts = parseSapoDate(date_str);

                        if (order_ts > 0 && order_ts >= min_valid_ts) {
                            const line_items = order.line_items || [];
                            line_items.forEach((line_item: any, index: number) => {
                                const qty = Number(line_item.quantity) || 0;
                                if (qty > 0) {
                                    const variant_obj = variant_by_id.get(line_item.variant_id);
                                    const raw_sku = variant_obj?.sku || line_item.sku || "";
                                    const item_name = (line_item.name || variant_obj?.name || "").toLowerCase();

                                    if (item_name.includes("olay") || raw_sku.includes("690314836")) {
                                        olay_found_count++;
                                        console.warn(`🔥 [BẪY V46 OLAY SẢN PHẨM THƯỜNG] Mã đơn=${order.code || order.id}, Ngày=${date_str}, SL=${qty}, Kho=${actual_loc_id}, SKU=[${raw_sku}], Tên=[${line_item.name}]`);
                                    }

                                    if (raw_sku) {
                                        const sku = raw_sku.trim();
                                        const line_id = line_item.id || index;
                                        const record_key = `${order.id}_${line_id}_${sku}_${actual_loc_id}`;

                                        if (!existing_fulfillment_keys.has(record_key)) {
                                            order_records.push({
                                                order_id: order.id,
                                                quantity: qty,
                                                sku: sku,
                                                is_composite: false,
                                                location_id: actual_loc_id,
                                                t_unix: order_ts,
                                                new_record: true,
                                            });
                                            existing_fulfillment_keys.add(record_key);
                                        }
                                    }
                                }
                            });
                        }
                    }
                });

                const last_date_raw = orders[orders.length - 1].created_on || orders[orders.length - 1].created_at || orders[orders.length - 1].modified_on;
                const last_ts = parseSapoDate(last_date_raw);

                if (last_ts > 0 && last_ts < min_valid_ts) {
                    running = false;
                    break;
                }

                page++;
                await sleep(100);
            } else {
                await sleep(1000);
            }
        } catch (e) {
            await sleep(1000);
        }
    }

    console.warn(`[V46 CHUẨN THỰC TẾ] Hoàn tất! Bắt được ${olay_found_count} dòng Olay từ ${total_fetched} đơn Sapo.`);

    await updateIndexedDB(order_records);
    setLastDataUpdate();
    return order_records;
}

export async function fetch_inventory_transfer(p_variants: Map<number, ProductV2>) {
    let a = new Axios({
        headers: {
            "Content-Type": "application/json",
            Authorization: obtain_access_token(),
        },
    });

    let transfer_records: TransferRecord[] = [];
    let existing_transfer_ids = new Set<string>();

    let page = 1;
    let running = true;

    while (running && page <= 10) {
        try {
            const resp = await a.get(`${proxyUrl}/admin/stock_transfers.json`, {
                params: {
                    limit: 250,
                    page: page,
                    order_by: "created_on desc"
                },
            });

            if (resp.status === 200) {
                const j = typeof resp.data === "string" ? JSON.parse(resp.data) : resp.data;
                const stock_transfers = j.stock_transfers || [];

                if (stock_transfers.length === 0) {
                    running = false;
                    break;
                }

                stock_transfers.forEach((transfer: any) => {
                    if (transfer.status == "received" || transfer.status == "shipped") {
                        transfer.line_items.forEach((line_item: any, idx: number) => {
                            if (p_variants.has(line_item.variant_id)) {
                                const sku = (p_variants.get(line_item.variant_id)?.sku || "").trim();
                                const key = `${transfer.id}_${line_item.id || idx}_${sku}_${transfer.source_location_id}`;

                                if (!existing_transfer_ids.has(key)) {
                                    transfer_records.push({
                                        transfer_id: transfer.id,
                                        location_id: Number(transfer.source_location_id),
                                        sku: sku,
                                        t_unix: parseSapoDate(transfer.created_on || transfer.created_at || transfer.modified_on),
                                        quantity: line_item.quantity,
                                        new_record: true,
                                    });
                                    existing_transfer_ids.add(key);
                                }
                            }
                        });
                    }
                });

                page++;
                await sleep(100);
            } else {
                await sleep(1000);
            }
        } catch (e) {
            await sleep(1000);
        }
    }

    await saveInventoryTransferToIndexedDB(
        transfer_records,
        p_variants,
    );

    return transfer_records;
}
