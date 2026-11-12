const express = require('express');
const router = express.Router();
const Table = require('../models/Table');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const Category = require('../models/Category');
const Bill = require('../models/Bill');
const Waiter = require('../models/Waiter');
const Hall = require('../models/Hall');
const HallBooking = require('../models/HallBooking');
const SiteSettings = require('../models/SiteSettings');
const Admin = require('../models/Admin');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { menuStorage, galleryStorage, uploadToAzure, deleteFromAzure, deleteFromCloudinary, STORAGE_PROVIDER } = require('../utils/storage');
const { getImageUrl } = require('../utils/imageHelper');
const { CGST_RATE, SGST_RATE } = require('../config/gst');
const { getStartOfDay, getEndOfDay, getStartOfYesterday, getEndOfYesterday } = require('../config/timezone');

// Auth middleware for API
const apiAuth = (req, res, next) => {
    if (req.session.staffAuthenticated) return next();
    res.status(401).json({ success: false, error: 'Unauthorized' });
};

const apiAdminAuth = (req, res, next) => {
    if (req.session.adminAuthenticated) return next();
    res.status(401).json({ success: false, error: 'Admin sign-in required' });
};

const apiStaffOrAdminAuth = (req, res, next) => {
    if (req.session.staffAuthenticated || req.session.adminAuthenticated) return next();
    res.status(401).json({ success: false, error: 'Sign-in required' });
};

const menuUpload = multer({ storage: menuStorage, limits: { fileSize: 2 * 1024 * 1024 } });
const galleryUpload = multer({ storage: galleryStorage, limits: { fileSize: 2 * 1024 * 1024 } });

async function removeMenuImage(image) {
    if (!image) return;
    const filename = image.split('/').pop();
    if (STORAGE_PROVIDER === 'azure') await deleteFromAzure(filename, 'menu-images');
    else await deleteFromCloudinary(filename.split('.')[0], 'menu-images');
}

// Admin authentication is kept separate from staff authentication so an owner
// can leave the admin area without logging the waiter out of the device.
const checkMasterAdmin = (email, password) =>
    email === String(process.env.MASTER_ADMIN_EMAIL || '').trim().toLowerCase() &&
    password === process.env.MASTER_ADMIN_PASSWORD;

router.post('/admin/auth/login', async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required' });
        }

        if (checkMasterAdmin(email, password)) {
            req.session.adminId = 'master';
            req.session.isMaster = true;
            req.session.adminAuthenticated = true;
            return req.session.save(error => {
                if (error) return res.status(500).json({ success: false, error: 'Could not start admin session' });
                res.json({ success: true, data: { email, isMaster: true } });
            });
        }

        const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const admin = await Admin.findOne({ email: { $regex: `^${escapedEmail}$`, $options: 'i' } });
        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }
        if (!admin.isVerified) {
            return res.status(403).json({ success: false, error: 'Please verify your email before signing in' });
        }
        if (!admin.isApproved) {
            return res.status(403).json({ success: false, error: 'Your account is pending approval' });
        }

        req.session.adminId = admin._id;
        req.session.isMaster = false;
        req.session.adminAuthenticated = true;
        req.session.save(error => {
            if (error) return res.status(500).json({ success: false, error: 'Could not start admin session' });
            res.json({ success: true, data: { email: admin.email, isMaster: false } });
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to sign in right now' });
    }
});

router.get('/admin/auth/check', async (req, res) => {
    if (!req.session.adminAuthenticated) {
        return res.json({ authenticated: false });
    }

    if (req.session.isMaster) {
        return res.json({ authenticated: true, admin: { email: process.env.MASTER_ADMIN_EMAIL, isMaster: true } });
    }

    const admin = await Admin.findById(req.session.adminId).select('email isVerified isApproved');
    if (!admin || !admin.isVerified || !admin.isApproved) {
        delete req.session.adminId;
        delete req.session.adminAuthenticated;
        delete req.session.isMaster;
        return req.session.save(() => res.json({ authenticated: false }));
    }

    res.json({ authenticated: true, admin: { email: admin.email, isMaster: false } });
});

