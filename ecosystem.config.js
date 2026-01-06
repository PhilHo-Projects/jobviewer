export default {
  apps: [{
    name: 'job-viewer',
    script: './server.js',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3004
    }
  }]
};
