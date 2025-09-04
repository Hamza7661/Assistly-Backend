const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Joi = require('joi');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    minlength: [1, 'First name cannot be empty'],
    maxlength: [50, 'First name cannot exceed 50 characters'],
    validate: {
      validator: function(v) {
        return /^[a-zA-Z\s'-]+$/.test(v);
      },
      message: 'First name contains invalid characters'
    }
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    minlength: [1, 'Last name cannot be empty'],
    maxlength: [50, 'Last name cannot exceed 50 characters'],
    validate: {
      validator: function(v) {
        return /^[a-zA-Z\s'-]+$/.test(v);
      },
      message: 'Last name contains invalid characters'
    }
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    validate: {
      validator: function(v) {
        const digitsOnly = v.replace(/[\s\-\(\)]/g, '');
        return /^\+?[\d\s\-\(\)\s]+$/.test(v) && digitsOnly.length >= 10;
      },
      message: 'Please enter a valid phone number with at least 10 digits'
    }
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    maxlength: [254, 'Email is too long'],
    validate: {
      validator: function(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Please enter a valid email address'
    }
  },
  professionDescription: {
    type: String,
    required: [true, 'Profession description is required'],
    trim: true,
    minlength: [1, 'Profession description cannot be empty'],
    maxlength: [300, 'Profession description cannot exceed 300 characters']
  },
  package: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Package',
    required: false
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters long'],
    maxlength: [128, 'Password is too long'],
    select: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date,
    default: null
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  },
  passwordChangedAt: {
    type: Date,
    default: null
  },
  passwordResetToken: {
    type: String,
    default: null
  },
  passwordResetExpires: {
    type: Date,
    default: null
  },
  emailVerificationToken: {
    type: String,
    default: null
  },
  emailVerificationExpires: {
    type: Date,
    default: null
  },
  phoneVerificationCode: {
    type: String,
    default: null
  },
  phoneVerificationExpires: {
    type: Date,
    default: null
  },
  twoFactorSecret: {
    type: String,
    default: null
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  profilePicture: {
    type: String,
    default: null
  },
  website: {
    type: String,
    trim: true,
    default: null,
    validate: {
      validator: function(v) {
        if (!v) return true;
        const urlRegex = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/[\w\-._~:?#\[\]@!$&'()*+,;=\/]*)?$/i;
        return urlRegex.test(v);
      },
      message: 'Please enter a valid URL'
    }
  },
  preferences: {
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true }
    },
    language: { type: String, default: 'en' },
    timezone: { type: String, default: 'UTC' }
  },
  metadata: {
    signupSource: { type: String, default: 'web' },
    userAgent: String,
    ipAddress: String,
    referrer: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true, 
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.loginAttempts;
      delete ret.lockUntil;
      delete ret.passwordResetToken;
      delete ret.passwordResetExpires;
      delete ret.emailVerificationToken;
      delete ret.emailVerificationExpires;
      delete ret.phoneVerificationCode;
      delete ret.phoneVerificationExpires;
      delete ret.twoFactorSecret;
      return ret;
    }
  },
  toObject: { 
    virtuals: true, 
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.loginAttempts;
      delete ret.lockUntil;
      delete ret.passwordResetToken;
      delete ret.passwordResetExpires;
      delete ret.emailVerificationToken;
      delete ret.emailVerificationExpires;
      delete ret.phoneVerificationCode;
      delete ret.phoneVerificationExpires;
      delete ret.twoFactorSecret;
      return ret;
    }
  }
});

userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

  // Check if password is older than 1 year (365 * 24 * 60 * 60 * 1000 = 31,536,000,000ms = 1 year)
  userSchema.virtual('isPasswordExpired').get(function() {
    if (!this.passwordChangedAt) return false;
    const passwordAge = Date.now() - this.passwordChangedAt.getTime();
    const maxAge = 365 * 24 * 60 * 60 * 1000; // 1 year in milliseconds
    return passwordAge > maxAge;
  });

userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });
userSchema.index({ package: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ isActive: 1 });
userSchema.index({ isVerified: 1 });
userSchema.index({ 'preferences.language': 1 });
userSchema.index({ 'metadata.signupSource': 1 });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const salt = await bcrypt.genSalt(saltRounds);
    this.password = await bcrypt.hash(this.password, salt);
    this.passwordChangedAt = new Date();
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  if (this.isLocked) {
    throw new Error('Account is temporarily locked due to too many failed login attempts');
  }
  
  try {
    const isMatch = await bcrypt.compare(candidatePassword, this.password);
    
    if (!isMatch) {
      await this.incLoginAttempts();
    } else {
      if (this.loginAttempts > 0) {
        await this.resetLoginAttempts();
      }
    }
    
    return isMatch;
  } catch (error) {
    throw new Error('Password comparison failed');
  }
};

userSchema.methods.incLoginAttempts = async function() {
  if (this.lockUntil && this.lockUntil > Date.now()) {
    return;
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock account for 2 hours after 5 failed attempts (2 * 60 * 60 * 1000 = 7,200,000ms = 2 hours)
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours in milliseconds
  }
  
  await this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = async function() {
  await this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 }
  });
};

userSchema.methods.getProfile = function() {
  return this.toObject();
};

userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

userSchema.statics.findByPhone = function(phoneNumber) {
  return this.findOne({ phoneNumber });
};

userSchema.statics.findActiveUsers = function() {
  return this.find({ isActive: true });
};

userSchema.statics.findVerifiedUsers = function() {
  return this.find({ isVerified: true });
};

const User = mongoose.model('User', userSchema);

const userValidationSchema = Joi.object({
  firstName: Joi.string()
    .min(1)
    .max(50)
    .pattern(/^[a-zA-Z\s'-]+$/)
    .required()
    .messages({
      'string.pattern.base': 'First name contains invalid characters',
      'string.min': 'First name cannot be empty',
      'string.max': 'First name cannot exceed 50 characters',
      'any.required': 'First name is required'
    }),
  
  lastName: Joi.string()
    .min(1)
    .max(50)
    .pattern(/^[a-zA-Z\s'-]+$/)
    .required()
    .messages({
      'string.pattern.base': 'Last name contains invalid characters',
      'string.min': 'Last name cannot be empty',
      'string.max': 'Last name cannot exceed 50 characters',
      'any.required': 'Last name is required'
    }),
  
  phoneNumber: Joi.string()
    .pattern(/^\+?[\d\s\-\(\)\s]+$/)
    .custom((value, helpers) => {
      const digitsOnly = value.replace(/[\s\-\(\)]/g, '');
      if (digitsOnly.length < 10) {
        return helpers.error('any.invalid');
      }
      return value;
    })
    .required()
    .messages({
      'string.pattern.base': 'Please enter a valid phone number',
      'any.invalid': 'Phone number must be at least 10 digits',
      'any.required': 'Phone number is required'
    }),
  
  email: Joi.string()
    .email()
    .max(254)
    .lowercase()
    .required()
    .messages({
      'string.email': 'Please enter a valid email address',
      'string.max': 'Email is too long',
      'any.required': 'Email is required'
    }),
  
  professionDescription: Joi.string()
    .min(1)
    .max(300)
    .required()
    .messages({
      'string.min': 'Profession description cannot be empty',
      'string.max': 'Profession description cannot exceed 300 characters',
      'any.required': 'Profession description is required'
    }),
  
  website: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow(null)
    .optional()
    .messages({
      'string.uri': 'Please enter a valid URL'
    }),
  
  package: Joi.string()
    .optional()
    .messages({
      'string.base': 'Package must be a valid string'
    }),
  
  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
    .required()
    .messages({
      'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
      'string.min': 'Password must be at least 8 characters long',
      'string.max': 'Password is too long',
      'any.required': 'Password is required'
    })
});

const userUpdateValidationSchema = Joi.object({
  firstName: Joi.string()
    .min(1)
    .max(50)
    .pattern(/^[a-zA-Z\s'-]+$/),
  
  lastName: Joi.string()
    .min(1)
    .max(50)
    .pattern(/^[a-zA-Z\s'-]+$/),
  
  professionDescription: Joi.string()
    .min(1)
    .max(300),
  
  package: Joi.string()
    .optional(),
  
  preferences: Joi.object({
    notifications: Joi.object({
      email: Joi.boolean(),
      sms: Joi.boolean(),
      push: Joi.boolean()
    }),
    language: Joi.string().valid('en', 'es', 'fr', 'de'),
    timezone: Joi.string()
  }),
  website: Joi.string().uri({ scheme: ['http', 'https'] })
});

module.exports = {
  User,
  userValidationSchema,
  userUpdateValidationSchema
};
