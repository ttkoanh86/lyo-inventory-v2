import { calculate_restock_data, normalizeString, type OrderRecordV2, type ProductV2, type TransferRecord } from "./DataPipelineV2";
import { imageToArrayBuffer } from "./imageToByteArray";
import { lazyLoadScript } from "./lazyLoadScript";
import { type Location } from "./Template";

export async function export_all_to_xlsx(order_records: OrderRecordV2[], transfer_records: TransferRecord[], variant_by_id: Map<number, ProductV2>, c_location_id: number, location: Location) {
    const success = await _actual_export_handler(calculate_restock_data(
        [...order_records, ...transfer_records],
        variant_by_id,
        c_location_id,
    ), location );

    if (!success) {
        alert("Gặp lỗi khi xuất file")
    }
}

export async function export_selected_to_xlsx(selected_skus: Set<string>, datasource: ProductV2[], location: Location) {
    if (selected_skus.size > 0) {
        const x = datasource.filter((x) => { return selected_skus.has(x.sku) })
        await _actual_export_handler(x, location)
    } else {
        if (await _actual_export_handler(datasource, location) == false) {
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

    if (await _actual_export_handler(x, locations[0], true) == false) {
        alert("Gặp lỗi khi xuất file")
    }

}

export async function _actual_export_handler(prods: ProductV2[], location: Location, is_transfer = false) {

    // Get ExcelJS from CDN
    await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js", "sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==")
    await lazyLoadScript("https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.0/FileSaver.min.js", "sha512-csNcFYJniKjJxRWRV1R7fvnXrycHP6qDR21mgz1ZP55xY5d+aHLfo9/FcGDQLfn2IfngbAHd8LdfsagcCqgTcQ==")
    
    // 🟢 DÙNG FILE MẪU NỘI BỘ MỚI TRONG THƯ MỤC STATIC
    const url = "/sapo_mau_file_nhap_don_nhap_hang-1-min.xlsx"
    const resp = await fetch(url)

    if (!resp.ok) {
        return false
    }

    const arrayBuffer = await resp.arrayBuffer();

    // Load workbook
    // @ts-ignore
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(arrayBuffer);
    const ws = wb.getWorksheet('Sheet1');

    let row = 8
    const img_col = 'E' // 🟢 ĐỔI CỘT ẢNH SANG CỘT E

    for (let v of prods) {
        // 🟢 CỘT A: SKU | B: Barcode | C: Tên SP | D: Số lượng (trống) | E: Ô chèn ảnh | F->J: SL tính toán
        const rowdata = [v.sku, v.barcode, v.name, "", "", v.c_restock_third, v.c_restock_half, v.c_restock, v.c_on_hand, v.c_incoming]
        for (let c = 0; c < rowdata.length; c++) {
            ws.getCell(String.fromCharCode(65 + c) + row).value = rowdata[c]
        }

        // Load image
        if (v.image_path) {
            const im = await imageToArrayBuffer(v.image_path, 141)
            let ext = v.image_path.split(".").at(-1)
            if (ext == 'jpg') {
                ext = 'jpeg'
            }
            if (im && im.b) {
                const img_id = wb.addImage({
                    buffer: im.b,
                    extension: ext
                })
                ws.addImage(img_id, `${img_col}${row}:${img_col}${row}`)
                ws.getRow(row).height = im.h * 0.75
            }
        }

        row += 1
    }

    // Save to XLSX
    const wb_buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([wb_buffer], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})
    
    const normalized_branch = normalizeString(location?.label || "Kho")
    const t = new Date()
    if (is_transfer) {
        // @ts-ignore
        saveAs(blob, `Chuyen hang_${normalized_branch}_${t.getFullYear()}${t.getMonth() + 1}${t.getDate()}_${t.getHours()}${t.getMinutes()}${t.getSeconds()}.xlsx`)
    } else {
        // @ts-ignore
        saveAs(blob, `Nhap hang_${normalized_branch}_${t.getFullYear()}${t.getMonth() + 1}${t.getDate()}_${t.getHours()}${t.getMinutes()}${t.getSeconds()}.xlsx`)
    }
    return true
}
