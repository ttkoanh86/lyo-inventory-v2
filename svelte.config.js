import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	ssr: false,

	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: '200.html', // Tạo file fallback 200.html cho SPA
			precompress: false,
			strict: true
		}),

		prerender: {
			entries: ['*'] // 🟢 ĐỔI THÀNH ['*'] ĐỂ SVELTEKIT TỰ TẠO TRANG INDEX.HTML VÀ CÁC TRANG CÒN LẠI
		}
	}
};

export default config;
