# 🚀 Assistly Backend API

A production-grade Voice Agent Backend for the Assistly App, built with Node.js, Express, and MongoDB.

## ✨ Features

- **🔐 Authentication & Authorization**: JWT-based auth with refresh tokens
- **📦 Package Management**: Flexible subscription packages with limits and features
- **🛡️ Security**: Rate limiting, CORS, Helmet, XSS protection, and more
- **📊 Health Monitoring**: Comprehensive health checks and system monitoring
- **📝 Logging**: Structured logging with Winston
- **🔄 Database**: MongoDB with Mongoose, connection pooling, and retry logic
- **🧪 Testing**: Jest and Supertest for comprehensive testing
- **🐳 Docker**: Containerization support
- **📋 Validation**: Joi schema validation
- **⚡ Performance**: Compression, caching, and optimization

## 🏗️ Architecture

```
src/
├── config/          # Configuration files
│   ├── database.js  # MongoDB connection manager
│   └── packageSeeder.js
├── middleware/      # Express middleware
│   └── security.js  # Security middleware (CORS, Helmet, Rate limiting)
├── models/          # Mongoose models
│   ├── User.js      # User model with authentication
│   └── Package.js   # Package/subscription model
├── routes/          # API routes
│   ├── auth.js      # Authentication routes
│   ├── packages.js  # Package management routes
│   ├── users.js     # User management routes
│   └── health.js    # Health check routes
├── utils/           # Utility functions
│   ├── logger.js    # Winston logger configuration
│   └── errorHandler.js # Global error handling
└── app.js           # Main application entry point
```

## 📦 Package System

The system includes 5 predefined packages:

### 1. Free Trial (ID: 1)
- **Price**: $0/month
- **Features**: 50 chatbot queries, 10 call handling, 60 voice minutes
- **No credit card required**

### 2. Basic (ID: 2)
- **Price**: $20/month
- **Features**: 500 chatbot queries, 100 call handling, 300 voice minutes, 5GB storage, 3 team members

### 3. Pro (ID: 3)
- **Price**: $50/month
- **Features**: 2000 chatbot queries, 500 call handling, 1000 voice minutes, 20GB storage, 10 team members, API access, priority support

### 4. Premium (ID: 4)
- **Price**: $100/month
- **Features**: Unlimited chatbot queries, unlimited call handling, unlimited voice minutes, 100GB storage, 25 team members, all features

### 5. Custom (ID: 5)
- **Price**: Contact sales
- **Features**: Fully customized enterprise solution with unlimited everything and white-label support

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18.0.0
- MongoDB >= 5.0
- Redis (optional, for caching)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd assistly-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
# Edit .env with your configuration
   ```

4. **Seed the database**
   ```bash
   npm run seed
   ```

5. **Start the application**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## 🗄️ Database Seeding

### Available Commands

```bash
# Seed all data
npm run seed

# Clear all data
npm run seed:clear

# Reset all data (clear + seed)
npm run seed:reset

# Check current data status
npm run seed:status
```

### Manual Seeding

```bash
# Seed packages only
node seeders/packageSeeder.js

# Run main seeder with specific command
node seeders/index.js seed
node seeders/index.js clear
node seeders/index.js reset
node seeders/index.js status
```

## 📡 API Endpoints

### Authentication
- `POST /api/v1/auth/signup` - User registration
- `POST /api/v1/auth/signin` - User login
- `POST /api/v1/auth/refresh-token` - Refresh access token
- `GET /api/v1/auth/profile` - Get user profile
- `POST /api/v1/auth/logout` - User logout

### Packages
- `GET /api/v1/packages` - Get all active packages
- `GET /api/v1/packages/:id` - Get package by ID
- `GET /api/v1/packages/type/:type` - Get package by type
- `GET /api/v1/packages/popular` - Get popular packages
- `GET /api/v1/packages/filter` - Get packages with filters
- `GET /api/v1/packages/compare?ids=1,2,3` - Compare packages

### Users
- `GET /api/v1/users` - Get all users (admin)
- `GET /api/v1/users/:id` - Get user by ID
- `PUT /api/v1/users/:id` - Update user
- `DELETE /api/v1/users/:id` - Delete user

### Health
- `GET /api/v1/health` - Basic health check
- `GET /api/v1/health/detailed` - Detailed system health
- `GET /api/v1/health/ready` - Readiness probe
- `GET /api/v1/health/live` - Liveness probe

## 🔧 Configuration

### Environment Variables

Key configuration options in `.env`:

```bash
# Server
PORT=3000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/assistly

# Security
JWT_SECRET=your-super-secret-jwt-key
BCRYPT_ROUNDS=12

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000        # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100        # 100 requests per 15 minutes
AUTH_RATE_LIMIT_MAX=5              # 5 auth attempts per 15 minutes
SIGNUP_RATE_LIMIT_MAX=3            # 3 signup attempts per hour
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## 🐳 Docker

```bash
# Build Docker image
npm run docker:build

# Run Docker container
npm run docker:run
```

## 📊 Monitoring

### Health Checks
- **Basic Health**: `/api/v1/health`
- **Detailed Health**: `/api/v1/health/detailed`
- **Readiness**: `/api/v1/health/ready`
- **Liveness**: `/api/v1/health/live`

### Logging
- **Development**: Console logging with colors
- **Production**: File-based logging with rotation
- **Log Levels**: error, warn, info, debug

## 🔒 Security Features

- **Rate Limiting**: Global and route-specific limits
- **CORS**: Configurable cross-origin resource sharing
- **Helmet**: Security headers and CSP
- **XSS Protection**: Input sanitization
- **MongoDB Injection Protection**: Query sanitization
- **Brute Force Protection**: Account lockout after failed attempts
- **Password Security**: Bcrypt hashing with configurable rounds

## 📈 Performance

- **Connection Pooling**: MongoDB connection management
- **Compression**: Response compression
- **Caching**: Redis-based caching (optional)
- **Indexing**: Optimized database indexes
- **Graceful Shutdown**: Proper cleanup on termination

## 🚀 Deployment

### Production Checklist

1. **Environment Variables**
   - Set `NODE_ENV=production`
   - Configure production MongoDB URI
   - Set strong JWT secrets
   - Configure production CORS origins

2. **Security**
   - Enable HTTPS
   - Configure firewall rules
   - Set up monitoring and alerting

3. **Scaling**
   - Use PM2 for process management
   - Set up load balancing
   - Configure auto-scaling

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run linting and tests
6. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Contact the development team
- Check the documentation

---

**Built with ❤️ by the Assistly Team**
