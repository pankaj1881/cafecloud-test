const express = require('express');
const router = express.Router();
const Waiter = require('../models/Waiter');
const Table = require('../models/Table');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const Category = require('../models/Category');
const Bill = require('../models/Bill');
const SiteSettings = require('../models/SiteSettings');
const { CGST_RATE, SGST_RATE } = require('../config/gst');
const { getStartOfDay, getEndOfDay, getStartOfYesterday, getEndOfYesterday } = require('../config/timezone');


// PIN verification middleware
const verifyPIN = (req, res, next) => {
    if (req.session.staffAuthenticated) {
        return next();
    }
    res.redirect('/waiter/login');
};


// PIN login page
router.get('/login', (req, res) => {
    res.render('waiter/login');
});


// PIN login handler
router.post('/login', async (req, res) => {
    const { pin } = req.body;
    const settings = await SiteSettings.findOne();
    const waiterPin = settings?.waiterPin || '1234';
   
    if (pin === waiterPin) {
        req.session.staffAuthenticated = true;
        res.redirect('/waiter/dashboard');
    } else {
        res.render('waiter/login', { error: 'Invalid PIN' });
    }
});


// Logout
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        res.clearCookie('connect.sid');
        res.redirect('/waiter/login');
    });
});


// Waiter selection page
router.get('/select', async (req, res) => {
    try {
        const waiters = await Waiter.find({ isActive: true }).sort({ name: 1 });
        res.render('waiter/select', { waiters });
    } catch (error) {
        res.status(500).send('Error loading waiters');
    }
});


// Dashboard - Shared for all
router.get('/dashboard', verifyPIN, async (req, res) => {
    try {
        const { from, to, view, orderType } = req.query;
        
        // Get QR ordering status
        const settings = await SiteSettings.findOne();
        const qrOrderingEnabled = settings?.qrOrderingEnabled !== false;
        
        const tables = await Table.find().sort({ tableNumber: 1 }).populate('currentOrderId');
        const parcelOrders = await Order.find({
            orderType: 'parcel',
            status: { $nin: ['billed', 'cancelled'] }
        }).sort({ orderTakenAt: -1 });
       
        // Get pending customer orders
        const pendingOrders = await Order.find({
            customerPlaced: true,
            approvalStatus: 'pending'
        }).sort({ orderTakenAt: 1 });
       
        // Check for tomorrow's and today's hall bookings
        const HallBooking = require('../models/HallBooking');
        const Hall = require('../models/Hall');
        
        const today = getStartOfDay();
        const todayEnd = getEndOfDay();
        
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStart = getStartOfDay(tomorrow);
        const tomorrowEnd = getEndOfDay(tomorrow);
       
        const todayTomorrowBookingsCount = await HallBooking.countDocuments({
            bookingDate: { $gte: today, $lte: tomorrowEnd },
            status: { $in: ['confirmed', 'ongoing'] }
        });
        
        // Get hall bookings for display
        const hallBookings = await HallBooking.find({
            bookingDate: { $gte: today },
            status: { $in: ['confirmed', 'ongoing'] }
        }).populate('hallId').sort({ bookingDate: 1, startTime: 1 });
        
        const halls = await Hall.find({ isActive: true });
        
        // Determine date range for orders
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
            startDate = today;
            endDate = todayEnd;
            currentView = 'today';
        }
        
        // Get orders for selected date range with type filter
        let allOrders = [];
        let billedHallBookings = [];
        
        if (orderType === 'hall') {
            // Show only hall bookings
            billedHallBookings = await HallBooking.find({
                bookingDate: { $gte: startDate, $lte: endDate },
                status: 'billed'
            }).populate('hallId').sort({ bookingDate: -1 });
        } else {
            // Build query for regular orders
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
            
            allOrders = await Order.find(orderQuery).sort({ orderTakenAt: -1 });
            
            // Get hall bookings only if showing all orders
            if (!orderType || orderType === 'all') {
                billedHallBookings = await HallBooking.find({
                    bookingDate: { $gte: startDate, $lte: endDate },
                    status: 'billed'
                }).populate('hallId').sort({ bookingDate: -1 });
            }
        }
        
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
        
        // Helper function for 12-hour time format
        const format12Hour = (timeStr) => {
            if (!timeStr) return '';
            const [hours, minutes] = timeStr.split(':');
            const hour = parseInt(hours);
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const hour12 = hour % 12 || 12;
            return `${hour12}:${minutes} ${ampm}`;
        };
       
        res.render('waiter/dashboard', { 
            tables, 
            parcelOrders, 
            pendingOrders, 
            todayTomorrowBookingsCount, 
            hallBookings, 
            halls,
            allOrders,
            billedHallBookings,
            billMap,
            billAmountMap,
            currentView,
            from: from || '',
            to: to || '',
            orderType: orderType || 'all',
            CGST_RATE,
            SGST_RATE,
            qrOrderingEnabled,
            format12Hour
        });
    } catch (error) {
        res.status(500).send('Error loading dashboard');
    }
});


