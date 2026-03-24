const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const Table = require('../models/Table');


// Customer order page (from QR scan)
router.get('/order', async (req, res) => {
    try {
        const tableNumber = parseInt(req.query.table);
        const sessionToken = req.query.token;
       
        if (!tableNumber) {
            return res.status(400).send('Invalid table number');
        }
        
        // Check if QR ordering is enabled
        const SiteSettings = require('../models/SiteSettings');
        const settings = await SiteSettings.findOne();
        const branding = require('../config/branding');
        
        if (settings && settings.qrOrderingEnabled === false) {
            return res.render('qr-ordering-disabled', { branding, settings });
        }
       
        // Check if table exists and its status
        const table = await Table.findOne({ tableNumber });
       
        if (!table) {
            return res.status(404).send('Table not found');
        }
       
        // Check for existing order with session token
        let existingOrder = null;
        if (sessionToken) {
            existingOrder = await Order.findOne({
                tableNumber,
                sessionToken,
                status: { $nin: ['billed', 'cancelled'] }
            });
           
            // If order is cancelled, clear session and allow new order
            if (!existingOrder) {
                const cancelledOrder = await Order.findOne({
                    tableNumber,
                    sessionToken,
                    status: 'cancelled'
                });
                
                if (cancelledOrder) {
                    // Redirect to fresh order page without token
                    return res.redirect(`/order?table=${tableNumber}`);
                }
            }
           
            // If order is served, redirect to customer bill page
            if (existingOrder && existingOrder.status === 'served') {
                return res.redirect(`/bill?table=${tableNumber}&token=${sessionToken}`);
            }
        }
       
        // If has valid session token, allow access (same customer)
        if (existingOrder) {
            const categories = await Category.find();
            const menuItems = await MenuItem.find({ isAvailable: true }).populate('category');
           
            return res.render('customer-order', {
                tableNumber,
                categories,
                menuItems,
                existingOrder,
                sessionToken
            });
        }
       
        // Check if table is not empty or has pending orders from OTHER customers
        if (table.status !== 'empty') {
            return res.render('customer-table-busy', { tableNumber, tableStatus: table.status });
        }
       
        // Check for pending orders from other customers (without valid session token)
        const pendingOrder = await Order.findOne({
            tableNumber,
            customerPlaced: true,
            approvalStatus: 'pending',
            status: { $nin: ['billed'] }
        });
       
        // If there's a pending order but no session token provided, block access
        if (pendingOrder && !sessionToken) {
            return res.render('customer-table-busy', { tableNumber, tableStatus: 'pending' });
        }
       
        // Table is empty, allow new order
        const categories = await Category.find();
        const menuItems = await MenuItem.find({ isAvailable: true }).populate('category');
       
        res.render('customer-order', {
            tableNumber,
            categories,
            menuItems,
            existingOrder: null,
            sessionToken: null
        });
    } catch (error) {
        console.error('Error loading order page:', error);
        res.status(500).send('Error loading order page');
    }
});


// Customer bill page
router.get('/bill', async (req, res) => {
    try {
        const tableNumber = parseInt(req.query.table);
        const sessionToken = req.query.token;
       
        console.log('Bill request - Table:', tableNumber, 'Token:', sessionToken);
       
        if (!tableNumber || !sessionToken) {
            return res.status(400).send('Invalid request - Missing table or token');
        }
       
        // Find the order - check both served and pending status
        let order = await Order.findOne({
            tableNumber,
            sessionToken,
            status: { $in: ['served', 'billed'] }
        });
       
        // If not found in served/billed, check if it's still pending but should be served
        if (!order) {
            order = await Order.findOne({
                tableNumber,
                sessionToken
            });
            console.log('Order found with any status:', order ? order.status : 'not found');
        }
       
        if (!order) {
            return res.status(404).send('Order not found or not yet completed');
        }
       
        res.render('customer-bill', {
            tableNumber,
            order
        });
    } catch (error) {
        console.error('Error loading bill page:', error);
        res.status(500).send('Error loading bill page: ' + error.message);
    }
});


// Check order status
router.get('/api/check-order-status', async (req, res) => {
    try {
        const { orderId, token } = req.query;
       
        if (!orderId || !token) {
            return res.json({ success: false, error: 'Invalid request' });
        }
       
        const order = await Order.findOne({ _id: orderId, sessionToken: token });
       
        if (!order) {
            return res.json({ success: false, error: 'Order not found' });
        }
       
        // If order is cancelled, tell customer
        if (order.status === 'cancelled') {
            return res.json({ 
                success: true, 
                status: 'cancelled',
                cancelled: true
            });
        }
       
        // If order is rejected, tell customer to start fresh
        if (order.approvalStatus === 'rejected') {
            return res.json({ 
                success: true, 
                status: order.status,
                rejected: true,
                rejectionReason: order.rejectionReason
            });
        }
       
        res.json({ success: true, status: order.status, rejected: false, cancelled: false });
    } catch (error) {
        console.error('Error checking order status:', error);
        res.json({ success: false, error: 'Error checking order status' });
    }
});


