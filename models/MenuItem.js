const mongoose = require("mongoose");

const menuItemSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category"
    },
    image: {
        type: String
    },
    description: {
        type: String
    },
    isAvailable: {
        type: Boolean,
        default: true
    },
    foodType: {
        type: String,
        enum: ['veg', 'non-veg', 'beverage', 'other'],
        default: 'veg'
    }
});

module.exports = mongoose.model("MenuItem", menuItemSchema);