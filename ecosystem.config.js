// PM2 ecosystem config — defines both app processes in cluster mode.
// cluster_mode + pm2 reload = zero-downtime deploys: the new worker starts
// and begins accepting requests before the old worker drains and exits.
// The deploy scripts (deploy.yml / deploy-staging.yml) check whether each
// process is already in cluster_mode; if not, they run pm2 delete + pm2 start
// using this file for a one-time migration. All subsequent deploys use reload.
//
// ⚠ Prod runs 2 instances on purpose: with a SINGLE cluster instance, a
// `pm2 reload` still has a sub-second swap gap (no second worker to serve
// during the handoff) — which showed up as a brief blip on deploys. With 2
// instances PM2 reloads them one at a time, so one always serves and the
// deploy is truly zero-downtime. Staging stays at 1 (downtime there is fine,
// and the box only has 2 cores — keep CPU contention low).
module.exports = {
  apps: [
    {
      name: 'lynxedo',
      script: './node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: '/opt/lynxedo/app',
      exec_mode: 'cluster',
      instances: 2,
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
