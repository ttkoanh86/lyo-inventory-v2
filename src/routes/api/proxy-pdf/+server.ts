import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
	const pdfUrl = url.searchParams.get('url');

	if (!pdfUrl) {
		return new Response(JSON.stringify({ error: 'Thiếu link PDF!' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		// Server gọi lấy file từ S3 Amazon
		const response = await fetch(pdfUrl, {
			headers: { 'User-Agent': 'Mozilla/5.0' }
		});

		if (!response.ok) {
			return new Response(JSON.stringify({ error: `Amazon S3 trả về lỗi HTTP ${response.status}` }), {
				status: response.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Đọc dữ liệu dạng ArrayBuffer và chuyển sang Uint8Array để bảo toàn dữ liệu nhị phân
		const arrayBuffer = await response.arrayBuffer();
		const uint8Array = new Uint8Array(arrayBuffer);

		return new Response(uint8Array, {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Length': uint8Array.byteLength.toString(),
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, OPTIONS'
			}
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message || 'Lỗi server kết nối S3' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
