export const environment = {
  production: true,
  // In Docker production the frontend is served by Nginx; use a relative API base so
  // browser requests go to the same origin and are proxied by Nginx to the backend.
  apiBase: '/api'
};
