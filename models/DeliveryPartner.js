const mongoose = require('mongoose');

const deliveryPartnerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    logo: { type: String, required: true },
    url: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('DeliveryPartner', deliveryPartnerSchema);
