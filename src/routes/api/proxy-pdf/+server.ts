import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
	const pdfUrl = url.searchParams.get('url');

	if (!pdfUrl) {
		return new Response(JSON.stringify({ error: 'Thiếu tham số url' }), { status: 400 });
	}

	try {
		// Backend kéo trực tiếp file từ S3 Amazon (Server-to-Server không bị CORS)
		const response = await fetch(pdfUrl);

		if (!response.ok) {
			return new Response(JSON.stringify({ error: 'Không thể tải file PDF từ S3' }), { status: 500 });
		}

		const arrayBuffer = await response.arrayBuffer();

		return new Response(arrayBuffer, {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Access-Control-Allow-Origin': '*'
			}
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), { status: 500 });
	}
};
