import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
	const pdfUrl = url.searchParams.get('url');

	if (!pdfUrl) {
		return new Response(JSON.stringify({ error: 'Thiếu tham số link PDF!' }), { 
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		// Gọi trực tiếp từ Server NodeJS (Không bị CORS chặn)
		const response = await fetch(pdfUrl, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
			}
		});

		if (!response.ok) {
			return new Response(JSON.stringify({ error: `S3 Amazon trả về lỗi HTTP ${response.status}` }), { 
				status: response.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const arrayBuffer = await response.arrayBuffer();

		return new Response(arrayBuffer, {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
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
