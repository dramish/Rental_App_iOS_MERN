import { Schema, model, Types } from 'mongoose';
import { pointSchema } from '../shops/shop.model';

/** One per driver user. `location` is the COARSE position used for dispatch ($near); fine-grained tracking lives in the location cache. */
const driverSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, unique: true },
    online: { type: Boolean, default: false },
    location: { type: pointSchema },
    locationUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
driverSchema.index({ location: '2dsphere' });
driverSchema.index({ online: 1 });

export const Driver = model('Driver', driverSchema);

export const TASK_STATUSES = ['OPEN', 'OFFERED', 'ASSIGNED', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** A unit of driver work: one leg of an order. (orderId, leg) is unique. */
const taskSchema = new Schema(
  {
    orderId: { type: Types.ObjectId, ref: 'Order', required: true },
    leg: { type: String, enum: ['DELIVERY', 'RETURN'], required: true },
    status: { type: String, enum: TASK_STATUSES, required: true, default: 'OPEN' },
    pickup: { type: pointSchema, required: true },
    dropoff: { type: pointSchema, required: true },
    offeredTo: { type: Types.ObjectId, ref: 'User', default: null },
    offerExpiresAt: { type: Date, default: null },
    declinedBy: { type: [Types.ObjectId], default: [] },
    attempts: { type: Number, default: 0 },
    driverId: { type: Types.ObjectId, ref: 'User', default: null },
    assignedAt: { type: Date },
  },
  { timestamps: true },
);
taskSchema.index({ orderId: 1, leg: 1 }, { unique: true });
taskSchema.index({ status: 1 });
taskSchema.index({ driverId: 1, status: 1 });
taskSchema.index({ offeredTo: 1, status: 1 });

export const DeliveryTask = model('DeliveryTask', taskSchema);
