import { calculate_restock_data, type OrderRecordV2, type ProductV2, type TransferRecord } from "./DataPipelineV2";
import { imageToArrayBuffer } from "./imageToByteArray";
import { lazyLoadScript } from "./lazyLoadScript";
import { type Location } from "./Template";

// 🟢 TỰ ĐỊNH NGHĨA HÀM CHUYỂN ĐỔI CHUỖI KHÔNG DẤU
function normalizeString(input: string): string {
	if (!input) return "";
	return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
}

// 🟢 1. HÀM XUẤT PHIẾU KIỂM HÀNG CHUẨN MẪU SAPO (6 CỘT)
export async function export_kiem_hang_to_xlsx(
	selected_skus: Set<string>, 
	datasource: ProductV2[], 
	location: Location
) {
	await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js", "sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==");
	await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.0/FileSaver.min.js", "sha512-csNcFYJniKjJxRWRV1R7fvnXrycHP6qDR21mgz1ZP55xY5d+aHLfo9/FcGDQLfn2IfngbAHd8LdfsagcCqgTcQ==");

	const items = (selected_skus && selected_skus.size > 0)
		? datasource.filter((item) => selected_skus.has(item.sku))
		: datasource;

	// @ts-ignore
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Sheet 1');

	ws.getRow(1).values = ["Phiếu kiểm hàng", "", "", "", "", ""];
	ws.getRow(1).font = { bold: true, size: 14 };
	ws.getRow(2).values = ["Mã phiếu:", "", "", "", "", ""];

	ws.getRow(4).values = ["Mã SKU*", "Tên sản phẩm", "Mã lô", "Tồn thực tế", "Lý do", "Ghi chú"];
	ws.getRow(4).font = { bold: true };

	for (let i = 0; i < items.length; i++) {
		const v = items[i];
		const stock_actual = v.c_on_hand ?? v.c_available ?? 0;
		ws.getRow(i + 5).values = [v.sku || "", v.name || "", "", stock_actual, "", ""];
	}

	ws.getColumn(1).width = 20;
	ws.getColumn(2).width = 50;
	ws.getColumn(3).width = 15;
	ws.getColumn(4).width = 15;
	ws.getColumn(5).width = 20;
	ws.getColumn(6).width = 20;

	const wb_buffer = await wb.xlsx.writeBuffer();
	const blob = new Blob([wb_buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

	const normalized_branch = normalizeString(location?.label || "Kho");
	const t = new Date();
	const time_str = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}_${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}`;

	// @ts-ignore
	saveAs(blob, `Kiem_hang_${normalized_branch}_${time_str}.xlsx`);
}

// 🟢 2. HÀM XUẤT CHO NHẬP HÀNG (CÓ CHỌN / ĐANG LỌC)
export async function export_selected_to_xlsx(
	selected_skus: Set<string>, 
	datasource: ProductV2[], 
	location: Location, 
	is_check_mode = false,
	skip_images = false
) {
	if (selected_skus.size > 0) {
		const x = datasource.filter((x) => { return selected_skus.has(x.sku) })
		await _actual_export_handler(x, location, false, is_check_mode, skip_images)
	} else {
		if (await _actual_export_handler(datasource, location, false, is_check_mode, skip_images) == false) {
			alert("Gặp lỗi khi xuất file")
		}
	}
}

// 🟢 3. HÀM XUẤT TOÀN BỘ SẢN PHẨM TRONG KHO (NHẬP HÀNG)
export async function export_all_to_xlsx(
	order_records: OrderRecordV2[], 
	transfer_records: TransferRecord[], 
	variant_by_id: Map<number, ProductV2>, 
	c_location_id: number, 
	location: Location, 
	is_check_mode = false,
	skip_images = false
) {
	const success = await _actual_export_handler(calculate_restock_data(
		[...order_records, ...transfer_records],
		variant_by_id,
		c_location_id,
	), location, false, is_check_mode, skip_images);

	if (!success) {
		alert("Gặp lỗi khi xuất file")
	}
}

// 🟢 4. HÀM XUẤT CHUYỂN HÀNG CŨ
export async function export_transfer_sheet_to_xlsx(
	order_records: OrderRecordV2[], 
	transfer_records: TransferRecord[], 
	variant_by_id: Map<number, ProductV2>, 
	locations: Location[],
	skip_images = false
) {
	const x = calculate_restock_data(
		[...order_records, ...transfer_records],
		variant_by_id,
		locations[0].id,
	).filter((x) => {
		return x.c_on_hand > 0
	})

	if (await _actual_export_handler(x, locations[0], true, false, skip_images) == false) {
		alert("Gặp lỗi khi xuất file")
	}
}

// 🟢 5. HÀM XUẤT PHIẾU CHUYỂN HÀNG SAPO CHUẨN NGUYÊN MẪU (DÒNG 1: MÃ PHIẾU, DÒNG 2: TRỐNG, DÒNG 3: CỘT TIÊU ĐỀ)
export async function export_phieu_chuyen_hang_sapo(
	items: any[], 
	target_location_label: string
) {
	await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js", "sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==");
	await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.0/FileSaver.min.js", "sha512-csNcFYJniKjJxRWRV1R7fvnXrycHP6qDR21mgz1ZP55xY5d+aHLfo9/FcGDQLfn2IfngbAHd8LdfsagcCqgTcQ==");

	// @ts-ignore
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Sheet0');

	// Dòng 1: Mã phiếu chuyển hàng (A1)
	ws.getRow(1).values = ["Mã phiếu chuyển hàng", "", "", "", "", ""];
	
	// Dòng 2: Để trống hoàn toàn chuẩn mẫu Sapo
	ws.getRow(2).values = ["", "", "", "", "", ""];

	// Dòng 3: Cột tiêu đề chuẩn 6 cột Sapo
	ws.getRow(3).values = ["Mã SKU *", "Tên sản phẩm", "Serial/IMEI", "Mã lô", "Số lượng chuyển", "Giá chuyển"];
	ws.getRow(3).font = { bold: true };

	// Dòng 4 trở đi: Dữ liệu sản phẩm
	for (let i = 0; i < items.length; i++) {
		const v = items[i];
		const qty_transfer = v.c_transfer_suggest ?? 0;
		ws.getRow(i + 4).values = [
			v.sku || "",
			v.name || "",
			"", // Serial/IMEI để trống
			"", // Mã lô để trống
			qty_transfer,
			""  // Giá chuyển để trống
		];
	}

	ws.getColumn(1).width = 20;
	ws.getColumn(2).width = 50;
	ws.getColumn(3).width = 15;
	ws.getColumn(4).width = 15;
	ws.getColumn(5).width = 18;
	ws.getColumn(6).width = 15;

	const wb_buffer = await wb.xlsx.writeBuffer();
	const blob = new Blob([wb_buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

	const normalized_name = normalizeString(target_location_label);
	const t = new Date();
	const date_str = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}_${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}`;
	
	// @ts-ignore
	saveAs(blob, `Phieu_Chuyen_Hang_${normalized_name}_${date_str}.xlsx`);
}

// 🟢 6. HÀM XỬ LÝ CHÍNH DÙNG CHO NHẬP HÀNG / CHUYỂN HÀNG
export async function _actual_export_handler(
	prods: ProductV2[], 
	location: Location, 
	is_transfer = false, 
	is_check_mode = false,
	skip_images = false
) {
	await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js", "sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==")
	await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.0/FileSaver.min.js", "sha512-csNcFYJniKjJxRWRV1R7fvnXrycHP6qDR21mgz1ZP55xY5d+aHLfo9/FcGDQLfn2IfngbAHd8LdfsagcCqgTcQ==")
	
	const url = "/sapo_mau_file_nhap_don_nhap_hang-1-min.xlsx"
	const resp = await fetch(url)

	if (!resp.ok) {
		return false
	}

	const arrayBuffer = await resp.arrayBuffer();

	// @ts-ignore
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(arrayBuffer);
	const ws = wb.getWorksheet('Sheet1');

	let startRow = 8
	const img_col = 'E'

	const prod_images: Array<{ buffer: ArrayBuffer | null; height: number; ext: string }> = new Array(prods.length);

	if (!skip_images) {
		const BATCH_SIZE = 15;
		for (let i = 0; i < prods.length; i += BATCH_SIZE) {
			const batch = prods.slice(i, i + BATCH_SIZE);
			const batchResults = await Promise.all(
				batch.map(async (v) => {
					if (!v.image_path) return { buffer: null, height: 40, ext: "png" };
					try {
						const im = await imageToArrayBuffer(v.image_path, 141);
						if (im && im.b) {
							let ext = "png";
							const cleanPath = v.image_path.split("?")[0].toLowerCase();
							if (cleanPath.endsWith(".jpg") || cleanPath.endsWith(".jpeg")) {
								ext = "jpeg";
							} else if (cleanPath.endsWith(".gif")) {
								ext = "gif";
							}
							return { buffer: im.b, height: Math.max(60, (im.h || 100) * 0.75), ext };
						}
					} catch (e) {}
					return { buffer: null, height: 40, ext: "png" };
				})
			);

			for (let j = 0; j < batchResults.length; j++) {
				prod_images[i + j] = batchResults[j];
			}
		}
	}

	for (let i = 0; i < prods.length; i++) {
		const v = prods[i];
		const row = startRow + i;
		const imgData = prod_images[i];

		const rowdata = [v.sku, v.barcode, v.name, "", "", v.c_restock_third, v.c_restock_half, v.c_restock, v.c_on_hand, v.c_incoming];
		
		for (let c = 0; c < rowdata.length; c++) {
			ws.getCell(String.fromCharCode(65 + c) + row).value = rowdata[c];
		}

		if (!skip_images && imgData && imgData.buffer) {
			try {
				const img_id = wb.addImage({
					buffer: imgData.buffer,
					extension: imgData.ext
				});
				ws.addImage(img_id, `${img_col}${row}:${img_col}${row}`);
				ws.getRow(row).height = imgData.height;
			} catch (err) {
				ws.getRow(row).height = 40;
			}
		} else {
			ws.getRow(row).height = 40;
		}
	}

	const wb_buffer = await wb.xlsx.writeBuffer();
	const blob = new Blob([wb_buffer], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
	
	const normalized_branch = normalizeString(location?.label || "Kho");
	const t = new Date();
	const time_str = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}_${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}`;

	let prefix = "Nhap hang";
	if (is_check_mode) {
		prefix = "Kiem hang";
	} else if (is_transfer) {
		prefix = "Chuyen hang";
	}

	// @ts-ignore
	saveAs(blob, `${prefix}_${normalized_branch}_${time_str}.xlsx`);
	return true;
}