router.post('/admin/auth/logout', (req, res) => {
    delete req.session.adminId;
    delete req.session.adminAuthenticated;
    delete req.session.isMaster;
    req.session.save(error => {
        if (error) return res.status(500).json({ success: false, error: 'Could not sign out' });
        res.json({ success: true });
    });
});

// ─── ADMIN MENU MANAGEMENT ────────────────────────────────────────────────
router.get('/admin/menu', apiAdminAuth, async (req, res) => {
    try {
        const [categories, items] = await Promise.all([
            Category.find().sort({ name: 1 }),
            MenuItem.find().populate('category').sort({ name: 1 })
        ]);
        const menuItems = items.map(item => ({ ...item.toObject(), imageUrl: getImageUrl(item.image) }));
        res.json({ success: true, data: { categories, menuItems } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Could not load menu' });
    }
});

router.post('/admin/categories', apiAdminAuth, async (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ success: false, error: 'Category name is required' });
        const duplicate = await Category.findOne({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
        if (duplicate) return res.status(409).json({ success: false, error: 'That category already exists' });
        const category = await Category.create({ name });
        res.json({ success: true, data: category });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Could not add category' });
    }
});

router.delete('/admin/categories/:id', apiAdminAuth, async (req, res) => {
    try {
        const items = await MenuItem.find({ category: req.params.id });
        for (const item of items) {
            try { await removeMenuImage(item.image); } catch (error) { console.error('Image delete error:', error); }
        }
        await MenuItem.deleteMany({ category: req.params.id });
        const category = await Category.findByIdAndDelete(req.params.id);
        if (!category) return res.status(404).json({ success: false, error: 'Category not found' });
        res.json({ success: true, deletedItems: items.length });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Could not delete category' });
    }
});

function handleMenuUpload(req, res, next) {
    menuUpload.single('image')(req, res, error => {
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, error: 'Image must be smaller than 2 MB' });
        }
        if (error) return res.status(400).json({ success: false, error: 'Could not upload that image' });
        next();
    });
}

