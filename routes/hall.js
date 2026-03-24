const express = require('express');
const router = express.Router();
const Hall = require('../models/Hall');
const HallBooking = require('../models/HallBooking');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const Category = require('../models/Category');
const SiteSettings = require('../models/SiteSettings');
const { getStartOfDay, getEndOfDay } = require('../config/timezone');

// Middleware
const verifyStaffAccess = (req, res, next) => {
    console.log('Hall auth - staff:', req.session.staffAuthenticated, 'admin:', req.session.adminAuthenticated);
    if (req.session.staffAuthenticated || req.session.adminAuthenticated) {
        return next();
    }
    res.redirect('/waiter/login');
};

// Helper function to check time overlap
const checkOverlap = (date1, start1, end1, date2, start2, end2, bufferMinutes) => {
    if (date1.toDateString() !== date2.toDateString()) return false;
    
    const toMinutes = (time) => {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    };
    
    const s1 = toMinutes(start1) - bufferMinutes;
    const e1 = toMinutes(end1) + bufferMinutes;
    const s2 = toMinutes(start2);
    const e2 = toMinutes(end2);
    
    return (s1 < e2 && e1 > s2);
};

// Calculate hours between times
const calculateHours = (startTime, endTime) => {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
};

// New Booking Form
router.get('/bookings/new', verifyStaffAccess, async (req, res) => {
    try {
        const halls = await Hall.find({ isActive: true });
        const settings = await SiteSettings.findOne();
        const categories = await Category.find();
        const menuItems = await MenuItem.find({ isAvailable: true }).populate('category');
        res.render('hall/new-booking', { halls, settings, categories, menuItems });
    } catch (error) {
        res.status(500).send('Error loading form');
    }
});

// Check Availability
router.post('/bookings/check-availability', async (req, res) => {
    try {
        const { hallId, bookingDate, startTime, endTime } = req.body;
        const settings = await SiteSettings.findOne();
        const bufferMinutes = settings?.hallBookingSettings?.bufferTimeMinutes || 30;
        
        const date = new Date(bookingDate);
        const existingBookings = await HallBooking.find({
            hallId,
            bookingDate: date,
            status: { $in: ['confirmed', 'ongoing'] }
        });
        
        for (let booking of existingBookings) {
            if (checkOverlap(date, startTime, endTime, booking.bookingDate, booking.startTime, booking.endTime, bufferMinutes)) {
                return res.json({ available: false, message: 'Time slot overlaps with existing booking' });
            }
        }
        
        res.json({ available: true });
    } catch (error) {
        res.status(500).json({ available: false, message: 'Error checking availability' });
    }
});

