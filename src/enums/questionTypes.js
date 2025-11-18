const QUESTION_TYPES = {
  SINGLE_CHOICE: { id: 1, code: 'single_choice', value: 'Single Choice' },
  MULTIPLE_CHOICE: { id: 2, code: 'multiple_choice', value: 'Multiple Choice' },
  TEXT_RESPONSE: { id: 3, code: 'text_response', value: 'Text Response' }
};

const QUESTION_TYPES_LIST = Object.values(QUESTION_TYPES);

const QUESTION_TYPE_BY_ID = QUESTION_TYPES_LIST.reduce((acc, t) => {
  acc[t.id] = t;
  return acc;
}, {});

const QUESTION_TYPE_BY_CODE = QUESTION_TYPES_LIST.reduce((acc, t) => {
  acc[t.code] = t;
  return acc;
}, {});

// Backwards-compat: numeric enum values for model validation
const QUESTION_TYPES_ENUM = {
  SINGLE_CHOICE: 1,
  MULTIPLE_CHOICE: 2,
  TEXT_RESPONSE: 3
};

module.exports = {
  QUESTION_TYPES,
  QUESTION_TYPES_LIST,
  QUESTION_TYPE_BY_ID,
  QUESTION_TYPE_BY_CODE,
  QUESTION_TYPES_ENUM
};