router.post('/admin/menu', apiAdminAuth, handleMenuUpload, async (req, res) => {
    try {
        const { name, price, category, description, foodType } = req.body;
        if (!String(name || '').trim() || !category || !Number.isFinite(Number(price)) || Number(price) < 0) {
            return res.status(400).json({ success: false, error: 'Name, category and a valid price are required' });
        }
        let image = null;
        if (req.file) image = STORAGE_PROVIDER === 'azure' ? await uploadToAzure(req.file, 'menu-images') : req.file.path;
        const item = await MenuItem.create({ name: name.trim(), price: Number(price), category, description: String(description || '').trim(), foodType: foodType || 'veg', image });
        await item.populate('category');
        res.json({ success: true, data: { ...item.toObject(), imageUrl: getImageUrl(item.image) } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Could not add menu item' });
    }
});

router.post('/admin/menu/:id', apiAdminAuth, handleMenuUpload, async (req, res) => {
    try {
        const { name, price, category, description, foodType } = req.body;
        if (!String(name || '').trim() || !category || !Number.isFinite(Number(price)) || Number(price) < 0) {
            return res.status(400).json({ success: false, error: 'Name, category and a valid price are required' });
        }
        const item = await MenuItem.findById(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: 'Menu item not found' });
        item.name = name.trim();
        item.price = Number(price);
        item.category = category;
        item.description = String(description || '').trim();
        item.foodType = foodType || 'veg';
        if (req.file) {
            try { await removeMenuImage(item.image); } catch (error) { console.error('Old image delete error:', error); }
            item.image = STORAGE_PROVIDER === 'azure' ? await uploadToAzure(req.file, 'menu-images') : req.file.path;
        }
        await item.save();
        await item.populate('category');
        res.json({ success: true, data: { ...item.toObject(), imageUrl: getImageUrl(item.image) } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Could not update menu item' });
    }
});

router.patch('/admin/menu/:id/availability', apiAdminAuth, async (req, res) => {
    try {
        const item = await MenuItem.findById(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: 'Menu item not found' });
        item.isAvailable = typeof req.body.isAvailable === 'boolean' ? req.body.isAvailable : !item.isAvailable;
        await item.save();
        res.json({ success: true, isAvailable: item.isAvailable });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Could not update availability' });
    }
});

router.delete('/admin/menu/:id', apiAdminAuth, async (req, res) => {
    try {
        const item = await MenuItem.findById(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: 'Menu item not found' });
        try { await removeMenuImage(item.image); } catch (error) { console.error('Image delete error:', error); }
        await item.deleteOne();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Could not delete menu item' });
    }
});

// ─── ADMIN TABLE & HALL MANAGEMENT ────────────────────────────────────────
router.get('/admin/operations-setup', apiAdminAuth, async (req, res) => {
    try {
        const [tables, halls, settings] = await Promise.all([
            Table.find().sort({ tableNumber: 1 }),
            Hall.find().sort({ name: 1 }),
            SiteSettings.findOne()
        ]);
        res.json({ success: true, data: {
            tables, halls,
            hallBookingSettings: settings?.hallBookingSettings || { minimumBookingHours: 2, bufferTimeMinutes: 30 }
        }});
    } catch (error) {
        res.status(500).json({ success: false, error: 'Could not load tables and halls' });
    }
});

router.post('/admin/tables/count', apiAdminAuth, async (req, res) => {
    try {
        const count = Number.parseInt(req.body.count, 10);
        if (!Number.isInteger(count) || count < 1 || count > 50) return res.status(400).json({ success: false, error: 'Table count must be between 1 and 50' });
        const tables = await Table.find().sort({ tableNumber: 1 });
        const highest = tables.length ? Math.max(...tables.map(table => table.tableNumber)) : 0;
        if (count > tables.length) {
            for (let number = highest + 1; number <= highest + (count - tables.length); number += 1) await Table.create({ tableNumber: number });
        } else if (count < tables.length) {
            const removable = [...tables].reverse().filter(table => table.status === 'empty').slice(0, tables.length - count);
            if (removable.length < tables.length - count) return res.status(409).json({ success: false, error: 'Busy tables cannot be removed. Reset them first.' });
            await Table.deleteMany({ _id: { $in: removable.map(table => table._id) } });
        }
        const updated = await Table.find().sort({ tableNumber: 1 });
        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Could not update table count' });
    }
});

router.post('/admin/tables/:number/reset', apiAdminAuth, async (req, res) => {
    const table = await Table.findOneAndUpdate({ tableNumber: Number(req.params.number) }, { status: 'empty', currentOrderId: null, occupiedAt: null }, { new: true });
    if (!table) return res.status(404).json({ success: false, error: 'Table not found' });
    res.json({ success: true, data: table });
});

router.post('/admin/halls', apiAdminAuth, async (req, res) => {
    try {
        const { name, capacity, baseRatePerHour, extensionRatePerHour } = req.body;
        if (!String(name || '').trim() || Number(capacity) < 1 || Number(baseRatePerHour) < 0 || Number(extensionRatePerHour) < 0) return res.status(400).json({ success: false, error: 'Enter valid hall details and rates' });
        const hall = await Hall.create({ name: name.trim(), capacity: Number(capacity), baseRatePerHour: Number(baseRatePerHour), extensionRatePerHour: Number(extensionRatePerHour) });
        res.json({ success: true, data: hall });
    } catch (error) { res.status(500).json({ success: false, error: 'Could not add hall' }); }
});

router.put('/admin/halls/:id', apiAdminAuth, async (req, res) => {
    try {
        const { name, capacity, baseRatePerHour, extensionRatePerHour } = req.body;
        if (!String(name || '').trim() || Number(capacity) < 1 || Number(baseRatePerHour) < 0 || Number(extensionRatePerHour) < 0) return res.status(400).json({ success: false, error: 'Enter valid hall details and rates' });
        const hall = await Hall.findByIdAndUpdate(req.params.id, { name: name.trim(), capacity: Number(capacity), baseRatePerHour: Number(baseRatePerHour), extensionRatePerHour: Number(extensionRatePerHour) }, { new: true, runValidators: true });
        if (!hall) return res.status(404).json({ success: false, error: 'Hall not found' });
        res.json({ success: true, data: hall });
    } catch (error) { res.status(500).json({ success: false, error: 'Could not update hall' }); }
});

router.patch('/admin/halls/:id/status', apiAdminAuth, async (req, res) => {
    const hall = await Hall.findById(req.params.id);
    if (!hall) return res.status(404).json({ success: false, error: 'Hall not found' });
    hall.isActive = typeof req.body.isActive === 'boolean' ? req.body.isActive : !hall.isActive;
    await hall.save();
    res.json({ success: true, data: hall });
});

router.delete('/admin/halls/:id', apiAdminAuth, async (req, res) => {
    const bookings = await HallBooking.countDocuments({ hallId: req.params.id, status: { $in: ['confirmed', 'ongoing'] } });
    if (bookings) return res.status(409).json({ success: false, error: 'This hall has active bookings and cannot be deleted' });
    const hall = await Hall.findByIdAndDelete(req.params.id);
    if (!hall) return res.status(404).json({ success: false, error: 'Hall not found' });
    res.json({ success: true });
});

router.put('/admin/hall-booking-settings', apiAdminAuth, async (req, res) => {
    const minimumBookingHours = Number(req.body.minimumBookingHours);
    const bufferTimeMinutes = Number(req.body.bufferTimeMinutes);
    if (minimumBookingHours < 1 || bufferTimeMinutes < 0) return res.status(400).json({ success: false, error: 'Enter valid booking settings' });
    const settings = await SiteSettings.findOneAndUpdate({}, { $set: { hallBookingSettings: { minimumBookingHours, bufferTimeMinutes } } }, { new: true, upsert: true });
    res.json({ success: true, data: settings.hallBookingSettings });
});

router.get('/admin/staff-pin', apiAdminAuth, async (req, res) => {
    const settings = await SiteSettings.findOne();
    res.json({ success: true, data: { pin: settings?.waiterPin || '1234' } });
});

router.put('/admin/staff-pin', apiAdminAuth, async (req, res) => {
    const pin = String(req.body.pin || '');
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ success: false, error: 'PIN must contain exactly 4 digits' });
    await SiteSettings.findOneAndUpdate({}, { $set: { waiterPin: pin, kitchenPin: pin } }, { upsert: true, new: true });
    res.json({ success: true });
});

