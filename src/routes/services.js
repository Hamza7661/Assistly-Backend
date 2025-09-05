const express = require('express');
const { SERVICES_LIST } = require('../enums/services');

const router = express.Router();

// Public: list available services
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    data: {
      services: SERVICES_LIST
    }
  });
});

module.exports = router;




