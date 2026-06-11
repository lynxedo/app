// PM2 ecosystem config — defines both app processes in cluster mode.
// cluster_mode + pm2 reload = zero-downtime deploys: the new worker starts
// and begins accepting requests before the old worker drains and exits.
// The deploy scripts (deploy.yml / deploy-staging.yml) check whether each
// process is already in cluster_mode; if not, they run pm2 delete + pm2 start
// using this file for a one-time migration. All subsequent deploys use reload.
module.exports = {
  apps: [
    {
      name: 'lynxedo',
      script: './node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: '/opt/lynxedo/app',
      exec_mode: 'cluster',
      instances: 1,
    },
    {
      name: 'lynxedo-staging',
      script: './node_modules/.bin/next',
      args: 'start -p 3002',
      cwd: '/opt/lynxedo-staging/app',
      exec_mode: 'cluster',
      instances: 1,
    },
  ],
}
