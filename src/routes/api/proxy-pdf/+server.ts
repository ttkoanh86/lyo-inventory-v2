import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
	const pdfUrl = url.searchParams.get('url');

	if (!pdfUrl) {
		return new Response(JSON.stringify({ error: 'Thiếu link PDF!' }), { status: 400 });
	}

	try {
		// Giả lập đầy đủ Header của Trình duyệt Chrome để Amazon S3 chấp nhận trả về đúng PDF
		const response = await fetch(pdfUrl, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'Accept': 'application/pdf,application/octet-stream,*/*',
				'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
			}
		});

		if (!response.ok) {
			return new Response(JSON.stringify({ error: `Amazon S3 báo lỗi HTTP ${response.status}` }), { status: response.status });
		}

		const blob = await response.blob();
		const arrayBuffer = await blob.arrayBuffer();

		// Kiểm tra 4 byte đầu tiên của file xem có đúng là file PDF (%PDF) không
		const headerText = new TextDecoder().decode(arrayBuffer.slice(0, 4));
		if (!headerText.startsWith('%PDF')) {
			return new Response(JSON.stringify({ error: 'Link không phải là file PDF hợp lệ hoặc đã hết hạn link S3!' }), { status: 400 });
		}

		return new Response(arrayBuffer, {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Access-Control-Allow-Origin': '*'
			}
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message || 'Lỗi server kết nối S3' }), { status: 500 });
	}
};
