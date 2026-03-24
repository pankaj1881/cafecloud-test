module.exports = (req, res, next) => {
    if (req.session && (req.session.admin || req.session.kitchen)) {
        return next();
    }
    res.redirect('/kitchen/login');
};
