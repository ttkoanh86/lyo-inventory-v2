<script lang="ts">
	import { onMount } from 'svelte';

	let pdfjsLib: any = $state(null);
	let is_loading = $state(false);
	let pdf_url_input = $state('');
	let picked_items: any[] = $state([]);
	let total_orders = $state(0);
	let total_products_qty = $state(0);

	onMount(async () => {
		// Import thư viện đọc PDF linh hoạt ở client-side
		const pdfModule = await import('pdfjs-dist');
		pdfjsLib = pdfModule;
		pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
	});

	// 🌐 XỬ LÝ ĐỌC TRỰC TIẾP TỪ LINK URL AMAZON S3 CỦA SAPO
	async function process_pdf_from_url(url: string) {
		if (!url.trim()) return;
		is_loading = true;
		picked_items = [];

		try {
			const response = await fetch(url);
			if (!response.ok) throw new Error("Không thể tải file PDF từ link này!");
			
			const arrayBuffer = await response.arrayBuffer();
			await parse_pdf_buffer(arrayBuffer);
		} catch (error: any) {
			console.error("Lỗi đọc PDF từ URL:", error);
			alert("Không thể tải trực tiếp từ Link do chặn bảo mật trình duyệt! Dì vui lòng chọn TẢI FILE TỪ MÁY TÍNH nhé.");
		} finally {
			is_loading = false;
		}
	}

	// 📄 XỬ LÝ KHI DÌ CHỌN FILE PDF TẢI VỀ MÁY
	async function handle_file_upload(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;

		is_loading = true;
		picked_items = [];

		try {
			const file = input.files[0];
			const arrayBuffer = await file.arrayBuffer();
			await parse_pdf_buffer(arrayBuffer);
		} catch (error) {
			alert("Lỗi khi đọc file PDF!");
		} finally {
			is_loading = false;
		}
	}

	// ⚙️ BÓC TÁCH BẮT CHÍNH XÁC CỘT SELLER SKU VÀ SỐ LƯỢNG (QTY)
	async function parse_pdf_buffer(arrayBuffer: ArrayBuffer) {
		const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
		total_orders = pdf.numPages;

		const item_map: Record<string, { seller_sku: string; qty: number }> = {};
		total_products_qty = 0;

		for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
			const page = await pdf.getPage(pageNum);
			const textContent = await page.getTextContent();
			
			const items = textContent.items.map((it: any) => it.str.trim()).filter((s: string) => s.length > 0);

			for (let i = 0; i < items.length; i++) {
				const str = items[i];

				// Bắt chính xác Seller SKU (Mã SKU kho Sapo)
				const is_seller_sku = /^(880\d{10}(\.[A-Z0-9]+)?|[A-Z0-9\-_]{6,25})$/i.test(str) && 
					!str.includes('Product') && !str.includes('Seller') && !str.includes('TikTok') && !str.includes('Order');

				if (is_seller_sku) {
					const seller_sku = str;

					// Bắt số lượng Qty ở các dòng kế tiếp
					let qty = 1;
					for (let j = i + 1; j <= i + 3 && j < items.length; j++) {
						if (/^\d+$/.test(items[j])) {
							qty = parseInt(items[j], 10);
							break;
						}
					}

					if (!item_map[seller_sku]) {
						item_map[seller_sku] = { seller_sku: seller_sku, qty: 0 };
					}
					item_map[seller_sku].qty += qty;
					total_products_qty += qty;
				}
			}
		}

		// Sắp xếp các sản phẩm số lượng nhiều lên trước
		picked_items = Object.values(item_map).sort((a, b) => b.qty - a.qty);
	}
</script>

<svelte:head>
	<title>Phiếu Nhặt Hàng Gom</title>
</svelte:head>

