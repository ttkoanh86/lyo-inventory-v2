<script lang="ts">
	import { onMount } from 'svelte';
	// 🟢 Import hàm gom hàng từ DataPipelineV2
	import { aggregate_sapo_orders_from_pdf } from '../dashboard/DataPipelineV2';

	let is_loading = false;
	let is_retrying = false;
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

	// ĐỌC MÃ ĐƠN TỪ PDF VÀ GỬI SANG DATAPIPELINE V2
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

	// CHỈ KÉO BÙ CÁC ĐƠN BỊ LỖI
	async function retry_failed_orders() {
		if (failed_order_ids.length === 0) return;

		is_retrying = true;
		const retry_targets = [...failed_order_ids];
		
		const res = await aggregate_sapo_orders_from_pdf(retry_targets);

		if (res.success && res.items.length > 0) {
			const item_map: Record<string, { sku: string; name: string; qty: number }> = {};
			
			picked_items.forEach(item => {
				item_map[item.sku] = { ...item };
			});

			res.items.forEach(new_item => {
				if (item_map[new_item.sku]) {
					item_map[new_item.sku].qty += new_item.qty;
				} else {
					item_map[new_item.sku] = { ...new_item };
				}
			});

			picked_items = Object.values(item_map).sort((a, b) => b.qty - a.qty);
			total_products_qty += res.total_qty || 0;
			successful_orders_count += res.found_orders_count || 0;
			failed_order_ids = res.failed_orders || [];
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

	<!-- CHỈ HIỂN THỊ THANH THÔNG BÁO KHI ĐANG LOADING -->
	{#if is_loading && extracted_order_ids.length > 0 && picked_items.length === 0}
		<div class="info-bar">
			⚡ Đã trích xuất được <b>{extracted_order_ids.length} Mã đơn hàng</b> — Hệ thống đang gom sản phẩm cần lấy từ Sapo!
		</div>
	{/if}

	{#if picked_items.length > 0}
		<div class="result-box">
			<div class="result-header">
				<div>
					<h3 class="print-title">📋 DANH SÁCH SẢN PHẨM CẦN GOM NHẶT HÀNG (TỪ SAPO)</h3>
					<p class="print-summary">
						Tổng số đơn: 
						<b style="color: {successful_orders_count === total_orders ? '#16a34a' : '#dc2626'}; font-size: 15px;">
							{successful_orders_count}/{total_orders} đơn
						</b>
						{#if failed_order_ids.length > 0}
							<span class="error-tag no-print">
								⚠️ hụt {failed_order_ids.length} đơn do lỗi mạng
							</span>
						{:else}
							<span class="success-tag no-print">✅ Đã gộp đủ 100%</span>
						{/if}
						| Tổng số lượng sản phẩm cần nhặt: <b style="color: #d97706; font-size: 16px;">{total_products_qty} món</b>
					</p>

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

			<table class="picking-table">
				<thead>
					<tr>
						<th class="col-stt">STT</th>
						<th class="col-sku">MÃ SKU</th>
						<th class="col-name">TÊN SẢN PHẨM</th>
						<th class="col-loc">VỊ TRÍ KHO</th>
						<th class="col-qty">TỔNG SỐ LƯỢNG</th>
						<th class="col-check">ĐÃ LẤY ( ✓ )</th>
					</tr>
				</thead>
				<tbody>
					{#each picked_items as item, index}
						<tr>
							<td class="col-stt-val">{index + 1}</td>
							<td class="col-sku-val"><div class="sku-code">{item.sku}</div></td>
							<td class="col-name-val"><b class="product-name">{item.name}</b></td>
							<td class="col-loc-val"><span class="location-badge">{item.location || '---'}</span></td>
							<td class="col-qty-val"><span class="qty-badge">{item.qty}</span></td>
							<td class="col-check-val"></td>	
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.container { max-width: 980px; margin: 30px auto; font-family: Arial, sans-serif; }
	.drop-zone { background: #f8fafc
