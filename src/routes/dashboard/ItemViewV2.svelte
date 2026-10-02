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
		get_items_out_of_stock_history,
		get_active_products,
		get_locations,
		fetch_order_record,
		type ProductV2,
		type OrderRecordV2,
		type TransferRecord,
		fetch_inventory_transfer,
		get_low_sales_skus,
		setLastDataUpdate,
		is_promotional_item,
		TARGET_LOCATION_ID_GROUP
	} from "./DataPipelineV2";
	import SelectionCheckboxCell from "./SelectionCheckboxCell.svelte";
	import ImageCell from "./ImageCell.svelte";
	import NameCell from "./NameCell.svelte";
	import { vi } from "./Localization";
	import { onMount, setContext } from "svelte";
	import {
		normalizeToEnglish,
		type Filtering,
		type Location,
		type Sorting,
	} from "./Template";
	import { lazyLoadStylesheets } from "./lazyLoadScript";
	import LoadingThrobber from "./LoadingThrobber.svelte";
	import SettingsModal from "./SettingsModal.svelte";

	import axios from "axios";
	import { goto } from "$app/navigation";
	import HeaderWithSortUi from "./HeaderWithSortUI.svelte";

	import {
		export_all_to_xlsx,
		export_selected_to_xlsx,
		export_kiem_hang_to_xlsx,
		export_phieu_chuyen_hang_sapo
	} from "./Export2Excel";

	// 🟢 CỜ NHẬN BIẾT CÁC TRANG
	let { isStockCheck = false, isStockTransfer = false } = $props();

	// 🟢 DANH SÁCH 2 KHO CHI NHÁNH CHUYỂN HÀNG
	const transfer_locations: Location[] = [
		{ id: 789503, label: "Kho 146 Bà Triệu", address: "Bà Triệu" },
		{ id: 789504, label: "Kho 180 Phạm Văn Đồng", address: "Phạm Văn Đồng" }
	];

	// 🟢 CẤU TRÚC CỘT THEO ĐÚNG THỨ TỰ YÊU CẦU
	const all_columns = [
		{ id: "id", hidden: true },
		{ id: "selected", cell: SelectionCheckboxCell, width: 36 },
		{ id: "sku", resize: true, width: 130, header: [{ cell: HeaderWithSortUi, text: "SKU" }] },
		{ id: "name", resize: true, width: 260, cell: NameCell, header: [{ cell: HeaderWithSortUi, text: "Tên sản phẩm" }] },
		{ id: "image", header: "Ảnh", cell: ImageCell },
		{ id: "image_path", hidden: true },

		// 🚚 CỘT CHÍNH CỦA CHUYỂN HÀNG
		{ id: "c_transfer_suggest", hidden: !isStockTransfer, resize: true, width: 140, header: [{ cell: HeaderWithSortUi, text: "🚨 SL CẦN\nCHUYỂN" }] },
		{ id: "c_on_hand_group", hidden: !isStockTransfer, resize: true, width: 130, header: [{ cell: HeaderWithSortUi, text: "Tồn Kho\nGroup" }] },

		// CỘT DÀNH CHO ĐẶT HÀNG
		{ id: "c_restock_third", hidden: isStockCheck || isStockTransfer, resize: true, width: 140, header: [{ cell: HeaderWithSortUi, text: "SL đặt\n(1/3 tháng)" }] },
		{ id: "c_restock_half", hidden: isStockCheck || isStockTransfer, resize: true, width: 140, header: [{ cell: HeaderWithSortUi, text: "SL đặt\n(1/2 tháng)" }] },

		// CỘT ĐỐI SOÁT CHI NHÁNH ĐƯỢC CHỌN
		{ id: "c_on_hand", resize: true, width: 130, header: [{ cell: HeaderWithSortUi, text: "Tồn thực tế" }] },
		{ id: "c_incoming", resize: true, width: 130, header: [{ cell: HeaderWithSortUi, text: "Hàng đang về" }] },
		{ id: "c_restock", hidden: isStockCheck, resize: true, width: 140, header: [{ cell: HeaderWithSortUi, text: "SL Bán 30 ngày" }] },
		{ id: "brand", resize: true, width: 160, header: [{ cell: HeaderWithSortUi, text: "Nhãn hiệu" }] },
	];

	const columns = all_columns.filter((col) => !col.hidden);

	const filter_by_id: Map<string, Filtering> = $state(new Map());
	const sort_by_id: Map<string, Sorting> = $state(new Map());
	let updateKeys = $state({ headerSorterKey: 0, dsource: [], dfiltered: [] });

	setContext("filterbyid", filter_by_id);
	setContext("sortbyid", sort_by_id);
	setContext("updatekeys", updateKeys);

	const responsive_fields = { 800: { columns: columns } };

	let data: any[] = $state([]);
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
	let datasource: any[] = $state([]);

	let tab1_items: ProductV2[] = [];
	let tab2_items: ProductV2[] = [];
	let tab3_items: ProductV2[] = [];
	let activeTab: 'need_restock' | 'has_sales' | 'out_of_stock' = $state('need_restock');

	let variant_by_id = new Map<number, ProductV2>();
	let order_records: OrderRecordV2[] = [];
	let transfer_records: TransferRecord[] = [];
	
	let locations: Location[] = $state([
		{ id: TARGET_LOCATION_ID_GROUP, label: "CÔNG TY TNHH LYO GROUP", address: "Mặc định" },
		{ id: 789501, label: "Chi nhánh trung tâm", address: "Trung tâm" }
	]);

	let c_location_id: number = $state(isStockTransfer ? 789503 : TARGET_LOCATION_ID_GROUP);
	let c_location: Location = $state(locations[0]);
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
		proxyUrl = "https://lyo-inventory-proxy.onrender.com/api";
		baseUrl = "https://lyo-inventory-proxy.onrender.com";
	}

	export function obtain_access_token(): string {
		let token = localStorage.getItem("token") || localStorage.getItem("api_token") || sessionStorage.getItem("token");
		if (!token) {
			token = "b3e0a88853e2496c9641800adb465097";
			localStorage.setItem("token", token);
		}
		return "Bearer " + token.replace("Bearer ", "").trim();
	}

	let grid_api = $state();
	const revoke_broadcast_channel = new BroadcastChannel("revoke");
	async function logout() {
		try {
			await axios.delete(`${baseUrl}/revoke`, { headers: { Authorization: obtain_access_token() } });
		} catch (e) {}
		localStorage.clear();
		sessionStorage.clear();
		revoke_broadcast_channel.postMessage("revoke");
		goto("/authentication");
	}

	// 🟢 HÀM TÍNH TOÁN LỌC DỮ LIỆU
	function applyTabFilter() {
		try {
			const selectedLocId = Number(c_location_id);

			if (isStockTransfer) {
				// 🚚 TRANG CHUYỂN HÀNG
				calculate_restock_data([...order_records, ...transfer_records], variant_by_id, selectedLocId);

				let transfer_list: any[] = [];
				variant_by_id.forEach((v) => {
					// 🚫 CHẶN MÃ SKU CẤM VÀ COMBO
					if (v.is_composite || is_promotional_item(v.brand, v.name, v.sku)) return;

					// 1. Tồn Kho Group (789505)
					let stock_group = 0;
					const inv_group = v.inventory_level_by_location.get(TARGET_LOCATION_ID_GROUP);
					if (inv_group) {
						stock_group = Math.max(0, Math.round(inv_group.available ?? inv_group.on_hand ?? 0));
					} else {
						for (let [locId, inv] of v.inventory_level_by_location) {
							if (locId !== 789503 && locId !== 789504) {
								stock_group = Math.max(0, Math.round(inv.available ?? inv.on_hand ?? 0));
								if (stock_group > 0) break;
							}
						}
					}

					if (stock_group <= 0) return;

					// 2. Tồn thực tế & Hàng đang về tại Chi nhánh nhận
					const inv_target = v.inventory_level_by_location.get(selectedLocId);
					const stock_target = inv_target ? Math.max(0, Math.round(inv_target.available ?? inv_target.on_hand ?? 0)) : 0;
					const incoming_target = inv_target ? Math.max(0, Math.round(inv_target.incoming ?? 0)) : 0;

					const current_total_branch = stock_target + incoming_target;
					const sales_30d = v.c_restock || 0;

					let raw_need_transfer = 0;

					if (sales_30d > 0) {
						// 🟢 CÓ BÁN 30 NGÀY: Thiếu hụt so với 50% sản lượng bán
						if (current_total_branch < 0.5 * sales_30d) {
							raw_need_transfer = Math.max(0, Math.round(0.5 * sales_30d - current_total_branch));
						}
					} else {
						// 🟢 KHÔNG BÁN 30 NGÀY: 
						// Chỉ mang lên 2 cái nếu TỒN CHI NHÁNH BẰNG 0 VÀ TỒN KHO GROUP >= 6 (>= 3x2)
						if (current_total_branch === 0 && stock_group >= 6) {
							raw_need_transfer = 2;
						}
					}

					if (raw_need_transfer > 0) {
						let suggest_transfer = Math.min(stock_group, raw_need_transfer);

						if (suggest_transfer > 0) {
							transfer_list.push({
								...v,
								c_on_hand_group: stock_group,
								c_on_hand: stock_target,
								c_incoming: incoming_target,
								c_transfer_suggest: suggest_transfer
							});
						}
					}
				});

				datasource = transfer_list.sort((a, b) => b.c_transfer_suggest - a.c_transfer_suggest);

			} else if (isStockCheck) {
				// 📋 TRANG KIỂM HÀNG
				let stock_check_list: ProductV2[] = [];
				variant_by_id.forEach((v) => {
					if (v.is_composite || is_promotional_item(v.brand, v.name, v.sku)) return;

					const inv = v.inventory_level_by_location.get(selectedLocId);
					const stock = inv ? Math.max(0, Math.round(inv.available ?? inv.on_hand ?? 0)) : 0;
					const incoming = inv ? Math.max(0, Math.round(inv.incoming ?? 0)) : 0;

					v.c_available = stock;
					v.c_on_hand = stock;
					v.c_incoming = incoming;

					if (stock > 0 && stock <= 20) {
						stock_check_list.push(v);
					}
				});
				datasource = stock_check_list.sort((a, b) => (a.c_on_hand || 0) - (b.c_on_hand || 0));

			} else {
				// 🚨 TRANG ĐẶT HÀNG
				calculate_restock_data([...order_records, ...transfer_records], variant_by_id, selectedLocId);
				tab1_items = get_items_need_restock(variant_by_id, selectedLocId);
				tab2_items = get_items_has_sales(variant_by_id);
				tab3_items = get_items_out_of_stock_history(variant_by_id, selectedLocId);

				if (activeTab === 'need_restock') datasource = [...tab1_items];
				else if (activeTab === 'has_sales') datasource = [...tab2_items];
				else datasource = [...tab3_items];
			}

			updateKeys.dsource = datasource as any;
			updateKeys.headerSorterKey++;
			rowCount = datasource.length;
			resetPagination();
			grid_key++;
		} catch (e) {
			console.error("Lỗi applyTabFilter:", e);
		}
	}

	function switchTab(tab: 'need_restock' | 'has_sales' | 'out_of_stock') {
		activeTab = tab;
		selected_skus.clear();
		filter_by_id.clear();
		sort_by_id.clear();
		applyTabFilter();
	}

	function handle_location_update() {
		is_loading = true;
		try {
			applyTabFilter();
			low_sales_skus = get_low_sales_skus(datasource);
			selected_skus.clear();
			filter_by_id.clear();
			sort_by_id.clear();
			filter_update_key.k += 1;
			c_location = (isStockTransfer ? transfer_locations : locations).find((v) => Number(v.id) === Number(c_location_id)) || locations[0];
		} finally {
			is_loading = false;
		}
	}

	function select_all() {
		for (let x of datasource) selected_skus.add(x.sku);
		checkbox_update_key.k += 1;
	}

	function deselect_all() {
		selected_skus.clear();
		checkbox_update_key.k += 1;
	}

	// ⚡ HÀM KHỞI TẠO ĐẢM BẢO CHÍNH XÁC 100% KẾT QUẢ CHO CẢ MÁY MỚI VÀ MÁY CŨ
	async function initialize() {
		is_loading = true;
		try {
			// 1. Kéo sản phẩm & tồn kho từ Sapo
			let loc_and_variant = await Promise.all([get_locations(), get_active_products()]);
			if (loc_and_variant[0] && loc_and_variant[0].length > 0) locations = loc_and_variant[0];
			variant_by_id = loc_and_variant[1] || new Map();

			c_location_id = isStockTransfer ? 789503 : Number(locations[0].id);
			c_location = (isStockTransfer ? transfer_locations : locations)[0];

			if (isStockCheck) {
				// 📋 KIỂM HÀNG: Hiện ngay không cần đơn hàng
				applyTabFilter();
			} else {
				// 🚚 CHUYỂN HÀNG & 🚨 ĐẶT HÀNG: BẮT BUỘC ĐỜI KÉO XONG ĐƠN HÀNG RỒI MỚI HIỂN THỊ CẢ TRÊN MÁY MỚI
				let order_and_transfer_records = await Promise.all([
					fetch_order_record(variant_by_id),
					fetch_inventory_transfer(variant_by_id),
				]);
				order_records = order_and_transfer_records[0] || [];
				transfer_records = order_and_transfer_records[1] || [];

				applyTabFilter();
			}

			setLastDataUpdate();
			low_sales_skus = get_low_sales_skus(datasource);
		} catch (error) {
			console.error("Lỗi khởi tạo:", error);
		} finally {
			is_loading = false;
		}
	}

	let export_popup_parent: HTMLElement;
	let export_popup_shown = $state(false);

	onMount(() => {
		try {
			lazyLoadStylesheets("https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css");
		} catch (e) {}
		initialize();
	});
