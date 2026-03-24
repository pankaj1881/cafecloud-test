const SiteSettings = require('../models/SiteSettings');

async function checkMaintenance(req, res, next) {
    try {
        // Skip check for admin routes
        if (req.path.startsWith('/admin')) {
            return next();
        }
        
        // Check environment variable only
        const isMaintenanceMode = process.env.MAINTENANCE_MODE === 'true';
        
        // If maintenance ON and user is NOT admin
        if (isMaintenanceMode && !req.session.adminAuthenticated) {
            return res.render('maintenance', {
                message: "We're cooking something special!"
            });
        }
        
        next();
    } catch (error) {
        console.error('Maintenance check error:', error);
        next();
    }
}

module.exports = checkMaintenance;



