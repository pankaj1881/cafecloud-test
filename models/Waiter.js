const mongoose = require('mongoose');

const waiterSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Waiter', waiterSchema);
