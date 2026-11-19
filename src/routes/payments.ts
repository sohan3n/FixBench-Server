import { Request, Response, Router } from "express";
import { MongoServerError, ObjectId } from "mongodb";
import Stripe from "stripe";
import { getCollections } from "../config/db.js";
import {
  verifyCustomer,
  verifyTechnician,
  verifyToken,
} from "../middlewares/auth.js";

const router = Router();

const PRO_PLAN_PRICE_USD = 19.99;

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (stripeClient) return stripeClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || secretKey.startsWith("sk_test_your_")) {
    throw new Error("Missing or placeholder STRIPE_SECRET_KEY in server .env");
  }

  stripeClient = new Stripe(secretKey);
  return stripeClient;
}

interface FulfillmentResult {
  payment: Record<string, unknown>;
  paymentType: "booking" | "pro_plan";
  alreadyProcessed: boolean;
}

/**
 * Shared idempotent fulfillment used by both GET /api/payments/verify and POST /api/payments/webhook.
 * Guarantees the same Stripe Checkout Session is never recorded twice.
 */
async function fulfillStripeSession(
  session: Stripe.Checkout.Session
): Promise<FulfillmentResult> {
  const { paymentsCollection, bookingsCollection, usersCollection } =
    getCollections();

  // Layer 1 idempotency check
  const existingPayment = await paymentsCollection.findOne({
    stripeSessionId: session.id,
  });

  const paymentType =
    session.metadata?.paymentType === "pro_plan" ? "pro_plan" : "booking";

  if (existingPayment) {
    return {
      payment: {
        ...existingPayment,
        _id: existingPayment._id.toString(),
      },
      paymentType,
      alreadyProcessed: true,
    };
  }

  const transactionId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || session.id;

  const now = new Date();
  const amountPaid =
    Math.round(((session.amount_total ?? 0) / 100) * 100) / 100;
  const currency = session.currency || "usd";

  if (paymentType === "pro_plan") {
    const technicianEmail =
      session.metadata?.technicianEmail || session.customer_email || "";
    const technicianName =
      session.metadata?.technicianName || "FixBench Technician";

    const paymentDoc = {
      bookingId: "pro-plan",
      serviceTitle: "FixBench Verified Pro Plan",
      customerName: technicianName,
      customerEmail: technicianEmail,
      technicianName: "FixBench Platform",
      technicianEmail: "platform@fixbench.com",
      amount: amountPaid > 0 ? amountPaid : PRO_PLAN_PRICE_USD,
      currency,
      transactionId,
      stripeSessionId: session.id,
      paymentStatus: "paid" as const,
      paidAt: now,
    };

    try {
      const insertRes = await paymentsCollection.insertOne(paymentDoc);

      if (technicianEmail) {
        await usersCollection.updateOne(
          { email: technicianEmail },
          { $set: { plan: "pro", updatedAt: now } }
        );
      }

      return {
        payment: {
          ...paymentDoc,
          _id: insertRes.insertedId.toString(),
        },
        paymentType: "pro_plan",
        alreadyProcessed: false,
      };
    } catch (error) {
      // Layer 2 atomic race-condition guard on unique stripeSessionId index
      if (error instanceof MongoServerError && error.code === 11000) {
        const duplicate = await paymentsCollection.findOne({
          stripeSessionId: session.id,
        });
        if (duplicate) {
          return {
            payment: { ...duplicate, _id: duplicate._id.toString() },
            paymentType: "pro_plan",
            alreadyProcessed: true,
          };
        }
      }
      throw error;
    }
  }

  // Standard completed booking payment
  const bookingId = session.metadata?.bookingId || "";
  if (!ObjectId.isValid(bookingId)) {
    throw new Error("Invalid bookingId in Stripe session metadata");
  }

  const booking = await bookingsCollection.findOne({
    _id: new ObjectId(bookingId),
  });

  if (!booking) {
    throw new Error("Associated booking not found for Stripe session");
  }

  const fallbackAmount = Number(booking.finalAmount) || 0;
  const paymentDoc = {
    bookingId,
    serviceTitle: String(booking.serviceTitle || "Repair Service"),
    customerName: String(booking.customerName || ""),
    customerEmail: String(booking.customerEmail || session.customer_email || ""),
    technicianName: String(booking.technicianName || ""),
    technicianEmail: String(booking.technicianEmail || ""),
    amount: amountPaid > 0 ? amountPaid : fallbackAmount,
    currency,
    transactionId,
    stripeSessionId: session.id,
    paymentStatus: "paid" as const,
    paidAt: now,
  };

  try {
    const insertRes = await paymentsCollection.insertOne(paymentDoc);

    await bookingsCollection.updateOne(
      { _id: new ObjectId(bookingId) },
      {
        $set: {
          paymentStatus: "paid",
          updatedAt: now,
        },
      }
    );

    return {
      payment: {
        ...paymentDoc,
        _id: insertRes.insertedId.toString(),
      },
      paymentType: "booking",
      alreadyProcessed: false,
    };
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      const duplicate = await paymentsCollection.findOne({
        stripeSessionId: session.id,
      });
      if (duplicate) {
        return {
          payment: { ...duplicate, _id: duplicate._id.toString() },
          paymentType: "booking",
          alreadyProcessed: true,
        };
      }
    }
    throw error;
  }
}

// ============================================================================
// RAW-BODY STRIPE WEBHOOK HANDLER (Mounted BEFORE express.json() in index.ts)
// ============================================================================

