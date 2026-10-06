<script lang="ts">
	import { onMount } from 'svelte';

	let is_loading = false;
	let extracted_order_ids: string[] = [];
	let picked_items: any[] = [];
	let total_orders = 0;
	let total_products_qty = 0;
	let is_pdf_ready = false;
	let is_dragging = false;

	onMount(() => {
		if ((window as any).pdfjsLib) {
			is_pdf_ready = true;
			return;
		}
		const script = document.createElement('script');
		script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
		script.onload = () => {
			(window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 
				'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
			is_pdf_ready = true;
		};
		document.head.appendChild(script);
	});

	// 📄 XỬ LÝ ĐỌC FILE PDF ĐỂ LẤY DANH SÁCH ORDER ID
	async function handle_file_process(file: File) {
		if (!file) return;
		if (!is_pdf_ready) return alert("Thư viện đang tải, vui lòng thử lại sau vài giây!");

		is_loading = true;
		extracted_order_ids = [];
		picked_items = [];

		try {
			const buffer = await file.arrayBuffer();
			const pdfjs = (window as any).pdfjsLib;
			const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
			const pdf = await loadingTask.promise;
			total_orders = pdf.numPages;

			const order_set = new Set<string>();

			for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
				const page = await pdf.getPage(pageNum);
				const textContent = await page.getTextContent();
				const items = textContent.items.map((it: any) => it.str.trim());

				for (let i = 0; i < items.length; i++) {
					const str = items[i];

					// 🎯 Bắt Order ID TikTok (18 số)
					const tiktok = str.match(/\b5\d{17}\b/);
					if (tiktok) {
						order_set.add(tiktok[0]);
						continue;
					}

					// 🎯 Bắt Order ID Shopee (Ví dụ: 261006V1SVJBYY)
					const shopee = str.match(/\b\d{6}[A-Z0-9]{8,10}\b/i);
					if (shopee && !shopee[0].startsWith('SPX')) {
						order_set.add(shopee[0]);
						continue;
					}
				}
			}

			extracted_order_ids = Array.from(order_set);

			// Gửi danh sách Order ID sang Backend/DataPipeline để tra cứu thông tin sản phẩm chuẩn từ Sapo
			await fetch_sapo_products_by_orders(extracted_order_ids);

		} catch (err) {
			console.error(err);
			alert("Lỗi bóc tách file PDF!");
		} finally {
			is_loading = false;
		}
	}

	// 🌐 GỌI TRA CỨU TỪ SAPO THEO DANH SÁCH MÃ ĐƠN
	async function fetch_sapo_products_by_orders(orderIds: string[]) {
		if (orderIds.length === 0) {
			alert("Không tìm thấy Mã đơn hàng (Order ID) nào trong file PDF!");
			return;
		}

		// Gọi API backend tra cứu thông tin sản phẩm chuẩn Sapo theo danh sách Order ID
		try {
			const res = await fetch('/api/get-sapo-orders-items', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ order_ids: orderIds })
			});

			if (res.ok) {
				const data = await res.json();
				picked_items = data.items || [];
				total_products_qty = data.total_qty || 0;
			}
		} catch (e) {
			console.error("Lỗi tra cứu Sapo:", e);
		}
	}

	function handle_file_upload(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files[0]) handle_file_process(input.files[0]);
	}

	function handle_drop(e: DragEvent) {
		e.preventDefault();
		is_dragging = false;
		if (e.dataTransfer?.files?.[0]) handle_file_process(e.dataTransfer.files[0]);
	}
</script>

