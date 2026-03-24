const { BlobServiceClient } = require('@azure/storage-blob');
const multer = require('multer');
const crypto = require('crypto');

const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);

// Container names
const MENU_CONTAINER = 'menu-images';
const GALLERY_CONTAINER = 'gallery-images';

// Multer memory storage
const storage = multer.memoryStorage();

// Upload to Azure Blob
async function uploadToBlob(containerName, file) {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists({ access: 'blob' });
    
    const blobName = `${crypto.randomBytes(16).toString('hex')}-${file.originalname}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    
    await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: { blobContentType: file.mimetype }
    });
    
    return blockBlobClient.url;
}

// Delete from Azure Blob
async function deleteFromBlob(blobUrl) {
    const urlParts = new URL(blobUrl);
    const pathParts = urlParts.pathname.split('/');
    const containerName = pathParts[1];
    const blobName = pathParts.slice(2).join('/');
    
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    
    await blockBlobClient.deleteIfExists();
}

module.exports = { 
    storage, 
    uploadToBlob, 
    deleteFromBlob,
    MENU_CONTAINER,
    GALLERY_CONTAINER
};
