import { calculate_restock_data, normalizeString, type OrderRecordV2, type ProductV2, type TransferRecord } from "./DataPipelineV2";
import { imageToArrayBuffer } from "./imageToByteArray";
import { lazyLoadScript } from "./lazyLoadScript";
import { type Location } from "./Template";

export async function export_all_to_xlsx(order_records: OrderRecordV2[], transfer_records: TransferRecord[], variant_by_id: Map<number, ProductV2>, c_location_id: number, location: Location, is_check_mode = false) {
    const success = await _actual_export_handler(calculate_restock_data(
        [...order_records, ...transfer_records],
        variant_by_id,
        c_location_id,
    ), location, false, is_check_mode);

    if (!success) {
        alert("Gặp lỗi khi xuất file")
    }
}

export async function export_selected_to_xlsx(selected_skus: Set<string>, datasource: ProductV2[], location: Location, is_check_mode = false) {
    if (selected_skus.size > 0) {
        const x = datasource.filter((x) => { return selected_skus.has(x.sku) })
        await _actual_export_handler(x, location, false, is_check_mode)
    } else {
        if (await _actual_export_handler(datasource, location, false, is_check_mode) == false) {
            alert("Gặp lỗi khi xuất file")
        }
    }
}

export async function export_transfer_sheet_to_xlsx(order_records: OrderRecordV2[], transfer_records: TransferRecord[], variant_by_id: Map<number, ProductV2>, locations: Location[]) {
    const x = calculate_restock_data(
        [...order_records, ...transfer_records],
        variant_by_id,
        locations[0].id,
    ).filter((x) => {
        return x.c_on_hand > 0
    })

    if (await _actual_export_handler(x, locations[0], true, false) == false) {
        alert("Gặp lỗi khi xuất file")
    }
}

export async function _actual_export_handler(prods: ProductV2[], location: Location, is_transfer = false, is_check_mode = false) {

    // 🟢 1. TẢI THƯ VIỆN EXCELJS
    await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js", "sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==")
    await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.0/FileSaver.min.js", "sha512-csNcFYJniKjJxRWRV1R7fvnXrycHP6qDR21mgz1ZP55xY5d+aHLfo9/FcGDQLfn2IfngbAHd8LdfsagcCqgTcQ==")
    
    // 🟢 2. NẠP FILE MẪU NỘI BỘ TỪ STATIC
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
    const img_col = 'E' // Cột E chèn ảnh

    // 🟢 3. TẢI ẢNH SONG SONG THEO LÔ (BATCH 15 ẢNH/LẦN) ĐỂ TĂNG TỐC TỐI ĐA
    const BATCH_SIZE = 15;
    const prod_images: Array<{ buffer: ArrayBuffer | null; height: number; ext: string }> = new Array(prods.length);

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
                } catch (e) {
                    console.warn("Lỗi tải ảnh SKU:", v.sku, e);
                }
                return { buffer: null, height: 40, ext: "png" };
            })
        );

        for (let j = 0; j < batchResults.length; j++) {
            prod_images[i + j] = batchResults[j];
        }
    }

    // 🟢 4. GHI DỮ LIỆU VÀO WORKBOOK EXCEL
    for (let i = 0; i < prods.length; i++) {
        const v = prods[i];
        const row = startRow + i;
        const imgData = prod_images[i];

        // CỘT A: SKU | B: Barcode | C: Tên SP | D: Số lượng (trống) | E: Ô chèn ảnh | F->J: SL tính toán
        const rowdata = [v.sku, v.barcode, v.name, "", "", v.c_restock_third, v.c_restock_half, v.c_restock, v.c_on_hand, v.c_incoming];
        
        for (let c = 0; c < rowdata.length; c++) {
            ws.getCell(String.fromCharCode(65 + c) + row).value = rowdata[c];
        }

        // Chèn ảnh nếu tải thành công
        if (imgData && imgData.buffer) {
            try {
                const img_id = wb.addImage({
                    buffer: imgData.buffer,
                    extension: imgData.ext
                });
                ws.addImage(img_id, `${img_col}${row}:${img_col}${row}`);
                ws.getRow(row).height = imgData.height;
            } catch (err) {
                console.warn("Không thể chèn ảnh vào Excel tại dòng:", row, err);
                ws.getRow(row).height = 40;
            }
        } else {
            ws.getRow(row).height = 40;
        }
    }

    // 🟢 5. XUẤT VÀ TẢI FILE EXCEL VỀ MÁY
    const wb_buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([wb_buffer], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    
    const normalized_branch = normalizeString(location?.label || "Kho");
    const t = new Date();
    const time_str = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}_${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}`;

    let prefix = "Nhap hang";
    if (is_transfer) {
        prefix = "Chuyen hang";
    } else if (is_check_mode) {
        prefix = "Kiem hang";
    }

    // @ts-ignore
    saveAs(blob, `${prefix}_${normalized_branch}_${time_str}.xlsx`);
    return true;
}
