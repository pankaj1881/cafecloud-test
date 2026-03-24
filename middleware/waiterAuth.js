module.exports = (req, res, next) => {
    if (req.session && req.session.waiter) {
        return next();
    }
    res.redirect('/waiter/login');
};
