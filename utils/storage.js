const multer = require('multer');
const path = require('path');
const { STORAGE_PROVIDER } = require('../config/storage');

// Cloudinary setup
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Azure setup
const { BlobServiceClient } = require('@azure/storage-blob');
const crypto = require('crypto');

let blobServiceClient;
if (STORAGE_PROVIDER === 'azure' && process.env.AZURE_STORAGE_CONNECTION_STRING) {
    blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
}

// Cloudinary Storage
const cloudinaryMenuStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'cafe-cloud/menu-images',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [{ width: 800, height: 800, crop: 'limit' }]
    }
});

const cloudinaryGalleryStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'cafe-cloud/gallery-images',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [{ width: 1200, height: 800, crop: 'limit' }]
    }
});

// Azure Storage (using multer memory storage + manual upload)
const azureMemoryStorage = multer.memoryStorage();

// Helper function to upload to Azure
async function uploadToAzure(file, folder) {
    const containerClient = blobServiceClient.getContainerClient('cafe-cloud');
    const randomId = crypto.randomBytes(16).toString('hex');
    const filename = `${Date.now()}-${randomId}${path.extname(file.originalname)}`;
    const blobName = `${folder}/${filename}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    
    await blockBlobClient.upload(file.buffer, file.buffer.length, {
        blobHTTPHeaders: { blobContentType: file.mimetype }
    });
    
    return filename; // Return only filename
}

// Helper function to delete from Azure
async function deleteFromAzure(filename, folder) {
    const containerClient = blobServiceClient.getContainerClient('cafe-cloud');
    const blobName = `${folder}/${filename}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.deleteIfExists();
}

// Helper function to delete from Cloudinary
async function deleteFromCloudinary(filename, folder) {
    const publicId = `cafe-cloud/${folder}/${filename.split('.')[0]}`;
    await cloudinary.uploader.destroy(publicId);
}

// Export storage based on provider
const menuStorage = STORAGE_PROVIDER === 'azure' ? azureMemoryStorage : cloudinaryMenuStorage;
const galleryStorage = STORAGE_PROVIDER === 'azure' ? azureMemoryStorage : cloudinaryGalleryStorage;

module.exports = {
    cloudinary,
    menuStorage,
    galleryStorage,
    uploadToAzure,
    deleteFromAzure,
    deleteFromCloudinary,
    STORAGE_PROVIDER
};
