require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectCollection, toApi } = require('./database');

const app = express();
const PORT = process.env.PORT || process.env.PRODUCT_SERVICE_PORT || 3002;

app.use(cors());
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`[Product Service] ${new Date().toISOString()} | ${req.method} ${req.url}`);
  next();
});

// Dedicated Product Database
const initialProducts = [
  { id: 501, name: 'Ergonomic Laptop Stand', price: 45.00, category: 'Accessories', stock: 50, createdAt: '2026-09-01T10:00:00Z' },
  { id: 502, name: 'Wireless Ergonomic Mouse', price: 25.00, category: 'Peripherals', stock: 120, createdAt: '2026-09-02T11:00:00Z' },
  { id: 503, name: 'Mechanical Keyboard (RGB)', price: 85.00, category: 'Peripherals', stock: 35, createdAt: '2026-09-03T12:00:00Z' },
  { id: 504, name: 'CampusConnect Notebook (Pack of 3)', price: 12.00, category: 'Stationery', stock: 200, createdAt: '2026-09-04T13:00:00Z' }
];

let products;
function handleDatabaseError(error, res) {
  console.error(`[Product Service] Database operation failed: ${error.message}`);
  res.status(500).json({ error: 'Database error', message: 'The product request could not be completed' });
}

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({
    service: 'product-service',
    status: 'UP',
    port: PORT,
    database: products ? 'CONNECTED' : 'DISCONNECTED',
    timestamp: new Date().toISOString()
  });
});

// GET /products - Get all products
app.get('/products', async (req, res) => {
  try { res.status(200).json((await products.collection.find().sort({ _id: 1 }).toArray()).map(toApi)); }
  catch (error) { handleDatabaseError(error, res); }
});

// GET /products/:id - Get product by ID
app.get('/products/:id', async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  let product;
  try { product = toApi(await products.collection.findOne({ _id: productId })); }
  catch (error) { return handleDatabaseError(error, res); }

  if (!product) {
    return res.status(404).json({
      error: 'Product not found',
      message: `No product exists with id ${req.params.id}`
    });
  }

  res.status(200).json(product);
});

// POST /products - Create new product
app.post('/products', async (req, res) => {
  const { name, price, category, stock } = req.body;

  if (!name || price === undefined || price === null) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Product name and price are required'
    });
  }

  if (typeof price !== 'number' || price < 0) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Price must be a positive number'
    });
  }

  let newId;
  try { newId = await products.nextId(); }
  catch (error) { return handleDatabaseError(error, res); }
  const newProduct = {
    id: newId,
    name,
    price: parseFloat(price.toFixed(2)),
    category: category || 'General',
    stock: typeof stock === 'number' ? stock : 10,
    createdAt: new Date().toISOString()
  };

  try { await products.collection.insertOne({ _id: newId, ...newProduct }); }
  catch (error) { return handleDatabaseError(error, res); }
  console.log(`[Product Service] Created product: ${newProduct.name} (ID: ${newProduct.id}, Price: $${newProduct.price})`);
  res.status(201).json(newProduct);
});

// PUT /products/:id - Update product
app.put('/products/:id', async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  let current;
  try { current = await products.collection.findOne({ _id: productId }); }
  catch (error) { return handleDatabaseError(error, res); }
  if (!current) {
    return res.status(404).json({
      error: 'Product not found',
      message: `Cannot update. No product found with id ${req.params.id}`
    });
  }

  const { name, price, category, stock } = req.body;
  const updates = {
    ...(name && { name }),
    ...(price !== undefined && { price: parseFloat(Number(price).toFixed(2)) }),
    ...(category && { category }),
    ...(stock !== undefined && { stock: parseInt(stock, 10) }),
    updatedAt: new Date().toISOString()
  };
  let result;
  try { result = await products.collection.findOneAndUpdate({ _id: productId }, { $set: updates }, { returnDocument: 'after' }); }
  catch (error) { return handleDatabaseError(error, res); }

  console.log(`[Product Service] Updated product ID: ${productId}`);
  res.status(200).json(toApi(result.value || result));
});

// DELETE /products/:id - Delete product
app.delete('/products/:id', async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  let deletedProduct;
  try { deletedProduct = toApi(await products.collection.findOneAndDelete({ _id: productId })); }
  catch (error) { return handleDatabaseError(error, res); }
  if (!deletedProduct) {
    return res.status(404).json({
      error: 'Product not found',
      message: `Cannot delete. No product found with id ${req.params.id}`
    });
  }

  console.log(`[Product Service] Deleted product ID: ${productId}`);
  res.status(200).json({
    message: 'Product deleted successfully',
    product: deletedProduct
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found on Product Service' });
});

connectCollection('products', initialProducts, 501).then((database) => {
  products = database;
  app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`Product Service is running on http://0.0.0.0:${PORT}`);
  console.log(`Responsibility: Product Catalog & Inventory`);
  console.log(`=========================================`);
  });
}).catch((error) => {
  console.error(`[Product Service] Could not connect to MongoDB: ${error.message}`);
  process.exit(1);
});
