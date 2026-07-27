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
    fulfillment_id?: string | number;
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
    const target_location_id = Number(location_id);

    // 1. KHỞI TẠO TẤT CẢ SẢN PHẨM MẶC ĐỊNH BÁN = 0
    for (let [_, variant] of variant_by_id) {
        if (variant.sku) {
            sales_by_sku.set(variant.sku, 0);
        }
    }

    // 2. CỘNG DỒN SỐ LƯỢNG BÁN TRONG 30 NGÀY QUA
    for (let record of records) {
        if (Number(record.location_id) === target_location_id) {
            if (record.t_unix >= now_ts - thirty_days_ms && record.t_unix <= now_ts) {
                const current_sales = sales_by_sku.get(record.sku) || 0;
                sales_by_sku.set(record.sku, current_sales + record.quantity);
            }
        }
    }

    // 3. TÍNH TOÁN VÀ LỌC SẢN PHẨM CẦN ĐẶT HÀNG
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

        const sales = sales_by_sku.get(variant.sku) ?? 0;

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

    return items_need_restocking;
}

export async function get_locations(): Promise<Location[]> {
    let a = new Axios({
        headers: {
            "Content-Type": "application/json",
            Authorization: obtain_access_token(),
        },
    });

    let resp = await a.get(`${proxyUrl}/admin/locations.json`);
    let location_by_id: Location[] = [];
    if (resp.status != 200) {
        return location_by_id;
    } else {
        let locs = JSON.parse(resp.data).locations;
        locs.forEach((loc: any) => {
            let addrs: string[] = [
                loc.address1,
                loc.address2,
                loc.district,
                loc.city,
                loc.country,
            ];
            addrs = addrs.filter((v) => v != "" && v != null);
            location_by_id.push({
                id: Number(loc.id),
                address: addrs.join(", "),
                label: loc.label,
            });
        });
    }

    return location_by_id;
}

// 🟢 TỰ ĐỘNG CHUYỂN SANG V3 ĐỂ RESET SẠCH MỐC BỊ KHÓA CŨ
export function isFirstTime() {
    return localStorage.getItem("last_data_update_v3") == null;
}

export function setLastDataUpdate() {
    localStorage.setItem(
        "last_data_update_v3",
        new Date().getTime().toString(),
    );
}

export function getLastDataUpdateTUnix() {
    return Number(localStorage.getItem("last_data_update_v3"));
}

// 🟢 CHỈ LẤY ĐƠN TRONG 40 NGÀY GẦN NHẤT ĐỂ ĐẢM BẢO QUÉT ĐỦ 100% ĐƠN 30 NGÀY BÁN
export function getLastDataUpdate() {
    const now = new Date();
    now.setDate(now.getDate() - 40);
    return now.toISOString().replace(/\.\d{3}Z$/, "Z");
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

    let a = new Axios({
        headers: {
            "Content-Type": "application/json",
            Authorization: obtain_access_token(),
        },
    });

    while (running) {
        const resp = await Promise.all([
            a.get(`${proxyUrl}/admin/products.json`, {
                params: { limit: 250, page: page, status: "active" },
            }),
            a.get(`${proxyUrl}/admin/products.json`, {
                params: { limit: 250, page: page + 1, status: "active" },
            }),
            a.get(`${proxyUrl}/admin/products.json`, {
                params: { limit: 250, page: page + 2, status: "active" },
            }),
            a.get(`${proxyUrl}/admin/products.json`, {
                params: { limit: 250, page: page + 3, status: "active" },
            }),
        ]);

        const success =
            resp[0].status == 200 &&
            resp[1].status == 200 &&
            resp[2].status == 200 &&
            resp[3].status == 200;

        if (success) {
            let total_products_fetched = 0;

            for (let r of resp) {
                const products = JSON.parse(r.data).products || [];
                total_products_fetched += products.length;

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

                            if (variant.composite) {
                                p_variant.composite_item_quantity_by_variant_id = new Map();
                                variant.composite_items.forEach((composite_item: any) => {
                                    p_variant.composite_item_quantity_by_variant_id?.set(composite_item.sub_variant_id, composite_item.quantity);
                                });
                            }

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
            }

            if (total_products_fetched === 0) {
                running = false;
                break;
            }

            page += 4;
        } else {
            await sleep(1000);
        }
    }
    return p_variant_by_ids;
}

