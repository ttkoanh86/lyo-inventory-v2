<script lang="ts">
    // @ts-ignore
    import { Grid, Willow } from "wx-svelte-grid";
    // @ts-ignore
    import { Button, Select, Portal, Modal, Popup } from "wx-svelte-core";
    // @ts-ignore
    import { Locale } from "wx-svelte-core";
    import {
        calculate_restock_data,
        get_items_need_restock,
        get_items_has_sales,
        get_items_out_of_stock_history, // 🟢 IMPORT HÀM LỌC TAB 3
        get_active_products,
        get_locations,
        fetch_order_record,
        type ProductV2,
        type OrderRecordV2,
        type TransferRecord,
        fetch_inventory_transfer,
        get_low_sales_skus,
        setLastDataUpdate,
    } from "./DataPipelineV2";
    import SelectionCheckboxCell from "./SelectionCheckboxCell.svelte";
    import ImageCell from "./ImageCell.svelte";
    import { vi } from "./Localization";
    import { onMount, setContext } from "svelte";
    import {
        normalizeToEnglish,
        type Filtering,
        type Location,
        type Sorting,
    } from "./Template";
    import { applyAction } from "$app/forms";
    import { lazyLoadStylesheets } from "./lazyLoadScript";
    import LoadingThrobber from "./LoadingThrobber.svelte";
    import SettingsModal from "./SettingsModal.svelte";

    import { Axios } from "axios";
    import { goto } from "$app/navigation";

    import HeaderWithSortUi from "./HeaderWithSortUI.svelte";

    import {
        export_all_to_xlsx,
        export_selected_to_xlsx,
        export_kiem_hang_to_xlsx,
        export_transfer_sheet_to_xlsx,
        _actual_export_handler,
    } from "./Export2Excel";

    const columns = [
        { id: "id", hidden: true },
        { id: "selected", cell: SelectionCheckboxCell, width: 36 },
        { id: "sku", resize: true, width: 130, header: [{ cell: HeaderWithSortUi, text: "SKU" }] },
        { id: "name", resize: true, width: 240, header: [{ cell: HeaderWithSortUi, text: "Tên sản phẩm" }] },
        { id: "image", header: "Ảnh", cell: ImageCell },
        { id: "image_path", hidden: true },
        { id: "c_restock_third", resize: true, width: 140, header: [{ cell: HeaderWithSortUi, text: "SL đặt\n(1/3 tháng)" }] },
        { id: "c_restock_half", resize: true, width: 140, header: [{ cell: HeaderWithSortUi, text: "SL đặt\n(1/2 tháng)" }] },
        { id: "c_restock", resize: true, width: 140, header: [{ cell: HeaderWithSortUi, text: "SL bán\n(1 tháng)" }] },
        { id: "c_on_hand", resize: true, width: 140, header: [{ cell: HeaderWithSortUi, text: "Tồn kho" }] },
        { id: "c_incoming", resize: true, width: 140, header: [{ cell: HeaderWithSortUi, text: "Đang về" }] },
        { id: "brand", resize: true, width: 180, header: [{ cell: HeaderWithSortUi, text: "Nhãn hiệu" }] },
        { id: "unit", resize: true, width: 180, header: [{ cell: HeaderWithSortUi, text: "Đơn vị tính" }] },
        { id: "import_price", resize: true, width: 180, header: [{ cell: HeaderWithSortUi, text: "Giá nhập" }] },
        { id: "retail_price", resize: true, width: 180, header: [{ cell: HeaderWithSortUi, text: "Thành tiền (Shop)" }] },
        { id: "retail_price_ecomm", resize: true, width: 180, header: [{ cell: HeaderWithSortUi, text: "Thành tiền (TMĐT)" }] },
    ];

    const filter_by_id: Map<string, Filtering> = $state(new Map());
    const sort_by_id: Map<string, Sorting> = $state(new Map());

    setContext("filterbyid", filter_by_id);
    setContext("sortbyid", sort_by_id);

    const responsive_fields = { 800: { columns: columns } };

    let data: ProductV2[] = $state([]);

    let currentPage = $state(1);
    let itemsPerPage = $state(50);
    let totalPages = $derived(Math.ceil(datasource.length / itemsPerPage) || 1);

    function updatePageData() {
        let start = (currentPage - 1) * itemsPerPage;
        let end = start + itemsPerPage;
        data = datasource.slice(start, Math.min(end, datasource.length));
    }

    function resetPagination() {
        currentPage = 1;
        updatePageData();
    }

    let is_loading = $state(false);
    let is_settings_open = $state(false);
    let updateKeys = $state({ headerSorterKey: 0, dsource: [], dfiltered: [] });
    setContext("updatekeys", updateKeys);

    let datasource: ProductV2[] = $state([]);

    // 🟢 STATE QUẢN LÝ BỘ 3 TAB NÚT LỌC
    let activeTab: 'need_restock' | 'has_sales' | 'out_of_stock' = $state('need_restock');

    let variant_by_id = new Map<number, ProductV2>();
    let order_records: OrderRecordV2[] = [];
    let transfer_records: TransferRecord[] = [];
    let locations: Location[] = $state([]);

    let c_location_id: number = $state(-1);
    let c_location: Location;
    let rowCount = $state(0);
    let grid_key = $state(0);

    let selected_skus = $state(new Set<string>());
    let checkbox_update_key = $state({ k: 0 });
    let filter_update_key = $state({ k: 0 });
    setContext("selected_skus", selected_skus);
    setContext("checkbox_key", checkbox_update_key);
    setContext("filter_update_key", filter_update_key);
    let proxyUrl = "";
    let baseUrl = "";

    let low_sales_skus: Set<string> = $state(new Set<string>());

    if (import.meta.env.MODE === "development") {
        proxyUrl = "http://localhost:8080/api";
        baseUrl = "http://localhost:8080";
    } else {
        proxyUrl = "https://lyo-inventory-proxy-x79b.onrender.com/api";
        baseUrl = "https://lyo-inventory-proxy-x79b.onrender.com";
    }

    export function obtain_access_token() {
        if (sessionStorage.getItem("token") == null) {
            goto("/authentication");
        }
        return "Bearer " + sessionStorage.getItem("token");
    }

    let a = new Axios({
        headers: {
            "Content-Type": "application/json",
            Authorization: obtain_access_token(),
        },
    });

    let grid_api = $state();

    const revoke_broadcast_channel = new BroadcastChannel("revoke");
    async function logout() {
        await a.delete(`${baseUrl}/revoke`);
        sessionStorage.clear();
        revoke_broadcast_channel.postMessage("revoke");
        goto("/authentication");
    }

    function tweak_ui() {}

    // 🟢 HÀM TRÍCH XUẤT ĐÚNG VÙNG DỮ LIỆU TƯƠNG ỨNG VỚI CẢ 3 TAB
    function applyTabFilter() {
        calculate_restock_data(
            [...order_records, ...transfer_records],
            variant_by_id,
            Number(c_location_id),
        );

        if (activeTab === 'need_restock') {
            datasource = get_items_need_restock(variant_by_id, Number(c_location_id));
        } else if (activeTab === 'has_sales') {
            datasource = get_items_has_sales(variant_by_id);
        } else {
            // 🟢 TAB 3: HÀNG BỊ ĐỨT (CẦN CHECK ĐỂ ĐẶT LẠI)
            datasource = get_items_out_of_stock_history(variant_by_id);
        }

        // 🟢 CẬP NHẬT TRỰC TIẾP DSOURCE ĐỂ BỘ LỌC CỘT SKU NẠP ĐÚNG DANH SÁCH THEO TAB
        updateKeys.dsource = datasource as any;

        rowCount = datasource.length;
        resetPagination();
        grid_key++;
    }

    // 🟢 HÀM ĐỔI TAB VÀ LÀM MỚI TOÀN BỘ BỘ LỌC HEADER
    function switchTab(tab: 'need_restock' | 'has_sales' | 'out_of_stock') {
        activeTab = tab;
        selected_skus.clear();
        filter_by_id.clear();
        sort_by_id.clear();
        
        applyTabFilter();

        // 🟢 THÔNG BÁO CHO HEADER CẬP NHẬT LẠI DANH SÁCH CHECKBOX THEO DSOURCE MỚI
        updateKeys.headerSorterKey++;
        filter_update_key.k += 1;
    }

    function handle_location_update() {
        is_loading = true;
        applyTabFilter();
        low_sales_skus = get_low_sales_skus(datasource);
        selected_skus.clear();
        filter_by_id.clear();
        sort_by_id.clear();

        updateKeys.headerSorterKey++;
        filter_update_key.k += 1;

        is_loading = false;
        c_location = locations.find((v) => Number(v.id) === Number(c_location_id)) as Location;
    }

    function select_all() {
        for (let x of datasource) {
            selected_skus.add(x.sku);
        }
        checkbox_update_key.k += 1;
    }

    function deselect_all() {
        selected_skus.clear();
        checkbox_update_key.k += 1;
    }

    async function initialize() {
        is_loading = true;
        let loc_and_variant = await Promise.all([
            get_locations(),
            get_active_products(),
        ]);
        locations = loc_and_variant[0];
        variant_by_id = loc_and_variant[1];

        let order_and_transfer_records = await Promise.all([
            fetch_order_record(variant_by_id),
            fetch_inventory_transfer(variant_by_id),
        ]);
        order_records = order_and_transfer_records[0];
        transfer_records = order_and_transfer_records[1];

        c_location_id = Number(locations[0].id);

        applyTabFilter();

        setLastDataUpdate();

        low_sales_skus = get_low_sales_skus(datasource);
        is_loading = false;
        
        updateKeys.headerSorterKey++;
        c_location = locations[0];
    }

    // 🟢 HÀM LỌC CHUẨN HÓA TRIMMING CHUỖI VÀ CHUẨN ĐÉC KIỂU DỮ LIỆU
    function enforce_filter(ukey: number) {
        data = [];
        applyTabFilter();

        if (filter_by_id.size) {
            filter_by_id.forEach((fval, fkey) => {
                const cleanIncludes = new Set<string>();
                fval.includes.forEach((item: any) => {
                    cleanIncludes.add(String(item ?? "").trim().toLowerCase());
                });

                datasource = datasource.filter((v) => {
                    const rawVal = v[fkey as keyof ProductV2];
                    const cleanVal = String(rawVal ?? "").trim().toLowerCase();
                    return cleanIncludes.has(cleanVal);
                });
            });
        }
        rowCount = datasource.length;
        resetPagination(); 
    }

    // 🟢 HÀM SẮP XẾP CHUẨN AN TOÀN CHO CẢ SỐ VÀ CHUỖI
    function enforce_sorting(ukey: number) {
        if (sort_by_id.size) {
            sort_by_id.forEach((sval, skey) => {
                datasource.sort((a, b) => {
                    const valA = a[skey as keyof ProductV2];
                    const valB = b[skey as keyof ProductV2];

                    if (typeof valA === "number" && typeof valB === "number") {
                        return sval.order === 1 ? valA - valB : valB - valA;
                    } else {
                        const cmp_a = normalizeToEnglish(String(valA ?? ""));
                        const cmp_b = normalizeToEnglish(String(valB ?? ""));
                        if (sval.order === 1) return cmp_a.localeCompare(cmp_b);
                        if (sval.order === -1) return cmp_b.localeCompare(cmp_a);
                        return 0;
                    }
                });
            });
        }
        updatePageData(); 
    }

    let viewing_low_sales = $state(false);
    let last_sales_filter: Map<string, Filtering>;
    function filter_low_sales_items(skip_updating = false) {
        viewing_low_sales = !viewing_low_sales;
        if (viewing_low_sales) {
            let s = new Set();
            datasource.forEach((v) => {
                if (v.c_restock < 20) {
                    s.add(v.c_restock);
                }
            });
            last_sales_filter = new Map(filter_by_id);
            filter_by_id.clear();
            filter_by_id.set("c_restock", {
                key: "c_restock",
                operator: "<",
                value: 20,
                type: "number",
                includes: s,
            });
        } else {
            filter_by_id.clear();
            if (last_sales_filter) {
                last_sales_filter.forEach((v, k) => {
                    filter_by_id.set(k, v);
                });
            }
            last_sales_filter?.clear();
        }

        if (!skip_updating) {
            filter_update_key.k += 1;
        }
    }

    let viewing_low_stocks = $state(false);
    function filter_low_stock_items() {
        viewing_low_stocks = !viewing_low_stocks;

        if (viewing_low_sales) {
            filter_low_sales_items(true);
        }

        if (viewing_low_stocks) {
            let s = new Set();
            datasource.forEach((v) => {
                if (v.c_on_hand < 20) {
                    s.add(v.c_on_hand);
                }
            });
            last_sales_filter = new Map(filter_by_id);
            filter_by_id.clear();
            filter_by_id.set("c_on_hand", {
                key: "c_on_hand",
                operator: "<",
                value: 20,
                type: "number",
                includes: s,
            });
        } else {
            filter_by_id.clear();
            if (last_sales_filter) {
                last_sales_filter.forEach((v, k) => {
                    filter_by_id.set(k, v);
                });
            }
            last_sales_filter?.clear();
        }
        filter_update_key.k += 1;
    }

    let export_popup_parent;
    let export_popup_shown = $state(false);

    function on_export_popup_cancel() {
        export_popup_shown = false;
    }

    let last_filter_update_key = 0;
    $effect(() => {
        if (last_filter_update_key != filter_update_key.k) {
            enforce_filter(filter_update_key.k);
            enforce_sorting(filter_update_key.k);
            last_filter_update_key = filter_update_key.k;
            grid_key += 1;
        }
    });

    onMount(async () => {
        lazyLoadStylesheets(
            "https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css",
        );
        await initialize();
        tweak_ui();
    });
