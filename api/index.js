// api/index.js
// Vercel serverless entry point. Vercel maps api/index.js to /api,
// and vercel.json rewrites /api/* to this function.
//
// A rewrite replaces the path the function observes with the destination
// (/api), so vercel.json forwards the tail of /api/* as ?path=. Restore it
// before Express routes.
// shortcut: query strings on /api requests are dropped; add an API that uses
// query params and this needs to merge them instead.

const app = require('../Backend/app');

module.exports = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const tail = url.searchParams.get('path');
  if (tail) req.url = `/api/${tail}`;
  return app(req, res);
};
