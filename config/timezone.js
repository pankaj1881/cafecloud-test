// Timezone configuration for the cafe system
// Change this if your cafe is in a different timezone

const TIMEZONE = 'Asia/Kolkata'; // IST (UTC+5:30)
const TIMEZONE_OFFSET = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds

// Get current date/time in cafe's timezone
function getNow() {
    return new Date();
}

// Get start of today (00:00:00) in cafe's timezone
function getStartOfDay(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

// Get end of today (23:59:59.999) in cafe's timezone
function getEndOfDay(date = new Date()) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

// Get start of yesterday
function getStartOfYesterday() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return getStartOfDay(yesterday);
}

// Get end of yesterday
function getEndOfYesterday() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return getEndOfDay(yesterday);
}

// Convert 24-hour time string to 12-hour format with AM/PM
// Example: "14:30" -> "2:30 PM"
function format12Hour(time24) {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
}

module.exports = {
    TIMEZONE,
    TIMEZONE_OFFSET,
    getNow,
    getStartOfDay,
    getEndOfDay,
    getStartOfYesterday,
    getEndOfYesterday,
    format12Hour
};
