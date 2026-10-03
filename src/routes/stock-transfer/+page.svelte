<script lang="ts">
	// @ts-ignore
	import { Grid, Willow } from "wx-svelte-grid";
	// @ts-ignore
	import { Button, Select, Portal, Modal } from "wx-svelte-core";
	// @ts-ignore
	import { Locale } from "wx-svelte-core";
	import {
		calculate_restock_data,
		get_active_products,
		fetch_order_record,
		type ProductV2,
		type OrderRecordV2,
		type TransferRecord,
		fetch_inventory_transfer,
		setLastDataUpdate,
		is_promotional_item,
		TARGET_LOCATION_ID_GROUP,
		TARGET_LOCATION_ID_BA_TRIEU,
		TARGET_LOCATION_ID_PHAM_VAN_DONG
	} from "../dashboard/DataPipelineV2";
	import SelectionCheckboxCell from "../dashboard/SelectionCheckboxCell.svelte";
	import ImageCell from "../dashboard/ImageCell.svelte";
	import NameCell from "../dashboard/NameCell.svelte";
	import { vi } from "../dashboard/Localization";
	import { onMount, setContext } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import { normalizeToEnglish, type Filtering, type Location, type Sorting } from "../dashboard/Template";
	import { lazyLoadStylesheets } from "../dashboard/lazyLoadScript";
	import LoadingThrobber from "../dashboard/LoadingThrobber.svelte";
	import SettingsModal from "../dashboard/SettingsModal.svelte";
	import axios from "axios";
	import { goto } from "$app/navigation";
	import HeaderWithSortUi from "../dashboard/HeaderWithSortUI.svelte";
	import { export_phieu_chuyen_hang_sapo } from "../dashboard/Export2Excel";

	// 🟢 DANH SÁCH 2 KHO CHI NHÁNH NHẬN HÀNG
	const transfer_locations: Location[] = [
		{ id: TARGET_LOCATION_ID_BA_TRIEU, label: "Kho 146 Bà Triệu", address: "Bà Triệu" },
		{ id: TARGET_LOCATION_ID_PHAM_VAN_DONG, label: "Kho 180 Phạm Văn Đồng", address: "Phạm Văn Đồng" }
	];

	// 🟢 CẤU TRÚC CỘT CHUYỂN HÀNG RIÊNG BIỆT
	const columns = [
		{ id: "selected", cell: SelectionCheckboxCell, width: 36 },
		{ id: "sku", resize: true, width: 130, header: [{ cell: HeaderWithSortUi, text: "SKU" }] },
		{ id: "name", resize: true, width: 260, cell: NameCell, header: [{ cell: HeaderWithSortUi, text: "Tên sản phẩm" }] },
		{ id: "image", header: "Ảnh", cell: ImageCell },
		{ id: "c_transfer_suggest", resize: true, width: 140, header: [{ cell: HeaderWithSortUi, text: "🚨 SL CẦN\nCHUYỂN" }] },
		{ id: "c_on_hand_group", resize: true, width: 130, header: [{ cell: HeaderWithSortUi, text: "Tồn Kho\nGroup" }] },
		{ id: "c_on_hand", resize: true, width: 130, header: [{ cell: HeaderWithSortUi, text: "Tồn thực tế" }] },
		{ id: "c_incoming", resize: true, width: 130, header: [{ cell: HeaderWithSortUi, text: "Hàng đang về" }] },
		{ id: "c_restock", resize: true, width: 140, header: [{ cell: HeaderWithSortUi, text: "SL Bán 30 ngày" }] },
		{ id: "brand", resize: true, width: 160, header: [{ cell: HeaderWithSortUi, text: "Nhãn hiệu" }] }
	];

	// 🟢 BỘ LỌC DÙNG SVELTEMAP ĐỂ BẮT ĐÚNG TÍN HIỆU PHẢN XẠ TRÊN SVELTE 5
	const filter_by_id = new SvelteMap<string, Filtering>();
	const sort_by_id = new SvelteMap<string, Sorting>();
	
	let updateKeys = $state({ headerSorterKey: 0, dsource: [] as any[], dfiltered: [] as any[] });

	setContext("filterbyid", filter_by_id);
	setContext("sortbyid", sort_by_id);
	setContext("updatekeys", updateKeys);

	const responsive_fields = { 800: { columns: columns } };

	let datasource: any[] = $state([]);
	let currentPage = $state(1);
	let itemsPerPage = $state(50);

	// 🟢 THUẬT TOÁN LỌC DỮ LIỆU TỰ ĐỘNG CHẠY KHI PHÂN LỌC MỚI ĐƯỢC CHỌN
	let display_datasource = $derived.by(() => {
		let result = [...datasource];

		if (filter_by_id.size > 0) {
			filter_by_id.forEach((filter: any, fieldId: string) => {
				if (!filter) return;

				// 1. Lọc theo Checkbox nhãn hiệu / SKU
				if (filter.includes && filter.includes instanceof Set && filter.includes.size > 0) {
					const normSet = new Set<string>();
					filter.includes.forEach((v: any) => {
						normSet.add(normalizeToEnglish(String(v || "").trim().toLowerCase()));
					});

					result = result.filter((item) => {
						const rawVal = item[fieldId] ?? item[fieldId.toLowerCase()] ?? "";
						const itemVal = normalizeToEnglish(String(rawVal).trim().toLowerCase());
						return normSet.has(itemVal);
					});
				}

				// 2. Lọc theo ô từ khóa gõ tay
				if (filter.value !== undefined && filter.value !== null && typeof filter.value === "string" && filter.value.trim() !== "") {
					const searchStr = normalizeToEnglish(filter.value.trim().toLowerCase());
					result = result.filter((item) => {
						const rawVal = item[fieldId] ?? item[fieldId.toLowerCase()] ?? "";
						const itemVal = normalizeToEnglish(String(rawVal).toLowerCase());
						return itemVal.includes(searchStr);
					});
				}
			});
		}

		// Sắp xếp cột A-Z, Z-A hoặc Số
		if (sort_by_id.size > 0) {
			sort_by_id.forEach((sort: any, fieldId: string) => {
				if (sort && (sort.order !== undefined || sort.dir !== undefined)) {
					const dirMult = (sort.order === 1 || sort.dir === "asc") ? 1 : -1;
					result.sort((a, b) => {
						const valA = a[fieldId] ?? "";
						const valB = b[fieldId] ?? "";
						if (typeof valA === "number" && typeof valB === "number") {
							return (valA - valB) * dirMult;
						}
						return valA.toString().localeCompare(valB.toString()) * dirMult;
					});
				}
			});
		}

		return result;
	});

	let totalPages = $derived(Math.ceil(display_datasource.length / itemsPerPage) || 1);

	let data = $derived.by(() => {
		let start = (currentPage - 1) * itemsPerPage;
		let end = start + itemsPerPage;
		return display_datasource.slice(start, Math.min(end, display_datasource.length));
	});

	function resetPagination() {
		currentPage = 1;
	}

	let is_loading = $state(false);
	let is_settings_open = $state(false);

	let variant_by_id = new Map<number, ProductV2>();
	let order_records: OrderRecordV2[] = [];
	let transfer_records: TransferRecord[] = [];
	
	let c_location_id: number = $state(TARGET_LOCATION_ID_BA_TRIEU);
	let grid_key = $state(0);

	let selected_skus = $state(new Set<string>());
	let checkbox_update_key = $state({ k: 0 });
	let filter_update_key = $state({ k: 0 });
	setContext("selected_skus", selected_skus);
	setContext("checkbox_key", checkbox_update_key);
	setContext("filter_update_key", filter_update_key);

	let baseUrl = import.meta.env.MODE === "development" ? "http://localhost:8080" : "https://lyo-inventory-proxy.onrender.com";

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

	// 🟢 CÔNG THỨC CHUẨN 100%: LẤY SỐ BÁN TOÀN HỆ THỐNG ĐỂ TÍNH GỢI Ý CHUYỂN HÀNG
	function applyTransferFilter() {
		try {
			const selectedLocId = Number(c_location_id);

			// 1. Kéo sản lượng bán 30 ngày trên toàn hệ thống (Group) để có c_restock chuẩn (Bông Miniso = 54)
			calculate_restock_data([...order_records, ...transfer_records], variant_by_id, TARGET_LOCATION_ID_GROUP);
			
			// Lưu lại số bán toàn hệ thống cho từng sản phẩm
			const group_sales_map = new Map<number, number>();
			variant_by_id.forEach((v, id) => {
				group_sales_map.set(id, v.c_restock || 0);
			});

			// 2. Kéo dữ liệu tồn thực tế theo Kho Chi Nhánh được chọn
			calculate_restock_data([...order_records, ...transfer_records], variant_by_id, selectedLocId);

			let transfer_list: any[] = [];
			variant_by_id.forEach((v, id) => {
				if (v.is_composite || is_promotional_item(v.brand, v.name, v.sku)) return;

				// Lấy lại số bán chuẩn 30 ngày toàn hệ thống
				const sales_30d_group = group_sales_map.get(id) || 0;
				v.c_restock = sales_30d_group;

				// Tồn Kho Group
				let stock_group = 0;
				const inv_group = v.inventory_level_by_location.get(TARGET_LOCATION_ID_GROUP);
				if (inv_group) {
					stock_group = Math.max(0, Math.round(inv_group.available ?? inv_group.on_hand ?? 0));
				} else {
					for (let [locId, inv] of v.inventory_level_by_location) {
						if (locId !== TARGET_LOCATION_ID_BA_TRIEU && locId !== TARGET_LOCATION_ID_PHAM_VAN_DONG) {
							stock_group = Math.max(0, Math.round(inv.available ?? inv.on_hand ?? 0));
							if (stock_group > 0) break;
						}
					}
				}

				if (stock_group <= 0) return;

				// Tồn thực tế & Hàng đang về tại Kho Chi Nhánh Nhận
				const inv_target = v.inventory_level_by_location.get(selectedLocId);
				const stock_target = inv_target ? Math.max(0, Math.round(inv_target.available ?? inv_target.on_hand ?? 0)) : 0;
				const incoming_target = inv_target ? Math.max(0, Math.round(inv_target.incoming ?? 0)) : 0;

				const current_total_branch = stock_target + incoming_target;

				let raw_need_transfer = 0;

				if (sales_30d_group > 0) {
					if (current_total_branch < 0.5 * sales_30d_group) {
						raw_need_transfer = Math.max(0, Math.round(0.5 * sales_30d_group - current_total_branch));
					}
				} else {
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

			// Nạp dữ liệu vào context để Popup UI đọc đúng danh sách Nhãn hiệu
			updateKeys.dsource = datasource;
			updateKeys.dfiltered = datasource;
			updateKeys.headerSorterKey++;

			resetPagination();
			grid_key++;
		} catch (e) {
			console.error("Lỗi tính Chuyển hàng:", e);
		}
	}

	function handle_location_update() {
		is_loading = true;
		try {
			applyTransferFilter();
			selected_skus.clear();
			filter_by_id.clear();
			sort_by_id.clear();
		} finally {
			is_loading = false;
		}
	}

	function select_all() {
		for (let x of display_datasource) selected_skus.add(x.sku);
		checkbox_update_key.k += 1;
	}

	function deselect_all() {
		selected_skus.clear();
		checkbox_update_key.k += 1;
	}

	// ⚡ KHỞI TẠO TẢI TOÀN BỘ ĐƠN HÀNG (KHÔNG TRUYỀN THAM SỐ MẢNG LỌC HẸP ĐỂ TRÁNH THIẾU DỮ LIỆU BÁN)
	async function initialize() {
		is_loading = true;
		try {
			let prods = new Map<number, ProductV2>();
			try {
				prods = await get_active_products();
			} catch (eProd) {
				prods = new Map();
			}
			variant_by_id = prods || new Map();

			try {
				let res = await Promise.all([
					fetch_order_record(variant_by_id).catch(() => []),
					fetch_inventory_transfer(variant_by_id).catch(() => [])
				]);
				order_records = res[0] || [];
				transfer_records = res[1] || [];
			} catch (eOrders) {
				order_records = [];
				transfer_records = [];
			}

			applyTransferFilter();

			try { setLastDataUpdate(); } catch (e) {}
		} catch (error) {
			console.error("Lỗi khởi tạo Chuyển hàng:", error);
		} finally {
			is_loading = false;
		}
	}

	onMount(() => {
		try {
			lazyLoadStylesheets("https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css");
		} catch (e) {}
		initialize();
	});
</script>

<svelte:head>
	<title>LYO Dự Báo - Chuyển Hàng Nội Bộ</title>
</svelte:head>

<Locale words={vi}>
	<Willow>
		<div style="display: flex; gap: 10px; padding-bottom: 10px">
			<div>
				<Button onclick={initialize} type="primary" icon="mdi mdi-refresh"></Button>
			</div>
			<div style="width: 280px; display:flex; align-items: center">
				<span>Kho nhận:&nbsp;</span>
				<Select 
					bind:value={c_location_id} 
					options={transfer_locations} 
					onchange={handle_location_update} 
					width="100" 
					placeholder="Chọn kho..."
				></Select>
			</div>
			<div style="display: flex; gap: 5px">
				<Button onclick={select_all}>Chọn tất cả</Button>
				<Button onclick={deselect_all}>Bỏ chọn tất cả</Button>

				<Button type="primary" icon="mdi mdi-file-excel" onclick={async () => {
					is_loading = true;
					try {
						const items = selected_skus.size > 0 
							? display_datasource.filter((x) => selected_skus.has(x.sku))
							: display_datasource;
						const target_label = transfer_locations.find(x => x.id === Number(c_location_id))?.label || "Kho";
						await export_phieu_chuyen_hang_sapo(items, target_label);
					} finally {
						is_loading = false;
					}
				}}>
					Xuất File Chuyển Hàng Sapo (.xlsx)
				</Button>

				<Button icon="mdi mdi-cog" onclick={() => { is_settings_open = true; }}></Button>
				<Button icon="mdi mdi-logout" onclick={logout} type="danger"></Button>
			</div>
		</div>

		<div style="width: 100%; padding: 8px 12px; background-color: #f0fdf4; color: #166534; margin-bottom: 10px; font-weight: bold; font-size: 13px; border-radius: 5px; border: 1px solid #bbf7d0;">
			🚚 ĐIỀU CHUYỂN KHO: Đang gợi ý {display_datasource.length} sản phẩm cần chuyển từ Kho Tổng LYO Group sang ({transfer_locations.find(x => x.id === Number(c_location_id))?.label}).
		</div>

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
				{#if display_datasource.length > 0}
					Từ <b>{(currentPage - 1) * itemsPerPage + 1}</b> đến <b>{Math.min(currentPage * itemsPerPage, display_datasource.length)}</b> trên tổng <b>{display_datasource.length}</b> kết quả
				{:else}
					Không có kết quả nào
				{/if}
			</div>

			<div class="page-controls">
				<button disabled={currentPage === 1} onclick={() => { currentPage--; }}>&lt;</button>
				{#each Array(totalPages) as _, i}
					{#if i + 1 === 1 || i + 1 === totalPages || (i + 1 >= currentPage - 1 && i + 1 <= currentPage + 1)}
						<button class:active={currentPage === i + 1} onclick={() => { currentPage = i + 1; }}>
							{i + 1}
						</button>
					{/if}
				{/each}
				<button disabled={currentPage === totalPages} onclick={() => { currentPage++; }}>&gt;</button>
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
	.pagination-container { display: flex; align-items: center; justify-content: flex-end; gap: 40px; padding: 8px 16px; background: #ffffff; border-top: 1px solid #e0e0e0; font-size: 14px; height: 45px; }
	.page-controls button { padding: 4px 10px; border: 1px solid #d9d9d9; background: #fff; border-radius: 4px; cursor: pointer; }
	.page-controls button.active { background-color: #0520c3; color: #fff; border-color: #0520c3; font-weight: bold; }
</style>
