const SiteSettings = require('../models/SiteSettings');

async function checkMaintenance(req, res, next) {
    try {
        // Skip check for admin routes
        if (req.path.startsWith('/admin')) {
            return next();
        }
        
        // Skip check for staff login pages
        if (req.path === '/waiter/login' || req.path === '/kitchen/login') {
            return next();
        }
        
        // Check environment variable only
        const isMaintenanceMode = process.env.MAINTENANCE_MODE === 'true';
        
        if (isMaintenanceMode) {
            // Allow authenticated staff to access ONLY their own routes
            const isStaff = req.session.adminAuthenticated || req.session.staffAuthenticated;
            const isStaffRoute = req.path.startsWith('/waiter') || req.path.startsWith('/kitchen') || req.path.startsWith('/hall');
            
            if (isStaff && isStaffRoute) {
                return next();
            }
            
            // Block everyone else (including staff trying to access customer pages)
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
