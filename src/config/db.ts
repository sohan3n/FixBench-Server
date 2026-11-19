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
let connectPromise: Promise<Db> | null = null;

export async function connectDB(): Promise<Db> {
  if (database) return database;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      await client.connect();
      const db = client.db(dbName);

      const usersCollection = db.collection("user");
      const servicesCollection = db.collection("services");
      const bookingsCollection = db.collection("bookings");
      const paymentsCollection = db.collection("payments");

      await Promise.all([
        usersCollection.createIndex({ email: 1 }, { unique: true }),
        paymentsCollection.createIndex({ stripeSessionId: 1 }, { unique: true }),
        paymentsCollection.createIndex({ paidAt: -1 }),
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
        servicesCollection.createIndex({
          technicianEmail: 1,
          createdAt: -1,
        }),
        bookingsCollection.createIndex({ serviceId: 1, rating: 1 }),
        bookingsCollection.createIndex({ customerEmail: 1, createdAt: -1 }),
        bookingsCollection.createIndex({
          customerEmail: 1,
          serviceId: 1,
          status: 1,
        }),
        bookingsCollection.createIndex({ technicianEmail: 1, createdAt: -1 }),
      ]);

      database = db;
      console.log(`Connected to MongoDB database: ${dbName}`);
      return db;
    } catch (error) {
      connectPromise = null;
      throw error;
    }
  })();

  return connectPromise;
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