require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.GATEWAY_PORT || 3000;

// Render's private-service references provide host:port without a scheme;
// Docker Compose URLs already include http://.
function serviceUrl(value, fallback) {
  const url = value || fallback;
  return /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `http://${url}`;
}

// ─── Configuration-Based Service Discovery ───────────────────────────
// Service URLs are read from environment variables (not hard-coded).
// This allows service locations to be changed without modifying code.
const SERVICE_CONFIG = {
  users: {
    name: 'user-service',
    url: serviceUrl(process.env.USER_SERVICE_URL, 'http://localhost:3001'),
  },
  products: {
    name: 'product-service',
    url: serviceUrl(process.env.PRODUCT_SERVICE_URL, 'http://localhost:3002'),
  },
  orders: {
    name: 'order-service',
    url: serviceUrl(process.env.ORDER_SERVICE_URL, 'http://localhost:3003'),
  },
};

app.use(cors());

// ─── Request Logging Middleware ───────────────────────────────────────
// Logs: HTTP Method, Request Path, Target Service, Response Status
app.use((req, res, next) => {
  const startTime = Date.now();

  // Determine which service this request targets
  const pathSegments = req.path.split('/').filter(Boolean);
  const routePrefix = pathSegments[0] || '';
  const serviceInfo = SERVICE_CONFIG[routePrefix];
  const targetService = serviceInfo ? serviceInfo.name : 'gateway';

  // Capture the response status after it finishes
  const originalEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - startTime;
    console.log(
      `[API Gateway] ${req.method} ${req.originalUrl} → ${targetService} → ${res.statusCode} (${duration}ms)`
    );
    originalEnd.apply(res, args);
  };

  next();
});

// ─── Gateway Health Check ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    service: 'api-gateway',
    status: 'UP',
    port: PORT,
    timestamp: new Date().toISOString(),
    upstreamServices: {
      userService: SERVICE_CONFIG.users.url,
      productService: SERVICE_CONFIG.products.url,
      orderService: SERVICE_CONFIG.orders.url,
    },
  });
});

// ─── Proxy Error Handler ─────────────────────────────────────────────
// Centralized 502/503 handling when a backend service is unavailable
function onProxyError(err, req, res, serviceName) {
  console.error(
    `[API Gateway] Proxy error for ${serviceName}: ${err.message}`
  );

  if (!res.headersSent) {
    const statusCode = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND'
      ? 503
      : 502;

    res.status(statusCode).json({
      error: statusCode === 503 ? 'Service Unavailable' : 'Bad Gateway',
      message: `${serviceName} is currently unreachable. Please try again later.`,
      service: serviceName,
      timestamp: new Date().toISOString(),
    });
  }
}

// ─── Proxy Factory ───────────────────────────────────────────────────
function createServiceProxy(routePrefix) {
  const config = SERVICE_CONFIG[routePrefix];

  return createProxyMiddleware({
    target: config.url,
    changeOrigin: true,
    // Express strips the mounted prefix from req.url; restore the full path.
    pathRewrite: (path, req) => req.originalUrl,
    // Timeout settings
    proxyTimeout: 5000,
    timeout: 5000,
    // Error handler for 502/503
    on: {
      error: (err, req, res) => onProxyError(err, req, res, config.name),
      proxyReq: (proxyReq, req) => {
        // Forward the original request body for POST/PUT
        if (req.body && (req.method === 'POST' || req.method === 'PUT')) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Type', 'application/json');
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },
    },
  });
}

// ─── Parse JSON body before proxying (needed for body forwarding) ────
app.use(express.json());

// ─── Route Definitions ──────────────────────────────────────────────
// /users/*    → User Service   (path is forwarded as-is)
// /products/* → Product Service
// /orders/*   → Order Service
//
// Using pathFilter approach so the original path (e.g. /users/101)
// is preserved when forwarding to the backend service.
app.use('/users', createServiceProxy('users'));
app.use('/products', createServiceProxy('products'));
app.use('/orders', createServiceProxy('orders'));

// ─── 404 Handler for Unmatched Routes ────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `The gateway does not have a route for ${req.method} ${req.originalUrl}`,
    availableRoutes: [
      'GET /health',
      'GET|POST /users',
      'GET|PUT|DELETE /users/:id',
      'GET|POST /products',
      'GET|PUT|DELETE /products/:id',
      'GET|POST /orders',
      'GET|DELETE /orders/:id',
    ],
  });
});

// ─── Start Server ────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`  API Gateway is running on port ${PORT}`);
  console.log(`=========================================`);
  console.log(`  Routing Configuration:`);
  console.log(`    /users    → ${SERVICE_CONFIG.users.url}`);
  console.log(`    /products → ${SERVICE_CONFIG.products.url}`);
  console.log(`    /orders   → ${SERVICE_CONFIG.orders.url}`);
  console.log(`=========================================`);
});