<div class="container">
	<div 
		class="no-print drop-zone {is_dragging ? 'dragging' : ''}"
		on:drop={handle_drop}
		on:dragover={(e) => { e.preventDefault(); is_dragging = true; }}
		on:dragleave={() => is_dragging = false}
	>
		<h2>📦 PHIẾU TỔNG HỢP NHẶT HÀNG GOM (TỰ ĐỘNG KHỚP SAPO)</h2>
		<p>Thả file PDF phiếu in Shopee / TikTok Shop vào đây để tự động đọc Order ID & Lấy dữ liệu kho Sapo chuẩn 100%</p>

		<input type="file" accept="application/pdf" on:change={handle_file_upload} id="file-input" hidden />
		<label for="file-input" class="btn-file">
			{is_loading ? "⏳ ĐANG BÓC TÁCH ORDER ID & TẢI SAPO..." : "📂 CHỌN FILE PDF / KÉO THẢ VÀO ĐÂY"}
		</label>
	</div>

	{#if extracted_order_ids.length > 0}
		<div class="info-bar">
			⚡ Đã tìm thấy <b>{extracted_order_ids.length} mã đơn hàng sàn</b> từ file PDF!
		</div>
	{/if}

	{#if picked_items.length > 0}
		<div class="result-box">
			<div class="result-header">
				<div>
					<h3>📋 DANH SÁCH SẢN PHẨM CẦN NHẶT HÀNG GOM (TỪ SAPO)</h3>
					<p>Tổng số đơn: <b>{total_orders} đơn</b> | Tổng số lượng: <b style="color: #d97706; font-size: 16px;">{total_products_qty} món</b></p>
				</div>
				<button class="no-print btn-print" on:click={() => window.print()}>🖨️ IN PHIẾU GOM HÀNG</button>
			</div>

			<table>
				<thead>
					<tr>
						<th style="width: 50px; text-align: center;">STT</th>
						<th>MÃ SELLER SKU (MÃ KHO SAPO)</th>
						<th>TÊN SẢN PHẨM TRÊN SAPO</th>
						<th style="width: 150px; text-align: center;">TỔNG SỐ LƯỢNG</th>
						<th style="width: 80px; text-align: center;" class="no-print">CHECK</th>
					</tr>
				</thead>
				<tbody>
					{#each picked_items as item, index}
						<tr>
							<td style="text-align: center; font-weight: bold;">{index + 1}</td>
							<td><div class="sku-code">{item.sku}</div></td>
							<td><b>{item.name}</b></td>
							<td style="text-align: center;"><span class="qty-badge">{item.qty}</span></td>
							<td style="text-align: center;" class="no-print"><input type="checkbox" style="width: 20px; height: 20px;" /></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.container { max-width: 900px; margin: 30px auto; font-family: Arial, sans-serif; }
	.drop-zone { background: #f8fafc; border: 3px dashed #cbd5e1; padding: 30px; border-radius: 12px; text-align: center; }
	.drop-zone.dragging { background: #e0f2fe; border-color: #0284c7; }
	.drop-zone h2 { color: #0284c7; margin-top: 0; }
	.btn-file { display: inline-block; padding: 12px 28px; background: #0284c7; color: white; font-weight: bold; border-radius: 8px; cursor: pointer; margin-top: 15px; }
	.info-bar { margin: 20px 0; padding: 12px; background: #e0f2fe; color: #0369a1; border-radius: 6px; font-size: 15px; }
	.result-header { display: flex; justify-content: space-between; align-items: center; margin: 20px 0 15px 0; border-bottom: 2px solid #0284c7; padding-bottom: 10px; }
	.btn-print { padding: 10px 22px; background: #16a34a; color: white; border: none; font-weight: bold; border-radius: 6px; cursor: pointer; }
	table { width: 100%; border-collapse: collapse; }
	th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; }
	th { background: #f1f5f9; }
	.sku-code { font-size: 15px; font-weight: bold; color: #0284c7; }
	.qty-badge { display: inline-block; padding: 4px 14px; background: #fef3c7; color: #b45309; font-size: 16px; font-weight: bold; border-radius: 12px; }
	@media print { .no-print { display: none !important; } .container { max-width: 100%; margin: 0; } }
</style>
