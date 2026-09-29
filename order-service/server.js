require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectCollection, toApi } = require('./database');

const app = express();
const PORT = process.env.PORT || process.env.ORDER_SERVICE_PORT || 3003;

// Upstream microservice endpoints (configured via environment variables)
function serviceUrl(value, fallback) {
  const url = value || fallback;
  return /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `http://${url}`;
}
const USER_SERVICE_URL = serviceUrl(process.env.USER_SERVICE_URL, 'http://localhost:3001');
const PRODUCT_SERVICE_URL = serviceUrl(process.env.PRODUCT_SERVICE_URL, 'http://localhost:3002');
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 4000;

app.use(cors());
app.use(express.json());

// Request logging for Docker logs and traceability
app.use((req, res, next) => {
  console.log(`[Order Service] ${new Date().toISOString()} | ${req.method} ${req.url}`);
  next();
});

const initialOrders = [
  {
    id: 1001,
    userId: 101,
    productId: 501,
    quantity: 2,
    unitPrice: 45.00,
    totalPrice: 90.00,
    status: 'CONFIRMED',
    userSnapshot: {
      name: 'Aarav Patel',
      email: 'aarav@example.com'
    },
    productSnapshot: {
      name: 'Ergonomic Laptop Stand',
      category: 'Accessories'
    },
    createdAt: '2026-09-05T09:00:00Z'
  }
];

// Helper to fetch upstream service with timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

let orders;
function handleDatabaseError(error, res) {
  console.error(`[Order Service] Database operation failed: ${error.message}`);
  res.status(500).json({ error: 'Database error', message: 'The order request could not be completed' });
}

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({
    service: 'order-service',
    status: 'UP',
    port: PORT,
    dependencies: {
      userServiceUrl: USER_SERVICE_URL,
      productServiceUrl: PRODUCT_SERVICE_URL,
      database: orders ? 'CONNECTED' : 'DISCONNECTED'
    },
    timestamp: new Date().toISOString()
  });
});

// GET /orders - Retrieve all orders
app.get('/orders', async (req, res) => {
  try { res.status(200).json((await orders.collection.find().sort({ _id: 1 }).toArray()).map(toApi)); }
  catch (error) { handleDatabaseError(error, res); }
});

// GET /orders/:id - Retrieve order by ID
app.get('/orders/:id', async (req, res) => {
  const orderId = parseInt(req.params.id, 10);
  let order;
  try { order = toApi(await orders.collection.findOne({ _id: orderId })); }
  catch (error) { return handleDatabaseError(error, res); }

  if (!order) {
    return res.status(404).json({
      error: 'Order not found',
      message: `No order exists with id ${req.params.id}`
    });
  }

  res.status(200).json(order);
});