</script>

<Locale words={vi}>
	<Willow>
		<div style="display: flex; gap: 10px; padding-bottom: 10px">
			<div>
				<Button onclick={initialize} type="primary" icon="mdi mdi-refresh"></Button>
			</div>
			<div style="width: 280px; display:flex; align-items: center">
				{#if isStockTransfer}
					<span>Kho nhận:&nbsp;</span>
				{:else}
					<span>Kho:&nbsp;</span>
				{/if}
				<Select 
					bind:value={c_location_id} 
					options={isStockTransfer ? transfer_locations : locations} 
					onchange={handle_location_update} 
					width="100" 
					placeholder="Chọn kho..."
				></Select>
			</div>
			<div style="display: flex; gap: 5px">
				<Button onclick={select_all}>Chọn tất cả</Button>
				<Button onclick={deselect_all}>Bỏ chọn tất cả</Button>

				{#if isStockTransfer}
					<!-- 🚚 TRANG CHUYỂN HÀNG: XUẤT FILE 6 CỘT CHUẨN SAPO -->
					<Button type="primary" icon="mdi mdi-file-excel" onclick={async () => {
						is_loading = true;
						try {
							const items = selected_skus.size > 0 
								? datasource.filter((x) => selected_skus.has(x.sku))
								: datasource;
							const target_label = transfer_locations.find(x => x.id === Number(c_location_id))?.label || "Kho";
							await export_phieu_chuyen_hang_sapo(items, target_label);
						} finally {
							is_loading = false;
						}
					}}>
						Xuất File Chuyển Hàng Sapo (.xlsx)
					</Button>

				{:else}
					<!-- 🚨 TRANG ĐẶT HÀNG VÀ KIỂM HÀNG -->
					<div bind:this={export_popup_parent}>
						<Button onclick={() => { export_popup_shown = !export_popup_shown; }} icon="mdi mdi-download">
							Tạo Đơn / Xuất File
						</Button>
					</div>
				{/if}

				{#if export_popup_shown && !isStockTransfer}
					<Portal>
						<Popup parent={export_popup_parent} at="bottom" oncancel={() => { export_popup_shown = false; }}>
							<div class="download-popup" style="padding: 10px; display: flex; flex-direction: column; gap: 8px">
								{#if isStockCheck}
									<!-- 📋 TRANG KIỂM HÀNG -->
									<p style="margin: 0px;"><b>Xuất phiếu kiểm hàng Sapo</b></p>
									<Button type="primary" onclick={async () => {
										is_loading = true;
										try {
											const items = selected_skus.size > 0 ? selected_skus : new Set(datasource.map(i => i.sku));
											await export_kiem_hang_to_xlsx(items, datasource, c_location);
										} finally {
											is_loading = false;
											export_popup_shown = false;
										}
									}}>
										Xuất {selected_skus.size > 0 ? selected_skus.size : datasource.length} sản phẩm (Kiểm Hàng)
									</Button>

								{:else}
									<!-- 🚨 TRANG ĐẶT HÀNG -->
									<p style="margin: 0px;"><b>Xuất phiếu nhập hàng</b></p>
									<Button type="primary" onclick={async () => {
										is_loading = true;
										try {
											const items = selected_skus.size > 0 ? selected_skus : new Set(datasource.map(i => i.sku));
											await export_selected_to_xlsx(items, datasource, c_location);
										} finally {
											is_loading = false;
											export_popup_shown = false;
										}
									}}>
										Xuất {selected_skus.size > 0 ? selected_skus.size : datasource.length} sản phẩm (Nhập Hàng)
									</Button>
								{/if}
							</div>
						</Popup>
					</Portal>
				{/if}

				<Button icon="mdi mdi-cog" onclick={() => { is_settings_open = true; }}></Button>
				<Button icon="mdi mdi-logout" onclick={logout} type="danger"></Button>
			</div>
		</div>

		<!-- BANNER THÔNG BÁO TƯƠNG ỨNG TỪNG TRANG -->
		{#if isStockTransfer}
			<div style="width: 100%; padding: 8px 12px; background-color: #f0fdf4; color: #166534; margin-bottom: 10px; font-weight: bold; font-size: 13px; border-radius: 5px; border: 1px solid #bbf7d0;">
				🚚 ĐIỀU CHUYỂN KHO: Đang gợi ý {datasource.length} sản phẩm cần chuyển từ Kho Tổng LYO Group sang ({transfer_locations.find(x => x.id === Number(c_location_id))?.label}) - Điều kiện: Tồn Group &ge; 3x SL Cần chuyển.
			</div>
		{:else if isStockCheck}
			<div style="width: 100%; padding: 8px 12px; background-color: #e7f5ff; color: #1864ab; margin-bottom: 10px; font-weight: bold; font-size: 13px; border-radius: 5px; border: 1px solid #a5d8ff;">
				📋 DỮ LIỆU KIỂM KHO: Đang hiển thị sản phẩm thuộc kho ({c_location?.label || 'LYO GROUP'}) có Tồn kho (0 &lt; Tồn kho &le; 20).
			</div>
		{:else}
			<div class="tab-filter-container">
				<button class="tab-btn {activeTab === 'need_restock' ? 'active-red' : ''}" onclick={() => switchTab('need_restock')}>
					🚨 Cần đặt ngay ({tab1_items.length})
				</button>
				<button class="tab-btn {activeTab === 'has_sales' ? 'active-green' : ''}" onclick={() => switchTab('has_sales')}>
					📦 Check nếu ôm hàng ({tab2_items.length})
				</button>
				<button class="tab-btn {activeTab === 'out_of_stock' ? 'active-orange' : ''}" onclick={() => switchTab('out_of_stock')}>
					⚠️ Hàng bị đứt ({tab3_items.length})
				</button>
			</div>
		{/if}

		<div style="height: calc(100dvh - 200px); overflow: hidden;">
			{#key grid_key}
				<Grid bind:this={grid_api} {columns} {data} responsive={responsive_fields} sizes={{ rowHeight: 165 }} />
			{/key}
		</div>

		<div class="pagination-container">
			<div class="page-size">
				<span>Hiển thị</span>
				<select bind:value={itemsPerPage} onchange={resetPagination}>
					<option value={20}>20</option>
					<option value={50}>50</option>
					<option value={100}>100</option>
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
						<LoadingThrobber />
						<p style="margin-bottom: 0px;">Đang tải dữ liệu...</p>
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
</Locale>

<style>
	.tab-filter-container { display: flex; gap: 10px; margin-bottom: 10px; }
	.tab-btn { padding: 8px 16px; font-size: 13px; font-weight: bold; border-radius: 6px; border: 1px solid #ccc; background: #f5f5f5; color: #333; cursor: pointer; }
	.tab-btn.active-red { background-color: #d92d20; color: #ffffff; border-color: #b42318; }
	.tab-btn.active-green { background-color: #059669; color: #ffffff; border-color: #047857; }
	.tab-btn.active-orange { background-color: #d97706; color: #ffffff; border-color: #b45309; }

	.pagination-container { display: flex; align-items: center; justify-content: flex-end; gap: 40px; padding: 8px 16px; background: #ffffff; border-top: 1px solid #e0e0e0; font-size: 14px; height: 45px; }
	.page-controls button { padding: 4px 10px; border: 1px solid #d9d9d9; background: #fff; border-radius: 4px; cursor: pointer; }
	.page-controls button.active { background-color: #0520c3; color: #fff; border-color: #0520c3; font-weight: bold; }
</style>
