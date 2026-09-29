require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectCollection, toApi } = require('./database');

const app = express();
const PORT = process.env.PORT || process.env.USER_SERVICE_PORT || 3001;

app.use(cors());
app.use(express.json());

// Request logger for Docker logs and traceability
app.use((req, res, next) => {
  console.log(`[User Service] ${new Date().toISOString()} | ${req.method} ${req.url}`);
  next();
});

const initialUsers = [
  { id: 101, name: 'Aarav Patel', email: 'aarav@example.com', role: 'Student', createdAt: '2026-09-01T10:00:00Z' },
  { id: 102, name: 'Priya Sharma', email: 'priya.sharma@example.com', role: 'Student', createdAt: '2026-09-02T11:30:00Z' },
  { id: 103, name: 'Rohan Gupta', email: 'rohan.gupta@example.com', role: 'Faculty', createdAt: '2026-09-03T14:15:00Z' }
];

let users;

function handleDatabaseError(error, res) {
  console.error(`[User Service] Database operation failed: ${error.message}`);
  res.status(500).json({ error: 'Database error', message: 'The user request could not be completed' });
}

// Health Check
app.get('/health', async (req, res) => {
  res.status(200).json({
    service: 'user-service',
    status: 'UP',
    port: PORT,
    database: users ? 'CONNECTED' : 'DISCONNECTED',
    timestamp: new Date().toISOString()
  });
});

// GET /users - Get all users
app.get('/users', async (req, res) => {
  try { res.status(200).json((await users.collection.find().sort({ _id: 1 }).toArray()).map(toApi)); }
  catch (error) { handleDatabaseError(error, res); }
});

// GET /users/:id - Get user by ID
app.get('/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  let user;
  try { user = toApi(await users.collection.findOne({ _id: userId })); }
  catch (error) { return handleDatabaseError(error, res); }

  if (!user) {
    return res.status(404).json({
      error: 'User not found',
      message: `No user exists with id ${req.params.id}`
    });
  }

  res.status(200).json(user);
});

// POST /users - Create new user
app.post('/users', async (req, res) => {
  const { name, email, role } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Name and email are required fields'
    });
  }

  let existing;
  try { existing = await users.collection.findOne({ email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }); }
  catch (error) { return handleDatabaseError(error, res); }
  if (existing) {
    return res.status(409).json({
      error: 'User conflict',
      message: `User with email ${email} already exists`
    });
  }

  let newId;
  try { newId = await users.nextId(); }
  catch (error) { return handleDatabaseError(error, res); }
  const newUser = {
    id: newId,
    name,
    email,
    role: role || 'Student',
    createdAt: new Date().toISOString()
  };

  try { await users.collection.insertOne({ _id: newId, ...newUser }); }
  catch (error) { return handleDatabaseError(error, res); }
  console.log(`[User Service] Created new user: ${newUser.name} (ID: ${newUser.id})`);
  res.status(201).json(newUser);
});

// PUT /users/:id - Update user
app.put('/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  let current;
  try { current = await users.collection.findOne({ _id: userId }); }
  catch (error) { return handleDatabaseError(error, res); }
  if (!current) {
    return res.status(404).json({
      error: 'User not found',
      message: `Cannot update. No user found with id ${req.params.id}`
    });
  }

  const { name, email, role } = req.body;
  const updated = {
    ...(name && { name }), ...(email && { email }), ...(role && { role }),
    updatedAt: new Date().toISOString()
  };
  let result;
  try { result = await users.collection.findOneAndUpdate({ _id: userId }, { $set: updated }, { returnDocument: 'after' }); }
  catch (error) { return handleDatabaseError(error, res); }

  console.log(`[User Service] Updated user ID: ${userId}`);
  res.status(200).json(toApi(result.value || result));
});

// DELETE /users/:id - Delete user
app.delete('/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  let deletedUser;
  try { deletedUser = toApi(await users.collection.findOneAndDelete({ _id: userId })); }
  catch (error) { return handleDatabaseError(error, res); }
  if (!deletedUser) {
    return res.status(404).json({
      error: 'User not found',
      message: `Cannot delete. No user found with id ${req.params.id}`
    });
  }

  console.log(`[User Service] Deleted user ID: ${userId}`);
  res.status(200).json({
    message: 'User deleted successfully',
    user: deletedUser
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found on User Service' });
});

connectCollection('users', initialUsers, 101).then((database) => {
  users = database;
  app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`User Service is running on http://0.0.0.0:${PORT}`);
  console.log(`Responsibility: User Management & Authentication`);
  console.log(`=========================================`);
  });
}).catch((error) => {
  console.error(`[User Service] Could not connect to MongoDB: ${error.message}`);
  process.exit(1);
});
