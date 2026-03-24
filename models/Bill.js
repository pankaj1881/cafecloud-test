const mongoose = require('mongoose');

const billSchema = new mongoose.Schema({
    billId: { type: String, required: true, unique: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    hallBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'HallBooking' },
    items: [{
        name: String,
        price: Number,
        quantity: Number
    }],
    subtotal: { type: Number, required: true },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    otherCharges: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    paymentMethod: { type: String, enum: ['cash', 'online', 'pending'], default: 'pending' },
    customerMobile: { type: String, default: null },
    generatedBy: { type: String, required: true },
    generatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Bill', billSchema);


