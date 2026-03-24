const { IMAGE_BASE_URL, MENU_IMAGES_FOLDER, GALLERY_IMAGES_FOLDER } = require('../config/storage');

// Generate full image URL from filename
function getImageUrl(filename, folder = MENU_IMAGES_FOLDER) {
    if (!filename) return null;
    
    // Check if IMAGE_BASE_URL is configured
    if (!IMAGE_BASE_URL) {
        console.warn('IMAGE_BASE_URL not configured in .env');
        return null;
    }
    
    // Extract filename if it's a full URL (for migration)
    let cleanFilename = filename;
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
        const parts = filename.split('/');
        cleanFilename = parts[parts.length - 1];
    }
    
    // Add .jpg extension if missing (for Cloudinary filenames without extension)
    if (!cleanFilename.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
        cleanFilename = cleanFilename + '.jpg';
    }
    
    // Generate URL from base path + folder + filename
    return `${IMAGE_BASE_URL}/${folder}/${cleanFilename}`;
}

// Extract filename from full URL or return filename
function extractFilename(urlOrFilename) {
    if (!urlOrFilename) return null;
    
    // If it's a full URL, extract filename
    if (urlOrFilename.startsWith('http://') || urlOrFilename.startsWith('https://')) {
        // For Cloudinary URLs, get everything after the last folder
        // Example: .../cafe-cloud/menu-images/v123/abc.jpg -> abc.jpg
        const parts = urlOrFilename.split('/');
        
        // Check if there's a version folder (starts with 'v' followed by numbers)
        const lastPart = parts[parts.length - 1];
        const secondLastPart = parts[parts.length - 2];
        
        // If second last part is version folder, skip it
        if (secondLastPart && secondLastPart.match(/^v\d+$/)) {
            return lastPart; // Just return filename without version
        }
        
        return lastPart;
    }
    
    // Already a filename
    return urlOrFilename;
}

module.exports = {
    getImageUrl,
    extractFilename,
    MENU_IMAGES_FOLDER,
    GALLERY_IMAGES_FOLDER
};
