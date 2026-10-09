import { Schema, model, Types, type InferSchemaType } from 'mongoose';

const skuSchema = new Schema(
  {
    shopId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, required: true, index: true },
    images: { type: [String], default: [] },
    totalQty: { type: Number, required: true, min: 1 },
    bufferDays: { type: Number, default: 0, min: 0 },
    dailyPriceMinor: { type: Number, required: true, min: 0 }, // integer minor units (paise/cents)
    depositMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
skuSchema.index({ title: 'text', description: 'text' });

export type SkuDoc = InferSchemaType<typeof skuSchema>;
export const Sku = model('Sku', skuSchema);
