<script lang="ts">
	// @ts-ignore
	import { Grid, Willow } from "wx-svelte-grid";
	// @ts-ignore
	import { Button, Portal, Modal } from "wx-svelte-core";
	// @ts-ignore
	import { Locale } from "wx-svelte-core";
	import {
		get_active_products,
		fetch_order_record,
		type ProductV2,
		TARGET_LOCATION_ID_GROUP
	} from "../dashboard/DataPipelineV2";
	import SelectionCheckboxCell from "../dashboard/SelectionCheckboxCell.svelte";
	import ImageCell from "../dashboard/ImageCell.svelte";
	import NameCell from "../dashboard/NameCell.svelte";
	import { vi } from "../dashboard/Localization";
	import { onMount, setContext } from "svelte";
	import { lazyLoadStylesheets, lazyLoadScript } from "../dashboard/lazyLoadScript";
	import LoadingThrobber from "../dashboard/LoadingThrobber.svelte";
	import HeaderWithSortUi from "../dashboard/HeaderWithSortUI.svelte";

	// ID 2 Kho Chi Nhánh
	const ID_BA_TRIEU = 789503;
	const ID_PVD = 789504;

	interface TransferItem extends ProductV2 {
		stock_group: number;
		stock_bt: number;
		sales_bt: number;
		suggest_bt: number;
		stock_pvd: number;
		sales_pvd: number;
		suggest_pvd: number;
	}

	const columns = [
		{ id: "id", hidden: true },
		{ id: "selected", cell: SelectionCheckboxCell, width: 36 },
		{ id: "sku", resize: true, width: 120, header: [{ cell: HeaderWithSortUi, text: "SKU" }] },
		{ id: "name", resize: true, width: 220, cell: NameCell, header: [{ cell: HeaderWithSortUi, text: "Tên sản phẩm" }] },
		{ id: "image", header: "Ảnh", cell: ImageCell },
		{ id: "stock_group", resize: true, width: 110, header: [{ cell: HeaderWithSortUi, text: "Tồn Kho\nGroup" }] },
		
		// Nhóm Bà Triệu
		{ id: "stock_bt", resize: true, width: 100, header: [{ cell: HeaderWithSortUi, text: "Tồn kho\nBà Triệu" }] },
		{ id: "sales_bt", resize: true, width: 100, header: [{ cell: HeaderWithSortUi, text: "Bán 30d\nBà Triệu" }] },
		{ id: "suggest_bt", resize: true, width: 110, header: [{ cell: HeaderWithSortUi, text: "🚨 Cần chuyển\nBà Triệu" }] },

		// Nhóm Phạm Văn Đồng
		{ id: "stock_pvd", resize: true, width: 100, header: [{ cell: HeaderWithSortUi, text: "Tồn kho\nPVĐ" }] },
		{ id: "sales_pvd", resize: true, width: 100, header: [{ cell: HeaderWithSortUi, text: "Bán 30d\nPVĐ" }] },
		{ id: "suggest_pvd", resize: true, width: 110, header: [{ cell: HeaderWithSortUi, text: "🚨 Cần chuyển\nPVĐ" }] },
	];

	const filter_by_id = $state(new Map());
	const sort_by_id = $state(new Map());
	setContext("filterbyid", filter_by_id);
	setContext("sortbyid", sort_by_id);

	let datasource: TransferItem[] = $state([]);
	let data: TransferItem[] = $state([]);

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
	let grid_key = $state(0);
	let selected_skus = $state(new Set<string>());
	let checkbox_update_key = $state({ k: 0 });
	let filter_update_key = $state({ k: 0 });

	setContext("selected_skus", selected_skus);
	setContext("checkbox_key", checkbox_update_key);
	setContext("filter_update_key", filter_update_key);

	async function initialize() {
		is_loading = true;
		try {
			const [variant_by_id, order_records] = await Promise.all([
				get_active_products(),
				fetch_order_record(new Map())
			]);

			// Tính sản lượng bán 30 ngày cho từng kho
			const sales_map = new Map<string, { bt: number; pvd: number }>();
			const now_ts = new Date().getTime();
			const min_valid_ts = now_ts - (30 * 24 * 60 * 60 * 1000);

			order_records.forEach((r) => {
				if (r.t_unix >= min_valid_ts && r.t_unix <= now_ts) {
					const sku = (r.sku || "").trim().toLowerCase();
					if (!sales_map.has(sku)) sales_map.set(sku, { bt: 0, pvd: 0 });
					const item = sales_map.get(sku)!;

					if (Number(r.location_id) === ID_BA_TRIEU) item.bt += (Number(r.quantity) || 0);
					if (Number(r.location_id) === ID_PVD) item.pvd += (Number(r.quantity) || 0);
				}
			});

			// Lọc sản phẩm có Tồn Group > 0 & Tính gợi ý điều chuyển
			let list: TransferItem[] = [];

			variant_by_id.forEach((v) => {
				if (v.is_composite) return;

				const inv_group = v.inventory_level_by_location.get(TARGET_LOCATION_ID_GROUP);
				const stock_group = inv_group ? Math.max(0, Math.round(inv_group.available ?? inv_group.on_hand ?? 0)) : 0;

				if (stock_group > 0) {
					const inv_bt = v.inventory_level_by_location.get(ID_BA_TRIEU);
					const stock_bt = inv_bt ? Math.max(0, Math.round(inv_bt.available ?? inv_bt.on_hand ?? 0)) : 0;

					const inv_pvd = v.inventory_level_by_location.get(ID_PVD);
					const stock_pvd = inv_pvd ? Math.max(0, Math.round(inv_pvd.available ?? inv_pvd.on_hand ?? 0)) : 0;

					const clean_sku = (v.sku || "").trim().toLowerCase();
					const sales_data = sales_map.get(clean_sku) || { bt: 0, pvd: 0 };

					const need_bt = Math.round(sales_data.bt * 0.5);
					const suggest_bt = Math.min(stock_group, Math.max(0, need_bt - stock_bt));

					const need_pvd = Math.round(sales_data.pvd * 0.5);
					const suggest_pvd = Math.min(stock_group, Math.max(0, need_pvd - stock_pvd));

					list.push({
						...v,
						stock_group,
						stock_bt,
						sales_bt: sales_data.bt,
						suggest_bt,
						stock_pvd,
						sales_pvd: sales_data.pvd,
						suggest_pvd
					});
				}
			});

			datasource = list.sort((a, b) => (b.suggest_bt + b.suggest_pvd) - (a.suggest_bt + a.suggest_pvd));
			resetPagination();
			grid_key++;
		} catch (e) {
			console.error("Lỗi khởi tạo Chuyển Hàng:", e);
		} finally {
			is_loading = false;
		}
	}

	async function export_transfer_sheets_custom(items: any[]) {
		await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js", "sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==");
		await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.0/FileSaver.min.js", "sha512-csNcFYJniKjJxRWRV1R7fvnXrycHP6qDR21mgz1ZP55xY5d+aHLfo9/FcGDQLfn2IfngbAHd8LdfsagcCqgTcQ==");

		// @ts-ignore
		const wb = new ExcelJS.Workbook();

		const ws1 = wb.addWorksheet('Chuyen_146_Ba_Trieu');
		ws1.getRow(1).values = ["Mã SKU", "Tên sản phẩm", "Tồn Group", "Bán 30d Bà Triệu", "SL Chuyển sang Bà Triệu"];
		ws1.getRow(1).font = { bold: true };

		const ws2 = wb.addWorksheet('Chuyen_180_Pham_Van_Dong');
		ws2.getRow(1).values = ["Mã SKU", "Tên sản phẩm", "Tồn Group", "Bán 30d PVĐ", "SL Chuyển sang PVĐ"];
		ws2.getRow(1).font = { bold: true };

		let r1 = 2, r2 = 2;
		items.forEach((item) => {
			if (item.suggest_bt > 0) {
				ws1.getRow(r1++).values = [item.sku, item.name, item.stock_group, item.sales_bt, item.suggest_bt];
			}
			if (item.suggest_pvd > 0) {
				ws2.getRow(r2++).values = [item.sku, item.name, item.stock_group, item.sales_pvd, item.suggest_pvd];
			}
		});

		ws1.getColumn(1).width = 20; ws1.getColumn(2).width = 45; ws1.getColumn(5).width = 25;
		ws2.getColumn(1).width = 20; ws2.getColumn(2).width = 45; ws2.getColumn(5).width = 25;

		const wb_buffer = await wb.xlsx.writeBuffer();
		const blob = new Blob([wb_buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

		const date_str = new Date().toISOString().slice(0, 10).replace(/-/g, "");
		// @ts-ignore
		saveAs(blob, `Phieu_Chuyen_Hang_Noi_Bo_${date_str}.xlsx`);
	}

	function select_all() {
		datasource.forEach((x) => selected_skus.add(x.sku));
		checkbox_update_key.k += 1;
	}

	function deselect_all() {
		selected_skus.clear();
		checkbox_update_key.k += 1;
	}

	onMount(async () => {
		lazyLoadStylesheets("https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css");
		await initialize();
	});
</script>

<svelte:head>
	<title>LYO Dự Báo - Chuyển Hàng</title>
</svelte:head>

<Locale words={vi}>
	<Willow>
		<div style="display: flex; gap: 10px; padding-bottom: 10px">
			<Button onclick={initialize} type="primary" icon="mdi mdi-refresh"></Button>
			
			<div style="display: flex; gap: 5px">
				<Button onclick={select_all}>Chọn tất cả</Button>
				<Button onclick={deselect_all}>Bỏ chọn tất cả</Button>

				<Button 
					type="primary" 
					icon="mdi mdi-truck-delivery"
					onclick={async () => {
						is_loading = true;
						try {
							const items = selected_skus.size > 0 
								? datasource.filter((x) => selected_skus.has(x.sku))
								: datasource;
							await export_transfer_sheets_custom(items);
						} finally {
							is_loading = false;
						}
					}}
				>
					Xuất File Chuyển Hàng Sapo (.xlsx)
				</Button>
			</div>
		</div>

		<div style="width: 100%; padding: 8px 12px; background-color: #f0fdf4; color: #166534; margin-bottom: 10px; font-weight: bold; font-size: 13px; border-radius: 5px; border: 1px solid #bbf7d0;">
			🚚 BÁO CÁO CHUYỂN HÀNG NỘI BỘ: Đang hiển thị {datasource.length} sản phẩm có Tồn kho tại Kho Tổng LYO Group & Gợi ý số lượng cần điều chuyển sang 2 chi nhánh.
		</div>

		<div style="height: calc(100dvh - 200px); overflow: hidden;">
			{#key grid_key}
				<Grid {columns} {data} sizes={{ rowHeight: 165 }} />
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
				Từ <b>{(currentPage - 1) * itemsPerPage + 1}</b> đến <b>{Math.min(currentPage * itemsPerPage, datasource.length)}</b> / <b>{datasource.length}</b> kết quả
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
						<p style="margin-bottom: 0px;">Đang tải dữ liệu chuyển hàng...</p>
					</div>
				</Modal>
			</Portal>
		{/if}
	</Willow>
</Locale>

<style>
	.pagination-container {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 40px;
		padding: 8px 16px;
		background: #ffffff;
		border-top: 1px solid #e0e0e0;
		font-size: 14px;
		height: 45px;
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
</style>
