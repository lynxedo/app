module.exports = {
  apps: [
    {
      name: 'lynxedo',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/opt/lynxedo/app',
      env: { NODE_ENV: 'production', PORT: 3000 }
    }
  ]
}
