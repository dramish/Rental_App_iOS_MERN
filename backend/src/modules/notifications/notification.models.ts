import { Schema, model, Types } from 'mongoose';

const deviceTokenSchema = new Schema(
  {
    userId: { type: Types.ObjectId, required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, default: 'ios' },
    bundleId: { type: String }, // which app registered it: APNs topic must match
  },
  { timestamps: true },
);
export const DeviceToken = model('DeviceToken', deviceTokenSchema);

/** ActivityKit push-to-update token for one order's Live Activity on one user's device. */
const liveActivityTokenSchema = new Schema(
  {
    orderId: { type: Types.ObjectId, required: true },
    userId: { type: Types.ObjectId, required: true },
    pushToken: { type: String, required: true },
  },
  { timestamps: true },
);
liveActivityTokenSchema.index({ orderId: 1, userId: 1 }, { unique: true });
export const LiveActivityToken = model('LiveActivityToken', liveActivityTokenSchema);
