import { Collection, Db, MongoClient, ServerApiVersion } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("Missing MONGODB_URI in fix-bench-server/.env");
}

const dbName = process.env.DB_NAME || "fixbench";

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let database: Db | null = null;

export async function connectDB(): Promise<Db> {
  if (database) return database;

  await client.connect();
  database = client.db(dbName);

  const usersCollection = database.collection("user");
  const servicesCollection = database.collection("services");
  const bookingsCollection = database.collection("bookings");
  const paymentsCollection = database.collection("payments");

  // Core uniqueness & query performance indexes
  await Promise.all([
    usersCollection.createIndex({ email: 1 }, { unique: true }),
    paymentsCollection.createIndex({ stripeSessionId: 1 }, { unique: true }),
    servicesCollection.createIndex({
      approvalStatus: 1,
      isAvailable: 1,
      createdAt: -1,
    }),
    servicesCollection.createIndex({
      category: 1,
      serviceMode: 1,
      basePrice: 1,
    }),
    bookingsCollection.createIndex({ serviceId: 1, rating: 1 }),
  ]);

  console.log(`Connected to MongoDB database: ${dbName}`);
  return database;
}

export function getCollections(): {
  usersCollection: Collection;
  servicesCollection: Collection;
  bookingsCollection: Collection;
  paymentsCollection: Collection;
} {
  if (!database) {
    throw new Error("Database not initialized. Call connectDB() first.");
  }

  return {
    usersCollection: database.collection("user"),
    servicesCollection: database.collection("services"),
    bookingsCollection: database.collection("bookings"),
    paymentsCollection: database.collection("payments"),
  };
}