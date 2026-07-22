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
    // TODO: Get a list of suppliers in last year + tags + category + unit
}

if (import.meta.env.MODE === "development") {
    proxyUrl = "http://localhost:8080/api";
    baseUrl = "http://localhost:8080";
} else {
    // 🔗 Dán đường link Proxy mới theo code của ttkoanh86:
    proxyUrl = "https://lyo-inventory-proxy-x79b.onrender.com/api";
    baseUrl = "https://lyo-inventory-proxy-x79b.onrender.com";
}

export function obtain_access_token() {
    // Tìm mã Token qua tiền tố VITE_ từ Render trước, nếu không thấy mới tìm các nguồn khác
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
    let time_cutoff_by_sku = new Map<string, number>();

    let items_need_restocking: ProductV2[] = [];

    const t_unix = getLastDataUpdateTUnix() || new Date().getTime();

    for (let v of variant_by_id) {
        if (v[1].c_on_hand > 0) {
            time_cutoff_by_sku.set(v[1].sku, t_unix);
            sales_by_sku.set(v[1].sku, 0);
        }
    }


    for (let record of records) {
        if (!time_cutoff_by_sku.has(record.sku)) {
            time_cutoff_by_sku.set(record.sku, record.t_unix);
            sales_by_sku.set(record.sku, 0);
        }

        if (location_id == record.location_id) {
            // @ts-ignore
            if (
                record.t_unix >=
                // @ts-ignore
                time_cutoff_by_sku.get(record.sku) -
                30 * 24 * 60 * 60 * 1000
            ) {
                // @ts-ignore
                sales_by_sku.set(

                    record.sku,
                    // @ts-ignore
                    sales_by_sku.get(record.sku) + record.quantity,
                );
            }
        }
    }



    variant_by_id.forEach((variant, id) => {
        const inventory = variant.inventory_level_by_location.get(location_id);

        variant.c_on_hand = Math.max(0, inventory?.on_hand || 0);
        variant.c_incoming = Math.max(0, inventory?.incoming || 0)
        variant.c_available = Math.max(0, inventory?.available || 0);
        variant.lot_no = inventory?.lot_no || undefined;
        variant.lot_mfg = inventory?.lot_mfg || undefined;
        variant.lot_exp = inventory?.lot_exp || undefined;
        variant.serial = inventory?.serial || undefined;

        if (variant.name_normalized.includes("melaxin")) {
            console.log(variant.name, variant.sku, variant.c_available, variant.c_incoming, sales_by_sku.get(variant.sku) ?? 0)
        }

        // @ts-ignore
        //Sản phẩm chỉ hiện ra nếu Total (Tồn kho + Đang về) <= 1/2 Lượng bán 30 ngày
        if (
            variant.c_available + variant.c_incoming <=
            // @ts-ignore
            (1 / 2) * sales_by_sku.get(variant.sku) &&
            // @ts-ignore
            sales_by_sku.get(variant.sku) > 0
        ) {
            // @ts-ignore
            //sales_by_sku.get(variant.sku) Đây là biến gốc lưu tổng số lượng đã bán/xuất kho của mã SKU đó trong vòng 30 ngày (1 tháng) được gom từ các đơn hàng
            variant.c_restock = Math.round(sales_by_sku.get(variant.sku)); //Số lượng bán 1 tháng, 
            variant.c_restock_half = Math.round(0.5 * variant.c_restock); //Số lượng đặt 1/2 tháng
            variant.c_restock_third = Math.round((1 / 3) * variant.c_restock); //ố lượng đặt 1/3 tháng

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
    // let location_by_id: Map<number, string> = new Map()
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
            addrs = addrs.filter((v, _, __) => {
                return v != "" && v != null;
            });
            location_by_id.push({
                id: loc.id,
                address: addrs.join(", "),
                label: loc.label,
            });
        });
    }

    return location_by_id;
}

