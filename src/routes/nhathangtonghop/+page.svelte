<script lang="ts">
	import { onMount } from 'svelte';
	import { aggregate_sapo_orders_from_pdf } from '../dashboard/DataPipelineV2';

	let is_loading = false;
	let is_retrying = false;
	let input_url = "";
	let selected_files: File[] = []; // Lưu danh sách các file PDF dì chọn
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

	// HÀM ĐỌC MÃ ĐƠN TỪ 1 BUFFER FILE PDF
	async function extract_orders_from_buffer(buffer: ArrayBuffer): Promise<string[]> {
		const pdfjs = (window as any).pdfjsLib;
		const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
		const pdf = await loadingTask.promise;

		const order_set = new Set<string>();

		for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
			const page = await pdf.getPage(pageNum);
			const textContent = await page.getTextContent();
			const items = textContent.items.map((it: any) => it.str.trim());

			for (let i = 0; i < items.length; i++) {
				const str = items[i];

				// TikTok Shop (18 số)
				const tiktok = str.match(/\b5\d{17}\b/);
				if (tiktok) order_set.add(tiktok[0]);

				// Shopee
				const shopee = str.match(/\b\d{6}[A-Z0-9]{8,10}\b/i);
				if (shopee && !shopee[0].toUpperCase().startsWith('SPX')) order_set.add(shopee[0]);
			}
		}

		return Array.from(order_set);
	}

	// CHỈ LƯU FILE VÀO DANH SÁCH CHỜ, KHÔNG TỰ ĐỘNG CHẠY TRA CỨU SAPO
	function handle_file_select(files: FileList | File[]) {
		if (!files || files.length === 0) return;
		
		const pdf_files: File[] = [];
		for (let i = 0; i < files.length; i++) {
			const f = files[i];
			if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
				pdf_files.push(f);
			}
		}

		if (pdf_files.length === 0) {
			alert("Vui lòng chọn các file định dạng PDF!");
			return;
		}

		// Cộng dồn danh sách file
		selected_files = [...selected_files, ...pdf_files];
	}

	function remove_file(index: number) {
		selected_files = selected_files.filter((_, i) => i !== index);
	}

	function clear_all_files() {
		selected_files = [];
	}

	// 🟢 NÚT BẤM BẮT ĐẦU CHẠY GOM HÀNG CÁC FILE ĐÃ CHỌN
	async function start_process_selected_files() {
		if (selected_files.length === 0) return alert("Dì chưa chọn file PDF nào cả!");
		if (!is_pdf_ready) return alert("Thư viện đọc PDF đang tải, vui lòng thử lại sau vài giây!");

		is_loading = true;
		extracted_order_ids = [];
		picked_items = [];
		failed_order_ids = [];

		try {
			const combined_order_set = new Set<string>();

			for (const file of selected_files) {
				const buffer = await file.arrayBuffer();
				const ordersInFile = await extract_orders_from_buffer(buffer);
				ordersInFile.forEach(id => combined_order_set.add(id));
			}

			extracted_order_ids = Array.from(combined_order_set);
			total_orders = extracted_order_ids.length;

			if (total_orders === 0) {
				alert("Không tìm thấy Mã đơn hàng nào trong các file PDF đã chọn!");
				is_loading = false;
				return;
			}

			await fetch_sapo_orders(extracted_order_ids);

		} catch (err) {
			console.error(err);
			alert("Lỗi khi đọc các file PDF!");
			is_loading = false;
		}
	}

	// ⚡ LUỒNG DÁN LINK S3
	async function handle_process_from_url() {
		const clean_url = input_url.trim();
		if (!clean_url) return alert("Vui lòng dán đường link phiếu in S3 Amazon!");
		if (!is_pdf_ready) return alert("Thư viện đang khởi tạo, vui lòng thử lại sau giây lát!");

		is_loading = true;
		extracted_order_ids = [];
		picked_items = [];
		failed_order_ids = [];

		try {
			const apiUrl = `/api/fetch-s3-pdf?url=${encodeURIComponent(clean_url)}`;
			const res = await fetch(apiUrl);

			if (!res.ok) {
				const errData = await res.json().catch(() => ({}));
				throw new Error(errData.error || `Không thể tải file từ S3 (HTTP ${res.status})`);
			}

			const buffer = await res.arrayBuffer();
			const ordersFromUrl = await extract_orders_from_buffer(buffer);

			extracted_order_ids = ordersFromUrl;
			total_orders = extracted_order_ids.length;

			if (total_orders === 0) {
				alert("Không tìm thấy Mã đơn hàng nào từ Link S3 này!");
				is_loading = false;
				return;
			}

			await fetch_sapo_orders(extracted_order_ids);

		} catch (err: any) {
			console.error(err);
			alert(err.message || "Không thể xử lý Link S3 này!");
			is_loading = false;
		}
	}

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
		if (input.files && input.files.length > 0) {
			handle_file_select(input.files);
			input.value = ""; 
		}
	}

	function handle_drop(e: DragEvent) {
		e.preventDefault();
		is_dragging = false;
		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
			handle_file_select(e.dataTransfer.files);
		}
	}
