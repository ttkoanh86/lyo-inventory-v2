<script lang="ts">
	import { onMount } from 'svelte';
	// 🟢 Import hàm gom hàng từ DataPipelineV2
	import { aggregate_sapo_orders_from_pdf } from '../dashboard/DataPipelineV2';

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

	// ĐỌC MÃ ĐƠN TỪ PDF VÀ ĐẨY VÀO DATAPIPELINE V2
	async function handle_file_process(file: File) {
		if (!file) return;
		if (!is_pdf_ready) return alert("Thư viện đọc PDF đang tải, vui lòng thử lại sau vài giây!");

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

					// 1. Bắt Order ID TikTok Shop (18 số)
					const tiktok = str.match(/\b5\d{17}\b/);
					if (tiktok) order_set.add(tiktok[0]);

					// 2. Bắt Order ID Shopee (Ví dụ: 261006V1SVJBYY)
					const shopee = str.match(/\b\d{6}[A-Z0-9]{8,10}\b/i);
					if (shopee && !shopee[0].startsWith('SPX')) order_set.add(shopee[0]);
				}
			}

			extracted_order_ids = Array.from(order_set);

			if (extracted_order_ids.length === 0) {
				alert("Không tìm thấy Mã đơn hàng (Order ID) nào trong file PDF!");
				return;
			}

			// 🌐 GỌI TRỰC TIẾP HÀM DATAPIPELINE V2
			const res = await aggregate_sapo_orders_from_pdf(extracted_order_ids);

			if (res.success) {
				picked_
