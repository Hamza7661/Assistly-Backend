const express = require('express');
const { LEAD_TYPES_LIST } = require('../enums/leadTypes');

const router = express.Router();

// Public: list lead types with ids, values, and texts
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    data: {
      leadTypes: LEAD_TYPES_LIST
    }
  });
});

module.exports = router;


