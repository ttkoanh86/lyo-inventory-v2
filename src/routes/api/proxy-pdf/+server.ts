import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
	const pdfUrl = url.searchParams.get('url');

	if (!pdfUrl) {
		return new Response(JSON.stringify({ error: 'Thiếu link PDF' }), { 
			status: 400, 
			headers: { 'Content-Type': 'application/json' } 
		});
	}

	try {
		// NodeJS Server kéo trực tiếp từ S3 Amazon (Không bị CORS)
		const response = await fetch(pdfUrl, {
			headers: { 'User-Agent': 'Mozilla/5.0' }
		});

		if (!response.ok) {
			return new Response(JSON.stringify({ error: `Lỗi kéo S3 (${response.status})` }), { status: response.status });
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
