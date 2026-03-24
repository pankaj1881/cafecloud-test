const SiteSettings = require("../models/SiteSettings");
const auth = require("../middleware/auth");
const Category = require("../models/Category");
const MenuItem = require("../models/MenuItem");
const Feedback = require("../models/Feedback");
const Waiter = require("../models/Waiter");
const Table = require("../models/Table");
const Order = require("../models/Order");
const Bill = require("../models/Bill");
const Hall = require("../models/Hall");
const HallBooking = require("../models/HallBooking");
const express = require("express");
const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");
const DeliveryPartner = require("../models/DeliveryPartner");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const crypto = require('crypto');
const { sendResetEmail, sendVerificationEmail } = require('../utils/email');
const { cloudinary, menuStorage, galleryStorage, uploadToAzure, deleteFromAzure, deleteFromCloudinary, STORAGE_PROVIDER } = require('../utils/storage');
const { CGST_RATE, SGST_RATE } = require('../config/gst');
const { getStartOfDay, getEndOfDay, getStartOfYesterday, getEndOfYesterday } = require('../config/timezone');
const branding = require('../config/branding');


// Multer setup for Cloudinary with 2MB file size limit
const menuUpload = multer({ 
    storage: menuStorage,
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit
});
const galleryUpload = multer({ 
    storage: galleryStorage,
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit
});


// Check master admin credentials
function checkMasterAdmin(email, password) {
    return email === process.env.MASTER_ADMIN_EMAIL && password === process.env.MASTER_ADMIN_PASSWORD;
}


// Login Page
router.get("/", async (req, res) => {
    res.render("admin/login", { error: null });
});


// Send Invitation (Master Admin Only)
router.post("/admins/invite", auth, async (req, res) => {
    if (!req.session.isMaster) {
        return res.json({ success: false, error: 'Unauthorized' });
    }
    try {
        const { email } = req.body;
        
        console.log('=== ADMIN INVITATION REQUEST ===');
        console.log('Email:', email);
       
        // Check admin limit
        const adminCount = await Admin.countDocuments();
        console.log('Current admin count:', adminCount);
        if (adminCount >= 3) {
            console.log('ERROR: Admin limit reached');
            return res.json({ success: false, error: 'Maximum admin limit (3) reached' });
        }
       
        // Check if email already exists
        const existingAdmin = await Admin.findOne({ email });
        if (existingAdmin) {
            console.log('ERROR: Email already exists');
            return res.json({ success: false, error: 'Email already registered' });
        }
       
        // Generate invitation token
        const invitationToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(invitationToken).digest('hex');
        console.log('Generated invitation token');
       
        // Create pending admin
        const newAdmin = await Admin.create({
            email,
            password: 'PENDING', // Temporary, will be set during registration
            role: 'admin',
            isVerified: false,
            isApproved: false,
            verificationToken: hashedToken
        });
        console.log('Created pending admin:', newAdmin._id);
       
        // Send invitation email
        const invitationLink = `${process.env.APP_URL}/admin/register/${invitationToken}`;
        console.log('Invitation link:', invitationLink);
        console.log('Sending email...');
        
        const emailResult = await sendVerificationEmail(email, invitationToken);
        console.log('Email result:', emailResult);
       
        if (!emailResult.success) {
            // Rollback - delete the admin
            await Admin.findOneAndDelete({ email });
            console.log('ERROR: Email failed, rolled back admin creation');
            return res.json({ success: false, error: 'Failed to send invitation email: ' + (emailResult.error || 'Unknown error') });
        }
       
        console.log('✓ Invitation sent successfully');
        res.json({ success: true, message: 'Invitation sent successfully' });
    } catch (error) {
        console.error('ERROR in invitation route:', error);
        res.json({ success: false, error: error.message });
    }
});


// Registration Page (Token Required)
router.get("/register/:token", async (req, res) => {
    try {
        const { token } = req.params;
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
       
        const admin = await Admin.findOne({ verificationToken: hashedToken });
       
        if (!admin) {
            return res.render("admin/register", {
                error: "Invalid or expired invitation link",
                token: null,
                email: null
            });
        }
       
        res.render("admin/register", {
            error: null,
            token,
            email: admin.email
        });
    } catch (error) {
        res.render("admin/register", {
            error: error.message,
            token: null,
            email: null
        });
    }
});


// Handle Registration (Token Required)
router.post("/register/:token", async (req, res) => {
    try {
        const { token } = req.params;
        const { password, confirmPassword } = req.body;
       
        if (password !== confirmPassword) {
            const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
            const admin = await Admin.findOne({ verificationToken: hashedToken });
            return res.render("admin/register", {
                error: "Passwords do not match",
                token,
                email: admin?.email || null
            });
        }
       
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const admin = await Admin.findOne({ verificationToken: hashedToken });
       
        if (!admin) {
            return res.render("admin/register", {
                error: "Invalid or expired invitation link",
                token: null,
                email: null
            });
        }
       
        // Update admin with password and mark as verified
        const hashedPassword = await bcrypt.hash(password, 10);
        admin.password = hashedPassword;
        admin.isVerified = true;
        admin.verificationToken = null;
        await admin.save();
       
        res.render("admin/verification-result", {
            success: true,
            message: "Registration completed! Your account is pending approval from master admin. You will be able to login once approved."
        });
    } catch (error) {
        res.render("admin/register", {
            error: error.message,
            token: req.params.token,
            email: null
        });
    }
});


