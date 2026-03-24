const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    rating: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
    },
    type: {
        type: String,
        enum: ["Feedback", "Complaint", "Suggestion"],
        default: "Feedback"
    },
    message: {
        type: String
    },
    status: {
        type: String,
        enum: ["Pending", "Reviewed"],
        default: "Pending"
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Feedback", feedbackSchema);
