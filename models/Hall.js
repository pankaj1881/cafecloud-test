const mongoose = require('mongoose');

const hallSchema = new mongoose.Schema({
    name: { type: String, required: true },
    capacity: { type: Number, required: true },
    baseRatePerHour: { type: Number, required: true, default: 5000 },
    extensionRatePerHour: { type: Number, required: true, default: 6000 },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Hall', hallSchema);