</script>

<svelte:head>
	<title>Phiếu Nhặt Hàng Gom DataPipeline</title>
</svelte:head>

<div class="container">
	<div class="no-print input-wrapper">
		<h2>📦 PHIẾU TỔNG HỢP CÁC SẢN PHẨM CẦN GOM NHẶT HÀNG GOM</h2>
		<p class="sub-title">Dán link S3 phiếu in hoặc Kéo - Thả NHIỀU FILE PDF vào đây để hệ thống tự động gom hàng chuẩn 100% từ Sapo</p>

		<div class="url-input-box">
			<input 
				type="text" 
				bind:value={input_url} 
				placeholder="🔗 Dán link phiếu in S3 Amazon (Shopee / TikTok Shop) vào đây..." 
				class="url-input"
				on:keydown={(e) => e.key === 'Enter' && handle_process_from_url()}
			/>
			<button class="btn-url" on:click={handle_process_from_url} disabled={is_loading}>
				{is_loading ? "⏳ ĐANG XỬ LÝ..." : "⚡ GOM HÀNG TỪ LINK"}
			</button>
		</div>

		<div class="divider"><span>HOẶC KÉO THẢ NHIỀU FILE PDF</span></div>

		<div 
			class="drop-zone {is_dragging ? 'dragging' : ''}"
			on:drop={handle_drop}
			on:dragover={(e) => { e.preventDefault(); is_dragging = true; }}
			on:dragleave={() => is_dragging = false}
		>
			<input type="file" accept="application/pdf" multiple on:change={handle_file_upload} id="file-input" hidden />
			<label for="file-input" class="btn-file">
				📂 CỘNG THÊM FILE PDF / KÉO THẢ TẤT CẢ VÀO ĐÂY
			</label>

			<!-- 📋 HIỂN THỊ DANH SÁCH FILE CHỜ BẤM BẮT ĐẦU -->
			{#if selected_files.length > 0}
				<div class="file-list-box">
					<div class="file-list-header">
						<span>📄 Đã chọn <b>{selected_files.length} file PDF</b>:</span>
						<button class="btn-clear-all" on:click={clear_all_files}>🗑️ Xóa tất cả</button>
					</div>
					<div class="file-items">
						{#each selected_files as file, idx}
							<div class="file-chip">
								<span class="file-name">📄 {file.name}</span>
								<button class="btn-remove-file" on:click={() => remove_file(idx)}>✕</button>
							</div>
						{/each}
					</div>

					<!-- NÚT BẤM KÍCH HOẠT TRA CỨU SAPO -->
					<button class="btn-start-process" on:click={start_process_selected_files} disabled={is_loading}>
						{is_loading ? "⏳ HỆ THỐNG ĐANG TRA CỨU SAPO..." : `⚡ BẮT ĐẦU GOM HÀNG (${selected_files.length} FILE PDF)`}
					</button>
				</div>
			{/if}
		</div>
	</div>

	{#if is_loading && extracted_order_ids.length > 0 && picked_items.length === 0}
		<div class="info-bar">
			⚡ Đã trích xuất được tổng cộng <b>{extracted_order_ids.length} Mã đơn hàng</b> từ các file PDF — Hệ thống đang gom sản phẩm cần lấy từ Sapo...
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
	.input-wrapper { background: #f8fafc; border: 1px solid #e2e8f0; padding: 25px; border-radius: 12px; text-align: center; }
	.input-wrapper h2 { color: #0284c7; margin-top: 0; margin-bottom: 6px; }
	.sub-title { color: #64748b; font-size: 14px; margin-bottom: 20px; }

	.url-input-box { display: flex; gap: 10px; max-width: 800px; margin: 0 auto; }
	.url-input { flex: 1; padding: 12px 16px; border: 2px solid #cbd5e1; border-radius: 8px; font-size: 14px; outline: none; transition: border-color 0.2s; }
	.url-input:focus { border-color: #0284c7; }
	.btn-url { padding: 12px 24px; background: #0284c7; color: white; font-weight: bold; border: none; border-radius: 8px; cursor: pointer; white-space: nowrap; }

	.divider { margin: 20px 0; position: relative; text-align: center; }
	.divider::before { content: ""; position: absolute; top: 50%; left: 0; width: 100%; height: 1px; background: #cbd5e1; z-index: 1; }
	.divider span { position: relative; z-index: 2; background: #f8fafc; padding: 0 15px; color: #94a3b8; font-size: 12px; font-weight: bold; }

	.drop-zone { border: 2px dashed #cbd5e1; padding: 20px; border-radius: 8px; background: #ffffff; }
	.drop-zone.dragging { background: #e0f2fe; border-color: #0284c7; }
	.btn-file { display: inline-block; padding: 10px 24px; background: #0284c7; color: white; font-weight: bold; border-radius: 6px; cursor: pointer; }

	.file-list-box { margin-top: 20px; padding: 15px; background: #f1f5f9; border-radius: 8px; text-align: left; border: 1px solid #cbd5e1; }
	.file-list-header { display: flex; justify-content: space-between; align-items: center; font-size: 14px; color: #334155; margin-bottom: 10px; }
	.btn-clear-all { background: none; border: none; color: #dc2626; cursor: pointer; font-size: 12px; font-weight: bold; }
	
	.file-items { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 15px; max-height: 150px; overflow-y: auto; }
	.file-chip { display: flex; align-items: center; gap: 6px; background: #ffffff; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 16px; font-size: 13px; color: #0f172a; }
	.file-name { max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.btn-remove-file { background: none; border: none; color: #94a3b8; cursor: pointer; font-weight: bold; font-size: 14px; padding: 0 2px; }
	.btn-remove-file:hover { color: #dc2626; }

	.btn-start-process { width: 100%; padding: 12px; background: #16a34a; color: white; border: none; font-weight: bold; font-size: 15px; border-radius: 6px; cursor: pointer; transition: background 0.2s; }
	.btn-start-process:hover { background: #15803d; }
	.btn-start-process:disabled { background: #9ca3af; cursor: not-allowed; }

	.info-bar { margin: 20px 0; padding: 12px; background: #e0f2fe; color: #0369a1; border-radius: 6px; font-size: 15px; text-align: center; }
	.result-header { display: flex; justify-content: space-between; align-items: center; margin: 20px 0 15px 0; border-bottom: 2px solid #0284c7; padding-bottom: 10px; }
	.btn-print { padding: 10px 22px; background: #16a34a; color: white; border: none; font-weight: bold; border-radius: 6px; cursor: pointer; }
	
	.success-tag { display: inline-block; margin: 0 6px; padding: 2px 8px; background: #dcfce7; color: #15803d; font-size: 12px; font-weight: bold; border-radius: 4px; }
	.error-tag { display: inline-block; margin: 0 6px; padding: 2px 8px; background: #fee2e2; color: #b91c1c; font-size: 12px; font-weight: bold; border-radius: 4px; }
	
	.failed-box { margin-top: 10px; padding: 10px 14px; background: #fef2f2; border: 1px solid #fca5a5; border-radius: 6px; color: #991b1b; font-size: 13px; }
	.failed-list { color: #dc2626; font-weight: bold; font-family: monospace; font-size: 13px; margin-left: 6px; }
	.btn-retry { margin-left: 12px; padding: 4px 12px; background: #dc2626; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 12px; }
	.btn-retry:disabled { background: #9ca3af; cursor: not-allowed; }

	.picking-table { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: fixed; }
	th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; vertical-align: middle; }
	th { background: #f1f5f9; font-size: 13px; font-weight: bold; text-transform: uppercase; }
	
	.col-stt, .col-stt-val { width: 45px; text-align: center; font-weight: bold; }
	.col-sku, .col-sku-val { width: 150px; }
	.col-name, .col-name-val { width: auto; }
	.col-loc, .col-loc-val { width: 110px; text-align: center; }
	.col-qty, .col-qty-val { width: 120px; text-align: center; }
	.col-check, .col-check-val { width: 90px; text-align: center; }

	.sku-code { font-size: 13px; font-weight: bold; color: #0284c7; word-break: break-all; }
	.product-name { font-size: 14px; line-height: 1.4; color: #1e293b; }
	.qty-badge { display: inline-block; padding: 3px 12px; background: #fef3c7; color: #b45309; font-size: 16px; font-weight: bold; border-radius: 10px; }
	.location-badge { font-weight: bold; color: #475569; background: #f1f5f9; padding: 3px 8px; border-radius: 4px; font-size: 12px; }

	@media print { 
		.no-print { display: none !important; } 
		.container { max-width: 100% !important; margin: 0 !important; width: 100% !important; } 
		
		.print-title { font-size: 16px !important; margin-bottom: 4px !important; }
		.print-summary { font-size: 13px !important; margin-top: 0 !important; }

		.picking-table { width: 100% !important; table-layout: fixed !important; margin-top: 5px !important; }
		th, td { padding: 4px 6px !important; font-size: 12px !important; border: 1px solid #000 !important; }
		th { background: #f1f5f9 !important; -webkit-print-color-adjust: exact; }

		.col-stt, .col-stt-val { width: 6% !important; }
		.col-sku, .col-sku-val { width: 18% !important; }
		.col-name, .col-name-val { width: 52% !important; }
		.col-loc, .col-loc-val { width: 8% !important; }
		.col-qty, .col-qty-val { width: 8% !important; }
		.col-check, .col-check-val { width: 8% !important; }

		.sku-code { font-size: 11px !important; color: #000 !important; word-break: break-all !important; }
		.product-name { font-size: 12px !important; line-height: 1.25 !important; color: #000 !important; font-weight: bold !important; }
		.qty-badge { background: none !important; color: #000 !important; padding: 0 !important; font-size: 13px !important; font-weight: bold !important; }
		.location-badge { background: none !important; color: #000 !important; padding: 0 !important; font-size: 11px !important; }
	}
</style>
