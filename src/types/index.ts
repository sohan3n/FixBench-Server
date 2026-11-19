import { ObjectId } from "mongodb";

export type UserRole = "customer" | "technician" | "admin";
export type TechnicianPlan = "free" | "pro";

export type ServiceCategory =
  | "Smartphone"
  | "Laptop & PC"
  | "AC"
  | "Refrigerator"
  | "TV"
  | "Washing Machine"
  | "Electrical";

export type ServiceMode = "Home Visit" | "Shop Drop-off";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export type BookingStatus =
  | "requested"
  | "accepted"
  | "rejected"
  | "in-progress"
  | "completed"
  | "cancelled";

export type PaymentStatus = "unpaid" | "paid";

export interface StatusHistoryEntry {
  status: BookingStatus | "paid";
  changedAt: Date;
}

// 1. users (Unified with BetterAuth's 'user' collection)
export interface UserDoc {
  _id?: ObjectId;
  name: string;
  email: string;
  image?: string;
  role: UserRole;
  phone?: string;
  area?: string;
  bio?: string;
  plan?: TechnicianPlan; // Optional 1: 'free' (max 3 services) | 'pro' (unlimited)
  createdAt?: Date;
  updatedAt?: Date;
}

// 2. services
export interface ServiceDoc {
  _id?: ObjectId;
  title: string;
  category: ServiceCategory;
  description: string;
  image: string;
  basePrice: number;
  estimatedDuration: string;
  serviceMode: ServiceMode;
  serviceArea: string;
  technicianName: string;
  technicianEmail: string;
  approvalStatus: ApprovalStatus;
  isAvailable: boolean;
  createdAt: Date;
}

// 3. bookings
export interface BookingDoc {
  _id?: ObjectId;
  serviceId: string;
  serviceTitle: string;
  serviceImage: string;
  category: ServiceCategory;
  basePrice: number;
  technicianName: string;
  technicianEmail: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: string;
  preferredDate: Date;
  problemDescription: string;
  status: BookingStatus;
  finalAmount: number;
  paymentStatus: PaymentStatus;
  statusHistory: StatusHistoryEntry[]; // Optional 3: Job Timeline Tracker
  rating?: number; // Optional 2: 1-5 stars
  review?: string; // Optional 2: Customer review
  createdAt: Date;
}

// 4. payments
export interface PaymentDoc {
  _id?: ObjectId;
  bookingId: string;
  paymentType?: "booking" | "subscription";
  serviceTitle: string;
  customerName: string;
  customerEmail: string;
  technicianName: string;
  technicianEmail: string;
  amount: number;
  currency: "usd";
  transactionId: string;
  stripeSessionId: string;
  paymentStatus: "paid";
  paidAt: Date;
}