// ─── ADMIN WEBSITE SETTINGS & ANNOUNCEMENTS ──────────────────────────────
router.get('/admin/website-settings', apiAdminAuth, async (req, res) => {
    let settings = await SiteSettings.findOne();
    if (!settings) settings = await SiteSettings.create({});
    res.json({ success: true, data: {
        website: {
            cafeName: settings.cafeName || '', description: settings.description || '', heroQuote: settings.heroQuote || '',
            address: settings.address || '', phone: settings.phone || '', instagram: settings.instagram || '',
            facebook: settings.facebook || '', mapLink: settings.mapLink || '', openingTime: settings.openingTime || '09:00',
            closingTime: settings.closingTime || '22:00', weeklyOff: settings.weeklyOff || 'None'
        },
        announcement: settings.announcement || { enabled: false, type: 'offer', title: '', description: '', startDate: null, endDate: null }
    }});
});

router.put('/admin/website-settings', apiAdminAuth, async (req, res) => {
    try {
        const allowed = ['cafeName', 'description', 'heroQuote', 'address', 'phone', 'instagram', 'facebook', 'mapLink', 'openingTime', 'closingTime', 'weeklyOff'];
        const update = {};
        allowed.forEach(key => { if (Object.prototype.hasOwnProperty.call(req.body, key)) update[key] = String(req.body[key] || '').trim(); });
        if (!update.cafeName) return res.status(400).json({ success: false, error: 'Cafe name is required' });
        await SiteSettings.findOneAndUpdate({}, { $set: update }, { upsert: true, new: true });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: 'Could not save website settings' }); }
});

router.put('/admin/announcement', apiAdminAuth, async (req, res) => {
    try {
        const { enabled, type, title, description, startDate, endDate } = req.body;
        const validTypes = ['offer', 'closure', 'announcement'];
        if (!validTypes.includes(type)) return res.status(400).json({ success: false, error: 'Choose a valid announcement type' });
        if (enabled && (!String(title || '').trim() || !startDate || !endDate)) return res.status(400).json({ success: false, error: 'Title, start date and end date are required' });
        const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
        const end = endDate ? new Date(`${endDate}T23:59:59`) : null;
        if (start && end && end < start) return res.status(400).json({ success: false, error: 'End date cannot be before start date' });
        const announcement = { enabled: Boolean(enabled), type, title: String(title || '').trim(), description: String(description || '').trim(), startDate: start, endDate: end };
        await SiteSettings.findOneAndUpdate({}, { $set: { announcement } }, { upsert: true, new: true });
        res.json({ success: true, data: announcement });
    } catch (error) { res.status(500).json({ success: false, error: 'Could not save announcement' }); }
});

