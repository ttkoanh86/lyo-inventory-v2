import { type Location } from "./Template";

let proxyUrl: string;

if (import.meta.env.MODE === "development") {
    proxyUrl = "http://localhost:8080/api";
} else {
    proxyUrl = "https://lyo-inventory-proxy-sg.onrender.com/api";
}

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

export function obtain_access_token() {
    const token = import.meta.env.VITE_SAPO_ACCESS_TOKEN || import.meta.env.SAPO_ACCESS_TOKEN || sessionStorage.getItem("token") || localStorage.getItem("token") || "";
    return "Bearer " + token.replace("Bearer ", "");
}

export type RecordItem = OrderRecordV2 | TransferRecord;
export function parseSapoDate(dateStr: string): number { return 0; }
export function is_promotional_item(brand: string, name: string = "") { return false; }
export function calculate_restock_data(records: RecordItem[], variant_by_id: Map<number, ProductV2>, location_id: number) { return []; }
export function get_items_need_restock(variant_by_id: Map<number, ProductV2>, target_location_id: number): ProductV2[] { return []; }
export function get_items_has_sales(variant_by_id: Map<number, ProductV2>): ProductV2[] { return []; }
export function get_items_out_of_stock_history(variant_by_id: Map<number, ProductV2>, target_location_id: number): ProductV2[] { return []; }
export async function get_locations(): Promise<Location[]> { return [{ id: 789505, label: "CÔNG TY TNHH LYO GROUP", address: "Mặc định" }]; }
export function isFirstTime() { return true; }
export function setLastDataUpdate() {}
export function getLastDataUpdateTUnix() { return 0; }
export function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
export function normalizeString(input: string): string { return input.toLowerCase(); }
export async function get_active_products() { return new Map<number, ProductV2>(); }
export async function updateIndexedDB(records: RecordItem[]) {}
export function get_low_sales_skus(p_variants: ProductV2[]) { return new Set<string>(); }

// 🧪 KIỂM TRA SITE MỚI VỚI BỘ LỌC KHO 789505 VÀ STATUS=ANY
export async function fetch_order_record(variant_by_id: Map<number, ProductV2>) {
    const token = obtain_access_token();
    
    // Thêm location_ids=789505 và status=any
    const testUrl = `${proxyUrl}/admin/orders.json?limit=10&page=1&location_ids=789505&status=any`;

    console.log(`====================================================`);
    console.log(`🚀 [TEST SITE MỚI + KHO 789505] URL: ${testUrl}`);

    try {
        const res = await fetch(testUrl, {
            method: "GET",
            headers: {
                "Authorization": token,
                "Content-Type": "application/json"
            }
        });

        const bodyText = await res.text();
        console.log(`📦 Body Trả Về:`, bodyText);

        const j = JSON.parse(bodyText);
        console.log(`🎯 TOTAL ĐƠN TÌM THẤY = ${j.metadata?.total ?? 0}`);

    } catch (e: any) {
        console.error(`💥 Lỗi:`, e?.message || e);
    }

    console.log(`====================================================`);
    return [];
}

export async function fetch_inventory_transfer(p_variants: Map<number, ProductV2>) { return []; }
