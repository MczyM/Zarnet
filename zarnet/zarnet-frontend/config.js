// Local dev (npx serve on your laptop): talks directly to the backend on :4000.
// Deployed (Netlify): uses a same-origin /api path, which netlify.toml proxies
// through to the real backend — keeps everything under one domain, no CORS.
window.ZARNET_API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:4000'
  : '/api';
