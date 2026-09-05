/** Domain types — minimal shapes the UI actually reads. */

export type { Role } from '@dealflow/shared';

export type QuotationStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'REVISION_REQUIRED'
  | 'SENT' | 'UNDER_NEGOTIATION' | 'CONFIRMED' | 'FULFILLMENT' | 'COMPLETED';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVISION_REQUIRED' | 'SUPERSEDED';

export type ApprovalLevel = 'MANAGER' | 'FINANCE';

export type RequiredApprovalLevel = 'NONE' | 'MANAGER' | 'MANAGER_FINANCE';

export type BillingType = 'ONE_TIME' | 'RECURRING';

export interface Customer {
  id: string; code: string; name: string; tierId: string;
  tier?: { id: string; name: string; defaultDiscountCeilingBp: number };
  contactName?: string | null; contactEmail?: string | null; paymentTermsDays?: number;
}

export interface Product {
  id: string; sku: string; name: string; categoryId: string; unit: string;
  basePricePaise: number; unitCostPaise: number | null; taxBp: number;
  billingType: BillingType; stockTracked: boolean; active: boolean;
  category?: { id: string; name: string };
}

export interface QuotationLine {
  id: string; productId: string; productName: string; productSku: string;
  categoryId: string; categoryName: string;
  quantity: number; listUnitPricePaise: number; unitPricePaise: number;
  discountBp: number; effectiveCeilingBp: number; violationBp: number;
  taxBp: number; lineTotalPaise: number; netAmountPaise: number; marginPaise: number;
  lineType: BillingType; subscriptionPlanId?: string | null;
}

export interface Quotation {
  id: string; quoteNumber: string; customerId: string; salesRepId: string;
  status: QuotationStatus; version: number;
  orderDiscountBp: number;
  subtotalPaise: number; discountTotalPaise: number; taxTotalPaise: number; grandTotalPaise: number;
  oneTimeSubtotalPaise: number; oneTimeGrandTotalPaise: number;
  recurringSubtotalPaise: number; recurringGrandTotalPaise: number;
  estimatedCostPaise: number; marginPaise: number; marginBp: number;
  riskScoreBp: number; requiredApprovalLevel: RequiredApprovalLevel;
  approvedVersion?: number | null; approvedAt?: string | null;
  sentAt?: string | null; confirmedAt?: string | null;
  promisedDeliveryDate?: string | null;
  projectedDeliveryDate?: string | null;
  validUntil?: string | null;
  lastActivityAt?: string | null;
  notes?: string | null; createdAt: string; updatedAt: string;
  lines?: QuotationLine[];
  customer?: Customer;
}

export interface ApprovalInstance {
  id: string; quotationId: string; quotationVersion: number;
  attempt: number; sequence: number; level: ApprovalLevel;
  status: ApprovalStatus; riskScoreBp: number;
  reviewerId?: string | null; actedAt?: string | null; reason?: string | null;
}

export interface RecommendationSuggestion {
  productId: string; productName: string; productSku: string;
  categoryName: string; unitPricePaise: number;
  marginBp: number; pairingWeight: number; promoLabel?: string | null;
  reason: string;
}

export interface Fulfillment {
  id: string; quotationId: string; status: string;
  plannedShipmentCount: number; plannedShippingCostPaise: number;
  projectedDeliveryDate?: string | null; acceptedAt?: string | null;
  allocations?: Array<{ id: string; warehouseId: string; warehouseName?: string; quantity: number; shipmentCostPaise: number; reserved: boolean; shippedAt?: string | null }>;
  backorders?: Array<{ id: string; productId: string; productName?: string; quantity: number; status: string }>;
}

export interface DealHealthEvent {
  id: string; quotationId: string; quotation?: { quoteNumber: string };
  type: 'STALLED' | 'DISCOUNT_ANOMALY' | 'DELIVERY_SLIPPAGE';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  title: string; detail: string; fingerprint: string;
  createdAt: string; nudgedAt?: string | null; escalatedAt?: string | null; resolvedAt?: string | null;
}

export interface AuditEntry {
  id: string; entityType: string; entityId: string; action: string;
  actorUserId?: string | null; actorRole?: string | null; actorLabel?: string | null;
  quotationId?: string | null; quotationVersion?: number | null;
  reason?: string | null;
  oldValue?: unknown; newValue?: unknown;
  createdAt: string;
}
