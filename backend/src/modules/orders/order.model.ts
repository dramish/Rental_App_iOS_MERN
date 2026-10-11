import { Schema, model, Types } from 'mongoose';
import { pointSchema } from '../shops/shop.model';

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'IN_USE',
  'OVERDUE',
  'RETURN_SCHEDULED',
  'PICKED_UP',
  'INSPECTED',
  'SETTLED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const itemSchema = new Schema(
  {
    skuId: { type: Types.ObjectId, required: true },
    title: { type: String, required: true },
    qty: { type: Number, required: true },
    dailyPriceMinor: { type: Number, required: true },
    depositMinor: { type: Number, required: true },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    customerId: { type: Types.ObjectId, ref: 'User', required: true },
    shopId: { type: Types.ObjectId, ref: 'User', required: true },
    items: { type: [itemSchema], required: true },
    rentalStart: { type: String, required: true }, // 'YYYY-MM-DD' UTC
    rentalEnd: { type: String, required: true },
    days: { type: Number, required: true },
    address: {
      line1: { type: String, required: true },
      city: { type: String, required: true },
      postalCode: { type: String, required: true },
      location: { type: pointSchema, required: true },
    },
    pickupLocation: { type: pointSchema, required: true }, // shop location, copied at placement
    currency: { type: String, required: true },
    rentMinor: { type: Number, required: true },
    depositMinor: { type: Number, required: true },
    totalMinor: { type: Number, required: true },
    status: { type: String, enum: ORDER_STATUSES, required: true, default: 'PENDING_PAYMENT' },
    /** Bumped on every state change. Clients compare versions to detect gaps and resync. */
    version: { type: Number, required: true, default: 1 },
    payment: {
      intentId: { type: String },
      status: { type: String, enum: ['none', 'authorized', 'captured', 'cancelled'], default: 'none' },
    },
    deliveryDriverId: { type: Types.ObjectId, ref: 'User' },
    returnDriverId: { type: Types.ObjectId, ref: 'User' },
    deliveredAt: { type: Date },
    pickedUpAt: { type: Date },
    settlement: {
      lateDays: { type: Number },
      lateFeeMinor: { type: Number },
      damageMinor: { type: Number },
      capturedMinor: { type: Number },
    },
  },
  { timestamps: true },
);
orderSchema.index({ customerId: 1, _id: -1 });
orderSchema.index({ shopId: 1, _id: -1 });
orderSchema.index({ deliveryDriverId: 1, _id: -1 }, { sparse: true });
orderSchema.index({ returnDriverId: 1, _id: -1 }, { sparse: true });

export const Order = model('Order', orderSchema);

/** Append-only audit log. (orderId, version) and (orderId, idempotencyKey) are unique. */
const orderEventSchema = new Schema({
  orderId: { type: Types.ObjectId, required: true },
  version: { type: Number, required: true },
  event: { type: String, required: true },
  fromStatus: { type: String },
  toStatus: { type: String, required: true },
  actorId: { type: String, required: true },
  actorRole: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  payload: { type: Schema.Types.Mixed },
  at: { type: Date, default: Date.now },
});
orderEventSchema.index({ orderId: 1, version: 1 }, { unique: true });
orderEventSchema.index({ orderId: 1, idempotencyKey: 1 }, { unique: true });

export const OrderEvent = model('OrderEvent', orderEventSchema);
