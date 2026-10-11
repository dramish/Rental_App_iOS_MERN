import { Schema, model } from 'mongoose';

/** Dedupe table for provider webhooks. Providers deliver at-least-once, so the same eventId can arrive many times. */
const webhookEventSchema = new Schema({
  eventId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['processing', 'done'], required: true },
  receivedAt: { type: Date, default: Date.now },
});
export const WebhookEvent = model('WebhookEvent', webhookEventSchema);
