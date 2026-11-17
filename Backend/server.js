// Backend/server.js
// Local entry point. On Vercel the app is served by api/index.js instead.

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SafeSip server: http://localhost:${PORT}`);
  console.log(`Dashboard:     http://localhost:${PORT}/dashboard.html`);
});