// API: Get pending orders count
router.get('/pending-count', verifyPIN, async (req, res) => {
    try {
        const count = await Order.countDocuments({
            customerPlaced: true,
            approvalStatus: 'pending'
        });
        res.json({ count });
    } catch (error) {
        res.json({ count: 0 });
    }
});

// API: Get pending orders data
router.get('/pending-orders-data', verifyPIN, async (req, res) => {
    try {
        const orders = await Order.find({
            customerPlaced: true,
            approvalStatus: 'pending'
        }).sort({ orderTakenAt: 1 });
        res.json({ success: true, orders });
    } catch (error) {
        res.json({ success: false, orders: [] });
    }
});


// Submit order
router.post('/order', async (req, res) => {
    try {
        const { orderType, tableNumber, customerName, customerPhone, deliveryType, deliveryAddress, items, orderId } = req.body;
       
        // Validate items
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid items' });
        }
       
        // If orderId exists, add items to existing order
        if (orderId) {
            const order = await Order.findById(orderId);
            if (!order) {
                return res.status(404).json({ success: false, error: 'Order not found' });
            }
            items.forEach(newItem => {
                newItem.status = 'pending';
                newItem.approved = true; // Waiter-added items are auto-approved
                order.items.push(newItem);
            });
            order.totalAmount = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            await order.save();
            return res.json({ success: true, orderId: order.orderId });
        }
       
        // Create new order
        const newOrderId = 'ORD' + Date.now();
       
        const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
       
        const order = new Order({
            orderId: newOrderId,
            orderType,
            tableNumber: orderType === 'dine-in' ? parseInt(tableNumber) : null,
            customerName: customerName || null,
            customerPhone: customerPhone ? '+91' + customerPhone : null,
            deliveryType: orderType === 'parcel' ? deliveryType : null,
            deliveryAddress: orderType === 'parcel' && deliveryType === 'home-delivery' ? deliveryAddress : null,
            items: items,
            totalAmount,
            waiterName: 'Staff'
        });
        await order.save();
       
        // Update table if dine-in
        if (orderType === 'dine-in') {
            await Table.findOneAndUpdate(
                { tableNumber: parseInt(tableNumber) },
                { status: 'busy', currentOrderId: order._id, occupiedAt: new Date() }
            );
        }
       
        res.json({ success: true, orderId: newOrderId });
    } catch (error) {
        console.error('Order submission error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// View All Orders (must be before /order/:type)
router.get('/orders', verifyPIN, async (req, res) => {
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
       
        // Get regular orders with type filter
        let orders = [];
        let hallBookings = [];
        
        if (orderType === 'hall') {
            // Show only hall bookings
            const HallBooking = require('../models/HallBooking');
            hallBookings = await HallBooking.find({
                bookingDate: { $gte: startDate, $lte: endDate },
                status: 'billed'
            }).populate('hallId').sort({ bookingDate: -1 });
        } else {
            // Build query for regular orders
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
            
            orders = await Order.find(orderQuery).sort({ orderTakenAt: -1 });
            
            // Get hall bookings only if showing all orders
            if (!orderType || orderType === 'all') {
                const HallBooking = require('../models/HallBooking');
                hallBookings = await HallBooking.find({
                    bookingDate: { $gte: startDate, $lte: endDate },
                    status: 'billed'
                }).populate('hallId').sort({ bookingDate: -1 });
            }
        }
       
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
       
        res.render('waiter/orders', { orders, hallBookings, billMap, billAmountMap, from: from || '', to: to || '', currentView, orderType: orderType || 'all' });
    } catch (error) {
        res.status(500).send('Error loading orders');
    }
});


// Take order page
router.get('/order/:type/:id', verifyPIN, async (req, res) => {
    try {
        const { type, id } = req.params;
        const categories = await Category.find();
        const menuItems = await MenuItem.find({ isAvailable: true }).populate('category');
       
        let table = null;
        let existingOrder = null;
        if (type === 'dine-in') {
            table = await Table.findOne({ tableNumber: parseInt(id) }).populate('currentOrderId');
            existingOrder = table?.currentOrderId;
        }
       
        res.render('waiter/take-order', {
            orderType: type,
            table,
            existingOrder,
            categories,
            menuItems
        });
    } catch (error) {
        res.status(500).send('Error loading order page');
    }
});


// Take order page (parcel - no table)
router.get('/order/:type', verifyPIN, async (req, res) => {
    try {
        const { type } = req.params;
        const categories = await Category.find();
        const menuItems = await MenuItem.find({ isAvailable: true }).populate('category');
       
        res.render('waiter/take-order', {
            orderType: type,
            table: null,
            existingOrder: null,
            categories,
            menuItems
        });
    } catch (error) {
        res.status(500).send('Error loading order page');
    }
});


// Mark item as served
router.post('/serve/:orderId/:itemIndex', async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
        order.items[req.params.itemIndex].status = 'served';
       
        // Check if all items are served
        const allServed = order.items.every(item => item.status === 'served');
        if (allServed) {
            order.status = 'served';
            order.servedAt = new Date();
           
            if (order.orderType === 'dine-in') {
                await Table.findOneAndUpdate(
                    { tableNumber: order.tableNumber },
                    { status: 'served' }
                );
            }
        } else {
            // If not all served, keep table as busy
            if (order.orderType === 'dine-in') {
                await Table.findOneAndUpdate(
                    { tableNumber: order.tableNumber },
                    { status: 'busy' }
                );
            }
        }
        await order.save();
       
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});


// Remove item from order
router.post('/remove/:orderId/:itemIndex', async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
       
        // Only allow removing if item is pending (not started in kitchen)
        if (order.items[req.params.itemIndex].status !== 'pending') {
            return res.json({ success: false, message: 'Cannot remove item already in preparation' });
        }
       
        order.items.splice(req.params.itemIndex, 1);
        order.totalAmount = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        await order.save();
       
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});