// POST /orders - Create order with inter-service validation
app.post('/orders', async (req, res) => {
  const { userId, productId, quantity } = req.body;

  // 1. Validate payload structure
  if (userId === undefined || productId === undefined) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'userId and productId are required'
    });
  }

  const orderQuantity = parseInt(quantity, 10) || 1;
  if (orderQuantity <= 0) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Quantity must be a positive integer greater than 0'
    });
  }

  // 2. Inter-service call: Validate User exists via User Service
  let userData;
  try {
    console.log(`[Order Service] Calling User Service -> GET ${USER_SERVICE_URL}/users/${userId}`);
    const userRes = await fetchWithTimeout(`${USER_SERVICE_URL}/users/${userId}`);

    if (userRes.status === 404) {
      console.warn(`[Order Service] User ${userId} not found in User Service`);
      return res.status(404).json({
        error: 'User not found',
        message: `Referenced user ID ${userId} does not exist in User Service`
      });
    }

    if (!userRes.ok) {
      console.error(`[Order Service] User Service returned status ${userRes.status}`);
      return res.status(userRes.status).json({
        error: 'User Service error',
        message: `User Service returned HTTP status ${userRes.status}`
      });
    }

    userData = await userRes.json();
  } catch (err) {
    console.error(`[Order Service] Failed to communicate with User Service: ${err.message}`);
    return res.status(503).json({
      error: 'Service Unavailable',
      message: `User Service is unreachable at ${USER_SERVICE_URL}. Order validation aborted.`,
      details: err.message
    });
  }

  // 3. Inter-service call: Validate Product exists via Product Service
  let productData;
  try {
    console.log(`[Order Service] Calling Product Service -> GET ${PRODUCT_SERVICE_URL}/products/${productId}`);
    const productRes = await fetchWithTimeout(`${PRODUCT_SERVICE_URL}/products/${productId}`);

    if (productRes.status === 404) {
      console.warn(`[Order Service] Product ${productId} not found in Product Service`);
      return res.status(404).json({
        error: 'Product not found',
        message: `Referenced product ID ${productId} does not exist in Product Service`
      });
    }

    if (!productRes.ok) {
      console.error(`[Order Service] Product Service returned status ${productRes.status}`);
      return res.status(productRes.status).json({
        error: 'Product Service error',
        message: `Product Service returned HTTP status ${productRes.status}`
      });
    }

    productData = await productRes.json();
  } catch (err) {
    console.error(`[Order Service] Failed to communicate with Product Service: ${err.message}`);
    return res.status(503).json({
      error: 'Service Unavailable',
      message: `Product Service is unreachable at ${PRODUCT_SERVICE_URL}. Order validation aborted.`,
      details: err.message
    });
  }

  // 4. Calculate pricing & construct order
  const unitPrice = productData.price;
  const totalPrice = parseFloat((unitPrice * orderQuantity).toFixed(2));
  let newOrderId;
  try { newOrderId = await orders.nextId(); }
  catch (error) { return handleDatabaseError(error, res); }

  const newOrder = {
    id: newOrderId,
    userId: userData.id,
    productId: productData.id,
    quantity: orderQuantity,
    unitPrice: unitPrice,
    totalPrice: totalPrice,
    status: 'CONFIRMED',
    userSnapshot: {
      name: userData.name,
      email: userData.email,
      role: userData.role
    },
    productSnapshot: {
      name: productData.name,
      category: productData.category
    },
    createdAt: new Date().toISOString()
  };

  try { await orders.collection.insertOne({ _id: newOrderId, ...newOrder }); }
  catch (error) { return handleDatabaseError(error, res); }
  console.log(`[Order Service] Created order ID ${newOrder.id} for User "${userData.name}" - Total: $${totalPrice}`);
  res.status(201).json(newOrder);
});

// DELETE /orders/:id - Cancel/delete order
app.delete('/orders/:id', async (req, res) => {
  const orderId = parseInt(req.params.id, 10);
  let deletedOrder;
  try { deletedOrder = toApi(await orders.collection.findOneAndDelete({ _id: orderId })); }
  catch (error) { return handleDatabaseError(error, res); }
  if (!deletedOrder) {
    return res.status(404).json({
      error: 'Order not found',
      message: `Cannot delete. No order found with id ${req.params.id}`
    });
  }

  console.log(`[Order Service] Deleted order ID: ${orderId}`);
  res.status(200).json({
    message: 'Order cancelled/deleted successfully',
    order: deletedOrder
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found on Order Service' });
});

connectCollection('orders', initialOrders, 1001).then((database) => {
  orders = database;
  app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`Order Service is running on http://0.0.0.0:${PORT}`);
  console.log(`Responsibility: Order Processing & Orchestration`);
  console.log(`User Service URL:    ${USER_SERVICE_URL}`);
  console.log(`Product Service URL: ${PRODUCT_SERVICE_URL}`);
  console.log(`=========================================`);
  });
}).catch((error) => {
  console.error(`[Order Service] Could not connect to MongoDB: ${error.message}`);
  process.exit(1);
});
