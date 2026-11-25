// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://workbench.luanti.org',
	vite: {
		plugins: [tailwindcss()],
	},
});