// Handle Login
router.post("/login", async (req, res) => {
    const { email, password } = req.body;


    // Check master admin first
    if (checkMasterAdmin(email, password)) {
        req.session.adminId = 'master';
        req.session.isMaster = true;
        req.session.adminAuthenticated = true;
        req.session.save((err) => {
            if (err) {
                return res.render("admin/login", { error: "Session error" });
            }
            res.redirect("/admin/dashboard");
        });
        return;
    }


    const admin = await Admin.findOne({ email });


    if (!admin) {
        return res.render("admin/login", { error: "Invalid email or password" });
    }


    if (!admin.isVerified) {
        return res.render("admin/login", { error: "Please verify your email before logging in" });
    }


    if (!admin.isApproved) {
        return res.render("admin/login", { error: "Your account is pending approval from master admin" });
    }


    const isMatch = await bcrypt.compare(password, admin.password);


    if (!isMatch) {
        return res.render("admin/login", { error: "Invalid email or password" });
    }


    req.session.adminId = admin._id;
    req.session.adminAuthenticated = true;
    req.session.save((err) => {
        if (err) {
            return res.render("admin/login", { error: "Session error" });
        }
        res.redirect("/admin/dashboard");
    });
});


// Verify Email (Legacy - now handled in registration)
router.get("/verify-email", async (req, res) => {
    res.render("admin/verification-result", {
        success: false,
        message: "This verification method is no longer used. Please use the invitation link sent by master admin."
    });
});


// Forgot Password Page
router.get("/forgot-password", (req, res) => {
    res.render("admin/forgot-password", { error: null, success: null });
});


// Handle Forgot Password
router.post("/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;
        const admin = await Admin.findOne({ email });


        if (!admin) {
            return res.render("admin/forgot-password", {
                error: "No account found with that email",
                success: null
            });
        }


        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');


        admin.resetToken = hashedToken;
        admin.resetTokenExpiry = Date.now() + 3600000; // 1 hour
        await admin.save();


        // Send email
        const emailResult = await sendResetEmail(email, resetToken);


        if (!emailResult.success) {
            return res.render("admin/forgot-password", {
                error: "Failed to send email. Please try again.",
                success: null
            });
        }


        res.render("admin/forgot-password", {
            error: null,
            success: "Password reset link sent to your email"
        });
    } catch (error) {
        res.render("admin/forgot-password", {
            error: error.message,
            success: null
        });
    }
});


// Reset Password Page
router.get("/reset-password", async (req, res) => {
    const { token } = req.query;
   
    if (!token) {
        return res.redirect("/admin");
    }


    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const admin = await Admin.findOne({
        resetToken: hashedToken,
        resetTokenExpiry: { $gt: Date.now() }
    });


    if (!admin) {
        return res.render("admin/reset-password", {
            error: "Invalid or expired reset link",
            token: null
        });
    }


    res.render("admin/reset-password", { error: null, token });
});


// Handle Reset Password
router.post("/reset-password", async (req, res) => {
    try {
        const { token, password, confirmPassword } = req.body;


        if (password !== confirmPassword) {
            return res.render("admin/reset-password", {
                error: "Passwords do not match",
                token
            });
        }


        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const admin = await Admin.findOne({
            resetToken: hashedToken,
            resetTokenExpiry: { $gt: Date.now() }
        });


        if (!admin) {
            return res.render("admin/reset-password", {
                error: "Invalid or expired reset link",
                token: null
            });
        }


        admin.password = await bcrypt.hash(password, 10);
        admin.resetToken = null;
        admin.resetTokenExpiry = null;
        await admin.save();


        res.redirect("/admin?reset=success");
    } catch (error) {
        res.render("admin/reset-password", {
            error: error.message,
            token: req.body.token
        });
    }
});


// Dashboard (Protected)
router.get("/dashboard", auth, async (req, res) => {
    const isMaster = req.session.isMaster || false;
    let pendingApprovals = 0;
   
    if (isMaster) {
        pendingApprovals = await Admin.countDocuments({ isVerified: true, isApproved: false });
    }


    res.render("admin/dashboard", { isMaster, pendingApprovals });
});


// View Categories
router.get("/categories", auth, async (req, res) => {
    const categories = await Category.find();
    res.render("admin/categories", { categories });
});


// Menu Management (Combined Categories + Menu Items)
router.get("/menu-management", auth, async (req, res) => {
    const categories = await Category.find();
    const items = await MenuItem.find().populate("category");
    res.render("admin/menu-management", { categories, items });
});


// Add Category
router.post("/categories/add", auth, async (req, res) => {
    await Category.create({ name: req.body.name });
    res.redirect("/admin/menu-management");
});


// Delete Category
router.get("/categories/delete/:id", auth, async (req, res) => {
    const menuItems = await MenuItem.find({ category: req.params.id });
   
    // Delete images from storage for each menu item
    for (const item of menuItems) {
        if (item.image) {
            try {
                const filename = item.image.split('/').pop();
                if (STORAGE_PROVIDER === 'azure') {
                    await deleteFromAzure(filename, 'menu-images');
                } else {
                    const publicId = filename.split('.')[0];
                    await deleteFromCloudinary(publicId, 'menu-images');
                }
            } catch (err) {
                console.error('Error deleting from storage:', err);
            }
        }
    }
   
    await MenuItem.deleteMany({ category: req.params.id });
    await Category.findByIdAndDelete(req.params.id);
    res.redirect("/admin/menu-management");
});


// View Menu Items
router.get("/menu", auth, async (req, res) => {
    const items = await MenuItem.find().populate("category");
    res.render("admin/menu", { items });
});


// Show Edit Menu Form
router.get("/menu/edit/:id", auth, async (req, res) => {
    const categories = await Category.find();
    const item = await MenuItem.findById(req.params.id).populate('category');
    if (!item) {
        return res.redirect('/admin/menu-management?tab=items');
    }
    res.render("admin/editMenu", { categories, item });
});