// Create Booking
router.post('/bookings', async (req, res) => {
    try {
        const { hallId, customerName, customerPhone, bookingDate, startTime, endTime, decorationCharges, cakeCharges, otherCharges, advanceAmount, specialRequirements, foodItems } = req.body;
        
        const hall = await Hall.findById(hallId);
        const bookedHours = calculateHours(startTime, endTime);
        
        // Generate booking ID
        const bookingId = 'HALL' + Date.now();
        
        const booking = new HallBooking({
            bookingId,
            hallId,
            customerName,
            customerPhone: customerPhone.startsWith('+91') ? customerPhone : '+91' + customerPhone,
            bookingDate: new Date(bookingDate),
            startTime,
            endTime,
            bookedHours,
            numberOfGuests: 0,
            baseRatePerHour: hall.baseRatePerHour,
            extensionRatePerHour: hall.extensionRatePerHour,
            decorationCharges: decorationCharges || 0,
            cakeCharges: cakeCharges || 0,
            otherCharges: otherCharges || 0,
            advanceAmount,
            specialRequirements,
            createdBy: req.session.adminAuthenticated ? 'Admin' : 'Staff'
        });
        
        await booking.save();
        
        // Create food order if items provided
        if (foodItems && foodItems.length > 0) {
            const orderId = 'ORD' + Date.now();
            
            const totalAmount = foodItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            
            const order = new Order({
                orderId,
                orderType: 'hall',
                hallBookingId: booking._id,
                customerName,
                customerPhone: booking.customerPhone,
                items: foodItems,
                totalAmount,
                waiterName: req.session.adminAuthenticated ? 'Admin' : 'Staff'
            });
            
            await order.save();
            booking.foodOrderIds.push(order._id);
            await booking.save();
        }
        
        res.json({ success: true, bookingId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Booking Details
router.get('/bookings/:id', verifyStaffAccess, async (req, res) => {
    try {
        const booking = await HallBooking.findById(req.params.id)
            .populate('hallId')
            .populate('foodOrderIds');
        const categories = await Category.find();
        const menuItems = await MenuItem.find({ isAvailable: true }).populate('category');
        
        // Check if booking is today
        const today = getStartOfDay();
        const bookingDate = getStartOfDay(new Date(booking.bookingDate));
        const isToday = bookingDate.getTime() === today.getTime();
        
        res.render('hall/booking-details', { booking, categories, menuItems, isToday });
    } catch (error) {
        res.status(500).send('Error loading booking');
    }
});

// Send Order to Kitchen
router.post('/orders/:orderId/send-to-kitchen', verifyStaffAccess, async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
        if (!order) {
            return res.json({ success: false, error: 'Order not found' });
        }
        
        order.status = 'preparing';
        order.sentToKitchen = true;
        order.preparingStartedAt = new Date();
        await order.save();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Remove item from hall order
router.post('/orders/:orderId/remove-item/:itemIndex', verifyStaffAccess, async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
        if (!order) {
            return res.json({ success: false, error: 'Order not found' });
        }
        if (order.sentToKitchen) {
            return res.json({ success: false, error: 'Cannot modify order already sent to kitchen' });
        }
        
        order.items.splice(req.params.itemIndex, 1);
        order.totalAmount = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        await order.save();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Scheduled Orders View
router.get('/scheduled-orders', verifyStaffAccess, async (req, res) => {
    try {
        const today = getStartOfDay();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Get future bookings with orders
        const futureBookings = await HallBooking.find({
            bookingDate: { $gte: tomorrow },
            status: { $in: ['confirmed', 'ongoing'] },
            foodOrderIds: { $exists: true, $ne: [] }
        }).populate('hallId').populate('foodOrderIds').sort({ bookingDate: 1 });
        
        res.render('hall/scheduled-orders', { bookings: futureBookings });
    } catch (error) {
        res.status(500).send('Error loading scheduled orders');
    }
});

// Add Food Order to Booking
router.post('/bookings/:id/add-order', async (req, res) => {
    try {
        const { items } = req.body;
        const booking = await HallBooking.findById(req.params.id).populate('foodOrderIds');
        
        // Check if there's an existing order that hasn't been sent to kitchen
        let order = booking.foodOrderIds.find(o => !o.sentToKitchen);
        
        if (order) {
            // Add items to existing order
            items.forEach(item => order.items.push(item));
            order.totalAmount = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            await order.save();
            res.json({ success: true, orderId: order.orderId });
        } else {
            // Create new order
            const orderId = 'ORD' + Date.now();
            
            const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            
            order = new Order({
                orderId,
                orderType: 'hall',
                hallBookingId: booking._id,
                customerName: booking.customerName,
                customerPhone: booking.customerPhone,
                items,
                totalAmount,
                waiterName: req.session.adminAuthenticated ? 'Admin' : 'Staff'
            });
            
            await order.save();
            booking.foodOrderIds.push(order._id);
            await booking.save();
            
            res.json({ success: true, orderId });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update Booking (All editable fields)
router.post('/bookings/:id/update', async (req, res) => {
    try {
        const { customerName, customerPhone, bookingDate, startTime, endTime, extensionHours, decorationCharges, cakeCharges, otherCharges, advanceAmount, specialRequirements } = req.body;
        const booking = await HallBooking.findById(req.params.id);
        
        if (!booking) return res.json({ success: false, error: 'Booking not found' });
        
        if (customerName !== undefined) booking.customerName = customerName;
        if (customerPhone !== undefined) booking.customerPhone = customerPhone.startsWith('+91') ? customerPhone : '+91' + customerPhone;
        if (bookingDate !== undefined) booking.bookingDate = new Date(bookingDate);
        if (startTime !== undefined) booking.startTime = startTime;
        if (endTime !== undefined) booking.endTime = endTime;
        if (startTime !== undefined || endTime !== undefined) {
            booking.bookedHours = calculateHours(booking.startTime, booking.endTime);
        }
        if (extensionHours !== undefined) booking.extensionHours = extensionHours;
        if (decorationCharges !== undefined) booking.decorationCharges = decorationCharges;
        if (cakeCharges !== undefined) booking.cakeCharges = cakeCharges;
        if (otherCharges !== undefined) booking.otherCharges = otherCharges;
        if (advanceAmount !== undefined) booking.advanceAmount = advanceAmount;
        if (specialRequirements !== undefined) booking.specialRequirements = specialRequirements;
        
        await booking.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Generate Final Bill
router.post('/bookings/:id/generate-bill', async (req, res) => {
    try {
        const { discountType, discountValue } = req.body;
        const booking = await HallBooking.findById(req.params.id).populate('foodOrderIds');
        
        const hallCharges = booking.bookedHours * booking.baseRatePerHour;
        const extensionCharges = booking.extensionHours * booking.extensionRatePerHour;
        const foodTotal = booking.foodOrderIds.reduce((sum, order) => sum + order.totalAmount, 0);
        
        let subtotal = hallCharges + extensionCharges + booking.decorationCharges + booking.cakeCharges + (booking.otherCharges || 0) + foodTotal;
        
        let discount = 0;
        if (discountType === 'percentage') {
            discount = (subtotal * discountValue) / 100;
        } else if (discountType === 'fixed') {
            discount = discountValue;
        }
        
        const finalAmount = subtotal - discount;
        const balanceDue = finalAmount - booking.advanceAmount;
        
        booking.discountType = discountType || 'none';
        booking.discountValue = discountValue || 0;
        booking.finalAmount = finalAmount;
        booking.balanceDue = balanceDue;
        booking.status = 'billed';
        booking.billedAt = new Date();
        
        // Generate unique bill ID
        const billId = 'BIL' + Date.now();
        
        // Create Bill document
        const Bill = require('../models/Bill');
        await Bill.create({
            billId,
            hallBookingId: booking._id,
            items: [],
            subtotal,
            cgst: 0,
            sgst: 0,
            totalAmount: finalAmount,
            paymentMethod: 'pending',
            generatedBy: req.session.adminAuthenticated ? 'admin' : 'staff'
        });
        
        booking.billId = billId;
        await booking.save();
        
        // Mark all food orders as billed
        await Order.updateMany(
            { _id: { $in: booking.foodOrderIds } },
            { status: 'billed', billedAt: new Date() }
        );
        
        res.json({ success: true, finalAmount, balanceDue });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cancel Booking (mark cancelled + cancel food orders)
router.post('/bookings/:id/cancel', async (req, res) => {
    try {
        const booking = await HallBooking.findById(req.params.id);
        if (!booking) return res.json({ success: false, error: 'Booking not found' });
        
        booking.status = 'cancelled';
        await booking.save();
        
        // Mark associated food orders as cancelled
        if (booking.foodOrderIds.length > 0) {
            await Order.updateMany(
                { _id: { $in: booking.foodOrderIds } },
                { status: 'cancelled', cancelledAt: new Date() }
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
