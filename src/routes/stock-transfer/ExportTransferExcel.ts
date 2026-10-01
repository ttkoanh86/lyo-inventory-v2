import { lazyLoadScript } from "../dashboard/lazyLoadScript";

export async function export_transfer_sheets_custom(items: any[]) {
	await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js", "sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==");
	await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.0/FileSaver.min.js", "sha512-csNcFYJniKjJxRWRV1R7fvnXrycHP6qDR21mgz1ZP55xY5d+aHLfo9/FcGDQLfn2IfngbAHd8LdfsagcCqgTcQ==");

	// @ts-ignore
	const wb = new ExcelJS.Workbook();

	// SHEET 1: Chuyển sang 146 Bà Triệu
	const ws1 = wb.addWorksheet('Chuyen_146_Ba_Trieu');
	ws1.getRow(1).values = ["Mã SKU", "Tên sản phẩm", "Tồn Group", "Bán 30d Bà Triệu", "SL Chuyển sang Bà Triệu"];
	ws1.getRow(1).font = { bold: true };

	// SHEET 2: Chuyển sang 180 Phạm Văn Đồng
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
