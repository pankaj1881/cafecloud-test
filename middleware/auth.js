module.exports = function (req, res, next) {
    if (!req.session.adminId) {
        return res.redirect("/admin");
    }
    next();
};