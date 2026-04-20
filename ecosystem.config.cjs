module.exports = {
  apps: [
    {
      name: 'ihr-telegram-bot',
      cwd: '/home/ubuntu/services/ihr-bot/ihr-telegram-bot',
      script: './src/index.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
