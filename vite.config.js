import { defineConfig } from 'vite';

export default defineConfig({
    base: '/job-viewer/',
    server: {
        proxy: {
            '/job-viewer/api': {
                target: 'http://localhost:3004',
                changeOrigin: true,
            },
        },
    },
});
