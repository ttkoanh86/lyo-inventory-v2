import { type Location } from "./Template";

let proxyUrl: string;
let baseUrl: string;

if (import.meta.env.MODE === "development") {
    proxyUrl = "http://localhost:8080/api";
    baseUrl = "http://localhost:8080";
} else {
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

const TARGET_LOCATION_ID_NEW = 789505;

export function obtain_access_token() {
    const token = import.meta.env.VITE_SAPO_ACCESS_TOKEN || 
                  import.meta.env.SAPO_ACCESS_TOKEN || 
                  localStorage.getItem("token") || 
                  sessionStorage.getItem("token") || 
                  "";
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
    console.log(`[TEST MODE] Đang xử lý ${records.length} bản ghi test thu được từ 2 site...`);
    return get_items_out_of_stock_history(variant_by_id, TARGET_LOCATION_ID_NEW);
}

export function get_items_need_restock(variant_by_id: Map<number, ProductV2>, target_location_id: number): ProductV2[] {
    return [];
}

export function get_items_has_sales(variant_by_id: Map<number, ProductV2>): ProductV2[] {
    return [];
}

export function get_items_out_of_stock_history(variant_by_id: Map<number, ProductV2>, target_location_id: number): ProductV2[] {
    let result: ProductV2[] = [];
    variant_by_id.forEach((variant) => {
        result.push(variant);
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

export async function get_active_products() {
    let p_variant_by_ids: Map<number, ProductV2> = new Map();
    let running = true;
    let page = 1;

    while (running && page <= 2) {
        try {
            const token = obtain_access_token();
            const res = await fetch(`${proxyUrl}/admin/products.json?limit=50&page=${page}&status=active`, {
                headers: { "Authorization": token, "Content-Type": "application/json" }
            });

            if (res.ok) {
                const data = await res.json();
                const products = data.products || [];
                if (products.length === 0) { running = false; break; }

                products.forEach((product: any) => {
                    const brand_name = (product.brand || "").trim();
                    const prod_name = (product.name || "").trim();

                    product.variants.forEach((variant: any) => {
                        let p_variant: ProductV2 = {
                            is_composite: false,
                            brand: brand_name || "<Không xác định>",
                            variant_id: variant.id,
                            product_id: product.id,
                            sku: (variant.sku || "").trim(),
                            barcode: (variant.barcode || variant.sku || "").trim(),
                            c_restock: 0, c_restock_half: 0, c_restock_third: 0, image_path: "",
                            c_on_hand: 0, c_incoming: 0, c_available: 0,
                            name: variant.name || prod_name, name_normalized: normalizeString(variant.name || prod_name),
                            import_price: variant.variant_import_price || 0, retail_price: variant.variant_retail_price || 0, retail_price_ecomm: 0,
                            inventory_level_by_location: new Map(),
                            composite_item_quantity_by_variant_id: new Map(),
                            order_history_by_location: new Set<number>()
                        };
                        p_variant_by_ids.set(p_variant.variant_id, p_variant);
                    });
                });
                page++;
            } else { running = false; }
        } catch (e) { running = false; }
    }
    return p_variant_by_ids;
}

export async function updateIndexedDB(records: RecordItem[]) {}

export function get_low_sales_skus(p_variants: ProductV2[]) {
    return new Set<string>();
}

// 🧪 HÀM KIỂM THỬ KẾT NỐI ĐỘC LẬP TỪNG SITE
async function testSingleSiteConnection(siteName: "SITE MỚI" | "SITE CŨ") {
    const token = obtain_access_token();
    let endpoint = `${proxyUrl}/admin/orders.json?limit=50&page=1`;
    
    if (siteName === "SITE CŨ") {
        endpoint += `&site=old`;
    }

    console.log(`🔍 [ĐANG THỬ KẾT NỐI ${siteName}] Endpoint: ${endpoint}`);

    try {
        const res = await fetch(endpoint, {
            headers: { 
                "Authorization": token, 
                "Content-Type": "application/json" 
            }
        });

        console.log(`📡 [KẾT QUẢ THỬ NGHIỆM ${siteName}] HTTP Status Code:`, res.status);

        if (res.ok) {
            const data = await res.json();
            const orders = data.orders || [];
            console.log(`✅ [THÀNH CÔNG ${siteName}] Sapo trả về thành công ${orders.length} đơn hàng!`);
            if (orders.length > 0) {
                console.log(`📦 [MẪU ĐƠN ĐẦU TIÊN CỦA ${siteName}]:`, orders[0]);
            }
            return orders;
        } else {
            console.error(`❌ [THẤT BẠI ${siteName}] Lỗi từ server Proxy/Sapo: HTTP ${res.status}`);
            return [];
        }
    } catch (err: any) {
        console.error(`💥 [NỔ LỖI ${siteName}] Không gọi được Proxy:`, err?.message || err);
        return [];
    }
}

export async function fetch_order_record(variant_by_id: Map<number, ProductV2>) {
    console.log(`====================================================`);
    console.log(`🚀 BẮT ĐẦU CHẠY BÀI TEST THỦ CÔNG KẾT NỐI TỪNG SITE...`);

    // 1. Kiểm tra Site Mới
    const newOrders = await testSingleSiteConnection("SITE MỚI");

    // 2. Kiểm tra Site Cũ
    const oldOrders = await testSingleSiteConnection("SITE CŨ");

    console.log(`====================================================`);
    console.log(`📊 BÁO CÁO KẾT QUẢ KIỂM THỬ:`);
    console.log(`   + SITE MỚI: ${newOrders.length} đơn hàng.`);
    console.log(`   + SITE CỦ: ${oldOrders.length} đơn hàng.`);
    console.log(`====================================================`);

    return [];
}

export async function fetch_inventory_transfer(p_variants: Map<number, ProductV2>) { return []; }