// Finish order (mark as ready for billing)
router.post('/finish/:orderId', async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
        
        if (!order) {
            return res.json({ success: false, error: 'Order not found' });
        }
        
        order.status = 'served';
        order.servedAt = new Date();
        await order.save();
        
        if (order.orderType === 'dine-in') {
            await Table.findOneAndUpdate(
                { tableNumber: order.tableNumber },
                { status: 'billing' }
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Finish order error:', error);
        res.json({ success: false, error: error.message });
    }
});


// Cancel order (mark as cancelled and free table)
router.post('/cancel/:orderId', async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
        
        if (!order) {
            return res.json({ success: false, error: 'Order not found' });
        }
        
        const tableNumber = order.tableNumber;
        const orderType = order.orderType;
        
        // Mark order as cancelled instead of deleting
        order.status = 'cancelled';
        order.cancelledAt = new Date();
        await order.save();
        
        // Free the table if dine-in
        if (orderType === 'dine-in' && tableNumber) {
            await Table.findOneAndUpdate(
                { tableNumber: tableNumber },
                { status: 'empty', currentOrderId: null, occupiedAt: null }
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Cancel order error:', error);
        res.json({ success: false, error: error.message });
    }
});


// Approve customer order
router.post('/approve-order', async (req, res) => {
    try {
        const { orderId } = req.body;
        const order = await Order.findById(orderId);
       
        if (!order) {
            return res.json({ success: false, error: 'Order not found' });
        }
       
        // Mark all unapproved items as approved
        order.items.forEach(item => {
            if (!item.approved) {
                item.approved = true;
            }
        });
       
        // Approve order
        order.approvalStatus = 'approved';
        order.sentToKitchen = true;
        order.status = 'preparing';
        await order.save();
       
        // Update table
        await Table.findOneAndUpdate(
            { tableNumber: order.tableNumber },
            { status: 'busy', currentOrderId: order._id, occupiedAt: new Date() }
        );
       
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});


// Reject customer order
router.post('/reject-order', async (req, res) => {
    try {
        const { orderId, reason } = req.body;
        const order = await Order.findById(orderId);
       
        if (!order) {
            return res.json({ success: false, error: 'Order not found' });
        }
       
        // Check if there are any approved items
        const hasApprovedItems = order.items.some(item => item.approved);
       
        if (hasApprovedItems) {
            // Remove only unapproved items
            order.items = order.items.filter(item => item.approved);
            order.totalAmount = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            order.approvalStatus = 'approved';
            order.status = 'preparing';
            await order.save();
        } else {
            // No approved items, reject entire order
            order.approvalStatus = 'rejected';
            order.rejectionReason = reason;
            order.status = 'billed';
            await order.save();
           
            // Clear table status
            if (order.orderType === 'dine-in' && order.tableNumber) {
                await Table.findOneAndUpdate(
                    { tableNumber: order.tableNumber },
                    { status: 'empty', currentOrderId: null, occupiedAt: null }
                );
            }
        }
       
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});


// Toggle QR ordering
router.post('/toggle-qr-ordering', verifyPIN, async (req, res) => {
    try {
        let settings = await SiteSettings.findOne();
        if (!settings) {
            settings = await SiteSettings.create({});
        }
        settings.qrOrderingEnabled = !settings.qrOrderingEnabled;
        await settings.save();
        res.json({ success: true, enabled: settings.qrOrderingEnabled });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Move Order (Table to Table, Table to Parcel, Parcel to Table)
router.post('/move-order', verifyPIN, async (req, res) => {
    try {
        const { orderId, moveType, newTableNumber } = req.body;
        const order = await Order.findById(orderId);
        
        if (!order) {
            return res.json({ success: false, error: 'Order not found' });
        }
        
        if (order.status === 'billed') {
            return res.json({ success: false, error: 'Cannot move billed order' });
        }
        
        const oldTableNumber = order.tableNumber;
        const oldOrderType = order.orderType;
        
        if (moveType === 'table-to-table') {
            // Check if new table is empty
            const newTable = await Table.findOne({ tableNumber: parseInt(newTableNumber) });
            if (newTable.status !== 'empty') {
                return res.json({ success: false, error: 'Target table is not empty' });
            }
            
            // Update order
            order.tableNumber = parseInt(newTableNumber);
            await order.save();
            
            // Update old table
            await Table.findOneAndUpdate(
                { tableNumber: oldTableNumber },
                { status: 'empty', currentOrderId: null, occupiedAt: null }
            );
            
            // Update new table
            await Table.findOneAndUpdate(
                { tableNumber: parseInt(newTableNumber) },
                { status: order.status === 'served' ? 'served' : 'busy', currentOrderId: order._id, occupiedAt: new Date() }
            );
            
        } else if (moveType === 'table-to-parcel') {
            // Update order
            order.orderType = 'parcel';
            order.tableNumber = null;
            order.deliveryType = 'pickup';
            await order.save();
            
            // Clear old table
            await Table.findOneAndUpdate(
                { tableNumber: oldTableNumber },
                { status: 'empty', currentOrderId: null, occupiedAt: null }
            );
            
        } else if (moveType === 'parcel-to-table') {
            // Check if table is empty
            const newTable = await Table.findOne({ tableNumber: parseInt(newTableNumber) });
            if (newTable.status !== 'empty') {
                return res.json({ success: false, error: 'Target table is not empty' });
            }
            
            // Update order
            order.orderType = 'dine-in';
            order.tableNumber = parseInt(newTableNumber);
            order.deliveryType = null;
            order.deliveryAddress = null;
            await order.save();
            
            // Update table
            await Table.findOneAndUpdate(
                { tableNumber: parseInt(newTableNumber) },
                { status: order.status === 'served' ? 'served' : 'busy', currentOrderId: order._id, occupiedAt: new Date() }
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});


module.exports = router;



