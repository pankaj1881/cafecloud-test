// Load dotenv FIRST before any other imports
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

// Set timezone to IST (India Standard Time) for entire application
process.env.TZ = 'Asia/Kolkata';


const siteConfig = require("./config/site");
const MenuItem = require("./models/MenuItem");
const Category = require("./models/Category");
const Feedback = require("./models/Feedback");
const SiteSettings = require("./models/SiteSettings");
const { getImageUrl } = require("./utils/imageHelper");
const checkMaintenance = require("./middleware/maintenance");
const { getEndOfDay, format12Hour } = require("./config/timezone");


const DeliveryPartner = require("./models/DeliveryPartner");


const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo").default; // ✅ FIXED (no .default)
const path = require("path");


const app = express();


// CORS for mobile app
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});


// Body parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// Static folder
app.use(express.static("public"));


// View engine
app.set("view engine", "ejs");


// Make image helper available to all views
app.locals.getImageUrl = getImageUrl;

// Make time format helper available to all views
app.locals.format12Hour = format12Hour;


// Validate required environment variables
if (!process.env.MONGO_URI && !process.env.MONGODB_URI) {
  console.error("ERROR: MONGO_URI or MONGODB_URI environment variable is required!");
  process.exit(1);
}


if (!process.env.SESSION_SECRET) {
  console.error("ERROR: SESSION_SECRET environment variable is required!");
  process.exit(1);
}


const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'production';
console.log("Connection String (masked):", MONGO_URI.replace(/:\/\/([^:]+):([^@]+)@/, "://***:***@"));
console.log("Target Database:", DB_NAME);


// Session config for Railway deployment
app.set('trust proxy', 1);
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: MONGO_URI,
      dbName: DB_NAME
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    },
  })
);


// Maintenance mode middleware (AFTER session)
app.use(checkMaintenance);


const PORT = process.env.PORT || 5000;


// MongoDB connection
mongoose
  .connect(MONGO_URI, {
    dbName: DB_NAME
  })
  .then(() => {
    console.log("MongoDB Connected");
    console.log("Using Database:", mongoose.connection.db.databaseName);
    console.log("Expected Database:", DB_NAME);


    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => console.log(err));


// ---------------- ROUTES ----------------


// Home
app.get("/", async (req, res) => {
  const settings = await SiteSettings.findOne();
 
  // Auto-disable expired announcements
  if (settings?.announcement?.enabled && settings.announcement.endDate) {
    const now = new Date();
    const endDate = getEndOfDay(new Date(settings.announcement.endDate));
   
    if (now > endDate) {
      settings.announcement.enabled = false;
      await settings.save();
    }
  }
 
  const galleryImages = settings?.galleryImages || [];


  const reviewFilter = { status: "Reviewed", type: "Feedback", rating: { $gte: 1 } };
  const reviewCount = await Feedback.countDocuments(reviewFilter);
  let reviews;
  if (reviewCount >= 10) {
    reviews = await Feedback.aggregate([{ $match: reviewFilter }, { $sample: { size: 20 } }]);
  } else {
    reviews = await Feedback.find(reviewFilter).sort({ createdAt: -1 });
  }


  res.render("home", {
    settings,
    heroImage: siteConfig.heroImage,
    logoImage: siteConfig.logoImage,
    galleryImages,
    reviews,
  });
});


// Menu
app.get("/menu", async (req, res) => {
  const settings = await SiteSettings.findOne();
  const categories = await Category.find();
  const items = await MenuItem.find().populate("category");
  res.render("menu", { settings, categories, items });
});


// Services (formerly Booking)
app.get("/services", async (req, res) => {
  const settings = await SiteSettings.findOne();
  const deliveryPartners = await DeliveryPartner.find().sort({ createdAt: 1 });
  res.render("services", { settings, deliveryPartners });
});

// Redirect old booking URL
app.get("/booking", (req, res) => {
  res.redirect("/services");
});


// Feedback
app.get("/feedback", async (req, res) => {
  const settings = await SiteSettings.findOne();
  res.render("feedback", { settings });
});


// Feedback Submit
app.post("/feedback", async (req, res) => {
  try {
    const { name, phone, rating, type, message } = req.body;


    await Feedback.create({
      name,
      phone: "+91" + phone,
      type,
      message,
      rating: type === "Feedback" ? rating : 0,
    });


    const settings = await SiteSettings.findOne();
    res.render("feedback-success", { settings });
  } catch (error) {
    console.log(error);
    res.send(
      '<script>alert("Error submitting feedback. Please try again."); window.history.back();</script>'
    );
  }
});


// Other Routes
app.use("/admin", require("./routes/admin"));
app.use("/waiter", require("./routes/waiter"));
app.use("/kitchen", require("./routes/kitchen"));
app.use("/hall", require("./routes/hall"));
app.use("/api", require("./routes/api"));
app.use("/", require("./routes/customer"));