export function isFirstTime() {
    return localStorage.getItem("last_data_update") == null;
}

export function setLastDataUpdate() {
    localStorage.setItem(
        "last_data_update",
        new Date().getTime().toString(),
    );
}

export function getLastDataUpdateTUnix() {
    return Number(localStorage.getItem("last_data_update"));
}

export function getLastDataUpdate() {
    const t_unix = localStorage.getItem("last_data_update");
    let utcString;
    if (t_unix != null) {
        utcString = new Date(Number(t_unix)).toISOString();
    } else {
        const now = new Date();
        now.setMonth(now.getMonth() - 6);
        utcString = now.toISOString();
    }
    // Strip milliseconds if present (UTC string from Date does not include ms, but just in case)
    return utcString.replace(/\.\d{3}Z$/, "Z");
}

export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function is_promotional_item(brand: string) {
    if (!brand) {
        return false
    }
    const br = brand.toLowerCase()
    if (!brand) {
        return false
    }
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
    // Remove accents
    let str = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    // Lowercase
    str = str.toLowerCase();
    // Remove special characters, keep a-z, 0-9, and whitespace
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
            if (JSON.parse(resp[0].data).products.length == 0) {
                running = false;
                break;
            }

            for (let r of resp) {
                const products = JSON.parse(r.data).products;
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
                                // image_path: variant.images[0].full_path || "",
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

                            // Populate inventory level map
                            variant.inventories.forEach(
                                (inventory: any) => {
                                    p_variant.inventory_level_by_location.set(
                                        inventory.location_id,
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
                                p_variant.composite_item_quantity_by_variant_id = new Map()
                                variant.composite_items.forEach((composite_item: any) => {
                                    p_variant.composite_item_quantity_by_variant_id?.set(composite_item.sub_variant_id, composite_item.quantity)
                                })
                            }

                            // Get image
                            if (variant.images && variant.images[0]) {
                                p_variant.image_path =
                                    variant.images[0].full_path;
                            } else if (
                                product.images &&
                                product.images[0]
                            ) {
                                p_variant.image_path =
                                    product.images[0].full_path;
                            }

                            p_variant_by_ids.set(
                                p_variant.variant_id,
                                p_variant,
                            );

                            for (let price of variant.variant_prices) {
                                if (price.price_list.code == "GIANHAP") {
                                    p_variant.retail_price_ecomm = price.included_tax_price
                                    break
                                }
                            }
                            p_variant.unit = variant.unit || "<Không xác định>"
                            p_variant.category = product.category
                        }
                    });
                });
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
        const request = indexedDB.open("LYOInventoryDB", 3);

        request.onerror = function () {
            reject("IndexedDB connection failed");
        };

        request.onsuccess = function () {
            const db = request.result;
            const tx = db.transaction("OrderRecordsV2", "readonly");
            const store = tx.objectStore("OrderRecordsV2");
            const records: OrderRecordV2[] = [];

            // Always use the "type" index for filtering
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
                        location_id: value.location_id,
                        is_composite: value.is_composite,
                        new_record: false,
                        order_id: value.order_id,
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

export async function updateIndexedDB(records: OrderRecordV2[]) {
    return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("LYOInventoryDB", 3);

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
                        location_id: r.location_id,
                        is_composite: r.is_composite,
                        order_id: r.order_id,
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

export async function fetch_order_record(variant_by_id: Map<number, ProductV2>) {

let a = new Axios({
    headers: {
        "Content-Type": "application/json",
        Authorization: obtain_access_token(),
    },
});

    const last_update_utc = getLastDataUpdate();
    // const today_utc = new Date().toUTCString()
    let existing_order_ids = new Set<number>();
    let page = 1;
    let order_records: OrderRecordV2[] = [];
    let total_pages = Infinity;

    if (!isFirstTime()) {
        order_records = await fetchRecordsFromIndexedDB();
    }
    for (let r of order_records) {
        existing_order_ids.add(r.order_id);
    }

    let running = true;

    while (running) {
        const resp = await Promise.all([
            a.get(`${proxyUrl}/admin/orders.json`, {
                params: {
                    status: "completed",
                    page: page,
                    limit: 250,
                    modified_on_min: last_update_utc,
                },
            }),
            a.get(`${proxyUrl}/admin/orders.json`, {
                params: {
                    status: "completed",
                    page: page + 1,
                    limit: 250,
                    modified_on_min: last_update_utc,
                },
            }),
            a.get(`${proxyUrl}/admin/orders.json`, {
                params: {
                    status: "completed",
                    page: page + 2,
                    limit: 250,
                    modified_on_min: last_update_utc,
                },
            }),
            a.get(`${proxyUrl}/admin/orders.json`, {
                params: {
                    status: "completed",
                    page: page + 3,
                    limit: 250,
                    modified_on_min: last_update_utc,
                },
            }),
        ]);

        const success =
            resp[0].status == 200 &&
            resp[1].status == 200 &&
            resp[2].status == 200 &&
            resp[3].status == 200;

        if (success) {
            total_pages = JSON.parse(resp[0].data).metadata.total;

            for (let r of resp) {
                const j = JSON.parse(r.data);
                if (j.orders.length == 0) {
                    running = false;
                    break;
                }
                if (j.orders) {
                    j.orders.forEach((order: any) => {
                        if (!existing_order_ids.has(order.id)) {
                            order.fulfillments.forEach(
                                (fulfillment: any) => {
                                    fulfillment.fulfillment_line_items.forEach(
                                        (line_item: any) => {

                                            if (line_item.is_composite) {
                                                const it = variant_by_id.get(line_item.variant_id)
                                                it?.composite_item_quantity_by_variant_id?.forEach((id: number, quantity: number) => {
                                                    const composite_item_sku = variant_by_id.get(id)?.sku
                                                    if (composite_item_sku) {
                                                        order_records.push({
                                                            order_id: order.id,
                                                            sku: composite_item_sku,
                                                            quantity: line_item.quantity * quantity,
                                                            is_composite: false,
                                                            location_id: fulfillment.stock_location_id,
                                                            t_unix: new Date(
                                                                order.modified_on
                                                            ).getTime(),
                                                            new_record: true
                                                        })
                                                    }

                                                });

                                            } else {
                                                order_records.push({
                                                    order_id: order.id,
                                                    quantity:
                                                        line_item.quantity,
                                                    sku: line_item.sku,
                                                    is_composite:
                                                        line_item.is_composite,
                                                    location_id:
                                                        fulfillment.stock_location_id,
                                                    t_unix: new Date(
                                                        order.modified_on,
                                                    ).getTime(),
                                                    new_record: true,
                                                });
                                            }


                                        },
                                    );
                                },
                            );
                            existing_order_ids.add(order.id);
                        }
                    });
                }
            }
            page += 4;
        } else {
            await sleep(1000);
        }
    }

    // Update IndexedDB
    updateIndexedDB(order_records.filter((v) => v.new_record));

    return order_records;
}

export async function fetchInventoryTransferFromIndexedDB(): Promise<
    TransferRecord[]
> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("LYOInventoryDB", 3);
        let transfers: TransferRecord[] = [];

        request.onerror = function () {
            reject("IndexedDB connection failed");
        };

        request.onsuccess = function () {
            const db = request.result;
            const tx = db.transaction("OrderRecordsV2", "readonly");
            const store = tx.objectStore("OrderRecordsV2");

            // Use the "type" index to get only "transfer" entries
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
                    // Iterate through entries as-is, do not save or return yet
                    transfers.push({
                        sku: value.sku,
                        t_unix: value.t_unix,
                        quantity: value.quantity,
                        location_id: value.location_id,
                        new_record: false,
                        transfer_id: value.order_id,
                    });

                    cursor.continue();
                } else {
                    db.close();
                    // Do not resolve or return anything yet
                    resolve(transfers);
                }
            };
        };
    });
}

