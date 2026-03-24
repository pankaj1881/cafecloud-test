const mongoose = require('mongoose');

const hallBookingSchema = new mongoose.Schema({
    bookingId: { type: String, required: true, unique: true },
    hallId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hall', required: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    bookingDate: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    bookedHours: { type: Number, required: true },
    numberOfGuests: { type: Number, default: 0 },
    otherCharges: { type: Number, default: 0 },
    baseRatePerHour: { type: Number, required: true },
    extensionHours: { type: Number, default: 0 },
    extensionRatePerHour: { type: Number, required: true },
    decorationCharges: { type: Number, default: 0 },
    cakeCharges: { type: Number, default: 0 },
    foodOrderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],
    advanceAmount: { type: Number, required: true },
    discountType: { type: String, enum: ['percentage', 'fixed', 'none'], default: 'none' },
    discountValue: { type: Number, default: 0 },
    finalAmount: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },
    specialRequirements: { type: String },
    status: { type: String, enum: ['confirmed', 'ongoing', 'billed', 'cancelled'], default: 'confirmed' },
    billId: { type: String },
    billedAt: { type: Date },
    createdBy: { type: String, default: 'Staff' }
}, { timestamps: true });

module.exports = mongoose.model('HallBooking', hallBookingSchema);
