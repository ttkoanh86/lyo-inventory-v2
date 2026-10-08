import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const targetUrl = url.searchParams.get('url');

	console.log('==================================================');
	console.log('📌 [API S3 DEBUG] Request URL nhận được:', targetUrl);

	if (!targetUrl || !targetUrl.startsWith('http')) {
		console.log('❌ [API S3 DEBUG] Tham số URL rỗng hoặc không đúng dạng http!');
		return json({ 
			error: 'Đường dẫn S3 rỗng hoặc không hợp lệ!',
			receivedUrl: targetUrl 
		}, { status: 400 });
	}

	try {
		console.log('⏳ [API S3 DEBUG] Bắt đầu gọi fetch() sang Amazon S3...');
		const response = await fetch(targetUrl, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
			}
		});

		console.log('📥 [API S3 DEBUG] Kết quả từ Amazon S3:');
		console.log('   - Status:', response.status, response.statusText);
		console.log('   - Content-Type:', response.headers.get('content-type'));
		console.log('   - Content-Length:', response.headers.get('content-length'));

		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		const previewText = buffer.slice(0, 500).toString('utf-8');
		const headerMagic = buffer.slice(0, 10).toString('utf-8');

		console.log('   - Kích thước đọc được:', buffer.length, 'bytes');
		console.log('   - 10 ký tự đầu tiên:', JSON.stringify(headerMagic));
		console.log('==================================================');

		return json({
			status: response.status,
			statusText: response.statusText,
			contentType: response.headers.get('content-type'),
			contentLengthBytes: buffer.length,
			headerMagic: headerMagic,
			isPdf: headerMagic.startsWith('%PDF-'),
			previewText: previewText
		});

	} catch (error: any) {
		console.error('💥 [API S3 DEBUG] Lỗi sập fetch tại Server Node.js:', error);
		console.log('==================================================');
		return json({ 
			error: 'Lỗi Server Node.js khi gọi Amazon S3', 
			message: error.message,
			stack: error.stack 
		}, { status: 500 });
	}
};