// Update Menu Item
router.post("/menu/edit/:id", auth, (req, res) => {
    menuUpload.single("image")(req, res, async (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            const categories = await Category.find();
            const item = await MenuItem.findById(req.params.id).populate('category');
            return res.render("admin/editMenu", { 
                categories, 
                item,
                error: 'Image size must be less than 2MB'
            });
        }
        if (err) {
            console.error('Upload error:', err);
            return res.status(500).send('Error uploading image');
        }
        
        try {
            const { name, price, category, description, foodType } = req.body;
            const item = await MenuItem.findById(req.params.id);
            
            if (!item) {
                return res.status(404).send('Item not found');
            }
            
            // Update fields
            item.name = name;
            item.price = price;
            item.category = category;
            item.description = description;
            item.foodType = foodType || 'veg';
            
            // If new image uploaded, delete old one and update
            if (req.file) {
                if (item.image) {
                    try {
                        const filename = item.image.split('/').pop();
                        if (STORAGE_PROVIDER === 'azure') {
                            await deleteFromAzure(filename, 'menu-images');
                        } else {
                            const publicId = filename.split('.')[0];
                            await deleteFromCloudinary(publicId, 'menu-images');
                        }
                    } catch (err) {
                        console.error('Error deleting old image:', err);
                    }
                }
                if (STORAGE_PROVIDER === 'azure') {
                    item.image = await uploadToAzure(req.file, 'menu-images');
                } else {
                    item.image = req.file.path;
                }
            }
            
            await item.save();
            res.redirect("/admin/menu-management?tab=items");
        } catch (error) {
            console.error('Menu edit error:', error);
            res.status(500).send('Error updating menu item');
        }
    });
});

// Show Add Menu Form
router.get("/menu/add", auth, async (req, res) => {
    const categories = await Category.find();
    res.render("admin/addMenu", { categories, backUrl: '/admin/menu-management' });
});


// Add Menu Item
router.post("/menu/add", auth, (req, res) => {
    menuUpload.single("image")(req, res, async (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            const categories = await Category.find();
            return res.render("admin/addMenu", { 
                categories, 
                backUrl: '/admin/menu-management',
                error: 'Image size must be less than 2MB'
            });
        }
        if (err) {
            console.error('Upload error:', err);
            return res.status(500).send('Error uploading image');
        }
        
        try {
            const { name, price, category, description, foodType } = req.body;
            let imageUrl = null;
           
            if (req.file) {
                if (STORAGE_PROVIDER === 'azure') {
                    imageUrl = await uploadToAzure(req.file, 'menu-images');
                } else {
                    imageUrl = req.file.path;
                }
            }

            await MenuItem.create({
                name,
                price,
                category,
                description,
                image: imageUrl,
                foodType: foodType || 'veg'
            });

            res.redirect("/admin/menu-management?tab=items");
        } catch (error) {
            console.error('Menu add error:', error);
            res.status(500).send('Error adding menu item');
        }
    });
});


// Delete Menu Item
router.get("/menu/delete/:id", auth, async (req, res) => {
    try {
        const item = await MenuItem.findById(req.params.id);


        // Delete image from storage if exists
        if (item && item.image) {
            try {
                const filename = item.image.split('/').pop();
                if (STORAGE_PROVIDER === 'azure') {
                    await deleteFromAzure(filename, 'menu-images');
                } else {
                    const publicId = filename.split('.')[0];
                    await deleteFromCloudinary(publicId, 'menu-images');
                }
            } catch (err) {
                console.error('Error deleting from storage:', err);
            }
        }


        await MenuItem.findByIdAndDelete(req.params.id);
        res.redirect("/admin/menu-management?tab=items");
    } catch (error) {
        console.error('Menu delete error:', error);
        res.status(500).send('Error deleting menu item');
    }
});


