const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
    res.send("Public Homepage Working");
});

module.exports = router;