</script>

<Locale words={vi}>
    <Willow>
        <div style="display: flex; gap: 10px; padding-bottom: 10px">
            <div>
                <Button onclick={initialize} type="primary" icon="mdi mdi-refresh"></Button>
            </div>
            <div style="width: 250px; display:flex; align-items: center">
                <span>Kho:&nbsp;</span>
                <Select bind:value={c_location_id} options={locations} onchange={handle_location_update} width="100" placeholder="Chọn kho hàng..."></Select>
            </div>
            <div style="display: flex; gap: 5px">
                <Button onclick={select_all}>Chọn tất cả</Button>
                <Button onclick={deselect_all}>Bỏ chọn tất cả</Button>

                <Button icon="mdi mdi-package-variant-closed-check" onclick={filter_low_stock_items}>Kiểm hàng</Button>
                
                <div bind:this={export_popup_parent}>
                    <Button onclick={() => { export_popup_shown = !export_popup_shown; }} icon="mdi mdi-download">Xuất Excel</Button>
                </div>

                {#if export_popup_shown}
                    <Portal>
                        <Popup parent={export_popup_parent} at="bottom" oncancel={on_export_popup_cancel}>
                            <div class="download-popup" style="padding: 10px; display: flex; flex-direction: column; gap: 8px">
                                
                                <p style="margin: 0px;"><b>1. Xuất phiếu nhập hàng</b></p>
                                {#if selected_skus.size != 0}
                                    <Button type="primary" onclick={async () => {
                                        is_loading = true;
                                        try {
                                            await export_selected_to_xlsx(selected_skus, datasource, c_location);
                                        } finally {
                                            is_loading = false;
                                            export_popup_shown = false;
                                        }
                                    }}>Xuất {selected_skus.size} sản phẩm đã chọn (Nhập hàng)</Button>
                                {:else}
                                    <Button type="primary" onclick={async () => {
                                        is_loading = true;
                                        try {
                                            const filtered_skus = new Set(datasource.map(item => item.sku));
                                            await export_selected_to_xlsx(filtered_skus, datasource, c_location);
                                        } finally {
                                            is_loading = false;
                                            export_popup_shown = false;
                                        }
                                    }}>Xuất toàn bộ {datasource.length} sản phẩm đang lọc (Nhập hàng)</Button>
                                {/if}

                                <Button type="secondary" onclick={async () => {
                                    is_loading = true;
                                    await export_all_to_xlsx(order_records, transfer_records, variant_by_id, c_location_id, c_location).finally(() => {
                                        is_loading = false;
                                    });
                                }}>Xuất toàn bộ sản phẩm trong kho</Button>

                                <hr style="color: #ccc; margin: 4px 0;" />

                                <p style="margin: 0px;"><b>2. Xuất phiếu kiểm hàng</b></p>
                                {#if selected_skus.size != 0}
                                    <Button type="block primary" onclick={async () => {
                                        is_loading = true;
                                        try {
                                            await export_kiem_hang_to_xlsx(selected_skus, datasource, c_location);
                                        } finally {
                                            is_loading = false;
                                            export_popup_shown = false;
                                        }
                                    }}>Xuất {selected_skus.size} sản phẩm đã chọn (Kiểm hàng)</Button>
                                {:else}
                                    <Button type="block primary" onclick={async () => {
                                        is_loading = true;
                                        try {
                                            const filtered_skus = new Set(datasource.map(item => item.sku));
                                            await export_kiem_hang_to_xlsx(filtered_skus, datasource, c_location);
                                        } finally {
                                            is_loading = false;
                                            export_popup_shown = false;
                                        }
                                    }}>Xuất toàn bộ {datasource.length} sản phẩm đang lọc (Kiểm hàng)</Button>
                                {/if}

                                <hr style="color: #ccc; margin: 4px 0;" />

                                <p style="margin: 0px;"><b>3. Xuất phiếu chuyển hàng</b></p>
                                <div>
                                    <Button type="block secondary" onclick={async () => {
                                        is_loading = true;
                                        await export_transfer_sheet_to_xlsx(order_records, transfer_records, variant_by_id, locations).finally(() => {
                                            is_loading = false;
                                        });
                                    }}>Xuất đơn chuyển hàng</Button>
                                    <p style="margin: 0px; font-size: 11px; color: gray;">
                                        <i>(Bao gồm hàng tồn kho trong chi nhánh trung tâm)</i>
                                    </p>
                                </div>

                            </div>
                        </Popup>
                    </Portal>
                {/if}

                <Button icon="mdi mdi-cog" onclick={() => { is_settings_open = true; }}></Button>
                <Button icon="mdi mdi-logout" onclick={logout} type="danger"></Button>
            </div>
        </div>

        <!-- 🟢 BỘ 3 TAB ĐỔI ĐÚNG VÙNG DỮ LIỆU TƯƠNG ỨNG MỖI NÚT -->
        <div class="tab-filter-container">
            <button 
                class="tab-btn {activeTab === 'need_restock' ? 'active-red' : ''}" 
                onclick={() => switchTab('need_restock')}
            >
                🚨 Cần đặt ngay (Cảnh báo đứt hàng)
            </button>

            <button 
                class="tab-btn {activeTab === 'has_sales' ? 'active-green' : ''}" 
                onclick={() => switchTab('has_sales')}
            >
                📦 Tồn kho an toàn (Cân nhắc đặt thêm)
            </button>

            <button 
                class="tab-btn {activeTab === 'out_of_stock' ? 'active-orange' : ''}" 
                onclick={() => switchTab('out_of_stock')}
            >
                ⚠️ Hàng bị đứt (Cần check để đặt lại)
            </button>
        </div>

        {#if low_sales_skus.size && !viewing_low_stocks}
            <div style="width: 100%; padding-left: 10px; background-color: #ffc748; margin-bottom: 10px; display: flex; align-items: center; gap: 10px; border-radius: 5px">
                {#if !viewing_low_sales}
                    <p><b>{low_sales_skus.size}</b> mặt hàng có sản lượng thấp (trong 1 tháng, dưới 20).</p>
                    <div style="height: 32px;">
                        <Button onclick={() => { filter_low_sales_items(false); }}>Xem chi tiết</Button>
                    </div>
                {:else}
                    <p><i class="mdi mdi-eye"></i>&nbsp;Đang xem <b>{low_sales_skus.size}</b> mặt hàng sản lượng thấp (trong 1 tháng, dưới 20).</p>
                    <div style="height: 32px;">
                        <Button onclick={() => { filter_low_sales_items(false); }}>Quay lại</Button>
                    </div>
                {/if}
            </div>
        {/if}

        {#if viewing_low_stocks}
            <div style="width: 100%; padding-left: 10px; background-color: #ffc748; margin-bottom: 10px; display: flex; align-items: center; gap: 10px; border-radius: 5px">
                <p><i class="mdi mdi-eye"></i>&nbsp;Đang xem <b>danh sách kiểm hàng</b> (mặt hàng tồn kho dưới 20).</p>
                <div style="height: 32px;">
                    <Button onclick={filter_low_stock_items}>Quay lại</Button>
                </div>
            </div>
        {/if}

        <div style="height: calc(100dvh - 200px); overflow: hidden;">
            {#key grid_key}
                <Grid bind:this={grid_api} {columns} {data} responsive={responsive_fields} sizes={{ rowHeight: 165 }} rowStyle={(row: any) => row.c_restock < 20 && c_location_id === 122671 ? "lowSales" : ""} />
                <style>
                    .lowSales { background-color: #ff9248 !important; }
                </style>
            {/key}
        </div>

        <div class="pagination-container">
            <div class="page-size">
                <span>Hiển thị</span>
                <select bind:value={itemsPerPage} onchange={resetPagination}>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                </select>
                <span>kết quả</span>
            </div>

            <div class="page-info">
                {#if datasource.length > 0}
                    Từ <b>{(currentPage - 1) * itemsPerPage + 1}</b> đến <b>{Math.min(currentPage * itemsPerPage, datasource.length)}</b> trên tổng <b>{datasource.length}</b> kết quả
                {:else}
                    Không có kết quả nào
                {/if}
            </div>

            <div class="page-controls">
                <button disabled={currentPage === 1} onclick={() => { currentPage--; updatePageData(); }}>&lt;</button>
                {#each Array(totalPages) as _, i}
                    {#if i + 1 === 1 || i + 1 === totalPages || (i + 1 >= currentPage - 1 && i + 1 <= currentPage + 1)}
                        <button class:active={currentPage === i + 1} onclick={() => { currentPage = i + 1; updatePageData(); }}>
                            {i + 1}
                        </button>
                    {/if}
                {/each}
                <button disabled={currentPage === totalPages} onclick={() => { currentPage++; updatePageData(); }}>&gt;</button>
            </div>
        </div>

        {#if is_loading}
            <Portal>
                <Modal buttons={[]}>
                    <div style="display:flex; flex-direction:column; align-items: center;">
                        <LoadingThrobber></LoadingThrobber>
                        <p style="margin-bottom: 0px;">Đang tải...</p>
                    </div>
                </Modal>
            </Portal>
        {/if}

        {#if is_settings_open}
            <Portal>
                <SettingsModal bind:shown={is_settings_open}></SettingsModal>
            </Portal>
        {/if}
    </Willow>
    <style>
        .wx-willow-theme {
            --wx-color-primary: #0520c3;
            --wx-filter-border: 1px solid #c1c1c1;
        }

        .tab-filter-container {
            display: flex;
            gap: 10px;
            margin-bottom: 10px;
        }
        .tab-btn {
            padding: 8px 16px;
            font-size: 13px;
            font-weight: bold;
            border-radius: 6px;
            border: 1px solid #ccc;
            background: #f5f5f5;
            color: #333;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .tab-btn:hover {
            background: #e0e0e0;
        }
        .tab-btn.active-red {
            background-color: #d92d20;
            color: #ffffff;
            border-color: #b42318;
            box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.1);
        }
        .tab-btn.active-green {
            background-color: #059669;
            color: #ffffff;
            border-color: #047857;
            box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.1);
        }
        .tab-btn.active-orange {
            background-color: #d97706;
            color: #ffffff;
            border-color: #b45309;
            box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.1);
        }

        .pagination-container {
            display: flex;
            align-items: center;
            justify-content: flex-end; 
            gap: 40px;
            padding: 8px 16px;
            background: #ffffff;
            border-top: 1px solid #e0e0e0;
            font-family: inherit;
            font-size: 14px;
            height: 45px;
        }

        .page-size select {
            padding: 4px 8px;
            border-radius: 4px;
            border: 1px solid #ccc;
            margin: 0 4px;
        }
        .page-controls {
            display: flex;
            gap: 4px;
        }
        .page-controls button {
            padding: 4px 10px;
            border: 1px solid #d9d9d9;
            background: #fff;
            border-radius: 4px;
            cursor: pointer;
        }
        .page-controls button.active {
            background-color: #0520c3;
            color: #fff;
            border-color: #0520c3;
            font-weight: bold;
        }
        .page-controls button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
    </style>
</Locale>
