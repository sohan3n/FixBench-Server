import crypto from "node:crypto";
import { promisify } from "node:util";
import dotenv from "dotenv";
import { ObjectId } from "mongodb";
import { connectDB, getCollections } from "./config/db.js";

dotenv.config();

const scryptAsync = promisify(crypto.scrypt);

/**
 * Generates a BetterAuth-compatible scrypt password hash (`saltHex:derivedKeyHex`)
 * matching BetterAuth's credential provider parameters (N=16384, r=16, p=1, dkLen=64).
 */
async function hashBetterAuthPassword(password: string): Promise<string> {
  const saltHex = crypto.randomBytes(16).toString("hex");
  const derivedKey = (await (scryptAsync as any)(
    password.normalize("NFKC"),
    saltHex,
    64,
    {
      N: 16384,
      r: 16,
      p: 1,
      maxmem: 128 * 16384 * 16 * 2,
    }
  )) as Buffer;

  return `${saltHex}:${derivedKey.toString("hex")}`;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysFromNowISO(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]!;
}

async function seedDatabase(): Promise<void> {
  const db = await connectDB();
  const {
    usersCollection,
    servicesCollection,
    bookingsCollection,
    paymentsCollection,
  } = getCollections();
  const accountsCollection = db.collection("account");
  const sessionsCollection = db.collection("session");

  console.log("Resetting previous demo data...");
  await Promise.all([
    usersCollection.deleteMany({}),
    accountsCollection.deleteMany({}),
    sessionsCollection.deleteMany({}),
    servicesCollection.deleteMany({}),
    bookingsCollection.deleteMany({}),
    paymentsCollection.deleteMany({}),
  ]);

  // ---------------------------------------------------------------------------
  // 1. SEED USERS (1 Admin, 3 Technicians [1 Pro, 2 Free], 2 Customers)
  // ---------------------------------------------------------------------------
  const [adminPassword, techPassword, customerPassword] = await Promise.all([
    hashBetterAuthPassword("Admin@1234"),
    hashBetterAuthPassword("Tech@1234"),
    hashBetterAuthPassword("Customer@1234"),
  ]);

  const adminId = new ObjectId();
  const techProId = new ObjectId();
  const techFree1Id = new ObjectId();
  const techFree2Id = new ObjectId();
  const customer1Id = new ObjectId();
  const customer2Id = new ObjectId();

  const seedUsers = [
    {
      _id: adminId,
      name: "Mainur Admin",
      email: "admin@fixbench.com",
      emailVerified: true,
      image:
        "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=400&q=80",
      role: "admin",
      plan: "free",
      phone: "+880 1711-000101",
      area: "Dhaka — Gulshan",
      bio: "Platform Operations Administrator overseeing technician verification, service moderation, and Stripe payment audits.",
      createdAt: daysAgo(90),
      updatedAt: daysAgo(5),
      plainPassword: adminPassword,
    },
    {
      _id: techProId,
      name: "Tariq Hasan",
      email: "tech.pro@fixbench.com",
      emailVerified: true,
      image:
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80",
      role: "technician",
      plan: "pro",
      phone: "+880 1819-220410",
      area: "Dhaka — Banani & Dhanmondi",
      bio: "Certified micro-soldering, laptop logic-board, and flagship smartphone specialist with 9+ years of bench experience.",
      createdAt: daysAgo(75),
      updatedAt: daysAgo(2),
      plainPassword: techPassword,
    },
    {
      _id: techFree1Id,
      name: "Nusrat Jahan",
      email: "tech.free@fixbench.com",
      emailVerified: true,
      image:
        "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80",
      role: "technician",
      plan: "free",
      phone: "+880 1912-334512",
      area: "Chittagong — GEC & Agrabad",
      bio: "Smart TV display calibration, OLED power-board repair, and home theater diagnostics specialist.",
      createdAt: daysAgo(60),
      updatedAt: daysAgo(4),
      plainPassword: techPassword,
    },
    {
      _id: techFree2Id,
      name: "Kamrul Islam",
      email: "tech.appliances@fixbench.com",
      emailVerified: true,
      image:
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80",
      role: "technician",
      plan: "free",
      phone: "+880 1611-889021",
      area: "Dhaka — Uttara & Mirpur",
      bio: "HVAC inverter AC gas refilling, refrigerator compressor diagnostics, and front-load washing machine repair technician.",
      createdAt: daysAgo(55),
      updatedAt: daysAgo(3),
      plainPassword: techPassword,
    },
    {
      _id: customer1Id,
      name: "Rafiul Karim",
      email: "customer@fixbench.com",
      emailVerified: true,
      image:
        "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=400&q=80",
      role: "customer",
      plan: "free",
      phone: "+880 1715-443219",
      area: "Dhaka — Dhanmondi",
      bio: "Product designer and homeowner booking regular laptop, smartphone, and home appliance maintenance.",
      createdAt: daysAgo(50),
      updatedAt: daysAgo(1),
      plainPassword: customerPassword,
    },
    {
      _id: customer2Id,
      name: "Sadia Rahman",
      email: "sadia.customer@fixbench.com",
      emailVerified: true,
      image:
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80",
      role: "customer",
      plan: "free",
      phone: "+880 1817-990341",
      area: "Chittagong — Nasirabad",
      bio: "Homeowner using FixBench for verified home appliance and electrical repairs.",
      createdAt: daysAgo(45),
      updatedAt: daysAgo(2),
      plainPassword: customerPassword,
    },
  ];

  await usersCollection.insertMany(
    seedUsers.map(({ plainPassword: _pw, ...userDoc }) => userDoc)
  );

  await accountsCollection.insertMany(
    seedUsers.map((u) => ({
      _id: new ObjectId(),
      accountId: u._id.toString(),
      providerId: "credential",
      userId: u._id,
      password: u.plainPassword,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }))
  );

  // ---------------------------------------------------------------------------
  // 2. SEED SERVICES (15 Total: 14 Approved across all 7 categories + 1 Pending)
  // ---------------------------------------------------------------------------
  const servicesData = [
    {
      _id: new ObjectId(),
      title: "iPhone & Flagship OLED Screen Replacement",
      category: "Smartphone",
      description:
        "True-Tone calibrated OLED display assembly replacement with fresh waterproof gasket seal, Face ID sensor check, and 90-day part warranty.",
      image:
        "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80",
      basePrice: 120,
      estimatedDuration: "1–2 Hours",
      serviceMode: "Shop Drop-off",
      serviceArea: "Dhaka — Banani & Dhanmondi",
      technicianName: "Tariq Hasan",
      technicianEmail: "tech.pro@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    },
    {
      _id: new ObjectId(),
      title: "MacBook & Ultrabook Logic Board Liquid Damage Repair",
      category: "Laptop & PC",
      description:
        "Ultrasonic board cleaning, shorted capacitor replacement, USB-C power delivery IC micro-soldering, and thermal paste renewal.",
      image:
        "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80",
      basePrice: 165,
      estimatedDuration: "1–2 Days",
      serviceMode: "Shop Drop-off",
      serviceArea: "Dhaka — Banani & Dhanmondi",
      technicianName: "Tariq Hasan",
      technicianEmail: "tech.pro@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(28),
      updatedAt: daysAgo(28),
    },
    {
      _id: new ObjectId(),
      title: "Inverter Split AC Deep Jet Wash & R32 Gas Top-Up",
      category: "AC",
      description:
        "High-pressure indoor coil and blower sanitization, drain-line flushing, refrigerant pressure check, and R32/R410A gas recharge.",
      image:
        "https://images.unsplash.com/photo-1585338107529-13afc5f02586?auto=format&fit=crop&w=900&q=80",
      basePrice: 55,
      estimatedDuration: "2 Hours",
      serviceMode: "Home Visit",
      serviceArea: "Dhaka — Uttara & Mirpur",
      technicianName: "Kamrul Islam",
      technicianEmail: "tech.appliances@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(26),
      updatedAt: daysAgo(26),
    },
    {
      _id: new ObjectId(),
      title: "No-Frost Refrigerator Cooling & Compressor Diagnostics",
      category: "Refrigerator",
      description:
        "Complete defrost heater, bi-metal thermostat, inverter PCB, and compressor relay repair for double-door and side-by-side fridges.",
      image:
        "https://images.unsplash.com/photo-1584568694244-14fbdf83bd30?auto=format&fit=crop&w=900&q=80",
      basePrice: 70,
      estimatedDuration: "2–3 Hours",
      serviceMode: "Home Visit",
      serviceArea: "Dhaka — Uttara & Mirpur",
      technicianName: "Kamrul Islam",
      technicianEmail: "tech.appliances@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(24),
      updatedAt: daysAgo(24),
    },
    {
      _id: new ObjectId(),
      title: "4K Smart TV LED Backlight & Power Supply Repair",
      category: "TV",
      description:
        "Fixes dark screen with sound issues by replacing full-array LED backlight strips and repairing surge-damaged SMPS power boards.",
      image:
        "https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=900&q=80",
      basePrice: 85,
      estimatedDuration: "3 Hours",
      serviceMode: "Home Visit",
      serviceArea: "Chittagong — GEC & Agrabad",
      technicianName: "Nusrat Jahan",
      technicianEmail: "tech.free@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(22),
      updatedAt: daysAgo(22),
    },
    {
      _id: new ObjectId(),
      title: "Front-Load Washing Machine Drain Pump & Drum Bearing Fix",
      category: "Washing Machine",
      description:
        "Eliminates E20/OE drain errors, noisy spin cycles, and door-lock switch faults for LG, Samsung, Bosch, and Whirlpool washers.",
      image:
        "https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?auto=format&fit=crop&w=900&q=80",
      basePrice: 65,
      estimatedDuration: "2 Hours",
      serviceMode: "Home Visit",
      serviceArea: "Dhaka — Uttara & Mirpur",
      technicianName: "Kamrul Islam",
      technicianEmail: "tech.appliances@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(20),
      updatedAt: daysAgo(20),
    },
    {
      _id: new ObjectId(),
      title: "Home Distribution Board, MCB & Short-Circuit Troubleshooting",
      category: "Electrical",
      description:
        "Thermal fault tracing, tripping breaker replacement, earthing voltage verification, and dedicated heavy-appliance line wiring.",
      image:
        "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=900&q=80",
      basePrice: 45,
      estimatedDuration: "1–2 Hours",
      serviceMode: "Home Visit",
      serviceArea: "Dhaka — Uttara & Mirpur",
      technicianName: "Kamrul Islam",
      technicianEmail: "tech.appliances@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(18),
      updatedAt: daysAgo(18),
    },
    {
      _id: new ObjectId(),
      title: "Gaming Laptop Thermal Repasting & Fan Assembly Overhaul",
      category: "Laptop & PC",
      description:
        "Heatsink dust extraction, Honeywell PTM7950 phase-change thermal pad application, and dual cooling fan replacement.",
      image:
        "https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=900&q=80",
      basePrice: 50,
      estimatedDuration: "90 Mins",
      serviceMode: "Shop Drop-off",
      serviceArea: "Dhaka — Banani & Dhanmondi",
      technicianName: "Tariq Hasan",
      technicianEmail: "tech.pro@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(16),
      updatedAt: daysAgo(16),
    },
    {
      _id: new ObjectId(),
      title: "Smartphone Battery & USB-C Charging Port Replacement",
      category: "Smartphone",
      description:
        "Original-capacity lithium battery swap and flex charging port replacement with full fast-charging wattage verification.",
      image:
        "https://images.unsplash.com/photo-1580910051074-3eb694886505?auto=format&fit=crop&w=900&q=80",
      basePrice: 40,
      estimatedDuration: "1 Hour",
      serviceMode: "Shop Drop-off",
      serviceArea: "Dhaka — Banani & Dhanmondi",
      technicianName: "Tariq Hasan",
      technicianEmail: "tech.pro@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(14),
      updatedAt: daysAgo(14),
    },
    {
      _id: new ObjectId(),
      title: "OLED & QLED TV HDMI Port & Mainboard Repair",
      category: "TV",
      description:
        "Micro-HDMI port re-soldering and T-Con / mainboard firmware recovery for Sony, Samsung, and LG 4K/8K televisions.",
      image:
        "https://images.unsplash.com/photo-1461151304267-38535e780c79?auto=format&fit=crop&w=900&q=80",
      basePrice: 95,
      estimatedDuration: "2–3 Hours",
      serviceMode: "Shop Drop-off",
      serviceArea: "Chittagong — GEC & Agrabad",
      technicianName: "Nusrat Jahan",
      technicianEmail: "tech.free@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(12),
      updatedAt: daysAgo(12),
    },
    {
      _id: new ObjectId(),
      title: "Custom Desktop PC Boot Failure & NVMe Data Recovery",
      category: "Laptop & PC",
      description:
        "PSU rail testing, BIOS recovery, Windows OS repair, and non-destructive file recovery from failing SSDs and hard drives.",
      image:
        "https://images.unsplash.com/photo-1587202372775-e229f172b9d7?auto=format&fit=crop&w=900&q=80",
      basePrice: 60,
      estimatedDuration: "2 Hours",
      serviceMode: "Home Visit",
      serviceArea: "Dhaka — Banani & Dhanmondi",
      technicianName: "Tariq Hasan",
      technicianEmail: "tech.pro@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(10),
      updatedAt: daysAgo(10),
    },
    {
      _id: new ObjectId(),
      title: "Smart Inverter & IPS Backup System Wiring Setup",
      category: "Electrical",
      description:
        "Pure sine-wave IPS/UPS load balancing, battery terminal maintenance, and automatic changeover switch installation.",
      image:
        "https://images.unsplash.com/photo-1558346490-a72e53ae2d4f?auto=format&fit=crop&w=900&q=80",
      basePrice: 55,
      estimatedDuration: "2 Hours",
      serviceMode: "Home Visit",
      serviceArea: "Chittagong — GEC & Agrabad",
      technicianName: "Nusrat Jahan",
      technicianEmail: "tech.free@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(8),
      updatedAt: daysAgo(8),
    },
    {
      _id: new ObjectId(),
      title: "Split AC PCB Error Code (E1/E6/CH05) Repair",
      category: "AC",
      description:
        "Outdoor inverter communication board repair, sensor thermistor replacement, and compressor soft-start diagnostics.",
      image:
        "https://images.unsplash.com/photo-1631545806609-35d4ae440431?auto=format&fit=crop&w=900&q=80",
      basePrice: 75,
      estimatedDuration: "2–3 Hours",
      serviceMode: "Home Visit",
      serviceArea: "Dhaka — Banani & Dhanmondi",
      technicianName: "Tariq Hasan",
      technicianEmail: "tech.pro@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(6),
      updatedAt: daysAgo(6),
    },
    {
      _id: new ObjectId(),
      title: "Refrigerator Door Gasket Seal & Water Dispenser Fix",
      category: "Refrigerator",
      description:
        "Stops cold air leaks and frost buildup by fitting magnetic door gaskets and clearing clogged water solenoid lines.",
      image:
        "https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&w=900&q=80",
      basePrice: 48,
      estimatedDuration: "90 Mins",
      serviceMode: "Home Visit",
      serviceArea: "Dhaka — Banani & Dhanmondi",
      technicianName: "Tariq Hasan",
      technicianEmail: "tech.pro@fixbench.com",
      approvalStatus: "approved",
      isAvailable: true,
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
    },
    // 15th Service: Pending Admin Approval (for testing Admin Service Approval Queue)
    {
      _id: new ObjectId(),
      title: "iPad Pro & Galaxy Tab Digitizer Glass Replacement",
      category: "Smartphone",
      description:
        "Precision laminated glass and Apple Pencil digitizer restoration with full chassis frame straightening.",
      image:
        "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=900&q=80",
      basePrice: 110,
      estimatedDuration: "3 Hours",
      serviceMode: "Shop Drop-off",
      serviceArea: "Dhaka — Banani & Dhanmondi",
      technicianName: "Tariq Hasan",
      technicianEmail: "tech.pro@fixbench.com",
      approvalStatus: "pending",
      isAvailable: true,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    },
  ];

  await servicesCollection.insertMany(servicesData);

  // ---------------------------------------------------------------------------
  // 3. SEED BOOKINGS (8 Bookings covering every lifecycle & payment state)
  // ---------------------------------------------------------------------------
  const [
    iphoneScreenSvc,
    macbookBoardSvc,
    acJetWashSvc,
    fridgeCoolingSvc,
    smartTvLedSvc,
    washerPumpSvc,
    electricalMcbSvc,
    laptopRepasteSvc,
  ] = servicesData;

  const bookingCompletedPaidReviewed1 = new ObjectId();
  const bookingCompletedPaidReviewed2 = new ObjectId();
  const bookingCompletedPaidUnreviewed = new ObjectId();
  const bookingCompletedUnpaid = new ObjectId();
  const bookingInProgress = new ObjectId();
  const bookingAccepted = new ObjectId();
  const bookingRequested = new ObjectId();
  const bookingCancelled = new ObjectId();

  const seedBookings = [
    // 1. Completed + Paid + Reviewed (Customer 1 -> Tariq Hasan)
    {
      _id: bookingCompletedPaidReviewed1,
      serviceId: iphoneScreenSvc!._id.toString(),
      serviceTitle: iphoneScreenSvc!.title,
      category: iphoneScreenSvc!.category,
      basePrice: iphoneScreenSvc!.basePrice,
      technicianName: iphoneScreenSvc!.technicianName,
      technicianEmail: iphoneScreenSvc!.technicianEmail,
      customerName: "Rafiul Karim",
      customerEmail: "customer@fixbench.com",
      customerPhone: "+880 1715-443219",
      address: "House 24, Road 7A, Dhanmondi, Dhaka",
      preferredDate: daysAgo(45).toISOString().split("T")[0]!,
      problemDescription:
        "Dropped phone on tile floor; green vertical line across display and touch unresponsive on right edge.",
      status: "completed",
      finalAmount: 135,
      paymentStatus: "paid",
      rating: 5,
      reviewComment:
        "Tariq replaced the OLED panel in under 90 minutes and preserved True Tone calibration. Looks brand new!",
      reviewedAt: daysAgo(44),
      createdAt: daysAgo(47),
      updatedAt: daysAgo(44),
    },
    // 2. Completed + Paid + Reviewed (Customer 2 -> Nusrat Jahan)
    {
      _id: bookingCompletedPaidReviewed2,
      serviceId: smartTvLedSvc!._id.toString(),
      serviceTitle: smartTvLedSvc!.title,
      category: smartTvLedSvc!.category,
      basePrice: smartTvLedSvc!.basePrice,
      technicianName: smartTvLedSvc!.technicianName,
      technicianEmail: smartTvLedSvc!.technicianEmail,
      customerName: "Sadia Rahman",
      customerEmail: "sadia.customer@fixbench.com",
      customerPhone: "+880 1817-990341",
      address: "Flat 4B, Green View Apartments, Nasirabad, Chittagong",
      preferredDate: daysAgo(20).toISOString().split("T")[0]!,
      problemDescription:
        "55-inch Samsung Smart TV has clear audio when powered on, but the backlight stays completely dim.",
      status: "completed",
      finalAmount: 95,
      paymentStatus: "paid",
      rating: 5,
      reviewComment:
        "Nusrat diagnosed the failed LED strips on the spot and brought replacement bars the same afternoon. Very professional!",
      reviewedAt: daysAgo(19),
      createdAt: daysAgo(22),
      updatedAt: daysAgo(19),
    },
    // 3. Completed + Paid + Unreviewed (Customer 1 can immediately test Review Modal & PDF Invoice!)
    {
      _id: bookingCompletedPaidUnreviewed,
      serviceId: acJetWashSvc!._id.toString(),
      serviceTitle: acJetWashSvc!.title,
      category: acJetWashSvc!.category,
      basePrice: acJetWashSvc!.basePrice,
      technicianName: acJetWashSvc!.technicianName,
      technicianEmail: acJetWashSvc!.technicianEmail,
      customerName: "Rafiul Karim",
      customerEmail: "customer@fixbench.com",
      customerPhone: "+880 1715-443219",
      address: "House 24, Road 7A, Dhanmondi, Dhaka",
      preferredDate: daysAgo(5).toISOString().split("T")[0]!,
      problemDescription:
        "1.5-ton inverter AC blowing warm air and dripping water from the indoor louver.",
      status: "completed",
      finalAmount: 68,
      paymentStatus: "paid",
      createdAt: daysAgo(7),
      updatedAt: daysAgo(5),
    },
    // 4. Completed + Unpaid (Customer 1 can immediately test Stripe "Pay Now" Checkout!)
    {
      _id: bookingCompletedUnpaid,
      serviceId: macbookBoardSvc!._id.toString(),
      serviceTitle: macbookBoardSvc!.title,
      category: macbookBoardSvc!.category,
      basePrice: macbookBoardSvc!.basePrice,
      technicianName: macbookBoardSvc!.technicianName,
      technicianEmail: macbookBoardSvc!.technicianEmail,
      customerName: "Rafiul Karim",
      customerEmail: "customer@fixbench.com",
      customerPhone: "+880 1715-443219",
      address: "House 24, Road 7A, Dhanmondi, Dhaka",
      preferredDate: daysAgo(2).toISOString().split("T")[0]!,
      problemDescription:
        "MacBook Pro 14-inch stopped charging on both left Thunderbolt ports after minor coffee splash.",
      status: "completed",
      finalAmount: 180,
      paymentStatus: "unpaid",
      createdAt: daysAgo(3),
      updatedAt: daysAgo(1),
    },
    // 5. In-Progress (Technician Tariq Hasan can test "Mark Completed + Final Amount")
    {
      _id: bookingInProgress,
      serviceId: laptopRepasteSvc!._id.toString(),
      serviceTitle: laptopRepasteSvc!.title,
      category: laptopRepasteSvc!.category,
      basePrice: laptopRepasteSvc!.basePrice,
      technicianName: laptopRepasteSvc!.technicianName,
      technicianEmail: laptopRepasteSvc!.technicianEmail,
      customerName: "Rafiul Karim",
      customerEmail: "customer@fixbench.com",
      customerPhone: "+880 1715-443219",
      address: "House 24, Road 7A, Dhanmondi, Dhaka",
      preferredDate: daysFromNowISO(0),
      problemDescription:
        "CPU thermal throttling at 98°C under load and right exhaust fan rattling.",
      status: "in-progress",
      finalAmount: 0,
      paymentStatus: "unpaid",
      createdAt: daysAgo(2),
      updatedAt: daysAgo(0),
    },
    // 6. Accepted (Technician Kamrul Islam can test "Start Work")
    {
      _id: bookingAccepted,
      serviceId: fridgeCoolingSvc!._id.toString(),
      serviceTitle: fridgeCoolingSvc!.title,
      category: fridgeCoolingSvc!.category,
      basePrice: fridgeCoolingSvc!.basePrice,
      technicianName: fridgeCoolingSvc!.technicianName,
      technicianEmail: fridgeCoolingSvc!.technicianEmail,
      customerName: "Rafiul Karim",
      customerEmail: "customer@fixbench.com",
      customerPhone: "+880 1715-443219",
      address: "House 24, Road 7A, Dhanmondi, Dhaka",
      preferredDate: daysFromNowISO(1),
      problemDescription:
        "Freezer compartment is cold, but lower fresh-food section stays at room temperature.",
      status: "accepted",
      finalAmount: 0,
      paymentStatus: "unpaid",
      createdAt: daysAgo(1),
      updatedAt: daysAgo(0),
    },
    // 7. Requested (Customer can test "Cancel Request" OR Technician Tariq can "Accept / Reject")
    {
      _id: bookingRequested,
      serviceId: iphoneScreenSvc!._id.toString(),
      serviceTitle: iphoneScreenSvc!.title,
      category: iphoneScreenSvc!.category,
      basePrice: iphoneScreenSvc!.basePrice,
      technicianName: iphoneScreenSvc!.technicianName,
      technicianEmail: iphoneScreenSvc!.technicianEmail,
      customerName: "Rafiul Karim",
      customerEmail: "customer@fixbench.com",
      customerPhone: "+880 1715-443219",
      address: "House 24, Road 7A, Dhanmondi, Dhaka",
      preferredDate: daysFromNowISO(3),
      problemDescription:
        "Secondary work phone has cracked outer glass and intermittent ghost touches.",
      status: "requested",
      finalAmount: 0,
      paymentStatus: "unpaid",
      createdAt: daysAgo(0),
      updatedAt: daysAgo(0),
    },
    // 8. Cancelled (Historical record for Admin All Bookings)
    {
      _id: bookingCancelled,
      serviceId: washerPumpSvc!._id.toString(),
      serviceTitle: washerPumpSvc!.title,
      category: washerPumpSvc!.category,
      basePrice: washerPumpSvc!.basePrice,
      technicianName: washerPumpSvc!.technicianName,
      technicianEmail: washerPumpSvc!.technicianEmail,
      customerName: "Sadia Rahman",
      customerEmail: "sadia.customer@fixbench.com",
      customerPhone: "+880 1817-990341",
      address: "Flat 4B, Green View Apartments, Nasirabad, Chittagong",
      preferredDate: daysAgo(10).toISOString().split("T")[0]!,
      problemDescription:
        "Booked by mistake for Dhaka service zone; rebooked locally.",
      status: "cancelled",
      finalAmount: 0,
      paymentStatus: "unpaid",
      createdAt: daysAgo(12),
      updatedAt: daysAgo(11),
    },
  ];

  await bookingsCollection.insertMany(seedBookings);

  // ---------------------------------------------------------------------------
  // 4. SEED PAYMENTS (3 Repair Job Settlements + 1 Verified Pro Upgrade)
  // ---------------------------------------------------------------------------
  const seedPayments = [
    {
      _id: new ObjectId(),
      bookingId: bookingCompletedPaidReviewed1.toString(),
      serviceTitle: iphoneScreenSvc!.title,
      customerName: "Rafiul Karim",
      customerEmail: "customer@fixbench.com",
      technicianName: "Tariq Hasan",
      technicianEmail: "tech.pro@fixbench.com",
      amount: 135,
      currency: "usd",
      transactionId: "pi_3QSeedFixBenchRepair001",
      stripeSessionId: "cs_test_seed_fixbench_repair_001",
      paymentStatus: "paid",
      paidAt: daysAgo(45),
    },
    {
      _id: new ObjectId(),
      bookingId: "pro-plan",
      serviceTitle: "FixBench Verified Pro Plan",
      customerName: "Tariq Hasan",
      customerEmail: "tech.pro@fixbench.com",
      technicianName: "FixBench Platform",
      technicianEmail: "platform@fixbench.com",
      amount: 19.99,
      currency: "usd",
      transactionId: "pi_3QSeedFixBenchProPlan001",
      stripeSessionId: "cs_test_seed_fixbench_pro_001",
      paymentStatus: "paid",
      paidAt: daysAgo(35),
    },
    {
      _id: new ObjectId(),
      bookingId: bookingCompletedPaidReviewed2.toString(),
      serviceTitle: smartTvLedSvc!.title,
      customerName: "Sadia Rahman",
      customerEmail: "sadia.customer@fixbench.com",
      technicianName: "Nusrat Jahan",
      technicianEmail: "tech.free@fixbench.com",
      amount: 95,
      currency: "usd",
      transactionId: "pi_3QSeedFixBenchRepair002",
      stripeSessionId: "cs_test_seed_fixbench_repair_002",
      paymentStatus: "paid",
      paidAt: daysAgo(20),
    },
    {
      _id: new ObjectId(),
      bookingId: bookingCompletedPaidUnreviewed.toString(),
      serviceTitle: acJetWashSvc!.title,
      customerName: "Rafiul Karim",
      customerEmail: "customer@fixbench.com",
      technicianName: "Kamrul Islam",
      technicianEmail: "tech.appliances@fixbench.com",
      amount: 68,
      currency: "usd",
      transactionId: "pi_3QSeedFixBenchRepair003",
      stripeSessionId: "cs_test_seed_fixbench_repair_003",
      paymentStatus: "paid",
      paidAt: daysAgo(5),
    },
  ];

  await paymentsCollection.insertMany(seedPayments);

  console.log("\nFixBench database seeded successfully!");
  console.log("==============================================================");
  console.log("Role         | Email                        | Password");
  console.log("--------------------------------------------------------------");
  console.log("Admin        | admin@fixbench.com           | Admin@1234");
  console.log("Technician   | tech.pro@fixbench.com        | Tech@1234  (Pro)");
  console.log("Technician   | tech.free@fixbench.com       | Tech@1234  (Free)");
  console.log("Technician   | tech.appliances@fixbench.com | Tech@1234  (Free)");
  console.log("Customer     | customer@fixbench.com        | Customer@1234");
  console.log("Customer     | sadia.customer@fixbench.com  | Customer@1234");
  console.log("==============================================================\n");
  console.log(
    `Seeded ${seedUsers.length} users, ${servicesData.length} services (14 approved, 1 pending), ${seedBookings.length} bookings, and ${seedPayments.length} Stripe payments ($317.99 total revenue).`
  );
  process.exit(0);
}

seedDatabase().catch((error) => {
  console.error("Error seeding FixBench database:", error);
  process.exit(1);
});