export async function fetchRecordsFromIndexedDB(): Promise<OrderRecordV2[]> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("LYOInventoryDB_V3", 3);

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
            if (!db.objectStoreNames.contains("OrderRecordsV2")) {
                db.close();
                resolve([]);
                return;
            }

            const tx = db.transaction("OrderRecordsV2", "readonly");
            const store = tx.objectStore("OrderRecordsV2");
            const records: OrderRecordV2[] = [];

            const index = store.index("type");
            const keyRange = IDBKeyRange.only("order");
            const cursorRequest = index.openCursor(keyRange);

            cursorRequest.onerror = function () {
                db.close();
                reject("Cursor error");
            };

            cursorRequest.onsuccess = function (event) {
                const cursor = (
                    event.target as IDBRequest<IDBCursorWithValue>
                ).result;
                if (cursor) {
                    const value = cursor.value;
                    records.push({
                        sku: value.sku,
                        t_unix: value.t_unix,
                        quantity: value.quantity,
                        location_id: Number(value.location_id),
                        is_composite: value.is_composite,
                        new_record: false,
                        order_id: value.order_id,
                        fulfillment_id: value.fulfillment_id
                    });
                    cursor.continue();
                } else {
                    db.close();
                    resolve(records);
                }
            };
        };
    });
}

export async function fetchInventoryTransferFromIndexedDB(): Promise<TransferRecord[]> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("LYOInventoryDB_V3", 3);
        let transfers: TransferRecord[] = [];

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
            if (!db.objectStoreNames.contains("OrderRecordsV2")) {
                db.close();
                resolve([]);
                return;
            }

            const tx = db.transaction("OrderRecordsV2", "readonly");
            const store = tx.objectStore("OrderRecordsV2");

            const index = store.index("type");
            const keyRange = IDBKeyRange.only("transfer");
            const cursorRequest = index.openCursor(keyRange);

            cursorRequest.onerror = function () {
                db.close();
                reject("Cursor error");
            };

            cursorRequest.onsuccess = function (event) {
                const cursor = (
                    event.target as IDBRequest<IDBCursorWithValue>
                ).result;
                if (cursor) {
                    const value = cursor.value;
                    transfers.push({
                        sku: value.sku,
                        t_unix: value.t_unix,
                        quantity: value.quantity,
                        location_id: Number(value.location_id),
                        new_record: false,
                        transfer_id: value.order_id,
                    });

                    cursor.continue();
                } else {
                    db.close();
                    resolve(transfers);
                }
            };
        };
    });
}

