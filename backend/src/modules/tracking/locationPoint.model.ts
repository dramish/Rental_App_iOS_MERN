import { Schema, model, Types } from 'mongoose';

/** Location history for accepted points. TTL keeps it bounded (7 days). */
const locationPointSchema = new Schema({
  driverId: { type: Types.ObjectId, required: true },
  orderId: { type: Types.ObjectId },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  accuracy: { type: Number },
  speed: { type: Number },
  seq: { type: Number, required: true },
  recordedAt: { type: Date, required: true },
});
locationPointSchema.index({ driverId: 1, seq: 1 });
locationPointSchema.index({ orderId: 1, recordedAt: 1 });
locationPointSchema.index({ recordedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

export const LocationPoint = model('LocationPoint', locationPointSchema);