// ─── ADMIN ANALYTICS & FEEDBACK ──────────────────────────────────────────
router.get('/admin/sales', apiAdminAuth, async (req, res) => {
    try {
        const period = ['today', 'weekly', 'monthly', 'yearly', 'alltime'].includes(req.query.period) ? req.query.period : 'monthly';
        const now = new Date(); let start = new Date(0);
        if (period === 'today') start = getStartOfDay(now);
        if (period === 'weekly') { start = getStartOfDay(now); start.setDate(start.getDate() - 6); }
        if (period === 'monthly') { start = getStartOfDay(now); start.setDate(1); }
        if (period === 'yearly') { start = getStartOfDay(now); start.setMonth(0, 1); }
        const bills = await Bill.find({ generatedAt: { $gte: start, $lte: now } }).lean();
        const revenue = bills.reduce((sum, bill) => sum + bill.totalAmount, 0);
        const payment = { cash: 0, online: 0, pending: 0 };
        const itemMap = {};
        bills.forEach(bill => {
            payment[bill.paymentMethod || 'pending'] = (payment[bill.paymentMethod || 'pending'] || 0) + bill.totalAmount;
            bill.items.forEach(item => { const current = itemMap[item.name] || { name: item.name, quantity: 0, revenue: 0 }; current.quantity += item.quantity; current.revenue += item.price * item.quantity; itemMap[item.name] = current; });
        });
        const daily = [];
        for (let offset = 6; offset >= 0; offset -= 1) {
            const day = getStartOfDay(now); day.setDate(day.getDate() - offset); const end = getEndOfDay(day);
            const dayBills = await Bill.find({ generatedAt: { $gte: day, $lte: end } }).lean();
            daily.push({ date: day, label: day.toLocaleDateString('en-IN', { weekday: 'short' }), revenue: dayBills.reduce((sum, bill) => sum + bill.totalAmount, 0) });
        }
        res.json({ success: true, data: { period, revenue, orders: bills.length, averageOrder: bills.length ? revenue / bills.length : 0, payment, topItems: Object.values(itemMap).sort((a, b) => b.quantity - a.quantity).slice(0, 10), daily } });
    } catch (error) { res.status(500).json({ success: false, error: 'Could not load sales analysis' }); }
});

router.get('/admin/feedback', apiAdminAuth, async (req, res) => {
    try {
        const feedbacks = await Feedback.find().sort({ createdAt: -1 }).lean();
        const rated = feedbacks.filter(item => item.rating > 0);
        res.json({ success: true, data: { feedbacks, stats: { total: feedbacks.length, pending: feedbacks.filter(item => item.status === 'Pending').length, reviewed: feedbacks.filter(item => item.status === 'Reviewed').length, averageRating: rated.length ? rated.reduce((sum, item) => sum + item.rating, 0) / rated.length : 0 } } });
    } catch (error) { res.status(500).json({ success: false, error: 'Could not load feedback' }); }
});

router.patch('/admin/feedback/:id/review', apiAdminAuth, async (req, res) => {
    const feedback = await Feedback.findByIdAndUpdate(req.params.id, { status: 'Reviewed' }, { new: true });
    if (!feedback) return res.status(404).json({ success: false, error: 'Feedback not found' });
    res.json({ success: true, data: feedback });
});

router.delete('/admin/feedback/:id', apiAdminAuth, async (req, res) => {
    const feedback = await Feedback.findByIdAndDelete(req.params.id);
    if (!feedback) return res.status(404).json({ success: false, error: 'Feedback not found' });
    res.json({ success: true });
});

