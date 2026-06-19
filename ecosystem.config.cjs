module.exports = {
    apps: [{
        name: 'job-viewer',
        script: './dist-server/server.js',
        node_args: '--env-file-if-exists=./data/app.env',
        env_production: {
            NODE_ENV: 'production',
            PORT: 3004
        }
    }]
};
