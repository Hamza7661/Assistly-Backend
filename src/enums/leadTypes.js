const LEAD_TYPES = {
  CALLBACK: { id: 1, value: 'callback', text: 'I would like a call back' },
  APPOINTMENT_ARRANGEMENT: { id: 2, value: 'appointment arrangement', text: 'I would like to arrange an appointment' },
  FURTHER_INFORMATION: { id: 3, value: 'further information', text: 'I would like further information' }
};

const LEAD_TYPES_LIST = Object.values(LEAD_TYPES);

const LEAD_TYPE_BY_ID = LEAD_TYPES_LIST.reduce((acc, t) => {
  acc[t.id] = t;
  return acc;
}, {});

// Backwards-compat maps
const LEAD_TYPES_VALUES = LEAD_TYPES_LIST.map(t => t.value);
const LEAD_TYPE_TEXTS = LEAD_TYPES_LIST.reduce((acc, t) => { acc[t.value] = t.text; return acc; }, {});

module.exports = {
  LEAD_TYPES,
  LEAD_TYPES_LIST,
  LEAD_TYPE_BY_ID,
  LEAD_TYPES_VALUES,
  LEAD_TYPE_TEXTS
};


