const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true },
    orderType: { type: String, enum: ['dine-in', 'parcel', 'hall'], required: true },
    tableNumber: { type: Number, default: null },
    hallBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'HallBooking', default: null },
    customerName: { type: String, default: null },
    customerPhone: { type: String, default: null },
    deliveryType: { type: String, enum: ['pickup', 'home-delivery'], default: null },
    deliveryAddress: { type: String, default: null },
    items: [{
        menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
        name: String,
        price: Number,
        quantity: Number,
        status: { type: String, enum: ['pending', 'preparing', 'ready', 'served'], default: 'pending' },
        approved: {type : Boolean, default: false}
    }],
    totalAmount: { type: Number, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'preparing', 'ready', 'served', 'billed', 'cancelled'], 
        default: 'pending' 
    },
    sentToKitchen: { type: Boolean, default: false },
    customerPlaced: { type: Boolean, default: false },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    rejectionReason: { type: String, default: null },
    sessionToken: { type : String, default: null},
    waiterName: { type: String, required: false },
    orderTakenAt: { type: Date, default: Date.now },
    preparingStartedAt: { type: Date, default: null },
    readyAt: { type: Date, default: null },
    servedAt: { type: Date, default: null },
    billedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null }
});

module.exports = mongoose.model('Order', orderSchema);
