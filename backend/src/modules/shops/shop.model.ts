import { Schema, model, Types } from 'mongoose';

export const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  { _id: false },
);

/** One profile per shop user. The location is the pickup/return point for drivers. */
const shopSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String, required: true, trim: true },
    addressLine: { type: String, required: true },
    city: { type: String, required: true },
    location: { type: pointSchema, required: true },
  },
  { timestamps: true },
);

export const Shop = model('Shop', shopSchema);
