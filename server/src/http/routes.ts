import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, requireCustomer, requireInternal } from './middleware/auth';
import { authRoutes, portalAuthRoutes } from '../modules/auth/authRoutes';
import { userRoutes } from '../modules/users/userRoutes';
import { customerRoutes, customerTierRoutes } from '../modules/customers/customerRoutes';
import { categoryRoutes, productRoutes } from '../modules/catalog/catalogRoutes';
import { discountRuleRoutes, priceListRoutes } from '../modules/pricing/pricingRoutes';
import { approvalRuleRoutes } from '../modules/approvalConfig/approvalRuleRoutes';
import { warehouseRoutes } from '../modules/inventory/inventoryRoutes';
import { subscriptionPlanRoutes } from '../modules/subscriptionPlans/subscriptionPlanRoutes';
import { quotationRoutes } from '../modules/quotations/quotationRoutes';
import {
  productPairingRoutes,
  promotionRoutes,
} from '../modules/recommendationConfig/recommendationConfigRoutes';

/**
 * API surface.
 *
 * Three namespaces with different trust levels:
 *   /api/health, /api/auth/*      - unauthenticated or self-service
 *   /api/portal/*                 - customer sessions only, scoped by customer id
 *   everything else under /api    - internal roles only
 *
 * The internal and portal guards are mounted on the routers rather than repeated
 * per handler, so a future route cannot be added to the wrong side of the
 * boundary by omission (docs/PRD.md 15). Each module router then declares its own
 * capability requirements per route.
 */
export function buildApiRouter(): Router {
  const api = Router();

  api.get('/health', async (_req, res) => {
    // Report the database too: an API that answers while the database is down is
    // a misleading health signal.
    let database: 'up' | 'down' = 'up';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    res.status(database === 'up' ? 200 : 503).json({
      data: { status: database === 'up' ? 'ok' : 'degraded', database, time: new Date().toISOString() },
    });
  });

  api.use('/auth', authRoutes);

  const portal = Router();
  portal.use('/auth', portalAuthRoutes);
  portal.use(requireAuth, requireCustomer);
  // Customer-facing quotation and negotiation routes are added in a later slice.
  api.use('/portal', portal);

  const internal = Router();
  internal.use(requireAuth, requireInternal);

  // Identity
  internal.use('/users', userRoutes);

  // Master data - customers
  internal.use('/customer-tiers', customerTierRoutes);
  internal.use('/customers', customerRoutes);

  // Master data - catalogue
  internal.use('/categories', categoryRoutes);
  internal.use('/products', productRoutes);
  internal.use('/subscription-plans', subscriptionPlanRoutes);

  // Master data - pricing and governance
  internal.use('/price-lists', priceListRoutes);
  internal.use('/discount-rules', discountRuleRoutes);
  internal.use('/approval-rules', approvalRuleRoutes);

  // Master data - operations
  internal.use('/warehouses', warehouseRoutes);

  // Master data - recommendation inputs
  internal.use('/product-pairings', productPairingRoutes);
  internal.use('/promotions', promotionRoutes);

  // Transactional - quotation lifecycle
  internal.use('/quotations', quotationRoutes);

  api.use(internal);

  return api;
}