// Toggle Menu Item Availability
router.post("/menu/toggle/:id", auth, async (req, res) => {
    try {
        const item = await MenuItem.findById(req.params.id);
        if (!item) {
            return res.json({ success: false, error: 'Item not found' });
        }
        
        item.isAvailable = !item.isAvailable;
        await item.save();
        
        res.json({ success: true, isAvailable: item.isAvailable });
    } catch (error) {
        console.error('Toggle availability error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// Logout Route
router.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/admin");
});


// View / Edit Site Settings
router.get("/settings", auth, async (req, res) => {
    let settings = await SiteSettings.findOne();


    if (!settings) {
        settings = await SiteSettings.create({});
    }


    res.render("admin/settings", { settings, success: false });
});


// Update Site Settings
router.post("/settings", auth, async (req, res) => {
    const {
    cafeName,
    description,
    heroQuote,
    address,
    phone,
    instagram,
    facebook,
    mapLink,
    galleryImages,
    openingTime,
    closingTime,
    weeklyOff
} = req.body;


    let settings = await SiteSettings.findOne();


    if (!settings) {
        settings = new SiteSettings();
    }


    settings.cafeName = cafeName;
    settings.description = description;
    settings.heroQuote = heroQuote;
    settings.address = address;
    settings.phone = phone;
    settings.instagram = instagram;
    settings.facebook = facebook;
    settings.mapLink = mapLink;
    settings.openingTime = openingTime || '09:00';
    settings.closingTime = closingTime || '22:00';
    settings.weeklyOff = weeklyOff || 'None';


    settings.galleryImages = galleryImages
        ? galleryImages.split(",").map(img => img.trim())
        : [];


    await settings.save();


    res.render("admin/settings", { settings, success: true });
});


// Announcements Management
router.get("/announcements", auth, async (req, res) => {
    let settings = await SiteSettings.findOne();
    if (!settings) {
        settings = await SiteSettings.create({});
    }
    res.render("admin/announcements", { settings, success: false, error: null });
});


router.post("/announcements", auth, async (req, res) => {
    const {
        announcementEnabled,
        announcementType,
        announcementTitle,
        announcementDescription,
        announcementStartDate,
        announcementEndDate
    } = req.body;

    let settings = await SiteSettings.findOne();
    if (!settings) {
        settings = new SiteSettings();
    }
    
    // Validate dates
    const startDate = new Date(announcementStartDate);
    const endDate = new Date(announcementEndDate);
    
    if (endDate < startDate) {
        return res.render("admin/announcements", { 
            settings, 
            success: false,
            error: 'End date cannot be before start date'
        });
    }
   
    settings.announcement = {
        enabled: announcementEnabled === 'true',
        type: announcementType || 'offer',
        title: announcementTitle || '',
        description: announcementDescription || '',
        startDate: startDate,
        endDate: endDate
    };

    await settings.save();
    res.render("admin/announcements", { settings, success: true });
});


// Dashboard PINs Management
router.get("/dashboard-pins", auth, async (req, res) => {
    let settings = await SiteSettings.findOne();
    if (!settings) {
        settings = await SiteSettings.create({});
    }
    res.render("admin/dashboard-pins", { settings, success: false });
});


router.post("/dashboard-pins", auth, async (req, res) => {
    const { waiterPin } = req.body;
    let settings = await SiteSettings.findOne();
    if (!settings) {
        settings = new SiteSettings();
    }
    // Use same PIN for all staff dashboards
    settings.waiterPin = waiterPin || '1234';
    settings.kitchenPin = waiterPin || '1234'; // Keep for backward compatibility
    await settings.save();
    res.render("admin/dashboard-pins", { settings, success: true });
});


// Hall Booking Settings
router.get("/hall-settings", auth, async (req, res) => {
    let settings = await SiteSettings.findOne();
    if (!settings) {
        settings = await SiteSettings.create({});
    }
    res.render("admin/hall-settings", { settings, success: false });
});


router.post("/hall-settings", auth, async (req, res) => {
    const { minimumBookingHours, bufferTimeMinutes } = req.body;
    let settings = await SiteSettings.findOne();
    if (!settings) {
        settings = new SiteSettings();
    }
    if (!settings.hallBookingSettings) {
        settings.hallBookingSettings = {};
    }
    settings.hallBookingSettings.minimumBookingHours = parseInt(minimumBookingHours) || 2;
    settings.hallBookingSettings.bufferTimeMinutes = parseInt(bufferTimeMinutes) || 30;
    await settings.save();
    res.render("admin/hall-settings", { settings, success: true });
});


// Maintenance Mode Settings (All Admins Can View)
router.get("/maintenance-mode", auth, async (req, res) => {
    res.render("admin/maintenance-mode");
});


// Hall Management
router.get("/halls", auth, async (req, res) => {
    const halls = await Hall.find().sort({ name: 1 });
    res.render("admin/halls", { halls });
});


router.post("/halls/add", auth, async (req, res) => {
    const { name, capacity, baseRatePerHour, extensionRatePerHour } = req.body;
    await Hall.create({
        name,
        capacity: parseInt(capacity),
        baseRatePerHour: parseInt(baseRatePerHour),
        extensionRatePerHour: parseInt(extensionRatePerHour)
    });
    res.redirect("/admin/halls");
});


router.post("/halls/update/:id", auth, async (req, res) => {
    const { baseRatePerHour, extensionRatePerHour } = req.body;
    await Hall.findByIdAndUpdate(req.params.id, {
        baseRatePerHour: parseInt(baseRatePerHour),
        extensionRatePerHour: parseInt(extensionRatePerHour)
    });
    res.json({ success: true });
});


router.post("/halls/toggle/:id", auth, async (req, res) => {
    const hall = await Hall.findById(req.params.id);
    hall.isActive = !hall.isActive;
    await hall.save();
    res.json({ success: true });
});


router.get("/halls/delete/:id", auth, async (req, res) => {
    await Hall.findByIdAndDelete(req.params.id);
    res.redirect("/admin/halls");
});


// Gallery Management
router.get("/gallery", auth, async (req, res) => {
    const settings = await SiteSettings.findOne();
    const galleryImages = settings?.galleryImages || [];
    const hallGalleryImages = settings?.hallGalleryImages || [];
    res.render("admin/gallery", { galleryImages, hallGalleryImages });
});


// Upload Gallery Image
router.post("/gallery/upload", auth, (req, res) => {
    galleryUpload.array("images", 10)(req, res, async (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            const settings = await SiteSettings.findOne();
            const galleryImages = settings?.galleryImages || [];
            const hallGalleryImages = settings?.hallGalleryImages || [];
            return res.render("admin/gallery", { 
                galleryImages,
                hallGalleryImages,
                error: 'One or more images exceed 2MB size limit'
            });
        }
        if (err) {
            console.error('Upload error:', err);
            return res.status(500).send('Error uploading images');
        }
        
        try {
            if (!req.files || req.files.length === 0) {
                return res.redirect("/admin/gallery");
            }

            let settings = await SiteSettings.findOne();
            if (!settings) {
                settings = await SiteSettings.create({});
            }
           
            if (!settings.galleryImages) {
                settings.galleryImages = [];
            }
           
            for (const file of req.files) {
                if (STORAGE_PROVIDER === 'azure') {
                    const imageUrl = await uploadToAzure(file, 'gallery-images');
                    settings.galleryImages.push(imageUrl);
                } else {
                    settings.galleryImages.push(file.path);
                }
            }
           
            await settings.save();

            res.redirect("/admin/gallery");
        } catch (error) {
            console.error('Gallery upload error:', error);
            res.status(500).send('Error uploading images');
        }
    });
});


// Delete Gallery Image
router.post("/gallery/delete", auth, async (req, res) => {
    try {
        const { imageUrl } = req.body;
       
        // Delete from storage
        if (imageUrl) {
            try {
                const filename = imageUrl.split('/').pop();
                if (STORAGE_PROVIDER === 'azure') {
                    await deleteFromAzure(filename, 'gallery-images');
                } else {
                    await deleteFromCloudinary(filename, 'gallery-images');
                }
            } catch (err) {
                console.error('Error deleting from storage:', err);
            }
        }


        // Remove from database
        const settings = await SiteSettings.findOne();
        if (settings && settings.galleryImages) {
            settings.galleryImages = settings.galleryImages.filter(img => img !== imageUrl);
            await settings.save();
        }


        res.json({ success: true });
    } catch (error) {
        console.error('Gallery delete error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// Upload Hall Gallery Image
router.post("/gallery/hall/upload", auth, (req, res) => {
    galleryUpload.array("images", 10)(req, res, async (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            const settings = await SiteSettings.findOne();
            return res.render("admin/gallery", {
                galleryImages: settings?.galleryImages || [],
                hallGalleryImages: settings?.hallGalleryImages || [],
                error: 'One or more images exceed 2MB size limit'
            });
        }
        if (err) {
            console.error('Upload error:', err);
            return res.status(500).send('Error uploading images');
        }
        try {
            if (!req.files || req.files.length === 0) return res.redirect("/admin/gallery");
            let settings = await SiteSettings.findOne();
            if (!settings) settings = await SiteSettings.create({});
            if (!settings.hallGalleryImages) settings.hallGalleryImages = [];
            for (const file of req.files) {
                if (STORAGE_PROVIDER === 'azure') {
                    settings.hallGalleryImages.push(await uploadToAzure(file, 'gallery-images'));
                } else {
                    settings.hallGalleryImages.push(file.path);
                }
            }
            await settings.save();
            res.redirect("/admin/gallery");
        } catch (error) {
            console.error('Hall gallery upload error:', error);
            res.status(500).send('Error uploading images');
        }
    });
});


// Delete Hall Gallery Image
router.post("/gallery/hall/delete", auth, async (req, res) => {
    try {
        const { imageUrl } = req.body;
        if (imageUrl) {
            try {
                const filename = imageUrl.split('/').pop();
                if (STORAGE_PROVIDER === 'azure') {
                    await deleteFromAzure(filename, 'gallery-images');
                } else {
                    await deleteFromCloudinary(filename, 'gallery-images');
                }
            } catch (err) {
                console.error('Error deleting from storage:', err);
            }
        }
        const settings = await SiteSettings.findOne();
        if (settings && settings.hallGalleryImages) {
            settings.hallGalleryImages = settings.hallGalleryImages.filter(img => img !== imageUrl);
            await settings.save();
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Hall gallery delete error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// Delivery Partners Management
router.get("/delivery-partners", auth, async (req, res) => {
    const partners = await DeliveryPartner.find().sort({ createdAt: 1 });
    res.render("admin/delivery-partners", { partners });
});

router.post("/delivery-partners/add", auth, (req, res) => {
    menuUpload.single("logo")(req, res, async (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            const partners = await DeliveryPartner.find().sort({ createdAt: 1 });
            return res.render("admin/delivery-partners", { partners, error: 'Logo size must be less than 2MB' });
        }
        if (err) return res.status(500).send('Error uploading logo');
        try {
            const { name, url } = req.body;
            let logoUrl = null;
            if (req.file) {
                if (STORAGE_PROVIDER === 'azure') {
                    logoUrl = await uploadToAzure(req.file, 'menu-images');
                } else {
                    logoUrl = req.file.path;
                }
            }
            await DeliveryPartner.create({ name, logo: logoUrl, url });
            res.redirect("/admin/delivery-partners");
        } catch (error) {
            console.error('Add partner error:', error);
            res.status(500).send('Error adding delivery partner');
        }
    });
});

router.get("/delivery-partners/delete/:id", auth, async (req, res) => {
    try {
        const partner = await DeliveryPartner.findById(req.params.id);
        if (partner && partner.logo) {
            try {
                const filename = partner.logo.split('/').pop();
                if (STORAGE_PROVIDER === 'azure') {
                    await deleteFromAzure(filename, 'menu-images');
                } else {
                    const publicId = filename.split('.')[0];
                    await deleteFromCloudinary(publicId, 'menu-images');
                }
            } catch (err) {
                console.error('Error deleting logo:', err);
            }
        }
        await DeliveryPartner.findByIdAndDelete(req.params.id);
        res.redirect("/admin/delivery-partners");
    } catch (error) {
        console.error('Delete partner error:', error);
        res.status(500).send('Error deleting partner');
    }
});


// View Feedback
router.get("/feedback", auth, async (req, res) => {
    const filter = req.query.filter;
    let query = {};
   
    if (filter && filter !== 'all') {
        query.type = filter;
    }
   
    const feedbacks = await Feedback.find(query).sort({ createdAt: -1 });
    res.render("admin/feedback", { feedbacks, filter });
});


// Mark Feedback as Reviewed
router.get("/feedback/review/:id", auth, async (req, res) => {
    await Feedback.findByIdAndUpdate(req.params.id, { status: "Reviewed" });
    res.redirect("/admin/feedback");
});


// Delete Feedback
router.get("/feedback/delete/:id", auth, async (req, res) => {
    await Feedback.findByIdAndDelete(req.params.id);
    res.redirect("/admin/feedback");
});


// Table Management
router.get("/tables", auth, async (req, res) => {
    const tables = await Table.find().sort({ tableNumber: 1 });
    res.render("admin/tables", { tables, branding });
});


router.post("/tables/set", auth, async (req, res) => {
    const { tableCount } = req.body;
    const count = parseInt(tableCount);
    const existing = await Table.countDocuments();
   
    if (count > existing) {
        for (let i = existing + 1; i <= count; i++) {
            await Table.create({ tableNumber: i });
        }
    } else if (count < existing) {
        for (let i = existing; i > count; i--) {
            await Table.findOneAndDelete({ tableNumber: i, status: 'empty' });
        }
    }
    res.redirect("/admin/tables");
});


router.post("/tables/reset/:number", auth, async (req, res) => {
    await Table.findOneAndUpdate(
        { tableNumber: parseInt(req.params.number) },
        { status: 'empty', currentOrderId: null, occupiedAt: null }
    );
    res.json({ success: true });
});


// Waiter Management
router.get("/waiters", auth, async (req, res) => {
    const waiters = await Waiter.find().sort({ createdAt: -1 });
    res.render("admin/waiters", { waiters });
});


router.post("/waiters/add", auth, async (req, res) => {
    const { name } = req.body;
    await Waiter.create({ name });
    res.redirect("/admin/waiters");
});


router.post("/waiters/toggle/:id", auth, async (req, res) => {
    const waiter = await Waiter.findById(req.params.id);
    waiter.isActive = !waiter.isActive;
    await waiter.save();
    res.json({ success: true });
});


router.get("/waiters/delete/:id", auth, async (req, res) => {
    await Waiter.findByIdAndDelete(req.params.id);
    res.redirect("/admin/waiters");
});


// Orders Management
router.get("/orders", auth, async (req, res) => {
    const { from, to, view, orderType } = req.query;
    
    let startDate, endDate, currentView;
    if (from && to) {
        startDate = getStartOfDay(new Date(from));
        endDate = getEndOfDay(new Date(to));
        currentView = 'custom';
    } else if (view === 'yesterday') {
        startDate = getStartOfYesterday();
        endDate = getEndOfYesterday();
        currentView = 'yesterday';
    } else {
        startDate = getStartOfDay();
        endDate = getEndOfDay();
        currentView = 'today';
    }
    
    // Get regular orders with type filter
    let orderQuery = {
        orderTakenAt: { $gte: startDate, $lte: endDate },
        orderType: { $ne: 'hall' },
        status: { $ne: 'cancelled' }
    };
    
    // Apply order type filter
    if (orderType === 'dine-in') {
        orderQuery.orderType = 'dine-in';
    } else if (orderType === 'parcel') {
        orderQuery.orderType = 'parcel';
    }
    
    const allOrders = await Order.find(orderQuery).sort({ orderTakenAt: -1 });
    
    // Get billed hall bookings (only if not filtering for specific order types)
    let billedHallBookings = [];
    if (!orderType || orderType === 'all' || orderType === 'hall') {
        billedHallBookings = await HallBooking.find({
            bookingDate: { $gte: startDate, $lte: endDate },
            status: 'billed'
        }).populate('hallId').sort({ bookingDate: -1 });
    }
    
    const bills = await Bill.find();
    const billMap = {};
    bills.forEach(bill => {
        if (bill.orderId) {
            billMap[bill.orderId.toString()] = bill.billId;
        }
        if (bill.hallBookingId) {
            billMap['hall_' + bill.hallBookingId.toString()] = bill.billId;
        }
    });
   
    const { format12Hour } = require('../config/timezone');
    res.render("admin/orders", { allOrders, billedHallBookings, billMap, from: from || '', to: to || '', currentView, orderType: orderType || 'all', format12Hour });
});


// Generate Bill (accessible by both admin and staff)
router.post("/bill/generate", async (req, res) => {
    try {
        const { orderId, paymentMethod } = req.body;
        const order = await Order.findById(orderId);
       
        if (!order) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }
       
        // Prevent bill generation for rejected orders
        if (order.approvalStatus === 'rejected') {
            return res.status(400).json({ success: false, error: 'Cannot generate bill for rejected order' });
        }
       
        // Prevent bill generation for cancelled orders
        if (order.status === 'cancelled') {
            return res.status(400).json({ success: false, error: 'Cannot generate bill for cancelled order' });
        }
       
        // Generate unique bill ID
        const billId = 'BIL' + Date.now();
       
        const subtotal = order.totalAmount;
        const cgst = subtotal * CGST_RATE;
        const sgst = subtotal * SGST_RATE;
        const otherCharges = parseFloat(req.body.otherCharges) || 0;
        const totalAmount = subtotal + cgst + sgst + otherCharges;
       
        const bill = await Bill.create({
            billId,
            orderId: order._id,
            items: order.items,
            subtotal,
            cgst,
            sgst,
            otherCharges,
            totalAmount,
            paymentMethod: paymentMethod || 'cash',
            generatedBy: 'admin'
        });
       
        order.status = 'billed';
        order.billedAt = new Date();
        order.sessionToken = null;
        await order.save();
       
        if (order.orderType === 'dine-in') {
            await Table.findOneAndUpdate(
                { tableNumber: order.tableNumber },
                { status: 'empty', currentOrderId: null, occupiedAt: null }
            );
        }
       
        res.json({ success: true, billId: bill.billId });
    } catch (error) {
        console.error('Bill generation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// View Hall Booking Bill
router.get("/hall-bill/:bookingId", async (req, res) => {
    try {
        // Check if either admin or waiter is authenticated
        if (!req.session.adminAuthenticated && !req.session.staffAuthenticated) {
            return res.redirect('/admin');
        }
        
        const booking = await HallBooking.findById(req.params.bookingId).populate('hallId').populate('foodOrderIds');
        if (!booking) {
            return res.status(404).send('Booking not found');
        }
        
        const settings = await SiteSettings.findOne();
        res.render("admin/hall-bill-view", { booking, settings });
    } catch (error) {
        console.error('Hall bill view error:', error);
        res.status(500).send('Error loading hall bill');
    }
});

// View Bill (Read-only for history) - Accessible by both admin and waiter
router.get("/bill/:billId/view", async (req, res) => {
    try {
        // Check if either admin or waiter is authenticated
        if (!req.session.adminAuthenticated && !req.session.staffAuthenticated) {
            return res.redirect('/admin');
        }
        
        const bill = await Bill.findOne({ billId: req.params.billId })
            .populate('orderId')
            .populate({
                path: 'hallBookingId',
                populate: { path: 'hallId foodOrderIds' }
            });
        
        if (!bill) {
            return res.status(404).send('Bill not found');
        }
        
        const settings = await SiteSettings.findOne();
        
        // Check if it's a hall booking bill
        if (bill.hallBookingId) {
            return res.render("admin/hall-bill-view", { booking: bill.hallBookingId, settings });
        }
        
        if (!bill.orderId) {
            return res.status(404).send('Order not found for this bill');
        }
        
        res.render("admin/bill-view", { bill, settings });
    } catch (error) {
        console.error('Bill view error:', error);
        res.status(500).send('Error loading bill');
    }
});

// View Bill
router.get("/bill/:billId", auth, async (req, res) => {
    const bill = await Bill.findOne({ billId: req.params.billId }).populate('orderId');
    const settings = await SiteSettings.findOne();
    res.render("admin/bill", { bill, settings });
});


// Download Bill PDF
router.get("/bill/:billId/pdf", auth, async (req, res) => {
    const bill = await Bill.findOne({ billId: req.params.billId }).populate('orderId');
    const settings = await SiteSettings.findOne();
    res.render("admin/bill-pdf", { bill, settings, layout: false });
});


// Clean database (remove all orders and bills, reset tables)
router.post("/cleanup", auth, async (req, res) => {
    try {
        await Order.deleteMany({});
        await Bill.deleteMany({});
        await Table.updateMany({}, { status: 'empty', currentOrderId: null, occupiedAt: null });
        res.json({ success: true, message: 'Database cleaned successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// Admin Management (Master Admin Only)
router.get("/admins", auth, async (req, res) => {
    if (!req.session.isMaster) {
        return res.redirect("/admin/dashboard");
    }
    const admins = await Admin.find().sort({ createdAt: -1 });
    const pendingCount = admins.filter(a => a.isVerified && !a.isApproved).length;
    res.render("admin/admins", { admins, pendingCount });
});

// Debug endpoint to check admin status (Master Admin Only)
router.get("/admins/debug", auth, async (req, res) => {
    if (!req.session.isMaster) {
        return res.json({ error: 'Unauthorized' });
    }
    try {
        const allAdmins = await Admin.find();
        const totalCount = allAdmins.length;
        const verifiedCount = allAdmins.filter(a => a.isVerified).length;
        const approvedCount = allAdmins.filter(a => a.isApproved).length;
        const pendingCount = allAdmins.filter(a => a.isVerified && !a.isApproved).length;
        const unverifiedCount = allAdmins.filter(a => !a.isVerified).length;
        
        res.json({
            success: true,
            stats: {
                total: totalCount,
                verified: verifiedCount,
                approved: approvedCount,
                pendingApproval: pendingCount,
                unverified: unverifiedCount,
                remainingSlots: Math.max(0, 3 - totalCount)
            },
            admins: allAdmins.map(a => ({
                email: a.email,
                role: a.role,
                isVerified: a.isVerified,
                isApproved: a.isApproved,
                createdAt: a.createdAt
            }))
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});


// Force cleanup unverified admins (Master Admin Only)
router.post("/admins/cleanup-unverified", auth, async (req, res) => {
    if (!req.session.isMaster) {
        return res.json({ success: false, error: 'Unauthorized' });
    }
    try {
        const result = await Admin.deleteMany({ isVerified: false });
        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});


router.post("/admins/approve/:id", auth, async (req, res) => {
    if (!req.session.isMaster) {
        return res.json({ success: false, error: 'Unauthorized' });
    }
    try {
        // Check approved admin limit
        const approvedCount = await Admin.countDocuments({ isApproved: true });
        if (approvedCount >= 3) {
            return res.json({ success: false, error: 'Maximum approved admin limit (3) reached' });
        }
       
        await Admin.findByIdAndUpdate(req.params.id, { isApproved: true });
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});


router.post("/admins/reject/:id", auth, async (req, res) => {
    if (!req.session.isMaster) {
        return res.json({ success: false, error: 'Unauthorized' });
    }
    try {
        await Admin.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});


router.get("/admins/delete/:id", auth, async (req, res) => {
    if (!req.session.isMaster) {
        return res.redirect("/admin/dashboard");
    }
    await Admin.findByIdAndDelete(req.params.id);
    res.redirect("/admin/admins");
});


// Sales Analysis Dashboard
router.get("/sales-analysis", auth, async (req, res) => {
    try {
        const filter = req.query.filter || 'alltime';
        const topLimit = parseInt(req.query.top) || 10;
        const weekOffset = parseInt(req.query.week) || 0;
        const selectedMonth = req.query.month || '';
       
        // Get all bills
        const allBills = await Bill.find();
       
        // Calculate today's metrics
        const todayStart = getStartOfDay();
        const todayEnd = getEndOfDay();
       
        const todayBills = await Bill.find({
            generatedAt: { $gte: todayStart, $lte: todayEnd }
        });
       
        const todayRevenue = todayBills.reduce((sum, bill) => sum + bill.totalAmount, 0);
        const todayOrders = todayBills.length;
       
        // Calculate category-wise revenue for selected month
        let pieChartMonth, pieChartYear, pieMonthStart, pieMonthEnd;
       
        if (selectedMonth) {
            const [year, month] = selectedMonth.split('-');
            pieChartYear = parseInt(year);
            pieChartMonth = parseInt(month) - 1;
        } else {
            // Default: Previous month
            const today = new Date();
            pieChartMonth = today.getMonth() - 1;
            pieChartYear = today.getFullYear();
            if (pieChartMonth < 0) {
                pieChartMonth = 11;
                pieChartYear -= 1;
            }
        }
       
        pieMonthStart = new Date(pieChartYear, pieChartMonth, 1, 0, 0, 0, 0);
        pieMonthEnd = new Date(pieChartYear, pieChartMonth + 1, 0, 23, 59, 59, 999);
       
        const pieMonthBills = await Bill.find({
            generatedAt: { $gte: pieMonthStart, $lte: pieMonthEnd }
        });
       
        // Get all categories and menu items
        const categories = await Category.find();
        const menuItems = await MenuItem.find().populate('category');
       
        // Create item to category mapping
        const itemCategoryMap = {};
        menuItems.forEach(item => {
            if (item.category) {
                itemCategoryMap[item.name] = item.category.name;
            }
        });
       
        // Calculate category revenue
        const categoryRevenue = {};
        pieMonthBills.forEach(bill => {
            bill.items.forEach(item => {
                const categoryName = itemCategoryMap[item.name] || 'Uncategorized';
                if (!categoryRevenue[categoryName]) {
                    categoryRevenue[categoryName] = 0;
                }
                categoryRevenue[categoryName] += item.price * item.quantity;
            });
        });
       
        // Prepare pie chart data
        const pieChartData = Object.entries(categoryRevenue).map(function(entry) {
            return {
                name: entry[0],
                revenue: entry[1]
            };
        });
       
        const totalPieRevenue = pieChartData.reduce((sum, cat) => sum + cat.revenue, 0);
        const pieChartMonthName = new Date(pieChartYear, pieChartMonth).toLocaleString('default', { month: 'long', year: 'numeric' });
        const selectedMonthValue = selectedMonth || (pieChartYear + '-' + String(pieChartMonth + 1).padStart(2, '0'));
       
        // Calculate date range for top items based on filter
        let startDate, endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
       
        switch(filter) {
            case 'today':
                startDate = new Date();
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'weekly':
                startDate = new Date();
                const currentDay = startDate.getDay();
                const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
                startDate.setDate(startDate.getDate() + mondayOffset);
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'monthly':
                startDate = new Date();
                startDate.setDate(1);
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'yearly':
                startDate = new Date();
                startDate.setMonth(0, 1);
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'alltime':
            default:
                startDate = new Date(0);
                break;
        }
       
        // Get bills for top items
        const topItemsBills = await Bill.find({
            generatedAt: { $gte: startDate, $lte: endDate }
        });
       
        // Calculate top 10 items
        const itemStats = {};
        topItemsBills.forEach(bill => {
            bill.items.forEach(item => {
                if (!itemStats[item.name]) {
                    itemStats[item.name] = { name: item.name, quantity: 0, revenue: 0, foodType: 'veg' };
                }
                itemStats[item.name].quantity += item.quantity;
                itemStats[item.name].revenue += item.price * item.quantity;
            });
        });
        
        // Get foodType from menu items
        const topItemsArray = Object.values(itemStats);
        for (const item of topItemsArray) {
            const menuItem = menuItems.find(mi => mi.name === item.name);
            if (menuItem) {
                item.foodType = menuItem.foodType || 'veg';
            }
        }
       
        const topItems = topItemsArray
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, topLimit);
        
        // Calculate least selling items (reverse sort)
        const leastItems = topItemsArray
            .sort((a, b) => a.quantity - b.quantity)
            .slice(0, topLimit);
       
        // Calculate weekly revenue (Sunday to Saturday)
        const today = new Date();
        const currentDayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
        const weeklyData = [];
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
       
        // Calculate week start based on offset
        const weekStartDate = new Date(today);
        weekStartDate.setDate(today.getDate() - currentDayOfWeek + (weekOffset * 7));
        weekStartDate.setHours(0, 0, 0, 0);
       
        const weekEndDate = new Date(weekStartDate);
        weekEndDate.setDate(weekStartDate.getDate() + 6);
        weekEndDate.setHours(23, 59, 59, 999);
       
        // Format dates for display
        const weekStartFormatted = weekStartDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        const weekEndFormatted = weekEndDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
       
        // Always show all 7 days
        for (let i = 0; i < 7; i++) {
            const dayDate = new Date(weekStartDate);
            dayDate.setDate(weekStartDate.getDate() + i);
            dayDate.setHours(0, 0, 0, 0);
           
            const dayEnd = new Date(dayDate);
            dayEnd.setHours(23, 59, 59, 999);
           
            let dayRevenue = 0;
            // Only fetch data for past days
            if (dayDate <= today) {
                const dayBills = await Bill.find({
                    generatedAt: { $gte: dayDate, $lte: dayEnd }
                });
                dayRevenue = dayBills.reduce((sum, bill) => sum + bill.totalAmount, 0);
            }
           
            weeklyData.push({
                day: dayNames[i],
                revenue: dayRevenue
            });
        }
       
        // Calculate max revenue for bar chart scaling
        const maxWeeklyRevenue = Math.max(...weeklyData.map(d => d.revenue), 1);
       
        res.render("admin/sales-analysis", {
            filter,
            topLimit,
            todayRevenue,
            todayOrders,
            topItems,
            leastItems,
            weeklyData,
            weekOffset,
            weekStartFormatted,
            weekEndFormatted,
            pieChartData,
            totalPieRevenue,
            pieChartMonthName,
            selectedMonthValue,
            maxWeeklyRevenue
        });
    } catch (error) {
        console.error('Sales analysis error:', error);
        res.status(500).send('Error loading sales analysis');
    }
});




// Process Payment for Bill
router.post("/bill/:billId/payment", auth, async (req, res) => {
    try {
        const { paymentMethod, customerMobile } = req.body;
        console.log('=== PAYMENT REQUEST ===');
        console.log('Bill ID from URL:', req.params.billId);
        console.log('Payment Method:', paymentMethod);
        console.log('Customer Mobile:', customerMobile);
        
        const bill = await Bill.findOne({ billId: req.params.billId });
        console.log('Bill found:', bill ? 'YES' : 'NO');
        
        if (!bill) {
            console.log('ERROR: Bill not found');
            return res.json({ success: false, error: 'Bill not found' });
        }
        
        console.log('BEFORE UPDATE - paymentMethod:', bill.paymentMethod);
        bill.paymentMethod = paymentMethod;
        if (customerMobile) {
            bill.customerMobile = customerMobile;
        }
        const savedBill = await bill.save();
        console.log('AFTER SAVE - paymentMethod:', savedBill.paymentMethod);
        console.log('=== PAYMENT SAVED SUCCESSFULLY ===');
        
        res.json({ success: true });
    } catch (error) {
        console.error('Payment error:', error);
        res.json({ success: false, error: error.message });
    }
});

module.exports = router;
