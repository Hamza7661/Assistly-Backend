const express = require('express');
const router = express.Router();
// Initialize Stripe only if API key is provided and not empty
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = (stripeKey && typeof stripeKey === 'string' && stripeKey.trim() !== '') 
  ? require('stripe')(stripeKey)
  : null;
const { User } = require('../models/User');
const { Package } = require('../models/Package');
const { Subscription } = require('../models/Subscription');
const { authenticateToken } = require('../middleware/auth');
const { AppError } = require('../utils/errorHandler');
const { logger } = require('../utils/logger');

// Helper function to check if Stripe is configured
const checkStripeConfigured = (req, res, next) => {
  if (!stripe) {
    return next(new AppError('Stripe is not configured. Please set STRIPE_SECRET_KEY in environment variables.', 503));
  }
  next();
};

// Get current subscription
router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const user = await User.findById(userId)
      .populate('subscription')
      .populate('package');
    
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    let subscription = null;
    if (user.subscription) {
      subscription = await Subscription.findById(user.subscription)
        .populate('package');
    }

    res.status(200).json({
      status: 'success',
      data: {
        subscription: subscription,
        package: user.package,
        stripeCustomerId: user.stripeCustomerId
      }
    });
  } catch (error) {
    logger.error('Error fetching subscription:', error);
    next(new AppError('Failed to fetch subscription', 500));
  }
});

// Create checkout session for subscription
router.post('/create-checkout-session', authenticateToken, checkStripeConfigured, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { packageId, successUrl, cancelUrl } = req.body;

    if (!packageId) {
      return next(new AppError('Package ID is required', 400));
    }

    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const packageDoc = await Package.findById(packageId);
    if (!packageDoc) {
      return next(new AppError('Package not found', 404));
    }

    // Skip checkout for free packages
    if (packageDoc.price.amount === 0 || packageDoc.type === 'free-trial') {
      // Directly assign free package
      user.package = packageId;
      await user.save();
      
      return res.status(200).json({
        status: 'success',
        data: {
          message: 'Free package activated',
          package: packageDoc
        }
      });
    }

    // Create or get Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        metadata: {
          userId: userId.toString()
        }
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    // Create Stripe Price if needed (for monthly subscriptions)
    let priceId = packageDoc.metadata?.stripePriceId;
    
    if (!priceId) {
      // Create price based on package
      const price = await stripe.prices.create({
        unit_amount: Math.round(packageDoc.price.amount * 100), // Convert to cents
        currency: packageDoc.price.currency.toLowerCase(),
        recurring: {
          interval: packageDoc.price.billingCycle === 'yearly' ? 'year' : 'month'
        },
        product_data: {
          name: packageDoc.name,
          description: packageDoc.description
        },
        metadata: {
          packageId: packageId.toString()
        }
      });
      priceId = price.id;
      
      // Store price ID in package metadata (if you have a metadata field)
      // For now, we'll store it in the subscription
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: successUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?subscription=success`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/packages?subscription=canceled`,
      metadata: {
        userId: userId.toString(),
        packageId: packageId.toString()
      },
      subscription_data: {
        metadata: {
          userId: userId.toString(),
          packageId: packageId.toString()
        }
      },
      allow_promotion_codes: true
    });

    res.status(200).json({
      status: 'success',
      data: {
        sessionId: session.id,
        url: session.url
      }
    });
  } catch (error) {
    logger.error('Error creating checkout session:', error);
    next(new AppError(error.message || 'Failed to create checkout session', 500));
  }
});