// Submit customer order
router.post('/api/customer-order', async (req, res) => {
    try {
        const { tableNumber, items, sessionToken, orderId } = req.body;
       
        if (!tableNumber || !items || items.length === 0) {
            return res.json({ success: false, error: 'Invalid order data' });
        }
       
        // If updating existing order (same customer with token)
        if (orderId && sessionToken) {
            const order = await Order.findOne({ _id: orderId, sessionToken });
            if (order) {
                // Check if order is already served or billed
                if (order.status === 'served' || order.status === 'billed') {
                    return res.json({ success: false, error: 'Order is already completed. Cannot add more items.' });
                }
               
                // Add new items to existing order (not approved yet)
                items.forEach(item => {
                    order.items.push({
                        menuItemId: item.menuItemId,
                        name: item.name,
                        price: item.price,
                        quantity: item.quantity,
                        status: 'pending',
                        approved: false
                    });
                });
                order.totalAmount = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                // Reset approval status so waiter sees new items
                order.approvalStatus = 'pending';
                await order.save();
               
                return res.json({
                    success: true,
                    orderId: order.orderId,
                    sessionToken: order.sessionToken
                });
            }
        }
       
        // Check if table is available for new order
        const table = await Table.findOne({ tableNumber });
       
        if (!table) {
            return res.json({ success: false, error: 'Table not found' });
        }
       
        if (table.status !== 'empty') {
            return res.json({ success: false, error: 'Table is currently occupied. Please wait until it is cleared.' });
        }
       
        const existingPending = await Order.findOne({
            tableNumber,
            customerPlaced: true,
            approvalStatus: 'pending'
        });
       
        if (existingPending) {
            return res.json({ success: false, error: 'An order is already pending for this table.' });
        }
       
        // Generate session token for new order
        const newSessionToken = 'SESSION_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
       
        // Calculate total
        const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
       
        // Generate order ID
        const newOrderId = 'ORD' + Date.now();
       
        // Create order
        const order = await Order.create({
            orderId: newOrderId,
            orderType: 'dine-in',
            tableNumber,
            items: items.map(item => ({
                menuItemId: item.menuItemId,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                status: 'pending',
                approved: false
            })),
            totalAmount,
            status: 'pending',
            customerPlaced: true,
            approvalStatus: 'pending',
            sessionToken: newSessionToken,
            waiterName: 'Customer',
            orderTakenAt: new Date()
        });
       
        res.json({
            success: true,
            orderId: order.orderId,
            sessionToken: newSessionToken
        });
    } catch (error) {
        console.error('Error creating customer order:', error);
        res.json({ success: false, error: 'Error creating order' });
    }
});

// Remove item from customer order (only unapproved items)
router.post('/api/customer-order/remove-item', async (req, res) => {
    try {
        const { orderId, sessionToken, itemId } = req.body;
       
        if (!orderId || !sessionToken || !itemId) {
            return res.json({ success: false, error: 'Invalid request' });
        }
       
        const order = await Order.findOne({ _id: orderId, sessionToken });
       
        if (!order) {
            return res.json({ success: false, error: 'Order not found' });
        }
       
        // Check if order is already approved/served/billed
        if (order.status === 'served' || order.status === 'billed') {
            return res.json({ success: false, error: 'Cannot modify completed order' });
        }
       
        // Find the FIRST unapproved item with this menuItemId
        const itemIndex = order.items.findIndex(item => 
            item.menuItemId.toString() === itemId && !item.approved
        );
       
        if (itemIndex === -1) {
            return res.json({ success: false, error: 'Item not found or already approved' });
        }
       
        // Remove the item
        order.items.splice(itemIndex, 1);
       
        // If no items left, delete the order
        if (order.items.length === 0) {
            await Order.findByIdAndDelete(orderId);
            return res.json({ success: true, orderDeleted: true });
        }
       
        // Recalculate total
        order.totalAmount = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        await order.save();
       
        res.json({ success: true, orderDeleted: false });
    } catch (error) {
        console.error('Error removing item:', error);
        res.json({ success: false, error: 'Error removing item' });
    }
});

// Update item quantity in customer order (only unapproved items)
router.post('/api/customer-order/update-quantity', async (req, res) => {
    try {
        const { orderId, sessionToken, itemId, newQuantity } = req.body;
       
        if (!orderId || !sessionToken || !itemId || newQuantity === undefined) {
            return res.json({ success: false, error: 'Invalid request' });
        }
       
        const order = await Order.findOne({ _id: orderId, sessionToken });
       
        if (!order) {
            return res.json({ success: false, error: 'Order not found' });
        }
       
        // Check if order is already approved/served/billed
        if (order.status === 'served' || order.status === 'billed') {
            return res.json({ success: false, error: 'Cannot modify completed order' });
        }
       
        // Find the FIRST unapproved item with this menuItemId
        const item = order.items.find(item => 
            item.menuItemId.toString() === itemId && !item.approved
        );
       
        if (!item) {
            return res.json({ success: false, error: 'Item not found or already approved' });
        }
       
        // Update quantity or remove if 0
        if (newQuantity <= 0) {
            // Remove only the first unapproved item with this ID
            const itemIndex = order.items.findIndex(i => 
                i.menuItemId.toString() === itemId && !i.approved
            );
            if (itemIndex !== -1) {
                order.items.splice(itemIndex, 1);
            }
           
            // If no items left, delete the order
            if (order.items.length === 0) {
                await Order.findByIdAndDelete(orderId);
                return res.json({ success: true, orderDeleted: true });
            }
        } else {
            item.quantity = newQuantity;
        }
       
        // Recalculate total
        order.totalAmount = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        await order.save();
       
        res.json({ success: true, orderDeleted: false });
    } catch (error) {
        console.error('Error updating quantity:', error);
        res.json({ success: false, error: 'Error updating quantity' });
    }
});


module.exports = router;



