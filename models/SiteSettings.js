const mongoose = require("mongoose");

const siteSettingsSchema = new mongoose.Schema({
    cafeName: String,
    description: String,
    heroQuote: String,
    address: String,
    phone: String,
    instagram: String,
    facebook: String,
    mapLink: String,
    heroImage: String,
    galleryImages: [String],
    hallGalleryImages: [String],
    waiterPin: { type: String, default: '1234' },
    kitchenPin: { type: String, default: '1234' },
    openingTime: { type: String, default: '09:00' },
    closingTime: { type: String, default: '22:00' },
    weeklyOff: { type: String, default: 'None' },
    announcement: {
        enabled: { type: Boolean, default: false },
        type: { type: String, default: 'offer' }, // offer, closure, announcement
        title: String,
        description: String,
        startDate: Date,
        endDate: Date
    },
    hallBookingSettings: {
        minimumBookingHours: { type: Number, default: 2 },
        bufferTimeMinutes: { type: Number, default: 30 }
    },
    maintenanceMode: {
        enabled: { type: Boolean, default: false },
        message: { type: String, default: 'We\'re cooking something special!' }
    },
    qrOrderingEnabled: { type: Boolean, default: true }
});

module.exports = mongoose.model("SiteSettings", siteSettingsSchema);