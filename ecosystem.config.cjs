module.exports = {
    apps: [{
        name: 'job-viewer',
        script: './dist-server/server.js',
        env_production: {
            NODE_ENV: 'production',
            PORT: 3004
        }
    }]
};