export async function stripeWebhookHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const stripe = getStripe();
    const signature = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || typeof signature !== "string") {
      res.status(400).json({ message: "Missing stripe-signature header" });
      return;
    }

    if (!webhookSecret || webhookSecret.startsWith("whsec_your_")) {
      res.status(500).json({ message: "Stripe webhook secret not configured" });
      return;
    }

    const event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      signature,
      webhookSecret
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid") {
        await fulfillStripeSession(session);
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Webhook signature verification failed";
    console.error("Stripe webhook error:", message);
    res.status(400).json({ message: `Webhook Error: ${message}` });
  }
}

// ============================================================================
// PROTECTED PAYMENT ROUTES
// ============================================================================

// POST /api/payments/create-checkout-session — Customer pays for a completed & unpaid job
router.post(
  "/create-checkout-session",
  verifyToken,
  verifyCustomer,
  async (req: Request, res: Response) => {
    try {
      const { bookingId } = req.body as { bookingId?: unknown };

      if (typeof bookingId !== "string" || !ObjectId.isValid(bookingId)) {
        res.status(400).json({ message: "Valid bookingId is required" });
        return;
      }

      const { bookingsCollection } = getCollections();
      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(bookingId),
      });

      if (!booking) {
        res.status(404).json({ message: "Booking not found" });
        return;
      }

      // Challenge 3: Strict customer ownership & status/payment gate
      if (booking.customerEmail !== req.user!.email) {
        res.status(403).json({
          message: "Forbidden: You can only pay for your own bookings",
        });
        return;
      }

      if (booking.paymentStatus === "paid") {
        res.status(409).json({ message: "This booking has already been paid" });
        return;
      }

      if (booking.status !== "completed") {
        res.status(400).json({
          message:
            "Payment is only allowed after the technician marks the job as completed",
        });
        return;
      }

      const finalAmount = Number(booking.finalAmount);
      if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
        res.status(400).json({ message: "Invalid booking payment amount" });
        return;
      }

      const stripe = getStripe();
      const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: req.user!.email,
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: Math.round(finalAmount * 100),
              product_data: {
                name: String(booking.serviceTitle || "FixBench Repair Service"),
                description: `Repair service by ${booking.technicianName} (${booking.category})`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          paymentType: "booking",
          bookingId,
          customerEmail: req.user!.email,
          technicianEmail: String(booking.technicianEmail || ""),
        },
        success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/payment/cancel?booking_id=${bookingId}`,
      });

      res.status(200).json({
        sessionId: session.id,
        url: session.url,
      });
    } catch (error) {
      console.error("Error creating booking checkout session:", error);
      res.status(500).json({ message: "Failed to initiate Stripe Checkout" });
    }
  }
);

// POST /api/payments/pro-checkout — Technician upgrades from Free to Verified Pro plan
router.post(
  "/pro-checkout",
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response) => {
    try {
      if (req.user!.plan === "pro") {
        res
          .status(409)
          .json({ message: "You are already on the Verified Pro plan" });
        return;
      }

      const stripe = getStripe();
      const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: req.user!.email,
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: Math.round(PRO_PLAN_PRICE_USD * 100),
              product_data: {
                name: "FixBench Verified Pro Technician Plan",
                description:
                  "Unlimited service listings and Verified Pro badge across FixBench",
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          paymentType: "pro_plan",
          technicianEmail: req.user!.email,
          technicianName: req.user!.name,
        },
        success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/payment/cancel?plan=pro`,
      });

      res.status(200).json({
        sessionId: session.id,
        url: session.url,
      });
    } catch (error) {
      console.error("Error creating Pro plan checkout session:", error);
      res
        .status(500)
        .json({ message: "Failed to initiate Pro plan checkout" });
    }
  }
);

// GET /api/payments/verify?session_id=... — Verifies Stripe session on /payment/success
router.get("/verify", verifyToken, async (req: Request, res: Response) => {
  try {
    const sessionId =
      typeof req.query.session_id === "string"
        ? req.query.session_id.trim()
        : "";

    if (!sessionId) {
      res.status(400).json({ message: "session_id query parameter is required" });
      return;
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const sessionOwnerEmail =
      session.metadata?.customerEmail ||
      session.metadata?.technicianEmail ||
      session.customer_email ||
      "";

    if (sessionOwnerEmail && sessionOwnerEmail !== req.user!.email) {
      res.status(403).json({
        message: "Forbidden: This payment session does not belong to you",
      });
      return;
    }

    if (session.payment_status !== "paid") {
      res.status(400).json({
        message: "Payment has not been completed for this session",
        paymentStatus: session.payment_status,
      });
      return;
    }

    const result = await fulfillStripeSession(session);

    res.status(200).json({
      message: "Payment verified successfully",
      paymentType: result.paymentType,
      alreadyProcessed: result.alreadyProcessed,
      payment: result.payment,
    });
  } catch (error) {
    console.error("Error verifying Stripe session:", error);
    res.status(500).json({ message: "Failed to verify payment session" });
  }
});

// GET /api/payments/my — Customer payment history
router.get(
  "/my",
  verifyToken,
  verifyCustomer,
  async (req: Request, res: Response) => {
    try {
      const { paymentsCollection } = getCollections();
      const rawPayments = await paymentsCollection
        .find({ customerEmail: req.user!.email })
        .sort({ paidAt: -1 })
        .toArray();

      const payments = rawPayments.map((payment) => ({
        ...payment,
        _id: payment._id.toString(),
      }));

      res.status(200).json({ payments });
    } catch (error) {
      console.error("Error fetching customer payments:", error);
      res.status(500).json({ message: "Failed to fetch payment history" });
    }
  }
);

export default router;