import { Collection, Db, MongoClient, ServerApiVersion } from "mongodb";
import dotenv from "dotenv";
import {
  BookingDoc,
  PaymentDoc,
  ServiceDoc,
  UserDoc,
} from "../types/index.js";

dotenv.config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("Missing MONGODB_URI in server .env");
}

const dbName = process.env.DB_NAME || "fixbench";

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db: Db;

export async function connectDB(): Promise<Db> {
  if (!db) {
    await client.connect();
    db = client.db(dbName);
    await ensureIndexes(db);
    console.log(`Connected to MongoDB database: ${dbName}`);
  }
  return db;
}

async function ensureIndexes(database: Db): Promise<void> {
  // BetterAuth stores users in the "user" collection
  await database.collection("user").createIndex({ email: 1 }, { unique: true });

  await database
    .collection("services")
    .createIndex({ approvalStatus: 1, isAvailable: 1, createdAt: -1 });
  await database.collection("services").createIndex({ technicianEmail: 1 });

  await database
    .collection("bookings")
    .createIndex({ customerEmail: 1, serviceId: 1, status: 1 });
  await database.collection("bookings").createIndex({ technicianEmail: 1 });

  // Prevent duplicate payment entries across Stripe webhooks & verify endpoints
  await database
    .collection("payments")
    .createIndex({ stripeSessionId: 1 }, { unique: true });
}

export function getCollections() {
  if (!db) {
    throw new Error("Database not initialized. Call connectDB() first.");
  }
  return {
    usersCollection: db.collection<UserDoc>("user"),
    servicesCollection: db.collection<ServiceDoc>("services"),
    bookingsCollection: db.collection<BookingDoc>("bookings"),
    paymentsCollection: db.collection<PaymentDoc>("payments"),
  };
}