<div class="container">
	<div class="no-print input-box">
		<h2>📦 PHIẾU TỔNG HỢP NHẶT HÀNG GOM (BATCH PICKING)</h2>
		
		<div class="url-group">
			<input 
				type="text" 
				bind:value={pdf_url_input} 
				placeholder="Dán Link PDF S3 của Sapo (https://s3-...)" 
			/>
			<button onclick={() => process_pdf_from_url(pdf_url_input)} disabled={is_loading}>
				{is_loading ? "ĐANG XỬ LÝ..." : "⚡ TỔNG HỢP TỪ LINK"}
			</button>
		</div>

		<div class="divider">HOẶC</div>

		<input type="file" accept="application/pdf" onchange={handle_file_upload} id="file-input" hidden />
		<label for="file-input" class="btn-file">📄 CHỌN FILE PDF TỪ MÁY TÍNH</label>
	</div>

	{#if picked_items.length > 0}
		<div class="result-box">
			<div class="result-header">
				<div>
					<h3>📋 DANH SÁCH SẢN PHẨM CẦN NHẶT HÀNG GOM</h3>
					<p>Tổng số đơn hàng: <b>{total_orders} đơn</b> | Tổng số lượng cần lấy: <b style="color: #d97706; font-size: 16px;">{total_products_qty} món</b></p>
				</div>
				<button class="no-print btn-print" onclick={() => window.print()}>🖨️ IN PHIẾU GOM HÀNG</button>
			</div>

			<table>
				<thead>
					<tr>
						<th style="width: 50px; text-align: center;">STT</th>
						<th>MÃ SELLER SKU (MÃ KHO SAPO)</th>
						<th style="width: 180px; text-align: center;">TỔNG SỐ LƯỢNG LẤY</th>
						<th style="width: 80px; text-align: center;" class="no-print">CHECK</th>
					</tr>
				</thead>
				<tbody>
					{#each picked_items as item, index}
						<tr>
							<td style="text-align: center; font-weight: bold;">{index + 1}</td>
							<td>
								<div class="sku-code">{item.seller_sku}</div>
							</td>
							<td style="text-align: center;">
								<span class="qty-badge">{item.qty}</span>
							</td>
							<td style="text-align: center;" class="no-print">
								<input type="checkbox" style="width: 18px; height: 18px; cursor: pointer;" />
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.container { max-width: 850px; margin: 30px auto; font-family: Arial, sans-serif; }
	.input-box { background: #f8fafc; border: 2px dashed #cbd5e1; padding: 25px; border-radius: 8px; text-align: center; }
	.input-box h2 { color: #0284c7; margin-top: 0; font-size: 18px; }
	.url-group { display: flex; gap: 10px; margin-top: 15px; }
	.url-group input { flex: 1; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 6px; }
	.url-group button { padding: 10px 20px; background: #0284c7; color: white; border: none; font-weight: bold; border-radius: 6px; cursor: pointer; }
	.divider { margin: 15px 0; color: #94a3b8; font-weight: bold; font-size: 12px; }
	.btn-file { display: inline-block; padding: 10px 20px; background: #475569; color: white; font-weight: bold; border-radius: 6px; cursor: pointer; }
	.result-header { display: flex; justify-content: space-between; align-items: center; margin: 25px 0 15px 0; border-bottom: 2px solid #0284c7; padding-bottom: 10px; }
	.btn-print { padding: 10px 20px; background: #16a34a; color: white; border: none; font-weight: bold; border-radius: 6px; cursor: pointer; }
	table { width: 100%; border-collapse: collapse; }
	th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; }
	th { background: #f1f5f9; }
	.sku-code { font-size: 16px; font-weight: bold; color: #0284c7; }
	.qty-badge { display: inline-block; padding: 4px 14px; background: #fef3c7; color: #b45309; font-size: 18px; font-weight: bold; border-radius: 12px; }
	
	@media print {
		.no-print { display: none !important; }
		.container { max-width: 100%; margin: 0; }
		.qty-badge { background: none; color: #000; padding: 0; }
	}
</style>