// ─── ADMIN GALLERY & DELIVERY PARTNERS ───────────────────────────────────
router.get('/admin/gallery', apiAdminAuth, async (req, res) => {
    const settings = await SiteSettings.findOne();
    const mapImages = images => (images || []).map(value => ({ value, url: getImageUrl(value, 'gallery-images') }));
    res.json({ success: true, data: { website: mapImages(settings?.galleryImages), halls: mapImages(settings?.hallGalleryImages) } });
});

function handleGalleryUpload(req, res, next) {
    galleryUpload.array('images', 10)(req, res, error => {
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, error: 'Every image must be smaller than 2 MB' });
        if (error) return res.status(400).json({ success: false, error: 'Could not upload those images' });
        next();
    });
}

router.post('/admin/gallery/:collection', apiAdminAuth, handleGalleryUpload, async (req, res) => {
    try {
        const field = req.params.collection === 'halls' ? 'hallGalleryImages' : req.params.collection === 'website' ? 'galleryImages' : null;
        if (!field) return res.status(400).json({ success: false, error: 'Invalid gallery' });
        if (!req.files?.length) return res.status(400).json({ success: false, error: 'Choose at least one image' });
        const values = [];
        for (const file of req.files) values.push(STORAGE_PROVIDER === 'azure' ? await uploadToAzure(file, 'gallery-images') : file.path);
        await SiteSettings.findOneAndUpdate({}, { $push: { [field]: { $each: values } } }, { upsert: true, new: true });
        res.json({ success: true, data: values.map(value => ({ value, url: getImageUrl(value, 'gallery-images') })) });
    } catch (error) { res.status(500).json({ success: false, error: 'Could not save gallery images' }); }
});

router.delete('/admin/gallery/:collection', apiAdminAuth, async (req, res) => {
    try {
        const field = req.params.collection === 'halls' ? 'hallGalleryImages' : req.params.collection === 'website' ? 'galleryImages' : null;
        const image = String(req.body.image || '');
        if (!field || !image) return res.status(400).json({ success: false, error: 'Invalid gallery image' });
        const filename = image.split('/').pop();
        try { if (STORAGE_PROVIDER === 'azure') await deleteFromAzure(filename, 'gallery-images'); else await deleteFromCloudinary(filename, 'gallery-images'); } catch (error) { console.error('Gallery storage delete error:', error); }
        await SiteSettings.findOneAndUpdate({}, { $pull: { [field]: image } });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: 'Could not delete image' }); }
});

router.get('/admin/delivery-partners', apiAdminAuth, async (req, res) => {
    const partners = await DeliveryPartner.find().lean();
    res.json({ success: true, data: partners.map(partner => ({ ...partner, logoUrl: getImageUrl(partner.logo, 'menu-images') })) });
});

router.post('/admin/delivery-partners', apiAdminAuth, (req, res) => {
    menuUpload.single('logo')(req, res, async error => {
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, error: 'Logo must be smaller than 2 MB' });
        if (error) return res.status(400).json({ success: false, error: 'Could not upload logo' });
        try {
            const name = String(req.body.name || '').trim(); const url = String(req.body.url || '').trim();
            let parsed; try { parsed = new URL(url); } catch { return res.status(400).json({ success: false, error: 'Enter a valid order URL' }); }
            if (!name || !['http:', 'https:'].includes(parsed.protocol) || !req.file) return res.status(400).json({ success: false, error: 'Name, logo and a valid URL are required' });
            const logo = STORAGE_PROVIDER === 'azure' ? await uploadToAzure(req.file, 'menu-images') : req.file.path;
            const partner = await DeliveryPartner.create({ name, logo, url });
            res.json({ success: true, data: { ...partner.toObject(), logoUrl: getImageUrl(logo, 'menu-images') } });
        } catch (uploadError) { res.status(500).json({ success: false, error: 'Could not add delivery partner' }); }
    });
});

router.delete('/admin/delivery-partners/:id', apiAdminAuth, async (req, res) => {
    const partner = await DeliveryPartner.findById(req.params.id);
    if (!partner) return res.status(404).json({ success: false, error: 'Delivery partner not found' });
    try { await removeMenuImage(partner.logo); } catch (error) { console.error('Partner logo delete error:', error); }
    await partner.deleteOne();
    res.json({ success: true });
});

