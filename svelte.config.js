import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html', // 🔥 Tự động tạo file index.html chuẩn cho ứng dụng SPA
			precompress: false,
			strict: false // Bỏ qua strict để không bị chặn khi build
		})
	}
};

export default config;