export async function updateIndexedDB(records: OrderRecordV2[]) {
    return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("LYOInventoryDB_V3", 3);

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

            records
                .filter((r) => r.new_record)
                .forEach((r) => {
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
        const request = indexedDB.open("LYOInventoryDB_V3", 3);

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
                if (r.new_record) {
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

export async function fetch_order_record(variant_by_id: Map<number, ProductV2>) {
    let a = new Axios({
        headers: {
            "Content-Type": "application/json",
            Authorization: obtain_access_token(),
        },
    });

    let order_records: OrderRecordV2[] = [];
    if (!isFirstTime()) {
        order_records = await fetchRecordsFromIndexedDB();
    }

    // 🟢 LUÔN BẢO ĐẢM MỐC LẤY LÀ 40 NGÀY GẦN NHẤT KHI CHẠY MỚI
    const min_created_date = getLastDataUpdate();

    let existing_records = new Set<string>();
    for (let r of order_records) {
        const key = r.fulfillment_id ? `f_${r.fulfillment_id}` : `o_${r.order_id}`;
        existing_records.add(key);
    }

    let page = 1;
    let running = true;

    while (running) {
        // Lấy theo created_on_min 40 ngày gần nhất
        const resp = await Promise.all([
            a.get(`${proxyUrl}/admin/orders.json`, {
                params: {
                    status: "any",
                    page: page,
                    limit: 250,
                    created_on_min: min_created_date,
                },
            }),
            a.get(`${proxyUrl}/admin/orders.json`, {
                params: {
                    status: "any",
                    page: page + 1,
                    limit: 250,
                    created_on_min: min_created_date,
                },
            }),
        ]);

        const success = resp[0].status == 200 && resp[1].status == 200;

        if (success) {
            let total_orders_fetched = 0;

            for (let r of resp) {
                const j = JSON.parse(r.data);
                const orders = j.orders || [];
                total_orders_fetched += orders.length;

                orders.forEach((order: any) => {
                    const is_not_cancelled = order.status !== "cancelled";

                    if (is_not_cancelled) {
                        const has_fulfillments = order.fulfillments && order.fulfillments.length > 0;

                        if (has_fulfillments) {
                            order.fulfillments.forEach((fulfillment: any) => {
                                const f_key = `f_${fulfillment.id}`;
                                if (!existing_records.has(f_key)) {
                                    const items = fulfillment.line_items || fulfillment.fulfillment_line_items || [];
                                    const fulfillment_date = fulfillment.created_on || order.created_on || order.modified_on;
                                    const fulfillment_ts = new Date(fulfillment_date).getTime();

                                    items.forEach((line_item: any) => {
                                        if (line_item.is_composite) {
                                            const it = variant_by_id.get(line_item.variant_id);
                                            it?.composite_item_quantity_by_variant_id?.forEach((quantity: number, id: number) => {
                                                const composite_item_sku = variant_by_id.get(id)?.sku;
                                                if (composite_item_sku) {
                                                    order_records.push({
                                                        order_id: order.id,
                                                        fulfillment_id: fulfillment.id,
                                                        sku: composite_item_sku,
                                                        quantity: line_item.quantity * quantity,
                                                        is_composite: false,
                                                        location_id: Number(fulfillment.stock_location_id || order.location_id),
                                                        t_unix: fulfillment_ts,
                                                        new_record: true
                                                    });
                                                }
                                            });
                                        } else {
                                            order_records.push({
                                                order_id: order.id,
                                                fulfillment_id: fulfillment.id,
                                                quantity: line_item.quantity,
                                                sku: line_item.sku,
                                                is_composite: line_item.is_composite,
                                                location_id: Number(fulfillment.stock_location_id || order.location_id),
                                                t_unix: fulfillment_ts,
                                                new_record: true,
                                            });
                                        }
                                    });

                                    existing_records.add(f_key);
                                }
                            });
                        } else {
                            const o_key = `o_${order.id}`;
                            if (!existing_records.has(o_key)) {
                                const items = order.line_items || [];
                                const order_ts = new Date(order.created_on || order.modified_on).getTime();

                                items.forEach((line_item: any) => {
                                    if (line_item.is_composite) {
                                        const it = variant_by_id.get(line_item.variant_id);
                                        it?.composite_item_quantity_by_variant_id?.forEach((quantity: number, id: number) => {
                                            const composite_item_sku = variant_by_id.get(id)?.sku;
                                            if (composite_item_sku) {
                                                order_records.push({
                                                    order_id: order.id,
                                                    sku: composite_item_sku,
                                                    quantity: line_item.quantity * quantity,
                                                    is_composite: false,
                                                    location_id: Number(order.location_id),
                                                    t_unix: order_ts,
                                                    new_record: true
                                                });
                                            }
                                        });
                                    } else {
                                        order_records.push({
                                            order_id: order.id,
                                            quantity: line_item.quantity,
                                            sku: line_item.sku,
                                            is_composite: line_item.is_composite,
                                            location_id: Number(order.location_id),
                                            t_unix: order_ts,
                                            new_record: true,
                                        });
                                    }
                                });

                                existing_records.add(o_key);
                            }
                        }
                    }
                });
            }

            if (total_orders_fetched === 0) {
                running = false;
                break;
            }

            page += 2;
        } else {
            await sleep(1000);
        }
    }

    await updateIndexedDB(order_records.filter((v) => v.new_record));
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
    if (!isFirstTime()) {
        transfer_records = await fetchInventoryTransferFromIndexedDB();
    }

    const min_created_date = getLastDataUpdate();

    let existing_transfer_ids = new Set<number>();
    for (let r of transfer_records) {
        existing_transfer_ids.add(r.transfer_id);
    }

    let page = 1;
    let running = true;

    while (running) {
        const resp = await Promise.all([
            a.get(`${proxyUrl}/admin/stock_transfers.json`, {
                params: {
                    status: "any",
                    page: page,
                    limit: 250,
                    created_on_min: min_created_date,
                },
            }),
            a.get(`${proxyUrl}/admin/stock_transfers.json`, {
                params: {
                    status: "any",
                    page: page + 1,
                    limit: 250,
                    created_on_min: min_created_date,
                },
            }),
        ]);

        const success = resp[0].status == 200 && resp[1].status == 200;

        if (success) {
            let total_transfers_fetched = 0;

            for (let r of resp) {
                const j = JSON.parse(r.data);
                const stock_transfers = j.stock_transfers || [];
                total_transfers_fetched += stock_transfers.length;

                stock_transfers.forEach((transfer: any) => {
                    if (
                        !existing_transfer_ids.has(transfer.id) &&
                        (transfer.status == "received" || transfer.status == "shipped")
                    ) {
                        transfer.line_items.forEach((line_item: any) => {
                            if (p_variants.has(line_item.variant_id)) {
                                transfer_records.push({
                                    transfer_id: transfer.id,
                                    location_id: Number(transfer.source_location_id),
                                    sku: p_variants.get(line_item.variant_id)?.sku || "",
                                    t_unix: new Date(transfer.created_on || transfer.modified_on).getTime(),
                                    quantity: line_item.quantity,
                                    new_record: true,
                                });
                            }
                        });
                        existing_transfer_ids.add(transfer.id);
                    }
                });
            }

            if (total_transfers_fetched === 0) {
                running = false;
                break;
            }

            page += 2;
        } else {
            await sleep(1000);
        }
    }

    await saveInventoryTransferToIndexedDB(
        transfer_records.filter((v) => v.new_record),
        p_variants,
    );

    return transfer_records;
}