export async function saveInventoryTransferToIndexedDB(
    records: TransferRecord[],
    products: Map<number, ProductV2>,
) {
    return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("LYOInventoryDB", 3);

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
                        location_id: r.location_id,
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

export function get_low_sales_skus(
    p_variants: ProductV2[]
) {
    
    let _r = new Set<string>();
    
    p_variants.forEach((v) => {
        if (v.c_restock < 20) {
            _r.add(v.sku)
        }
    })

    return _r;
}

export async function fetch_inventory_transfer(
    p_variants: Map<number, ProductV2>,
) {
    // received OR shipped

    let a = new Axios({
    headers: {
        "Content-Type": "application/json",
        Authorization: obtain_access_token(),
    },
});

    const last_update_utc = getLastDataUpdate();

    let existing_transfer_ids = new Set<number>();
    let page = 1;
    let transfer_records: TransferRecord[] = [];
    let total_pages = Infinity;

    if (!isFirstTime()) {
        transfer_records = await fetchInventoryTransferFromIndexedDB();
    }
    for (let r of transfer_records) {
        existing_transfer_ids.add(r.transfer_id);
    }

    let running = true;

    while (running) {
        const resp = await Promise.all([
            a.get(`${proxyUrl}/admin/stock_transfers.json`, {
                params: {
                    status: "completed",
                    page: page,
                    limit: 250,
                    modified_on_min: last_update_utc,
                },
            }),
            a.get(`${proxyUrl}/admin/stock_transfers.json`, {
                params: {
                    status: "completed",
                    page: page + 1,
                    limit: 250,
                    modified_on_min: last_update_utc,
                },
            }),
            a.get(`${proxyUrl}/admin/stock_transfers.json`, {
                params: {
                    status: "completed",
                    page: page + 2,
                    limit: 250,
                    modified_on_min: last_update_utc,
                },
            }),
            a.get(`${proxyUrl}/admin/stock_transfers.json`, {
                params: {
                    status: "completed",
                    page: page + 3,
                    limit: 250,
                    modified_on_min: last_update_utc,
                },
            }),
        ]);

        const success =
            resp[0].status == 200 &&
            resp[1].status == 200 &&
            resp[2].status == 200 &&
            resp[3].status == 200;

        if (success) {
            total_pages = JSON.parse(resp[0].data).metadata.total;

            for (let r of resp) {
                const j = JSON.parse(r.data);
                if (j.stock_transfers.length == 0) {
                    running = false;
                    break;
                }
                if (j.stock_transfers) {
                    j.stock_transfers.forEach((transfer: any) => {
                        if (
                            !existing_transfer_ids.has(transfer.id) &&
                            (transfer.status == "received" ||
                                transfer.status == "shipped")
                        ) {
                            transfer.line_items.forEach(
                                (line_item: any) => {
                                    if (
                                        p_variants.has(line_item.variant_id)
                                    ) {
                                        transfer_records.push({
                                            transfer_id: transfer.id,
                                            location_id:
                                                transfer.source_location_id,
                                            // @ts-ignore
                                            sku: p_variants.get(
                                                line_item.variant_id,
                                            ).sku,
                                            t_unix: new Date(
                                                transfer.modified_on,
                                            ).getTime(),
                                            quantity: line_item.quantity,
                                            new_record: true,
                                        });
                                    }
                                },
                            );
                            existing_transfer_ids.add(transfer.id);
                        }
                    });
                }
            }
            page += 4;
        } else {
            await sleep(1000);
        }
    }

    // Update IndexedDB
    saveInventoryTransferToIndexedDB(
        transfer_records.filter((v) => v.new_record),
        p_variants,
    );

    return transfer_records;
}

