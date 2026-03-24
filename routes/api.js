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
const { CGST_RATE, SGST_RATE } = require('../config/gst');
const { getStartOfDay, getEndOfDay, getStartOfYesterday, getEndOfYesterday } = require('../config/timezone');

// Auth middleware for API
const apiAuth = (req, res, next) => {
    if (req.session.staffAuthenticated) return next();
    res.status(401).json({ success: false, error: 'Unauthorized' });
};

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
