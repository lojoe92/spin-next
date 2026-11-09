// Template for the pm2 process config. Copy to ecosystem.config.js on the server
// and fill in the real values. ecosystem.config.js is in .gitignore so the real
// one never gets pushed back to the repo.
module.exports = {
  apps: [{
    name: 'spin-next',
    script: 'server.js',
    cwd: '/home/sweetsmilingsoul/spin-next',
    env: {
      PORT: 3003,

      // Initial admin account (created the first time the DB is empty)
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'CHANGE-ME-TO-A-STRONG-PASSWORD',
      ADMIN_EMAIL:    'you@example.com',

      // JWT signing key — generate a random one, e.g.
      //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
      JWT_SECRET: 'CHANGE-ME-TO-A-RANDOM-SECRET',

      // Where sql.js persists the database on disk
      DB_PATH: './server-data/spin.db',

      // Resend (shared with the family-tree app — same account, same domain)
      RESEND_API_KEY: 're_YOUR_KEY_FROM_FAMILY_TREE',
      EMAIL_FROM:     'Spin Next <noreply@sweetsmilingsoul.com>',
      APP_BASE_URL:   'https://spin.sweetsmilingsoul.com'
    }
  }]
};
