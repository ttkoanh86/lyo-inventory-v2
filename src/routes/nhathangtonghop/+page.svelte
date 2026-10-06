<script lang="ts">
	import { onMount } from 'svelte';

	let is_loading = false;
	let pdf_url_input = '';
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

	// 🌐 XỬ LÝ ĐỌC LINK PDF QUA PROXY
	async function process_pdf_from_url(url: string) {
		if (!url.trim()) return;
		if (!is_pdf_ready) return alert("Thư viện đọc PDF đang tải, vui lòng thử lại sau vài giây!");
		
		is_loading = true;
		picked_items = [];
		const cleanUrl = url.trim();

		try {
			const proxyApiUrl = `/api/proxy-pdf?url=${encodeURIComponent(cleanUrl)}`;
			const response = await fetch(proxyApiUrl);

			if (!response.ok) {
				const errData = await response.json().catch(() => ({}));
				throw new Error(errData.error || `Lỗi tải link (${response.status})`);
			}

			const buffer = await response.arrayBuffer();
			await parse_tiktok_sapo_pdf(new Uint8Array(buffer));
		} catch (e: any) {
			console.error("Lỗi kéo PDF:", e);
			alert(`Không thể đọc PDF từ Link!\nLý do: ${e.message}\n\n👉 Mẹo: Bạn có thể Kéo - Thả file PDF trực tiếp vào ô bên dưới nhé!`);
		} finally {
			is_loading = false;
		}
	}

	// 📄 XỬ LÝ KHI CHỌN HOẶC KÉO THẢ FILE PDF
	async function handle_file_process(file: File) {
		if (!file || file.type !== 'application/pdf') {
			return alert("Vui lòng chọn hoặc kéo thả đúng file định dạng PDF!");
		}
		if (!is_pdf_ready) return alert("Thư viện đọc PDF đang tải, vui lòng thử lại sau vài giây!");

		is_loading = true;
		picked_items = [];

		try {
			const buffer = await file.arrayBuffer();
			await parse_tiktok_sapo_pdf(new Uint8Array(buffer));
		} catch (err) {
			alert("Lỗi bóc tách file PDF!");
		} finally {
			is_loading = false;
		}
	}

	function handle_file_upload(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			handle_file_process(input.files[0]);
		}
	}

	// 🖱️ SỰ KIỆN KÉO THẢ FILE (DRAG & DROP)
	function handle_drop(e: DragEvent) {
		e.preventDefault();
		is_dragging = false;
		if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
			handle_file_process(e.dataTransfer.files[0]);
		}
	}

	function handle_drag_over(e: DragEvent) {
		e.preventDefault();
		is_dragging = true;
	}

	function handle_drag_leave() {
		is_dragging = false;
	}

	// ⚙️ BÓC TÁCH BẮT CHÍNH XÁC SELLER SKU
	async function parse_tiktok_sapo_pdf(pdfData: Uint8Array) {
		const pdfjs = (window as any).pdfjsLib;
		const loadingTask = pdfjs.getDocument({ data: pdfData });
		const pdf = await loadingTask.promise;
		total_orders = pdf.numPages;

		const item_map: Record<string, number> = {};
		total_products_qty = 0;

		for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
			const page = await pdf.getPage(pageNum);
			const textContent = await page.getTextContent();
			const items = textContent.items.map((it: any) => it.str.trim()).filter((s: string) => s.length > 0);

			for (let i = 0; i < items.length; i++) {
				const str = items[i];
				const is_seller_sku = /^(880\d{10}(\.[A-Z0-9]+)?|[A-Z0-9\-_]{6,25})$/i.test(str) && 
					!str.includes('Product') && !str.includes('Seller') && !str.includes('TikTok') && !str.includes('Order');

				if (is_seller_sku) {
					let qty = 1;
					for (let j = i + 1; j <= i + 3 && j < items.length; j++) {
						if (/^\d+$/.test(items[j])) {
							qty = parseInt(items[j], 10);
							break;
						}
					}
					item_map[str] = (item_map[str] || 0) + qty;
					total_products_qty += qty;
				}
			}
		}

		picked_items = Object.entries(item_map)
			.map(([sku, qty]) => ({ seller_sku: sku, qty }))
			.sort((a, b) => b.qty - a.qty);
	}
</script>

<svelte:head>
	<title>Phiếu Nhặt Hàng Gom</title>
</svelte:head>

<div class="container">
	<div 
		class="no-print input-box {is_dragging ? 'dragging' : ''}"
		on:drop={handle_drop}
		on:dragover={handle_drag_over}
		on:dragleave={handle_drag_leave}
	>
		<h2>📦 PHIẾU TỔNG HỢP NHẶT HÀNG GOM (BATCH PICKING)</h2>
		
		<div class="url-group">
			<input type="text" bind:value={pdf_url_input} placeholder="Dán Link PDF S3 vừa xuất từ Sapo (https://s3-...)" />
			<button on:click={() => process_pdf_from_url(pdf_url_input)} disabled={is_loading}>
				{is_loading ? "ĐANG XỬ LÝ..." : "⚡ TỔNG HỢP TỪ LINK"}
			</button>
		</div>

		<div class="divider">HOẶC KÉO - THẢ FILE PDF VÀO ĐÂY</div>

		<input type="file" accept="application/pdf" on:change={handle_file_upload} id="file-input" hidden />
		<label for="file-input" class="btn-file">
			{is_loading ? "⏳ ĐANG BÓC TÁCH..." : "📄 CHỌN TỪ MÁY TÍNH / KÉO THẢ FILE PDF"}
		</label>
	</div>

	{#if picked_items.length > 0}
		<div class="result-box">
			<div class="result-header">
				<div>
					<h3>📋 DANH SÁCH SẢN PHẨM CẦN NHẶT HÀNG GOM</h3>
					<p>Tổng số đơn: <b>{total_orders} đơn</b> | Tổng số lượng: <b style="color: #d97706;">{total_products_qty} món</b></p>
				</div>
				<button class="no-print btn-print" on:click={() => window.print()}>🖨️ IN PHIẾU GOM HÀNG</button>
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
							<td><div class="sku-code">{item.seller_sku}</div></td>
							<td style="text-align: center;"><span class="qty-badge">{item.qty}</span></td>
							<td style="text-align: center;" class="no-print"><input type="checkbox" style="width: 18px; height: 18px;" /></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.container { max-width: 850px; margin: 30px auto; font-family: Arial, sans-serif; }
	.input-box { background: #f8fafc; border: 2px dashed #cbd5e1; padding: 25px; border-radius: 8px; text-align: center; transition: 0.2s; }
	.input-box.dragging { background: #e0f2fe; border-color: #0284c7; }
	.input-box h2 { color: #0284c7; margin-top: 0; font-size: 18px; }
	.url-group { display: flex; gap: 10px; margin-top: 15px; }
	.url-group input { flex: 1; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 6px; }
	.url-group button { padding: 10px 20px; background: #0284c7; color: white; border: none; font-weight: bold; border-radius: 6px; cursor: pointer; }
	.divider { margin: 15px 0; color: #64748b; font-weight: bold; font-size: 13px; }
	.btn-file { display: inline-block; padding: 12px 24px; background: #475569; color: white; font-weight: bold; border-radius: 6px; cursor: pointer; }
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
