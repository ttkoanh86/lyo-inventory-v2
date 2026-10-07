import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	// Lấy link S3 từ tham số ?url=...
	const targetUrl = url.searchParams.get('url');

	if (!targetUrl || !targetUrl.startsWith('http')) {
		return json({ error: 'Đường dẫn S3 không hợp lệ hoặc thiếu tham số url!' }, { status: 400 });
	}

	try {
		// Server Node.js đại diện tải trực tiếp từ Amazon S3
		const response = await fetch(targetUrl);

		if (!response.ok) {
			return json(
				{ error: `Không thể tải file từ Amazon S3 (Mã lỗi HTTP: ${response.status})` },
				{ status: response.status }
			);
		}

		// Lấy dữ liệu binary ArrayBuffer của file PDF
		const pdfBuffer = await response.arrayBuffer();

		// Trả về file PDF binary trực tiếp cho Frontend với header cho phép CORS nội bộ
		return new Response(pdfBuffer, {
			headers: {
				'Content-Type': 'application/pdf',
				'Cache-Control': 'no-cache',
				'Access-Control-Allow-Origin': '*'
			}
		});
	} catch (error: any) {
		console.error('Lỗi Server fetch S3 PDF:', error);
		return json({ error: 'Lỗi Server khi kết nối tải PDF từ S3: ' + error.message }, { status: 500 });
	}
};
