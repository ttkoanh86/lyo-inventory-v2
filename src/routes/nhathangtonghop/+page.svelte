<script lang="ts">
	import { onMount } from 'svelte';

	let is_loading = $state(false);
	let pdf_url_input = $state('');
	let picked_items: any[] = $state([]);
	let total_orders = $state(0);
	let total_products_qty = $state(0);
	let is_pdf_ready = $state(false);

	onMount(() => {
		// Tải pdf.js từ CDN trực tiếp trên trình duyệt để tránh lỗi build Rollup/Vite
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

	// 🌐 XỬ LÝ ĐỌC TRỰC TIẾP TỪ LINK URL AMAZON S3
	async function process_pdf_from_url(url: string) {
		if (!url.trim()) return;
		if (!is_pdf_ready) {
			alert("Thư viện đọc PDF đang tải, vui lòng thử lại sau 3 giây!");
			return;
		}

		is_loading = true;
		picked_items = [];

		try {
			const response = await fetch(url);
			if (!response.ok) throw new Error("Không thể tải file PDF từ link này!");
			
			const arrayBuffer = await response.arrayBuffer();
			await parse_tiktok_sapo_pdf(arrayBuffer);
		} catch (error: any) {
			console.error("Lỗi đọc PDF từ URL:", error);
			alert("Không thể tải trực tiếp từ Link do chặn bảo mật trình duyệt! Bạn vui lòng TẢI FILE TỪ MÁY TÍNH nhé.");
		} finally {
			is_loading = false;
		}
	}

	// 📄 XỬ LÝ KHI CHỌN FILE PDF TỪ MÁY TÍNH
	async function handle_file_upload(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;
		if (!is_pdf_ready) {
			alert("Thư viện đọc PDF đang tải, vui lòng thử lại sau 3 giây!");
			return;
		}

		is_loading = true;
		picked_items = [];

		try {
			const file = input.files[0];
			const arrayBuffer = await file.arrayBuffer();
			await parse_tiktok_sapo_pdf(arrayBuffer);
		} catch (error) {
			console.error("Lỗi đọc file PDF:", error);
			alert("Lỗi khi bóc tách file PDF!");
		} finally {
			is_loading = false;
		}
	}

	// 🟢 HÀM BÓC TÁCH BẮT ĐÚNG SELLER SKU VÀ SỐ LƯỢNG TỪ FILE PDF PHIẾU GIAO
	async function parse_tiktok_sapo_pdf(arrayBuffer: ArrayBuffer) {
		const pdfjs = (window as any).pdfjsLib;
		const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
		total_orders = pdf.numPages;

		const item_map: Record<string, number> = {}; // { "SellerSKU": TotalQty }
		total_products_qty = 0;

		for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
			const page = await pdf.getPage(pageNum);
			const textContent = await page.getTextContent();
			
			const items = textContent.items.map((it: any) => it.str.trim()).filter((s: string) => s.length > 0);

			for (let i = 0; i < items.length; i++) {
				const str = items[i];

				// 🎯 LỌC CHUẨN CỘT SELLER SKU (Ví dụ: "8800248335641.CB10", "8809733216441")
				const is_seller_sku = /^(880\d{10}(\.[A-Z0-9]+)?|[A-Z0-9\-_]{6,25})$/i.test(str) && 
					!str.includes('Product') && !str.includes('Seller') && !str.includes('TikTok') && !str.includes('Order');

				if (is_seller_sku) {
					const seller_sku = str;

					// Tìm số lượng (Qty) ở các dòng kế tiếp
					let qty = 1;
					for (let j = i + 1; j <= i + 3 && j < items.length; j++) {
						if (/^\d+$/.test(items[j])) {
							qty = parseInt(items[j], 10);
							break;
						}
					}

					// Gom tổng số lượng theo Seller SKU
					if (!item_map[seller_sku]) {
						item_map[seller_sku] = 0;
					}
					item_map[seller_sku] += qty;
					total_products_qty += qty;
				}
			}
		}

		// Chuyển kết quả gom sang dạng mảng hiển thị giao diện
		picked_items = Object.entries(item_map)
			.map(([sku, qty]) => ({ seller_sku: sku, qty }))
			.sort((a, b) => b.qty - a.qty);
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
				<button
