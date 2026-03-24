// Storage Configuration
// Set STORAGE_PROVIDER=azure or STORAGE_PROVIDER=cloudinary in .env

const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || 'cloudinary';

const IMAGE_BASE_URL = STORAGE_PROVIDER === 'azure'
    ? process.env.AZURE_IMAGE_BASE_URL
    : process.env.CLOUDINARY_IMAGE_BASE_URL;

// Debug logging
console.log('=== STORAGE CONFIG ===');
console.log('STORAGE_PROVIDER:', STORAGE_PROVIDER);
console.log('CLOUDINARY_IMAGE_BASE_URL:', process.env.CLOUDINARY_IMAGE_BASE_URL);
console.log('AZURE_IMAGE_BASE_URL:', process.env.AZURE_IMAGE_BASE_URL);
console.log('IMAGE_BASE_URL:', IMAGE_BASE_URL);
console.log('=====================');

module.exports = {
    STORAGE_PROVIDER,
    IMAGE_BASE_URL,
    MENU_IMAGES_FOLDER: 'menu-images',
    GALLERY_IMAGES_FOLDER: 'gallery-images'
};
