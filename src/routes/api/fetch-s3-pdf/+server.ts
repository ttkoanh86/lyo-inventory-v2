import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const targetUrl = url.searchParams.get('url');

	if (!targetUrl || !targetUrl.startsWith('http')) {
		return json({ error: 'Đường dẫn S3 rỗng hoặc không hợp lệ!' }, { status: 400 });
	}

	try {
		// Server Node.js tải file từ S3 Amazon
		const response = await fetch(targetUrl, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
			}
		});

		// Lấy tất cả các Headers Amazon S3 trả về
		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});

		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		// Trích xuất 100 byte đầu dạng Hex và 500 ký tự đầu dạng Text
		const first100Hex = buffer.slice(0, 100).toString('hex').match(/.{1,2}/g)?.join(' ') || '';
		const previewText = buffer.slice(0, 800).toString('utf-8');

		// Kiểm tra ký hiệu file PDF gốc (%PDF-)
		const headerMagic = buffer.slice(0, 10).toString('utf-8');
		const isStandardPdf = headerMagic.startsWith('%PDF-');

		return json({
			success: true,
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders,
			contentLengthBytes: buffer.length,
			isStandardPdf: isStandardPdf,
			headerMagic: headerMagic,
			first100Hex: first100Hex,
			previewText: previewText
		});

	} catch (error: any) {
		return json({
			success: false,
			error: 'Lỗi kết nối từ Server Render sang S3: ' + error.message
		}, { status: 500 });
	}
};
