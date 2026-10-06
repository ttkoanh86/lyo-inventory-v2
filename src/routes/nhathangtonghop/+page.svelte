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

	// 📄 XỬ LÝ ĐỌC FILE PDF
	async function handle_file_process(file: File) {
		if (!file) return;
		if (!is_pdf_ready) return alert("Thư viện đang tải, vui lòng thử lại sau vài giây!");

		is_loading = true;
		extracted_order_ids = [];
		picked_items = [];
		total_products_qty = 0;

		try {
			const buffer = await file.arrayBuffer();
			const pdfjs = (window as any).pdfjsLib;
			const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
			const pdf = await loadingTask.promise;
			total_orders = pdf.numPages;

			const order_set = new Set<string>();
			const item_map: Record<string, number> = {};

			for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
				const page = await pdf.getPage(pageNum);
				const textContent = await page.getTextContent();
				const items = textContent.items.map((it: any) => it.str.trim()).filter((s: string) => s.length > 0);

				for (let i = 0; i < items.length; i++) {
					const str = items[i];

					// 🎯 1. RÚT ORDER ID TIKTOK SHOP (18 CHỮ SỐ)
					const tiktok = str.match(/\b5\d{17}\b/);
					if (tiktok) {
						order_set.add(tiktok[0]);
					}

					// 🎯 2. RÚT ORDER ID SHOPEE (MÃ CHỮ + SỐ 14-15 KÝ TỰ)
					const shopee = str.match(/\b\d{6}[A-Z0-9]{8,10}\b/i);
					if (shopee && !shopee[0].startsWith('SPX')) {
						order_set.add(shopee[0]);
					}

					// 🎯 3. BÓC TÁCH MÃ SELLER SKU (Mã kho Sapo)
					const is_seller_sku = (/^(880\d{10}(\.[A-Z0-9]+)?|[A-Z0-9]{2,8}-\d{3,6})$/i.test(str) || 
						(str.length >= 8 && str.length <= 25 && /\d/.test(str) && /[A-Z]/i.test(str))) &&
						!/^(Product|Name|SKU|Seller|Qty|TikTok|Order|Package|In|transit|by|Sample|Total|phannguyenkieuna|Cherry|Original|Tone-up|\d+ml|\d+g)$/i.test(str) &&
						!/^\d{12,20}$/.test(str);

					if (is_seller_sku) {
						let qty = 1;
						// Lấy số lượng Qty ở các ô kế tiếp
						for (let j = i + 1; j <= i + 4 && j < items.length; j++) {
							if (/^\d{1,3}$/.test(items[j])) {
								const num = parseInt(items[j], 10);
								if (num > 0 && num < 500) {
									qty = num;
									break;
								}
							}
						}

						item_map[str] = (item_map[str] || 0) + qty;
						total_products_qty += qty;
					}
				}
			}

			extracted_order_ids = Array.from(order_set);
			picked_items = Object.entries(item_map)
				.map(([sku, qty]) => ({ sku, qty }))
				.sort((a, b) => b.qty - a.qty);

		} catch (err) {
			console.error(err);
			alert("Lỗi khi bóc tách file PDF!");
		} finally {
			is_loading = false;
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

<svelte:head>
	<title>Phiếu Nhặt Hàng Gom</title>
</svelte:head>

<div class="container">
	<div 
		class="no-print drop-zone {is_dragging ? 'dragging' : ''}"
		on:drop={handle_drop}
		on:dragover={(e) => { e.preventDefault(); is_dragging = true; }}
		on:dragleave={() => is_dragging = false}
	>
		<h2>📦 PHIẾU TỔNG HỢP NHẶT HÀNG GOM (BATCH PICKING)</h2>
		<p>Thả file PDF phiếu in Shopee / TikTok Shop vào đây để tự động đọc Order ID & Lấy danh sách nhặt hàng gom</p>

		<input type="file" accept="application/pdf" on:change={handle_file_upload} id="file-input" hidden />
		<label for="file-input" class="btn-file">
			{is_loading ? "⏳ ĐANG BÓC TÁCH FILE PDF..." : "📂 CHỌN FILE PDF / KÉO THẢ VÀO ĐÂY"}
		</label>
	</div>

	{#if extracted_order_ids.length > 0}
		<div class="info-bar">
			⚡ Đã bóc tách thành công <b>{extracted_order_ids.length} mã đơn hàng sàn (Order ID)</b> từ file PDF!
		</div>
	{/if}

	{#if picked_items.length > 0}
		<div class="result-box">
			<div class="result-header">
				<div>
					<h3>📋 DANH SÁCH SẢN PHẨM CẦN NHẶT HÀNG GOM</h3>
					<p>Tổng số đơn: <b>{total_orders} đơn</b> | Tổng số lượng: <b style="color: #d97706; font-size: 16px;">{total_products_qty} món</b></p>
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
							<td><div class="sku-code">{item.sku}</div></td>
							<td style="text-align: center;"><span class="qty-badge">{item.qty}</span></td>
							<td style="text-align: center;" class="no-print"><input type="checkbox" style="width: 20px; height: 20px; cursor: pointer;" /></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.container { max-width: 850px; margin: 30px auto; font-family: Arial, sans-serif; }
	.drop-zone { background: #f8fafc; border: 3px dashed #cbd5e1; padding: 30px; border-radius: 12px; text-align: center; }
	.drop-zone.dragging { background: #e0f2fe; border-color: #0284c7; }
	.drop-zone h2 { color: #0284c7; margin-top: 0; }
	.btn-file { display: inline-block; padding: 12px 28px; background: #0284c7; color: white; font-weight: bold; border-radius: 8px; cursor: pointer; margin-top: 15px; }
	.info-bar { margin: 20px 0; padding: 12px; background: #e0f2fe; color: #0369a1; border-radius: 6px; font-size: 15px; text-align: center; }
	.result-header { display: flex; justify-content: space-between; align-items: center; margin: 20px 0 15px 0; border-bottom: 2px solid #0284c7; padding-bottom: 10px; }
	.btn-print { padding: 10px 22px; background: #16a34a; color: white; border: none; font-weight: bold; border-radius: 6px; cursor: pointer; }
	table { width: 100%; border-collapse: collapse; }
	th, td { border: 1px solid #cbd5e1; padding: 12px; text-align: left; }
	th { background: #f1f5f9; }
	.sku-code { font-size: 16px; font-weight: bold; color: #0284c7; }
	.qty-badge { display: inline-block; padding: 4px 16px; background: #fef3c7; color: #b45309; font-size: 18px; font-weight: bold; border-radius: 12px; }
	@media print { .no-print { display: none !important; } .container { max-width: 100%; margin: 0; } .qty-badge { background: none; color: #000; padding: 0; } }
</style>