// Bill details used by the native in-app bill viewer.
router.get('/bill/:billId', apiStaffOrAdminAuth, async (req, res) => {
    try {
        const bill = await Bill.findOne({ billId: req.params.billId })
            .populate('orderId')
            .populate({ path: 'hallBookingId', populate: { path: 'hallId foodOrderIds' } });
        if (!bill) return res.status(404).json({ success: false, error: 'Bill not found' });
        const settings = await SiteSettings.findOne().select('cafeName address phone');
        res.json({ success: true, data: { bill, settings } });
    } catch (error) { res.status(500).json({ success: false, error: 'Could not load bill' }); }
});

// ─── AUTH ────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
    try {
        const { pin } = req.body;
        const settings = await SiteSettings.findOne();
        const waiterPin = settings?.waiterPin || '1234';
        if (pin === waiterPin) {
            req.session.staffAuthenticated = true;
            res.json({ success: true });
        } else {
            res.json({ success: false, error: 'Invalid PIN' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

router.get('/auth/check', (req, res) => {
    res.json({ authenticated: !!req.session.staffAuthenticated });
});

// ─── SETTINGS ───────────────────────────────────────────────
router.get('/settings', apiAuth, async (req, res) => {
    try {
        const settings = await SiteSettings.findOne();
        res.json({
            success: true,
            data: {
                qrOrderingEnabled: settings?.qrOrderingEnabled !== false,
                cgstRate: CGST_RATE,
                sgstRate: SGST_RATE,
                hallBookingSettings: settings?.hallBookingSettings || { minimumBookingHours: 2, bufferTimeMinutes: 30 },
                cafeName: settings?.cafeName || 'Cafe Cloud'
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── TABLES ─────────────────────────────────────────────────
router.get('/tables', apiAuth, async (req, res) => {
    try {
        const tables = await Table.find().sort({ tableNumber: 1 }).populate('currentOrderId');
        res.json({ success: true, data: tables });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── PARCELS ────────────────────────────────────────────────
router.get('/parcels', apiAuth, async (req, res) => {
    try {
        const parcels = await Order.find({
            orderType: 'parcel',
            status: { $nin: ['billed', 'cancelled'] }
        }).sort({ orderTakenAt: -1 });
        res.json({ success: true, data: parcels });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── MENU ───────────────────────────────────────────────────
router.get('/menu', apiAuth, async (req, res) => {
    try {
        const categories = await Category.find();
        const menuItems = await MenuItem.find({ isAvailable: true }).populate('category');
        res.json({ success: true, data: { categories, menuItems } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── PENDING ORDERS ─────────────────────────────────────────
router.get('/pending-count', apiAuth, async (req, res) => {
    try {
        const count = await Order.countDocuments({
            customerPlaced: true,
            approvalStatus: 'pending'
        });
        res.json({ success: true, count });
    } catch (error) {
        res.json({ success: true, count: 0 });
    }
});

router.get('/pending-orders', apiAuth, async (req, res) => {
    try {
        const orders = await Order.find({
            customerPlaced: true,
            approvalStatus: 'pending'
        }).sort({ orderTakenAt: 1 });
        res.json({ success: true, data: orders });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── ORDERS HISTORY ─────────────────────────────────────────
router.get('/orders', apiAuth, async (req, res) => {
    try {
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

        let orders = [];
        let hallBookings = [];

        if (orderType === 'hall') {
            hallBookings = await HallBooking.find({
                bookingDate: { $gte: startDate, $lte: endDate },
                status: 'billed'
            }).populate('hallId').sort({ bookingDate: -1 });
        } else {
            let orderQuery = {
                orderTakenAt: { $gte: startDate, $lte: endDate },
                orderType: { $ne: 'hall' },
                status: { $ne: 'cancelled' }
            };
            if (orderType === 'dine-in') orderQuery.orderType = 'dine-in';
            else if (orderType === 'parcel') orderQuery.orderType = 'parcel';

            orders = await Order.find(orderQuery).sort({ orderTakenAt: -1 });

            if (!orderType || orderType === 'all') {
                hallBookings = await HallBooking.find({
                    bookingDate: { $gte: startDate, $lte: endDate },
                    status: 'billed'
                }).populate('hallId').sort({ bookingDate: -1 });
            }
        }

        // Build bill maps
        const bills = await Bill.find();
        const billMap = {};
        const billAmountMap = {};
        bills.forEach(bill => {
            if (bill.orderId) {
                billMap[bill.orderId.toString()] = bill.billId;
                billAmountMap[bill.orderId.toString()] = bill.totalAmount;
            }
            if (bill.hallBookingId) {
                billMap['hall_' + bill.hallBookingId.toString()] = bill.billId;
                billAmountMap['hall_' + bill.hallBookingId.toString()] = bill.totalAmount;
            }
        });

        res.json({
            success: true,
            data: { orders, hallBookings, billMap, billAmountMap, currentView }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── KITCHEN ────────────────────────────────────────────────
router.get('/kitchen/orders', apiAuth, async (req, res) => {
    try {
        const today = getStartOfDay();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayBookings = await HallBooking.find({
            bookingDate: { $gte: today, $lt: tomorrow },
            status: { $in: ['confirmed', 'ongoing'] }
        });
        const todayBookingIds = todayBookings.map(b => b._id);

        const orders = await Order.find({
            status: { $nin: ['billed', 'cancelled'] },
            'items.status': { $in: ['pending', 'preparing', 'ready'] },
            $and: [
                {
                    $or: [
                        { customerPlaced: true, approvalStatus: 'approved' },
                        { customerPlaced: { $ne: true } }
                    ]
                },
                {
                    $or: [
                        { orderType: { $in: ['dine-in', 'parcel'] } },
                        { orderType: 'hall', hallBookingId: { $in: todayBookingIds } },
                        { orderType: 'hall', sentToKitchen: true }
                    ]
                }
            ]
        }).populate('hallBookingId').sort({ orderTakenAt: 1 });

        res.json({ success: true, data: orders });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── HALLS ──────────────────────────────────────────────────
router.get('/halls', apiAuth, async (req, res) => {
    try {
        const halls = await Hall.find({ isActive: true });
        res.json({ success: true, data: halls });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/hall-bookings', apiAuth, async (req, res) => {
    try {
        const today = getStartOfDay();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowEnd = getEndOfDay(tomorrow);

        const bookings = await HallBooking.find({
            bookingDate: { $gte: today },
            status: { $in: ['confirmed', 'ongoing'] }
        }).populate('hallId').sort({ bookingDate: 1, startTime: 1 });

        const todayTomorrowCount = await HallBooking.countDocuments({
            bookingDate: { $gte: today, $lte: tomorrowEnd },
            status: { $in: ['confirmed', 'ongoing'] }
        });

        res.json({ success: true, data: { bookings, todayTomorrowCount } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/hall-bookings/:id', apiAuth, async (req, res) => {
    try {
        const booking = await HallBooking.findById(req.params.id)
            .populate('hallId')
            .populate('foodOrderIds');

        if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

        const today = getStartOfDay();
        const bookingDate = getStartOfDay(new Date(booking.bookingDate));
        const isToday = bookingDate.getTime() === today.getTime();

        res.json({ success: true, data: { booking, isToday } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── DASHBOARD SUMMARY (single call for main tab) ──────────
router.get('/dashboard', apiAuth, async (req, res) => {
    try {
        const settings = await SiteSettings.findOne();
        const qrOrderingEnabled = settings?.qrOrderingEnabled !== false;

        const tables = await Table.find().sort({ tableNumber: 1 }).populate('currentOrderId');
        const parcelOrders = await Order.find({
            orderType: 'parcel',
            status: { $nin: ['billed', 'cancelled'] }
        }).sort({ orderTakenAt: -1 });

        const pendingCount = await Order.countDocuments({
            customerPlaced: true,
            approvalStatus: 'pending'
        });

        const today = getStartOfDay();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowEnd = getEndOfDay(tomorrow);

        const todayTomorrowBookingsCount = await HallBooking.countDocuments({
            bookingDate: { $gte: today, $lte: tomorrowEnd },
            status: { $in: ['confirmed', 'ongoing'] }
        });

        res.json({
            success: true,
            data: {
                tables,
                parcelOrders,
                pendingCount,
                todayTomorrowBookingsCount,
                qrOrderingEnabled,
                cgstRate: CGST_RATE,
                sgstRate: SGST_RATE
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
