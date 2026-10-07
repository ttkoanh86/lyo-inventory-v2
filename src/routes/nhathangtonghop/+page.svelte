<script lang="ts">
	import { onMount } from 'svelte';
	import { aggregate_sapo_orders_from_pdf } from '../dashboard/DataPipelineV2';

	let is_loading = false;
	let is_retrying = false; // Trạng thái đang kéo bù
	let extracted_order_ids: string[] = [];
	let picked_items: any[] = [];
	let total_orders = 0;
	let successful_orders_count = 0;
	let failed_order_ids: string[] = [];
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

	// ĐỌC MÃ ĐƠN TỪ PDF VÀ GỬI SANG DATAPIPELINE
	async function handle_file_process(file: File) {
		if (!file) return;
		if (!is_pdf_ready) return alert("Thư viện đọc PDF đang tải, vui lòng thử lại sau vài giây!");

		is_loading = true;
		extracted_order_ids = [];
		picked_items = [];
		failed_order_ids = [];

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

					// 1. Order ID TikTok Shop (18 số)
					const tiktok = str.match(/\b5\d{17}\b/);
					if (tiktok) order_set.add(tiktok[0]);

					// 2. Order ID Shopee (Ví dụ: 261006V1SVJBYY)
					const shopee = str.match(/\b\d{6}[A-Z0-9]{8,10}\b/i);
					if (shopee && !shopee[0].startsWith('SPX')) order_set.add(shopee[0]);
				}
			}

			extracted_order_ids = Array.from(order_set);

			if (extracted_order_ids.length === 0) {
				alert("Không tìm thấy Mã đơn hàng (Order ID) nào trong file PDF!");
				return;
			}

			// GỌI KÉO TẤT CẢ LẦN ĐẦU
			await fetch_sapo_orders(extracted_order_ids);

		} catch (err) {
			console.error(err);
			alert("Lỗi khi đọc file PDF!");
		} finally {
			is_loading = false;
		}
	}

	// KÉO LẦN ĐẦU CHO TẤT CẢ ĐƠN
	async function fetch_sapo_orders(orderIds: string[]) {
		is_loading = true;
		const res = await aggregate_sapo_orders_from_pdf(orderIds);
		if (res.success) {
			picked_items = res.items || [];
			total_products_qty = res.total_qty || 0;
			successful_orders_count = res.found_orders_count || 0;
			failed_order_ids = res.failed_orders || [];
		} else {
			alert(res.message || "Lỗi khi gom hàng từ Sapo!");
		}
		is_loading = false;
	}

	// 🎯 CHỈ KÉO BÙ CÁC ĐƠN BỊ LỖI (KHÔNG CHẠY LẠI TỪ ĐẦU)
	async function retry_failed_orders() {
		if (failed_order_ids.length === 0) return;

		is_retrying = true;
		const retry_targets = [...failed_order_ids];
		
		// Gọi DataPipeline chỉ với danh sách đơn lỗi
		const res = await aggregate_sapo_orders_from_pdf(retry_targets);

		if (res.success && res.items.length > 0) {
			// Merge kết quả mới kéo bù vào danh sách cũ
			const item_map: Record<string, { sku: string; name: string; qty: number }> = {};
			
			// Đưa danh sách cũ vào map
			picked_items.forEach(item => {
				item_map[item.sku] = { ...item };
			});

			// Cộng dồn các món từ đơn kéo bù thành công
			res.items.forEach(new_item => {
				if (item_map[new_item.sku]) {
					item_map[new_item.sku].qty += new_item.qty;
				} else {
					item_map[new_item.sku] = { ...new_item };
				}
			});

			// Cập nhật lại giao diện
			picked_items = Object.values(item_map).sort((a, b) => b.qty - a.qty);
			total_products_qty += res.total_qty || 0;
			successful_orders_count += res.found_orders_count || 0;
			failed_order_ids = res.failed_orders || []; // Cập nhật danh sách lỗi còn lại (nếu vẫn lỗi)
		} else if (res.success && res.found_orders_count === 0) {
			alert("Vẫn chưa kéo được các đơn này do mạng/Sapo bận. Vui lòng thử lại sau giây lát!");
		}

		is_retrying = false;
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

<svelte:head>
	<title>Phiếu Nhặt Hàng Gom DataPipeline</title>
</svelte:head>

<div class="container">
	<div 
		class="no-print drop-zone {is_dragging ? 'dragging' : ''}"
		on:drop={handle_drop}
		on:dragover={(e) => { e.preventDefault(); is_dragging = true; }}
		on:dragleave={() => is_dragging = false}
	>
		<h2>📦 PHIẾU TỔNG HỢP CÁC SẢN PHẨM CẦN GOM NHẶT HÀNG GOM</h2>
		<p>Kéo - Thả file PDF phiếu in Shopee / TikTok Shop vào đây để hệ thống tự động gom hàng chuẩn 100% từ Sapo</p>

		<input type="file" accept="application/pdf" on:change={handle_file_upload} id="file-input" hidden />
		<label for="file-input" class="btn-file">
			{is_loading ? "⏳ HỆ THỐNG ĐANG TRA CỨU SAPO..." : "📂 CHỌN FILE PDF / KÉO THẢ VÀO ĐÂY"}
		</label>
	</div>

	<!-- CHỈ HIỂN THỊ THANH THÔNG BÁO KHI ĐANG LOADING LẦN ĐẦU -->
	{#if is_loading && extracted_order_ids.length > 0 && picked_items.length === 0}
		<div class="info-bar">
			⚡ Đã trích xuất được <b>{extracted_order_ids.length} Mã đơn hàng</b> — Hệ thống đang gom sản phẩm cần lấy từ Sapo!
		</div>
	{/if}

	{#if picked_items.length > 0}
		<div class="result-box">
			<div class="result-header">
				<div>
					<h3>📋 DANH SÁCH SẢN PHẨM CẦN GOM NHẶT HÀNG (TỪ SAPO)</h3>
					<p>
						Tổng số đơn: 
						<b style="color: {successful_orders_count === total_orders ? '#16a34a' : '#dc2626'}; font-size: 15px;">
							{successful_orders_count}/{total_orders} đơn
						</b>
						{#if failed_order_ids.length > 0}
							<span class="error-tag">
								⚠️ hụt {failed_order_ids.length} đơn do lỗi mạng
							</span>
						{:else}
							<span class="success-tag">✅ Đã gộp đủ 100%</span>
						{/if}
						| Tổng số lượng sản phẩm cần nhặt: <b style="color: #d97706; font-size: 16px;">{total_products_qty} món</b>
					</p>

					<!-- 🔴 KHUNG CẢNH BÁO VÀ NÚT CHỈ KÉO BÙ ĐƠN LỖI -->
					{#if failed_order_ids.length > 0}
						<div class="failed-box no-print">
							🚨 <b>CÁC MÃ ĐƠN CHƯA KÉO ĐƯỢC DO TIMEOUT ({failed_order_ids.length} đơn):</b> 
							<span class="failed-list">{failed_order_ids.join(', ')}</span>
							<button class="btn-retry" on:click={retry_failed_orders} disabled={is_retrying}>
								{is_retrying ? '⏳ ĐANG KÉO BÙ...' : '🔄 CHỈ KÉO BÙ CÁC ĐƠN LỖI NÀY'}
							</button>
						</div>
					{/if}
				</div>
				<button class="no-print btn-print" on:click={() => window.print()}>🖨 IN PHIẾU GOM HÀNG</button>
			</div>

			<table>
				<thead>
					<tr>
						<th style="width: 40px; text-align: center;">STT</th>
						<th style="width: 125px;">MÃ SKU</th>
						<th>TÊN SẢN PHẨM</th>
						<th style="width: 120px; text-align: center;">VỊ TRÍ KHO</th>
						<th style="width: 110px; text-align: center;">TỔNG SỐ LƯỢNG</th>
						<th style="width: 90px; text-align: center;">ĐÃ LẤY ( ✓ )</th>
					</tr>
				</thead>
				<tbody>
					{#each picked_items as item, index}
						<tr>
							<td style="text-align: center; font-weight: bold;">{index + 1}</td>
							<td><div class="sku-code">{item.sku}</div></td>
							<td><b class="product-name">{item.name}</b></td>
							<td style="text-align: center;"><span class="location-badge">{item.location || '---'}</span></td>
							<td style="text-align: center;"><span class="qty-badge">{item.qty}</span></td>
							<td style="text-align: center;"></td>	
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.container { max-width: 960px; margin: 30px auto; font-family: Arial, sans-serif; }
	.drop-zone { background: #f8fafc; border: 3px dashed #cbd5e1; padding: 30px; border-radius: 12px; text-align: center; }
	.drop-zone.dragging { background: #e0f2fe; border-color: #0284c7; }
	.drop-zone h2 { color: #0284c7; margin-top: 0; }
	.btn-file { display: inline-block; padding: 12px 28px; background: #0284c7; color: white; font-weight: bold; border-radius: 8px; cursor: pointer; margin-top: 15px; }
	.info-bar { margin: 20px 0; padding: 12px; background: #e0f2fe; color: #0369a1; border-radius: 6px; font-size: 15px; text-align: center; }
	.result-header { display: flex; justify-content: space-between; align-items: center; margin: 20px 0 15px 0; border-bottom: 2px solid #0284c7; padding-bottom: 10px; }
	.btn-print { padding: 10px 22px; background: #16a34a; color: white; border: none; font-weight: bold; border-radius: 6px; cursor: pointer; }
	
	.success-tag { display: inline-block; margin: 0 6px; padding: 2px 8px; background: #dcfce7; color: #15803d; font-size: 12px; font-weight: bold; border-radius: 4px; }
	.error-tag { display: inline-block; margin: 0 6px; padding: 2px 8px; background: #fee2e2; color: #b91c1c; font-size: 12px; font-weight: bold; border-radius: 4px; }
	
	.failed-box { margin-top: 10px; padding: 10px 14px; background: #fef2f2; border: 1px solid #fca5a5; border-radius: 6px; color: #991b1b; font-size: 13px; }
	.failed-list { color: #dc2626; font-weight: bold; font-family: monospace; font-size: 13px; margin-left: 6px; }
	.btn-retry { margin-left: 12px; padding: 4px 12px; background: #dc2626; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 12px; }
	.btn-retry:disabled { background: #9ca3af; cursor: not-allowed; }

	table { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: auto; }
	th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; vertical-align: middle; }
	th { background: #f1f5f9; font-size: 13px; font-weight: bold; text-transform: uppercase; }
	
	.sku-code { font-size: 13px; font-weight: bold; color: #0284c7; word-break: break-word; }
	.product-name { font-size: 14px; line-height: 1.4; color: #1e293b; }
	.qty-badge { display: inline-block; padding: 3px 12px; background: #fef3c7; color: #b45309; font-size: 16px; font-weight: bold; border-radius: 10px; }
	.location-badge { font-weight: bold; color: #475569; background: #f1f5f9; padding: 3px 8px; border-radius: 4px; font-size: 12px; }

	@media print { 
		.no-print { display: none !important; } 
		.container { max-width: 100%; margin: 0; } 
		.qty-badge { background: none; color: #000; padding: 0; font-size: 15px; }
		.location-badge { background: none; color: #000; padding: 0; }
	}
</style>
