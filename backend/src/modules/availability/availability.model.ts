import { Schema, model, Types } from 'mongoose';

/**
 * Per-day capacity bucket: how many units of a SKU are reserved on a UTC day.
 * Invariant: 0 <= reserved <= sku.totalQty, enforced by conditional $inc, never read-then-write.
 */
const availabilityDaySchema = new Schema({
  skuId: { type: Types.ObjectId, ref: 'Sku', required: true },
  date: { type: Date, required: true }, // UTC midnight
  reserved: { type: Number, required: true, default: 0, min: 0 },
});
availabilityDaySchema.index({ skuId: 1, date: 1 }, { unique: true });

export const AvailabilityDay = model('AvailabilityDay', availabilityDaySchema);

const reservationSchema = new Schema(
  {
    orderId: { type: Types.ObjectId, required: true },
    skuId: { type: Types.ObjectId, ref: 'Sku', required: true },
    qty: { type: Number, required: true, min: 1 },
    startDate: { type: Date, required: true }, // rental window
    endDate: { type: Date, required: true },
    blockedStart: { type: Date, required: true }, // rental window widened by the SKU's buffer days
    blockedEnd: { type: Date, required: true },
    status: { type: String, enum: ['HELD', 'CONFIRMED', 'RELEASED'], required: true },
    holdExpiresAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
reservationSchema.index({ orderId: 1, skuId: 1 }, { unique: true }); // one reservation per (order, sku): makes reserve() replay-safe

export const Reservation = model('Reservation', reservationSchema);
