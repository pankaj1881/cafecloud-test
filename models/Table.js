const mongoose = require('mongoose');

const tableSchema = new mongoose.Schema({
    tableNumber: { type: Number, required: true, unique: true },
    status: { 
        type: String, 
        enum: ['empty', 'busy', 'served', 'billing'], 
        default: 'empty' 
    },
    currentOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    occupiedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Table', tableSchema);
