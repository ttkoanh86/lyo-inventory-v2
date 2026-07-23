import { calculate_restock_data, normalizeString, type OrderRecordV2, type ProductV2, type TransferRecord } from "./DataPipelineV2";
import { imageToArrayBuffer } from "./imageToByteArray";
import { lazyLoadScript } from "./lazyLoadScript";
import { type Location } from "./Template";

declare var ExcelJS: any;
declare var saveAs: any;

export async function export_all_to_xlsx(order_records: OrderRecordV2[], transfer_records: TransferRecord[], variant_by_id: Map<number, ProductV2>, c_location_id: number, location: Location) {
    const success = await _actual_export_handler(calculate_restock_data(
        [...order_records, ...transfer_records],
        variant_by_id,
        c_location_id,
    ), location);

    if (!success) {
        alert("Gặp lỗi khi xuất file");
    }
}

export async function export_selected_to_xlsx(selected_skus: Set<string>, datasource: ProductV2[], location: Location) {
    if (selected_skus.size > 0) {
        const x = datasource.filter((x) => { return selected_skus.has(x.sku); });
        await _actual_export_handler(x, location);
    } else {
        if (await _actual_export_handler(datasource, location) == false) {
            alert("Gặp lỗi khi xuất file");
        }
    }
}

export async function export_transfer_sheet_to_xlsx(order_records: OrderRecordV2[], transfer_records: TransferRecord[], variant_by_id: Map<number, ProductV2>, locations: Location[]) {
    const x = calculate_restock_data(
        [...order_records, ...transfer_records],
        variant_by_id,
        locations[0].id,
    ).filter((x) => {
        return x.c_on_hand > 0;
    });

    if (await _actual_export_handler(x, locations[0], true) == false) {
        alert("Gặp lỗi khi xuất file");
    }
}

export async function _actual_export_handler(prods: ProductV2[], location: Location, is_transfer = false) {
    try {
        await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js", "sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==");
        await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.0/FileSaver.min.js", "sha512-csNcFYJniKjJxRWRV1R7fvnXrycHP6qDR21mgz1ZP55xY5d+aHLfo9/FcGDQLfn2IfngbAHd8LdfsagcCqgTcQ==");

        const url = "https://lyo-inventory-mgmt.github.io/assets/sapo_mau_file_nhap_don_nhap_hang-1-min.xlsx";
        const resp = await fetch(url);

        if (!resp.ok) {
            return false;
        }

        const arrayBuffer = await resp.arrayBuffer();

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(arrayBuffer);
        const ws = wb.getWorksheet('Sheet1');

        if (!ws) return false;

        let row = 8;
        const img_col = 'C';

        for (let v of prods) {
            const rowdata = [v.sku, v.barcode, "", v.c_restock_third, v.c_restock_half, v.c_restock, v.c_on_hand, v.c_incoming, v.name];
            for (let c = 0; c < rowdata.length; c++) {
                ws.getCell(String.fromCharCode(65 + c) + row).value = rowdata[c];
            }

            if (v.image_path) {
                const im = await imageToArrayBuffer(v.image_path, 141);
                let ext = v.image_path.split(".").at(-1) || "png";
                if (ext === 'jpg') {
                    ext = 'jpeg';
                }
                if (im && im.b) {
                    const img_id = wb.addImage({
                        buffer: im.b,
                        extension: ext
                    });
                    ws.addImage(img_id, `${img_col}${row}:${img_col}${row}`);
                    ws.getRow(row).height = im.h * 0.75;
                }
            }

            row += 1;
        }

        const wb_buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([wb_buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

        const normalized_branch = normalizeString(location?.label || "Kho");
        const t = new Date();
        const month = String(t.getMonth() + 1).padStart(2, '0');
        const day = String(t.getDate()).padStart(2, '0');
        const timeStr = `${t.getFullYear()}${month}${day}_${t.getHours()}${t.getMinutes()}${t.getSeconds()}`;

        if (is_transfer) {
            saveAs(blob, `Chuyen hang_${normalized_branch}_${timeStr}.xlsx`);
        } else {
            saveAs(blob, `Nhap hang_${normalized_branch}_${timeStr}.xlsx`);
        }
        return true;
    } catch (err) {
        console.error("Lỗi xuất Excel:", err);
        return false;
    }
}
