const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const HallBooking = require('../models/HallBooking');
const { getStartOfDay } = require('../config/timezone');

// Kitchen authentication middleware
const verifyKitchenAccess = (req, res, next) => {
    if (req.session.staffAuthenticated) {
        return next();
    }
    res.redirect('/waiter/login');
};

// Kitchen dashboard (requires staff authentication)
router.get('/dashboard', verifyKitchenAccess, async (req, res) => {
    try {
        // Get today's date range
        const today = getStartOfDay();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Get today's hall bookings
        const todayBookings = await HallBooking.find({
            bookingDate: { $gte: today, $lt: tomorrow },
            status: { $in: ['confirmed', 'ongoing'] }
        });
        const todayBookingIds = todayBookings.map(b => b._id);
        
        // Get orders: ONLY approved orders (not pending approval)
        // Regular orders + hall orders (today OR manually sent)
        const orders = await Order.find({ 
            status: { $nin: ['billed', 'cancelled'] },
            'items.status': { $in: ['pending', 'preparing', 'ready'] },
            $and: [
                // Approval check: customer orders must be approved, waiter orders auto-approved
                {
                    $or: [
                        { customerPlaced: true, approvalStatus: 'approved' },
                        { customerPlaced: { $ne: true } }
                    ]
                },
                // Order type check
                {
                    $or: [
                        { orderType: { $in: ['dine-in', 'parcel'] } },
                        { orderType: 'hall', hallBookingId: { $in: todayBookingIds } },
                        { orderType: 'hall', sentToKitchen: true }
                    ]
                }
            ]
        }).populate('hallBookingId').sort({ orderTakenAt: 1 });
        
        res.render('kitchen/dashboard', { orders: orders || [] });
    } catch (error) {
        console.error('Kitchen dashboard error:', error);
        res.status(500).send('Error loading kitchen dashboard');
    }
});

// Start preparing item
router.post('/prepare/:orderId/:itemIndex', async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
        order.items[req.params.itemIndex].status = 'preparing';
        if (order.status === 'pending') {
            order.status = 'preparing';
            order.preparingStartedAt = new Date();
        }
        await order.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// Mark item as ready
router.post('/ready/:orderId/:itemIndex', async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
        order.items[req.params.itemIndex].status = 'ready';
        
        // Check if all items are ready
        const allReady = order.items.every(item => item.status === 'ready');
        if (allReady) {
            // For parcel orders, mark as served (ready for billing) automatically
            if (order.orderType === 'parcel') {
                order.status = 'served';
                order.servedAt = new Date();
            } else {
                order.status = 'ready';
                order.readyAt = new Date();
            }
        }
        await order.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

module.exports = router;
