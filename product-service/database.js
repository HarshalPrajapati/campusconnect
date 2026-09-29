const { MongoClient } = require('mongodb');

async function connectCollection(name, seed, firstId) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || undefined);
  const collection = db.collection(name);

  const existingCount = await collection.countDocuments();
  if (existingCount === 0 && seed.length) {
    try {
      await collection.insertMany(seed.map((item) => ({ _id: item.id, ...item })), { ordered: false });
    } catch (error) {
      if (error.code !== 11000 && !error.writeErrors?.every((entry) => entry.code === 11000)) throw error;
    }
  }

  const maxId = await collection.findOne({}, { sort: { _id: -1 }, projection: { _id: 1 } });
  await db.collection('sequences').updateOne(
    { _id: name },
    { $max: { value: maxId?._id || firstId - 1 } },
    { upsert: true }
  );

  return {
    collection,
    async nextId() {
      const result = await db.collection('sequences').findOneAndUpdate(
        { _id: name },
        { $inc: { value: 1 } },
        { returnDocument: 'after' }
      );
      const sequence = result?.value && typeof result.value === 'object' ? result.value : result;
      return sequence.value;
    },
    close: () => client.close(),
  };
}

function toApi(document) {
  if (!document) return document;
  if (document.value && typeof document.value === 'object' && Object.hasOwn(document, 'ok')) {
    document = document.value;
  }
  const { _id, ...fields } = document;
  return fields;
}

module.exports = { connectCollection, toApi };