// Create portal session for managing subscription
router.post('/create-portal-session', authenticateToken, checkStripeConfigured, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { returnUrl } = req.body;

    const user = await User.findById(userId);
    if (!user || !user.stripeCustomerId) {
      return next(new AppError('No active subscription found', 404));
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard`
    });

    res.status(200).json({
      status: 'success',
      data: {
        url: session.url
      }
    });
  } catch (error) {
    logger.error('Error creating portal session:', error);
    next(new AppError(error.message || 'Failed to create portal session', 500));
  }
});

// Webhook handler for Stripe events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    logger.warn('Stripe webhook received but Stripe is not configured');
    return res.status(503).json({ error: 'Stripe is not configured' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.warn('Stripe webhook secret not configured');
    return res.status(503).json({ error: 'Webhook secret not configured' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutCompleted(session);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionUpdate(subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        await handlePaymentSucceeded(invoice);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handlePaymentFailed(invoice);
        break;
      }
      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Helper functions for webhook handlers
async function handleCheckoutCompleted(session) {
  try {
    if (!stripe) {
      logger.error('Stripe not configured, cannot process checkout completion');
      return;
    }

    const userId = session.metadata?.userId;
    const packageId = session.metadata?.packageId;

    if (!userId || !packageId) {
      logger.error('Missing metadata in checkout session:', session.id);
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      logger.error('User not found:', userId);
      return;
    }

    // Get subscription from Stripe
    const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);

    // Create or update subscription in database
    let subscription = await Subscription.findOne({ stripeSubscriptionId: stripeSubscription.id });
    
    if (!subscription) {
      subscription = new Subscription({
        user: userId,
        package: packageId,
        stripeCustomerId: stripeSubscription.customer,
        stripeSubscriptionId: stripeSubscription.id,
        stripePriceId: stripeSubscription.items.data[0].price.id,
        status: stripeSubscription.status,
        currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        billingCycle: stripeSubscription.items.data[0].price.recurring?.interval === 'year' ? 'yearly' : 'monthly',
        amount: stripeSubscription.items.data[0].price.unit_amount / 100,
        currency: stripeSubscription.items.data[0].price.currency.toUpperCase()
      });
    } else {
      subscription.status = stripeSubscription.status;
      subscription.currentPeriodStart = new Date(stripeSubscription.current_period_start * 1000);
      subscription.currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
      subscription.cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end;
    }

    await subscription.save();

    // Update user
    user.package = packageId;
    user.subscription = subscription._id;
    if (!user.stripeCustomerId) {
      user.stripeCustomerId = stripeSubscription.customer;
    }
    await user.save();

    logger.info('Checkout completed and subscription created:', { userId, subscriptionId: subscription._id });
  } catch (error) {
    logger.error('Error handling checkout completed:', error);
    throw error;
  }
}

async function handleSubscriptionUpdate(stripeSubscription) {
  try {
    const subscription = await Subscription.findOne({ stripeSubscriptionId: stripeSubscription.id });
    
    if (!subscription) {
      logger.warn('Subscription not found in database:', stripeSubscription.id);
      return;
    }

    subscription.status = stripeSubscription.status;
    subscription.currentPeriodStart = new Date(stripeSubscription.current_period_start * 1000);
    subscription.currentPeriodEnd = new Date(stripeSubscription.current_period_end * 1000);
    subscription.cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end;
    
    if (stripeSubscription.canceled_at) {
      subscription.canceledAt = new Date(stripeSubscription.canceled_at * 1000);
    }

    await subscription.save();

    logger.info('Subscription updated:', { subscriptionId: subscription._id, status: subscription.status });
  } catch (error) {
    logger.error('Error handling subscription update:', error);
    throw error;
  }
}

async function handleSubscriptionDeleted(stripeSubscription) {
  try {
    const subscription = await Subscription.findOne({ stripeSubscriptionId: stripeSubscription.id });
    
    if (!subscription) {
      logger.warn('Subscription not found in database:', stripeSubscription.id);
      return;
    }

    subscription.status = 'canceled';
    subscription.canceledAt = new Date();
    await subscription.save();

    // Update user to remove package (or set to free trial)
    const user = await User.findById(subscription.user);
    if (user) {
      // Optionally set to free trial package
      const freeTrialPackage = await Package.findOne({ type: 'free-trial' });
      if (freeTrialPackage) {
        user.package = freeTrialPackage._id;
      } else {
        user.package = null;
      }
      user.subscription = null;
      await user.save();
    }

    logger.info('Subscription canceled:', { subscriptionId: subscription._id });
  } catch (error) {
    logger.error('Error handling subscription deleted:', error);
    throw error;
  }
}

async function handlePaymentSucceeded(invoice) {
  try {
    const subscription = await Subscription.findOne({ stripeCustomerId: invoice.customer });
    
    if (subscription) {
      subscription.status = 'active';
      await subscription.save();
      logger.info('Payment succeeded for subscription:', subscription._id);
    }
  } catch (error) {
    logger.error('Error handling payment succeeded:', error);
    throw error;
  }
}

async function handlePaymentFailed(invoice) {
  try {
    const subscription = await Subscription.findOne({ stripeCustomerId: invoice.customer });
    
    if (subscription) {
      subscription.status = 'past_due';
      await subscription.save();
      logger.warn('Payment failed for subscription:', subscription._id);
    }
  } catch (error) {
    logger.error('Error handling payment failed:', error);
    throw error;
  }
}

module.exports = router;

