import { Axios } from "axios";
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

// 🕵️ HÀM BẪY CHI TIẾT RAW RESPONSE TỪ PROXY BACKEND
async function debugCallProxy(siteLabel: "SITE MỚI" | "SITE CỦ", isOld: boolean) {
    console.log(`====================================================`);
    console.log(`🕵️ [BẪY KẾT NỐI - ${siteLabel}] Bắt đầu gửi request...`);
    
    let url = `${proxyUrl}/admin/orders.json?limit=10&page=1`;
    if (isOld) {
        url += `&site=old`;
    }

    try {
        const token = obtain_access_token();
        console.log(`👉 [REQ ${siteLabel}] URL: ${url}`);
        console.log(`👉 [REQ ${siteLabel}] Token Prefix: ${token.substring(0, 15)}...`);

        const res = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": token,
                "Content-Type": "application/json"
            }
        });

        console.log(`📥 [RESP ${siteLabel}] HTTP Status Code: ${res.status}`);

        const textData = await res.text();
        console.log(`📥 [RAW BODY ${siteLabel}]:`, textData);

        try {
            const parsed = JSON.parse(textData);
            const orders = parsed.orders || parsed.data?.orders || [];
            console.log(`✅ [PARSED ${siteLabel}] Số lượng đơn đọc được: ${orders.length}`);
            if (orders.length > 0) {
                console.log(`📦 [ĐƠN MẪU ${siteLabel}]:`, orders[0]);
            }
        } catch (err) {
            console.error(`❌ [LỖI PARSE JSON ${siteLabel}] Body không phải định dạng JSON chuẩn!`);
        }
    } catch (e: any) {
        console.error(`💥 [LỖI MẠNG / CATCH ${siteLabel}]:`, e?.message || e);
    }
}

export async function fetch_order_record(variant_by_id: Map<number, ProductV2>) {
    // Gọi bẫy dữ liệu cho Site Mới
    await debugCallProxy("SITE MỚI", false);

    // Gọi bẫy dữ liệu cho Site Cũ
    await debugCallProxy("SITE CỦ", true);

    return [];
}

export async function fetch_inventory_transfer(p_variants: Map<number, ProductV2>) { return []; }
