const { Server } = require('socket.io');
const { logger } = require('./logger');

class WebSocketServer {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socketId mapping
  }

  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"]
      }
    });

    this.io.on('connection', (socket) => {
      logger.info(`WebSocket client connected: ${socket.id}`);

      // Handle user authentication and room joining
      socket.on('join', (userId) => {
        if (userId) {
          this.connectedUsers.set(userId, socket.id);
          socket.join(`user_${userId}`);
          logger.info(`User ${userId} joined WebSocket room`);
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        // Find and remove the user from connectedUsers
        for (const [userId, socketId] of this.connectedUsers.entries()) {
          if (socketId === socket.id) {
            this.connectedUsers.delete(userId);
            logger.info(`User ${userId} disconnected from WebSocket`);
            break;
          }
        }
      });
    });

    logger.info('WebSocket server initialized');
    return this.io;
  }

  // Broadcast to a specific user
  broadcastToUser(userId, data) {
    if (!this.io) {
      logger.warn('WebSocket server not initialized');
      return;
    }

    try {
      this.io.to(`user_${userId}`).emit('new_lead', data);
      logger.info(`Broadcasted new_lead to user ${userId}:`, data.type);
    } catch (error) {
      logger.error('Error broadcasting to user:', error);
    }
  }

  // Broadcast app creation progress to a specific user
  broadcastAppCreationProgress(userId, progressData) {
    if (!this.io) {
      logger.warn('WebSocket server not initialized');
      return;
    }

    try {
      this.io.to(`user_${userId}`).emit('app_creation_progress', progressData);
      logger.info(`Broadcasted app_creation_progress to user ${userId}:`, progressData.step);
    } catch (error) {
      logger.error('Error broadcasting app creation progress:', error);
    }
  }

  // Broadcast to all connected users
  broadcastToAll(data) {
    if (!this.io) {
      logger.warn('WebSocket server not initialized');
      return;
    }

    try {
      this.io.emit('message', data);
      logger.info('Broadcasted message to all users:', data.type);
    } catch (error) {
      logger.error('Error broadcasting to all users:', error);
    }
  }

  // Get connected users count
  getConnectedUsersCount() {
    return this.connectedUsers.size;
  }

  // Check if user is connected
  isUserConnected(userId) {
    return this.connectedUsers.has(userId);
  }
}

// Create singleton instance
const websocketServer = new WebSocketServer();

module.exports = websocketServer;
